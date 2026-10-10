'use strict';

const { app, core } = require('photoshop');
const fs = require('uxp').storage.localFileSystem;
const formats = require('uxp').storage.formats;

const API_BASES = ['http://127.0.0.1:5000', 'http://localhost:5000'];
const $ = (id) => document.getElementById(id);
const btnProcess = $('btnProcess');
const btnCheck = $('btnCheck');
const statusText = $('statusText');
const detailText = $('detailText');
const progressBar = $('progressBar');
const progressTrack = document.querySelector('.progress-track');
const statusDot = $('statusDot');

function updateStatus(title, detail, progress = 0, type = '') {
    statusText.textContent = title;
    detailText.textContent = detail || '';
    const safeProgress = Math.max(0, Math.min(100, Number(progress) || 0));
    progressBar.style.width = `${safeProgress}%`;
    progressTrack.setAttribute('aria-valuenow', String(safeProgress));
    statusDot.className = `status-dot${type ? ` ${type}` : ''}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 300000) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timeoutId = null;
    if (controller) timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, controller ? { ...options, signal: controller.signal } : options);
    } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
    }
}

async function requestFromServer(path, options = {}, timeoutMs = 300000) {
    let lastError = null;
    for (const base of API_BASES) {
        try {
            return await fetchWithTimeout(`${base}${path}`, options, timeoutMs);
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError && lastError.name === 'AbortError') {
        throw new Error('Yêu cầu quá thời gian chờ. Hãy thử ảnh nhỏ hơn hoặc kiểm tra server_debug.log.');
    }
    throw new Error('Không kết nối được AI Server. Hãy chạy run_ai_server.bat và kiểm tra cổng 5000.');
}

function getLayersList(doc) {
    const list = [];
    if (!doc || !doc.layers) return list;
    const len = Number(doc.layers.length) || 0;
    for (let i = 0; i < len; i++) {
        try {
            if (doc.layers[i]) list.push(doc.layers[i]);
        } catch (_) {}
    }
    return list;
}

function isDocumentOpen(docId) {
    if (!app.documents) return false;
    const len = Number(app.documents.length) || 0;
    for (let i = 0; i < len; i++) {
        try {
            if (app.documents[i] && app.documents[i].id === docId) return true;
        } catch (_) {}
    }
    return false;
}


async function checkServer(showStatus = true) {
    if (showStatus) updateStatus('Đang kiểm tra server…', 'Đang kết nối đến máy chủ AI trên máy này.', 10, 'warning');
    try {
        const response = await requestFromServer('/health', { method: 'GET' }, 5000);
        const data = await response.json();
        if (!response.ok || data.status !== 'ok') {
            throw new Error(data.message || `Server trả về HTTP ${response.status}.`);
        }
        if (showStatus) {
            updateStatus('AI Server đã sẵn sàng', `Model: ${data.model || 'đã khởi tạo'} · API v${data.api_version || 2}`, 100, 'success');
        }
        return data;
    } catch (error) {
        if (showStatus) updateStatus('Không kết nối được AI Server', error.message, 0, 'error');
        throw error;
    }
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    if (typeof btoa === 'function') {
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, chunk);
        }
        return btoa(binary);
    }
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const len = bytes.length;
    let base64 = '';
    for (let i = 0; i < len; i += 3) {
        const b0 = bytes[i];
        const b1 = i + 1 < len ? bytes[i + 1] : 0;
        const b2 = i + 2 < len ? bytes[i + 2] : 0;
        base64 += chars[b0 >> 2];
        base64 += chars[((b0 & 3) << 4) | (b1 >> 4)];
        base64 += (i + 1 < len) ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
        base64 += (i + 2 < len) ? chars[b2 & 63] : '=';
    }
    return base64;
}

function base64ToArrayBuffer(base64Data) {
    if (typeof base64Data !== 'string' || !base64Data.length) {
        throw new Error('Dữ liệu ảnh trả về đang trống.');
    }
    const cleanData = base64Data.replace(/^data:image\/[^;]+;base64,/i, '').replace(/[\r\n\s]/g, '');
    if (typeof atob === 'function') {
        let binary;
        try {
            binary = atob(cleanData);
        } catch (_) {
            throw new Error('Dữ liệu Base64 trả về không thể giải mã.');
        }
        const bLen = Math.max(0, Number(binary.length) || 0);
        const bytes = new Uint8Array(bLen);
        for (let i = 0; i < bLen; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lookup = new Uint8Array(256);
    for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
    let len = cleanData.length;
    let padding = 0;
    if (cleanData.endsWith('==')) padding = 2;
    else if (cleanData.endsWith('=')) padding = 1;
    const bytesLen = Math.max(0, Math.floor((len * 3 / 4) - padding));
    const bytes = new Uint8Array(bytesLen);
    let byteIdx = 0;
    for (let i = 0; i < len; i += 4) {
        const c1 = lookup[cleanData.charCodeAt(i)];
        const c2 = lookup[cleanData.charCodeAt(i + 1)];
        const c3 = lookup[cleanData.charCodeAt(i + 2)];
        const c4 = lookup[cleanData.charCodeAt(i + 3)];
        if (byteIdx < bytesLen) bytes[byteIdx++] = (c1 << 2) | (c2 >> 4);
        if (byteIdx < bytesLen) bytes[byteIdx++] = ((c2 & 15) << 4) | (c3 >> 2);
        if (byteIdx < bytesLen) bytes[byteIdx++] = ((c3 & 3) << 6) | c4;
    }
    return bytes.buffer;
}

async function fileToBase64(file) {
    const arrayBuffer = await file.read({ format: formats.binary });
    return arrayBufferToBase64(arrayBuffer);
}

async function base64ToFile(base64Data, file) {
    if (typeof base64Data !== 'string' || !base64Data.length) {
        throw new Error(`Dữ liệu ảnh trả về cho ${file.name} đang trống.`);
    }
    const buffer = base64ToArrayBuffer(base64Data);
    await file.write(buffer, { format: formats.binary });
}

async function exportCompositeToPng(sourceDoc, exportFile) {
    let exportDoc = null;
    try {
        await core.executeAsModal(async () => {
            exportDoc = await sourceDoc.duplicate('AI Layer Splitter - Temp Export', true);
            await exportDoc.saveAs.png(exportFile);
            await exportDoc.closeWithoutSaving();
            exportDoc = null;
        }, { commandName: 'AI Layer Splitter - Export Composite' });
    } catch (error) {
        if (exportDoc) {
            try {
                await core.executeAsModal(async () => {
                    await exportDoc.closeWithoutSaving();
                }, { commandName: 'AI Layer Splitter - Close Temp Export' });
            } catch (_) { /* Preserve the original export error. */ }
        }
        throw new Error(`Không xuất được ảnh tạm từ Photoshop: ${error.message}`);
    }
}

async function createLayerMaskFromTransparency(layer) {
    if (!layer || !layer.id) {
        throw new Error('Không xác định được layer để tạo Layer Mask.');
    }

    const { batchPlay } = require('photoshop').action;
    await batchPlay([
        {
            _obj: 'select',
            _target: [{ _ref: 'layer', _id: layer.id }],
            makeVisible: false,
            _options: { dialogOptions: 'dontDisplay' }
        },
        {
            // Photoshop's native Layer > Layer Mask > From Transparency:
            // converts the layer's current alpha/transparency into a user mask.
            _obj: 'make',
            new: { _class: 'channel' },
            at: { _ref: 'channel', _enum: 'channel', _value: 'mask' },
            using: { _enum: 'userMaskEnabled', _value: 'transparency' },
            _options: { dialogOptions: 'dontDisplay' }
        }
    ], {});
}

async function importPngAsLayer(file, targetDoc, name, placement = null, createMaskFromTransparency = false) {
    let tempDoc = null;
    try {
        tempDoc = await app.open(file);
        if (!tempDoc.layers || tempDoc.layers.length === 0) {
            throw new Error(`File kết quả không có layer: ${name}`);
        }
        const importedLayer = await tempDoc.layers[0].duplicate(targetDoc);
        importedLayer.name = name;

        // Cropped object PNGs save scratch space. After duplicating a cropped
        // image into the source document, restore its original canvas position.
        // This path is only used when the API returns crop_x/crop_y; ordinary
        // full-canvas foreground/background imports keep their existing placement.
        if (placement &&
            Number.isFinite(Number(placement.x)) &&
            Number.isFinite(Number(placement.y))) {
            const bounds = importedLayer.bounds;
            const readPx = (value) => {
                if (typeof value === 'number') return value;
                if (value && typeof value.value === 'number') return value.value;
                if (value && typeof value._value === 'number') return value._value;
                return Number(value);
            };
            const left = readPx(bounds.left);
            const top = readPx(bounds.top);
            if (!Number.isFinite(left) || !Number.isFinite(top)) {
                throw new Error('Không đọc được tọa độ layer sau khi nhập ảnh đã cắt.');
            }
            await importedLayer.translate(Number(placement.x) - left, Number(placement.y) - top);
        }

        if (createMaskFromTransparency) {
            await createLayerMaskFromTransparency(importedLayer);
        }

        await tempDoc.closeWithoutSaving();
        tempDoc = null;
        return importedLayer;
    } finally {
        if (tempDoc) {
            try { await tempDoc.closeWithoutSaving(); } catch (_) { /* Best-effort cleanup. */ }
        }
    }
}


/* Click-to-select individual object using the optional local SAM model. */
const btnLoadSegImage = $('btnLoadSegImage');
const btnClearPoints = $('btnClearPoints');
const btnAddObject = $('btnAddObject');
const segPointMode = $('segPointMode');
const segPreviewWrap = $('segPreviewWrap');
const segPreviewImage = $('segPreviewImage');
const segOverlayCanvas = $('segOverlayCanvas');
const segPointCount = $('segPointCount');
const segScore = $('segScore');
const segObjectName = $('segObjectName');
const segHint = $('segHint');

let segmentationImageId = null;
let segmentationDocumentId = null;
let segmentationPoints = [];
let segmentationLayerCount = 0;
let segmentationRequestInProgress = false;
let segmentationHasMask = false;

function setSegHint(message, type = '') {
    if (!segHint) return;
    segHint.textContent = message || '';
    segHint.className = 'seg-hint' + (type ? ' ' + type : '');
}

function clearSegOverlay() {
    if (segOverlayCanvas) {
        const ctx = segOverlayCanvas.getContext('2d');
        ctx.clearRect(0, 0, segOverlayCanvas.width, segOverlayCanvas.height);
    }
    segmentationHasMask = false;
    if (btnAddObject) btnAddObject.disabled = true;
    if (segScore) segScore.textContent = '';
}

function drawSegOverlay(overlayBase64) {
    return new Promise((resolve, reject) => {
        const overlayImage = new Image();
        overlayImage.onload = () => {
            const width = segPreviewImage.naturalWidth;
            const height = segPreviewImage.naturalHeight;
            segOverlayCanvas.width = width;
            segOverlayCanvas.height = height;
            const ctx = segOverlayCanvas.getContext('2d');
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(overlayImage, 0, 0, width, height);
            for (const point of segmentationPoints) {
                const positive = point.label === 1;
                ctx.beginPath();
                ctx.arc(point.x, point.y, Math.max(5, Math.round(width / 180)), 0, Math.PI * 2);
                ctx.fillStyle = positive ? '#23e69b' : '#ff6677';
                ctx.fill();
                ctx.lineWidth = Math.max(2, Math.round(width / 500));
                ctx.strokeStyle = '#10141d';
                ctx.stroke();
            }
            resolve();
        };
        overlayImage.onerror = () => reject(new Error('Không hiển thị được lớp phủ vùng chọn.'));
        overlayImage.src = 'data:image/png;base64,' + overlayBase64;
    });
}

function updateSegPointLabel() {
    const positive = segmentationPoints.filter(point => point.label === 1).length;
    const negative = segmentationPoints.filter(point => point.label === 0).length;
    if (segPointCount) {
        segPointCount.textContent = segmentationPoints.length
            ? (segmentationPoints.length + ' điểm · +' + positive + ' giữ · −' + negative + ' loại')
            : 'Chưa có điểm chọn';
    }
}

async function postSegmentation(path, body, timeoutMs = 600000) {
    const response = await requestFromServer(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }, timeoutMs);
    let data;
    try {
        data = await response.json();
    } catch (_) {
        throw new Error('AI Server trả về dữ liệu không hợp lệ (HTTP ' + response.status + ').');
    }
    if (!response.ok || data.status !== 'success') {
        throw new Error(data.error || ('Yêu cầu tách vật thể thất bại (HTTP ' + response.status + ').'));
    }
    return data;
}

if (btnLoadSegImage) {
    btnLoadSegImage.addEventListener('click', async () => {
        if (segmentationRequestInProgress || btnProcess.disabled) return;
        if (!app.documents || app.documents.length === 0) {
            setSegHint('Hãy mở một ảnh trong Photoshop trước.', 'error');
            updateStatus('Chưa có ảnh đang mở', 'Mở tài liệu Photoshop rồi nạp ảnh vào vùng chọn vật thể.', 0, 'warning');
            return;
        }

        segmentationRequestInProgress = true;
        btnProcess.disabled = true;
        btnCheck.disabled = true;
        btnLoadSegImage.disabled = true;
        btnClearPoints.disabled = true;
        btnAddObject.disabled = true;
        let exportFile = null;
        try {
            const sourceDoc = app.activeDocument;
            const sourceId = sourceDoc.id;
            const tempFolder = await fs.getTemporaryFolder();
            exportFile = await tempFolder.createFile('ai_sam_input_' + Date.now() + '.png', { overwrite: true });

            updateStatus('Đang chuẩn bị ảnh cho SAM…', 'Xuất ảnh hợp nhất từ Photoshop; tài liệu gốc không bị thay đổi.', 8, 'warning');
            await exportCompositeToPng(sourceDoc, exportFile);
            const imageBase64 = await fileToBase64(exportFile);

            if (segmentationImageId) {
                try {
                    await postSegmentation('/segment_close', { image_id: segmentationImageId }, 5000);
                } catch (_) { /* Starting a new selection may replace an expired session. */ }
            }

            updateStatus('Đang khởi tạo model tách vật thể…', 'Lần đầu có thể mất thời gian để nạp SAM vào bộ nhớ.', 25, 'warning');
            setSegHint('Đang nạp model SAM và mã hóa ảnh…');

            const data = await postSegmentation('/segment_init', { image_base64: imageBase64 }, 600000);
            segmentationImageId = data.image_id;
            segmentationDocumentId = sourceId;
            segmentationPoints = [];
            segmentationLayerCount = 0;
            clearSegOverlay();
            updateSegPointLabel();

            segPreviewImage.onload = () => {
                segOverlayCanvas.width = segPreviewImage.naturalWidth;
                segOverlayCanvas.height = segPreviewImage.naturalHeight;
                const ctx = segOverlayCanvas.getContext('2d');
                ctx.clearRect(0, 0, segOverlayCanvas.width, segOverlayCanvas.height);
            };
            segPreviewImage.src = 'data:image/png;base64,' + imageBase64;
            segPreviewWrap.hidden = false;
            btnClearPoints.disabled = false;
            setSegHint('Ảnh ' + data.width + ' × ' + data.height + 'px · Model SAM chạy trên ' +
                (data.device === 'cuda' ? 'GPU' : 'CPU') + '. Bấm vào vật thể để tạo vùng chọn.');
            updateStatus('Ảnh đã sẵn sàng để chọn vật thể', 'Bấm vào bên trong vật thể. Hãy thêm điểm − nếu vùng chọn ăn sang phần khác.', 100, 'success');
        } catch (error) {
            console.error('[SAM segmentation init]', error);
            setSegHint(error.message || String(error), 'error');
            updateStatus('Không khởi tạo được chế độ tách chi tiết', error.message || String(error), 0, 'error');
        } finally {
            if (exportFile) {
                try { await exportFile.delete(); } catch (_) { /* Best-effort temporary cleanup. */ }
            }
            segmentationRequestInProgress = false;
            btnLoadSegImage.disabled = false;
            btnProcess.disabled = false;
            btnCheck.disabled = false;
        }
    });
}

if (segPreviewImage) {
    segPreviewImage.addEventListener('click', async (event) => {
        if (!segmentationImageId || segmentationRequestInProgress || btnProcess.disabled) return;
        if (!app.documents || app.documents.length === 0 || segmentationDocumentId !== app.activeDocument.id) {
            setSegHint('Tài liệu đang hoạt động đã thay đổi hoặc đã đóng. Hãy nạp lại ảnh để tránh thêm layer nhầm tài liệu.', 'error');
            return;
        }
        const rect = segPreviewImage.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = Math.max(0, Math.min(segPreviewImage.naturalWidth - 1,
            Math.round((event.clientX - rect.left) * segPreviewImage.naturalWidth / rect.width)));
        const y = Math.max(0, Math.min(segPreviewImage.naturalHeight - 1,
            Math.round((event.clientY - rect.top) * segPreviewImage.naturalHeight / rect.height)));
        const label = Number(segPointMode.value);
        if (label === 0 && !segmentationPoints.some(point => point.label === 1)) {
            setSegHint('Hãy chấm một điểm + bên trong vật thể trước, sau đó mới dùng điểm −.', 'error');
            return;
        }
        if (segmentationPoints.length >= 16) {
            setSegHint('Đã đạt giới hạn 16 điểm. Xóa điểm hoặc thêm layer này trước.', 'error');
            return;
        }

        segmentationPoints.push({ x: x, y: y, label: label });
        updateSegPointLabel();
        segmentationRequestInProgress = true;
        btnProcess.disabled = true;
        btnCheck.disabled = true;
        btnLoadSegImage.disabled = true;
        btnClearPoints.disabled = true;
        btnAddObject.disabled = true;
        setSegHint('Đang tính lại vùng chọn theo các điểm +/−…');
        updateStatus('Đang tách vùng chọn…', 'SAM đang tìm biên của vật thể và cập nhật mặt nạ.', 55, 'warning');
        try {
            const data = await postSegmentation('/segment_point', {
                image_id: segmentationImageId,
                points: segmentationPoints
            }, 600000);
            await drawSegOverlay(data.overlay_base64);
            segmentationHasMask = true;
            btnAddObject.disabled = false;
            const scoreText = 'Độ tin cậy ' + Math.round(data.score * 100) + '% · ' + data.area_percent + '% ảnh';
            if (segScore) segScore.textContent = scoreText;
            setSegHint('Kiểm tra lớp phủ màu xanh. Nếu bị dính vùng khác, chọn − rồi bấm vào vùng cần bỏ; nếu thiếu phần vật thể, chọn + và bấm thêm.', 'success');
            updateStatus('Đã tạo vùng chọn vật thể', scoreText, 100, 'success');
        } catch (error) {
            console.error('[SAM point prediction]', error);
            segmentationPoints.pop();
            updateSegPointLabel();
            setSegHint(error.message || String(error), 'error');
            updateStatus('Chưa tạo được vùng chọn', error.message || String(error), 0, 'error');
        } finally {
            segmentationRequestInProgress = false;
            btnLoadSegImage.disabled = false;
            btnClearPoints.disabled = false;
            btnProcess.disabled = false;
            btnCheck.disabled = false;
        }
    });
}

if (btnClearPoints) {
    btnClearPoints.addEventListener('click', () => {
        if (segmentationRequestInProgress) return;
        segmentationPoints = [];
        clearSegOverlay();
        updateSegPointLabel();
        setSegHint('Đã xóa điểm chọn. Bấm + vào một vật thể khác để bắt đầu vùng chọn mới.');
        updateStatus('Sẵn sàng chọn vật thể tiếp theo', 'Các layer đã thêm trước đó vẫn được giữ nguyên.', 0, 'warning');
    });
}

if (btnAddObject) {
    btnAddObject.addEventListener('click', async () => {
        if (!segmentationImageId || !segmentationHasMask || segmentationRequestInProgress || btnProcess.disabled) return;
        if (!app.documents || app.documents.length === 0 || segmentationDocumentId !== app.activeDocument.id) {
            setSegHint('Tài liệu đang hoạt động đã thay đổi. Hãy nạp lại ảnh trước khi thêm layer.', 'error');
            return;
        }

        segmentationRequestInProgress = true;
        btnProcess.disabled = true;
        btnCheck.disabled = true;
        btnAddObject.disabled = true;
        btnLoadSegImage.disabled = true;
        btnClearPoints.disabled = true;
        let outputFile = null;
        try {
            updateStatus('Đang tạo PNG trong suốt…', 'Giữ lại pixel nằm trong vùng chọn, phần còn lại trong suốt.', 65, 'warning');
            const data = await postSegmentation('/segment_export', { image_id: segmentationImageId }, 600000);
            const tempFolder = await fs.getTemporaryFolder();
            outputFile = await tempFolder.createFile('ai_sam_object_' + Date.now() + '.png', { overwrite: true });
            await base64ToFile(data.foreground_base64, outputFile);

            const targetDoc = app.activeDocument;
            const requestedName = segObjectName && segObjectName.value ? segObjectName.value.trim() : '';
            const layerName = requestedName || ('AI - Vật thể ' + String(segmentationLayerCount + 1).padStart(2, '0') + ' (SAM)');
            updateStatus('Đang thêm vật thể vào Photoshop…', 'Tạo layer độc lập và giữ nguyên kích thước canvas gốc.', 82, 'warning');
            await core.executeAsModal(async () => {
                await importPngAsLayer(outputFile, targetDoc, layerName.slice(0, 80), {
                    x: data.crop_x,
                    y: data.crop_y
                });
            }, { commandName: 'AI Layer Splitter - Add SAM Object' });

            segmentationLayerCount += 1;
            segmentationPoints = [];
            clearSegOverlay();
            updateSegPointLabel();
            if (segObjectName) segObjectName.value = '';
            setSegHint('Đã thêm layer "' + layerName + '". Bạn có thể chọn vật thể tiếp theo trên cùng ảnh.', 'success');
            updateStatus('Đã thêm layer vật thể', 'Tổng số layer vật thể đã thêm trong phiên này: ' + segmentationLayerCount + '.', 100, 'success');
        } catch (error) {
            console.error('[SAM export/import]', error);
            setSegHint(error.message || String(error), 'error');
            updateStatus('Không thêm được layer', error.message || String(error), 0, 'error');
        } finally {
            if (outputFile) {
                try { await outputFile.delete(); } catch (_) { /* Best-effort temporary cleanup. */ }
            }
            segmentationRequestInProgress = false;
            btnLoadSegImage.disabled = false;
            btnClearPoints.disabled = false;
            btnAddObject.disabled = !segmentationHasMask;
            btnProcess.disabled = false;
            btnCheck.disabled = false;
        }
    });
}


/* Full-banner decomposition: generate candidate masks, preview and import selected layers. */
const btnAnalyzeBanner = $('btnAnalyzeBanner');
const btnSelectMainMasks = $('btnSelectMainMasks');
const btnSelectAllMasks = $('btnSelectAllMasks');
const btnSelectNoMasks = $('btnSelectNoMasks');
const btnImportMasks = $('btnImportMasks');
const bannerSegQuality = $('bannerSegQuality');
const autoSegObjectList = $('autoSegObjectList');
const autoSegSummary = $('autoSegSummary');
const autoSegHint = $('autoSegHint');
const chkAutoCreateOverlay = $('chkAutoCreateOverlay');
const chkAutoHideOriginal = $('chkAutoHideOriginal');

if (chkAutoHideOriginal && chkAutoCreateOverlay) {
    chkAutoHideOriginal.addEventListener('change', () => {
        if (chkAutoHideOriginal.checked) chkAutoCreateOverlay.checked = true;
    });
    chkAutoCreateOverlay.addEventListener('change', () => {
        if (chkAutoHideOriginal.checked && !chkAutoCreateOverlay.checked) {
            chkAutoCreateOverlay.checked = true;
            setAutoSegHint('Để ẩn layer gốc mà không tạo lỗ caro, lớp phủ bảo toàn phải được bật.', 'warning');
        }
    });
}

let autoSegImageId = null;
let autoSegDocumentId = null;
let autoSegTargetDoc = null;
let autoSegOriginalLayers = [];
let autoSegObjects = [];
let autoSegBusy = false;

function setAutoSegHint(message, type = '') {
    if (!autoSegHint) return;
    autoSegHint.textContent = message || '';
    autoSegHint.className = 'seg-hint' + (type ? ' ' + type : '');
}

function selectedAutoObjects() {
    if (!autoSegObjectList) return [];
    const checkboxes = autoSegObjectList.querySelectorAll('.auto-mask-checkbox');
    const selectedIds = new Set();
    const len = checkboxes ? checkboxes.length : 0;
    for (let i = 0; i < len; i++) {
        const input = checkboxes[i];
        if (input && input.checked && input.dataset && input.dataset.objectId) {
            selectedIds.add(input.dataset.objectId);
        }
    }
    return (autoSegObjects || []).filter(item => selectedIds.has(item.id));
}

function refreshAutoSelection() {
    const selectedCount = selectedAutoObjects().length;
    const totalCount = (autoSegObjects || []).length;
    if (autoSegSummary && totalCount) {
        autoSegSummary.hidden = false;
        autoSegSummary.textContent = selectedCount + ' / ' + totalCount + ' vùng được chọn';
    }
    if (btnImportMasks) btnImportMasks.disabled = autoSegBusy || selectedCount === 0;
    if (btnSelectMainMasks) btnSelectMainMasks.disabled = autoSegBusy || totalCount === 0;
    if (btnSelectAllMasks) btnSelectAllMasks.disabled = autoSegBusy || totalCount === 0;
    if (btnSelectNoMasks) btnSelectNoMasks.disabled = autoSegBusy || totalCount === 0;
    if (autoSegObjectList) {
        const controls = autoSegObjectList.querySelectorAll('input, button');
        const ctrlLen = controls ? controls.length : 0;
        for (let i = 0; i < ctrlLen; i++) {
            controls[i].disabled = autoSegBusy;
        }
        if (btnImportMasks) btnImportMasks.disabled = autoSegBusy || selectedCount === 0;
    }
}

function openImageZoom(item) {
    const modal = document.getElementById('imageZoomModal');
    const modalImg = document.getElementById('zoomModalImg');
    const modalTitle = document.getElementById('zoomModalTitle');
    const modalMeta = document.getElementById('zoomModalMeta');
    if (!modal || !modalImg) return;

    modalImg.src = 'data:image/png;base64,' + item.thumbnail_base64;
    if (modalTitle) modalTitle.textContent = item.name;
    if (modalMeta) {
        modalMeta.innerHTML = '<strong>' + (item.layerName || item.name) + '</strong><br>' +
            item.bbox.width + ' × ' + item.bbox.height + ' px · ' +
            item.area_percent + '% diện tích · Điểm AI: ' + Math.round(item.score * 100) + '%';
    }
    modal.hidden = false;
}

function closeImageZoom() {
    const modal = document.getElementById('imageZoomModal');
    if (modal) modal.hidden = true;
}

const btnZoomModalClose = document.getElementById('btnZoomModalClose');
if (btnZoomModalClose) btnZoomModalClose.addEventListener('click', closeImageZoom);
const zoomBackdrop = document.querySelector('.zoom-modal-backdrop');
if (zoomBackdrop) zoomBackdrop.addEventListener('click', closeImageZoom);

const btnViewList = document.getElementById('btnViewList');
const btnViewGrid = document.getElementById('btnViewGrid');
if (btnViewList && btnViewGrid && autoSegObjectList) {
    btnViewList.addEventListener('click', () => {
        btnViewList.classList.add('active');
        btnViewGrid.classList.remove('active');
        autoSegObjectList.classList.remove('gallery-mode');
    });
    btnViewGrid.addEventListener('click', () => {
        btnViewGrid.classList.add('active');
        btnViewList.classList.remove('active');
        autoSegObjectList.classList.add('gallery-mode');
    });
}

function renderAutoObjectList(objects) {
    autoSegObjects = (objects || []).map(item => ({
        ...item,
        layerName: item.layerName || ('AI - ' + (item.category || 'Phần') + ' · ' + (item.name || item.id))
    }));
    if (!autoSegObjectList) return;
    while (autoSegObjectList.firstChild) {
        autoSegObjectList.removeChild(autoSegObjectList.firstChild);
    }

    const objLen = autoSegObjects.length;
    for (let i = 0; i < objLen; i++) {
        const item = autoSegObjects[i];
        const row = document.createElement('div');
        const isInitiallySelected = item.default_selected !== false;
        row.className = 'auto-mask-card' + (isInitiallySelected ? ' is-checked' : '');
        row.setAttribute('role', 'listitem');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'auto-mask-checkbox';
        checkbox.checked = isInitiallySelected;
        checkbox.dataset.objectId = item.id;
        checkbox.dataset.defaultSelected = String(isInitiallySelected);
        checkbox.setAttribute('aria-label', 'Chọn ' + item.name);

        const thumb = document.createElement('div');
        thumb.className = 'auto-mask-thumb';
        thumb.title = 'Bấm để phóng to xem chi tiết';
        const image = document.createElement('img');
        image.alt = 'Xem trước ' + item.name;
        image.src = 'data:image/png;base64,' + item.thumbnail_base64;
        thumb.appendChild(image);

        thumb.addEventListener('click', (e) => {
            e.stopPropagation();
            openImageZoom(item);
        });

        const copy = document.createElement('div');
        copy.className = 'auto-mask-copy';

        const kind = document.createElement('div');
        kind.className = 'auto-mask-kind' + (item.parent_id ? ' detail' : '');
        kind.textContent = item.category || (item.parent_id ? 'Chi tiết' : 'Phần chính');

        const title = document.createElement('div');
        title.className = 'auto-mask-title';
        title.textContent = item.name;

        const meta = document.createElement('div');
        meta.className = 'auto-mask-meta';
        meta.textContent = item.area_percent + '% ảnh · ' +
            item.bbox.width + ' × ' + item.bbox.height + ' px';

        const confidence = document.createElement('div');
        confidence.className = 'auto-mask-meta auto-mask-confidence';
        confidence.textContent = 'Điểm AI: ' + Math.round(item.score * 100) + '%';

        const relation = document.createElement('div');
        relation.className = 'auto-mask-meta';
        relation.textContent = item.parent_id
            ? 'Nằm trong cụm ' + item.parent_id + ' · không chọn sẵn để tránh trùng layer'
            : 'Phần chính · được chọn sẵn';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.maxLength = 80;
        nameInput.className = 'auto-mask-name';
        nameInput.value = item.layerName;
        nameInput.setAttribute('aria-label', 'Tên layer ' + item.name);
        nameInput.addEventListener('input', () => { item.layerName = nameInput.value; });

        checkbox.addEventListener('change', () => {
            row.classList.toggle('is-checked', checkbox.checked);
            refreshAutoSelection();
        });

        row.addEventListener('click', (e) => {
            if (e.target.closest && (e.target.closest('.auto-mask-thumb') || e.target.closest('.auto-mask-name'))) return;
            if (e.target !== checkbox) {
                checkbox.checked = !checkbox.checked;
                row.classList.toggle('is-checked', checkbox.checked);
                refreshAutoSelection();
            }
        });

        copy.appendChild(kind);
        copy.appendChild(title);
        copy.appendChild(meta);
        copy.appendChild(confidence);
        copy.appendChild(relation);
        copy.appendChild(nameInput);

        row.appendChild(checkbox);
        row.appendChild(thumb);
        row.appendChild(copy);
        autoSegObjectList.appendChild(row);
    }
    refreshAutoSelection();

    // Auto-switch to banner tab so user sees the detected regions immediately
    const tabBannerBtn = document.getElementById('tabBtnBanner');
    if (tabBannerBtn && !tabBannerBtn.classList.contains('active')) {
        tabBannerBtn.click();
    }
}

async function setAutoBusy(busy) {
    autoSegBusy = busy;
    if (btnAnalyzeBanner) btnAnalyzeBanner.disabled = busy;
    if (btnProcess) btnProcess.disabled = busy;
    if (btnCheck) btnCheck.disabled = busy;
    if (btnLoadSegImage) btnLoadSegImage.disabled = busy;
    if (btnClearPoints) btnClearPoints.disabled = busy;
    if (btnAddObject) btnAddObject.disabled = busy || !segmentationHasMask;
    if (segPointMode) segPointMode.disabled = busy;
    if (chkAutoCreateOverlay) chkAutoCreateOverlay.disabled = busy;
    if (chkAutoHideOriginal) chkAutoHideOriginal.disabled = busy;
    refreshAutoSelection();
}

if (btnAnalyzeBanner) {
    btnAnalyzeBanner.addEventListener('click', async () => {
        if (autoSegBusy || segmentationRequestInProgress) return;
        if (!app.documents || app.documents.length === 0) {
            setAutoSegHint('Hãy mở banner trong Photoshop trước khi phân tích.', 'error');
            updateStatus('Chưa có ảnh đang mở', 'Mở poster trong Photoshop rồi bấm Phân tích toàn banner.', 0, 'warning');
            return;
        }

        const sourceDoc = app.activeDocument;
        let exportFile = null;
        try {
            await setAutoBusy(true);
            updateStatus('Đang chuẩn bị toàn banner…', 'Xuất bản hợp nhất để AI phân tích tất cả thành phần đang nhìn thấy.', 7, 'warning');
            setAutoSegHint('Đang chuẩn bị ảnh. Với banner lớn, bước này có thể mất thời gian…');

            const tempFolder = await fs.getTemporaryFolder();
            exportFile = await tempFolder.createFile('ai_auto_banner_' + Date.now() + '.png', { overwrite: true });
            await exportCompositeToPng(sourceDoc, exportFile);
            const imageBase64 = await fileToBase64(exportFile);

            if (autoSegImageId) {
                try { await postSegmentation('/segment_auto_close', { image_id: autoSegImageId }, 5000); } catch (_) {}
            }
            updateStatus('AI đang dò các phần trong banner…', 'Tìm vùng lớn và chi tiết. Mức Chi tiết sẽ chậm hơn, nhất là khi chạy CPU.', 22, 'warning');
            setAutoSegHint('SAM đang tìm các vùng ứng viên trên toàn ảnh…');

            const data = await postSegmentation('/segment_auto', {
                image_base64: imageBase64,
                quality: bannerSegQuality ? bannerSegQuality.value : 'balanced'
            }, 900000);

            autoSegImageId = data.image_id;
            autoSegDocumentId = sourceDoc.id;
            autoSegTargetDoc = sourceDoc;
            autoSegOriginalLayers = getLayersList(sourceDoc);
            renderAutoObjectList(data.objects);

            const deviceLabel = data.device === 'cuda' ? 'GPU' : 'CPU';
            const elapsed = Number(data.elapsed_seconds || 0).toFixed(1);
            setAutoSegHint(
                'Đã tìm ' + data.count + ' vùng trong ' + elapsed + ' giây trên ' + deviceLabel +
                '. Vùng lớn/nhỏ có thể chồng lấn nhau: xem thumbnail, bỏ chọn vùng trùng hoặc không cần, rồi nhập các vùng còn lại.',
                'success'
            );
            updateStatus('Đã phân tích banner', data.count + ' vùng ứng viên · ' + elapsed + ' giây · ' + deviceLabel, 100, 'success');
        } catch (error) {
            console.error('[Auto banner segmentation]', error);
            setAutoSegHint(error.message || String(error), 'error');
            updateStatus('Không phân tích được banner', error.message || String(error), 0, 'error');
        } finally {
            if (exportFile) {
                try { await exportFile.delete(); } catch (_) {}
            }
            await setAutoBusy(false);
        }
    });
}

if (btnSelectMainMasks) {
    btnSelectMainMasks.addEventListener('click', () => {
        if (autoSegBusy || !autoSegObjectList) return;
        const cards = autoSegObjectList.querySelectorAll('.auto-mask-card');
        const count = cards ? cards.length : 0;
        for (let i = 0; i < count; i++) {
            const card = cards[i];
            const input = card.querySelector('.auto-mask-checkbox');
            if (input) {
                input.checked = input.dataset.defaultSelected !== 'false';
                card.classList.toggle('is-checked', input.checked);
            }
        }
        refreshAutoSelection();
    });
}

if (btnSelectAllMasks) {
    btnSelectAllMasks.addEventListener('click', () => {
        if (autoSegBusy || !autoSegObjectList) return;
        const cards = autoSegObjectList.querySelectorAll('.auto-mask-card');
        const count = cards ? cards.length : 0;
        for (let i = 0; i < count; i++) {
            const card = cards[i];
            const input = card.querySelector('.auto-mask-checkbox');
            if (input) {
                input.checked = true;
                card.classList.add('is-checked');
            }
        }
        refreshAutoSelection();
    });
}

if (btnSelectNoMasks) {
    btnSelectNoMasks.addEventListener('click', () => {
        if (autoSegBusy || !autoSegObjectList) return;
        const cards = autoSegObjectList.querySelectorAll('.auto-mask-card');
        const count = cards ? cards.length : 0;
        for (let i = 0; i < count; i++) {
            const card = cards[i];
            const input = card.querySelector('.auto-mask-checkbox');
            if (input) {
                input.checked = false;
                card.classList.remove('is-checked');
            }
        }
        refreshAutoSelection();
    });
}

if (btnImportMasks) {
    btnImportMasks.addEventListener('click', async () => {
        if (autoSegBusy || segmentationRequestInProgress || !autoSegImageId) return;
        const selected = selectedAutoObjects();
        if (!selected.length) {
            setAutoSegHint('Hãy chọn ít nhất một vùng trước khi nhập layer.', 'error');
            return;
        }
        if (!autoSegTargetDoc || !isDocumentOpen(autoSegDocumentId)) {
            setAutoSegHint('Tài liệu Photoshop ban đầu đã đóng. Hãy phân tích lại ảnh đang mở.', 'error');
            return;
        }

        let importedCount = 0;
        const total = selected.length;
        const hideSourceAfterImport = !!(chkAutoHideOriginal && chkAutoHideOriginal.checked);
        // Overlay is on by default. Force it on whenever the source is going to be hidden,
        // because otherwise unselected or missed mask areas would become checkerboard holes.
        const createPreservationOverlay = hideSourceAfterImport ||
            !!(chkAutoCreateOverlay && chkAutoCreateOverlay.checked);
        try {
            await setAutoBusy(true);

            // Import the complementary preservation overlay first, under the selected
            // object layers. This keeps all original pixels not covered by the selected
            // masks, even where SAM missed wispy edges, text, water, or tiny decorations.
            if (createPreservationOverlay) {
                updateStatus(
                    'Đang tạo lớp phủ bảo toàn banner…',
                    'Giữ lại các pixel chưa tách và vùng AI bỏ sót để tránh ô caro.',
                    12,
                    'warning'
                );
                const remainder = await postSegmentation('/segment_auto_export', {
                    image_id: autoSegImageId,
                    object_id: '__remainder__',
                    object_ids: selected.map(item => item.id)
                }, 600000);
                const tempFolder = await fs.getTemporaryFolder();
                const remainderFile = await tempFolder.createFile(
                    'ai_banner_remainder_' + Date.now() + '.png',
                    { overwrite: true }
                );
                try {
                    await base64ToFile(remainder.foreground_base64, remainderFile);
                    await core.executeAsModal(async () => {
                        await importPngAsLayer(
                            remainderFile,
                            autoSegTargetDoc,
                            'AI - Lớp phủ bảo toàn banner',
                            { x: remainder.crop_x, y: remainder.crop_y }
                        );
                    }, { commandName: 'AI Layer Splitter - Import Preservation Overlay' });
                    importedCount += 1;
                } finally {
                    try { await remainderFile.delete(); } catch (_) {}
                }
            }

            for (let index = 0; index < selected.length; index += 1) {
                if (!isDocumentOpen(autoSegDocumentId)) {
                    throw new Error('Tài liệu ban đầu đã đóng; dừng nhập để không nhầm sang file khác.');
                }
                const item = selected[index];
                updateStatus(
                    'Đang tạo layer ' + (index + 1) + '/' + total + '…',
                    item.layerName || item.name,
                    15 + Math.round((index / total) * 80),
                    'warning'
                );

                const response = await postSegmentation('/segment_auto_export', {
                    image_id: autoSegImageId,
                    object_id: item.id
                }, 600000);

                const tempFolder = await fs.getTemporaryFolder();
                const tempFile = await tempFolder.createFile(
                    'ai_banner_part_' + item.id + '_' + Date.now() + '.png',
                    { overwrite: true }
                );
                try {
                    await base64ToFile(response.foreground_base64, tempFile);
                    await core.executeAsModal(async () => {
                        await importPngAsLayer(tempFile, autoSegTargetDoc, (item.layerName || item.name).trim().slice(0, 80), {
                            x: response.crop_x,
                            y: response.crop_y
                        });
                    }, { commandName: 'AI Layer Splitter - Import Banner Part' });
                    importedCount += 1;
                } finally {
                    try { await tempFile.delete(); } catch (_) {}
                }
            }

            if (hideSourceAfterImport) {
                // Hide exactly the layers that existed before the new layer package was imported.
                const origLen = autoSegOriginalLayers ? autoSegOriginalLayers.length : 0;
                for (let i = 0; i < origLen; i++) {
                    try { autoSegOriginalLayers[i].visible = false; } catch (_) {}
                }
            }

            setAutoSegHint(
                createPreservationOverlay
                    ? 'Đã thêm ' + importedCount + ' layer, gồm “Lớp phủ bảo toàn banner” nằm dưới các phần tách để giữ pixel chưa nhận diện và tránh lỗ caro.'
                    : 'Đã thêm ' + importedCount + ' layer riêng. Lớp phủ bảo toàn đang tắt; hãy giữ layer gốc hiển thị hoặc bật lớp phủ nếu không muốn xuất hiện vùng caro.',
                'success'
            );
            if (hideSourceAfterImport && !createPreservationOverlay) {
                throw new Error('Không thể ẩn layer gốc nếu chưa tạo lớp phủ bảo toàn.');
            }
            updateStatus('Đã tách các phần thành layer', importedCount + ' layer đã được thêm vào tài liệu Photoshop.', 100, 'success');
        } catch (error) {
            console.error('[Auto banner layer import]', error);
            setAutoSegHint(
                'Đã nhập ' + importedCount + '/' + total + ' layer trước khi gặp lỗi: ' + (error.message || String(error)),
                'error'
            );
            updateStatus('Quá trình nhập chưa hoàn tất', importedCount + '/' + total + ' layer đã được thêm. ' + (error.message || String(error)), 0, 'error');
        } finally {
            await setAutoBusy(false);
        }
    });
}

btnCheck.addEventListener('click', async () => {
    if (btnCheck.disabled) return;
    btnCheck.disabled = true;
    try {
        await checkServer(true);
    } catch (_) {
        // Status panel already explains the connection error.
    } finally {
        btnCheck.disabled = false;
    }
});

btnProcess.addEventListener('click', async () => {
    if (btnProcess.disabled || segmentationRequestInProgress) return;
    if (!app.documents || app.documents.length === 0) {
        updateStatus('Chưa có ảnh đang mở', 'Hãy mở một tài liệu trong Photoshop trước khi chạy.', 0, 'warning');
        return;
    }

    const extractSubject = $('chkPerson').checked;
    const inpaintBackground = $('chkInpaint').checked;
    const model = $('selModel') ? $('selModel').value : 'isnet-general-use';
    const fillHoles = $('chkFillHoles') ? $('chkFillHoles').checked : true;
    const refineEdges = $('chkRefineEdges') ? $('chkRefineEdges').checked : true;
    const createSubjectLayerMask = $('chkLayerMask') ? $('chkLayerMask').checked : true;

    if (!extractSubject && !inpaintBackground) {
        updateStatus('Chưa chọn tác vụ', 'Hãy bật ít nhất một tuỳ chọn xử lý.', 0, 'warning');
        return;
    }

    btnProcess.disabled = true;
    btnCheck.disabled = true;
    const sourceDoc = app.activeDocument;
    let originalTopLayers = [];
    let tempFolder = null;
    let exportFile = null;
    const createdFiles = [];

    try {
        originalTopLayers = getLayersList(sourceDoc);
        tempFolder = await fs.getTemporaryFolder();
        exportFile = await tempFolder.createFile('ai_layer_splitter_input.png', { overwrite: true });

        updateStatus('Đang kiểm tra AI Server…', 'Kiểm tra kết nối trước khi xuất ảnh.', 5, 'warning');
        await checkServer(false);

        updateStatus('Đang chuẩn bị ảnh…', 'Tạo bản xuất hợp nhất, không chỉnh sửa tài liệu gốc.', 12);
        await exportCompositeToPng(sourceDoc, exportFile);

        updateStatus('Đang gửi ảnh tới AI…', `Phân tích AI với mô hình ${model}. Ảnh lớn có thể cần thêm thời gian.`, 28);
        const imageBase64 = await fileToBase64(exportFile);
        const response = await requestFromServer('/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image_base64: imageBase64,
                extract_subject: extractSubject,
                inpaint_background: inpaintBackground,
                model: model,
                fill_holes: fillHoles,
                refine_edges: refineEdges,
                remove_speckles: true
            })
        }, 300000);

        let data;
        try {
            data = await response.json();
        } catch (_) {
            throw new Error(`Server trả về dữ liệu không hợp lệ (HTTP ${response.status}). Xem server_debug.log để biết thêm.`);
        }
        if (!response.ok || data.status !== 'success') {
            throw new Error(data.error || `AI Server trả về HTTP ${response.status}.`);
        }
        if (extractSubject && !data.foreground_base64) throw new Error('Server không trả về layer chủ thể.');
        if (inpaintBackground && !data.background_base64) throw new Error('Server không trả về layer nền.');

        updateStatus('Đang chuẩn bị các layer…', `Ảnh ${data.width} × ${data.height}px (${data.model}) · Xong trong ${data.elapsed_seconds}s.`, 65);
        const resultFiles = {};
        if (inpaintBackground) {
            resultFiles.background = await tempFolder.createFile('ai_layer_splitter_background.png', { overwrite: true });
            createdFiles.push(resultFiles.background);
            await base64ToFile(data.background_base64, resultFiles.background);
        }
        if (extractSubject) {
            resultFiles.foreground = await tempFolder.createFile('ai_layer_splitter_subject.png', { overwrite: true });
            createdFiles.push(resultFiles.foreground);
            await base64ToFile(data.foreground_base64, resultFiles.foreground);
        }

        updateStatus('Đang thêm layer vào Photoshop…', 'Đang nhập nền trước và chủ thể sau để đúng thứ tự.', 78);
        await core.executeAsModal(async () => {
            if (inpaintBackground) {
                await importPngAsLayer(resultFiles.background, sourceDoc, 'AI - Nền đã bù (OpenCV)');
            }
            if (extractSubject) {
                const layerLabel = data.model === 'isnet-general-use' ? 'AI - Chủ thể siêu nét (IS-Net)' : `AI - Chủ thể (${data.model || 'Tách rời'})`;
                await importPngAsLayer(resultFiles.foreground, sourceDoc, layerLabel, null, createSubjectLayerMask);
            }
            // Only hide originals after all requested result layers were imported successfully.
            if (inpaintBackground) {
                for (const layer of originalTopLayers) {
                    try { layer.visible = false; }
                    catch (visibilityError) { console.error('Không thể ẩn layer gốc:', visibilityError); }
                }
            }
        }, { commandName: 'AI Layer Splitter - Import Layers' });

        const maskStatus = extractSubject && createSubjectLayerMask ? ' kèm Layer Mask chỉnh sửa được' : '';
        updateStatus('Tách layer thành công', inpaintBackground
            ? `Đã thêm ${extractSubject ? 'layer chủ thể' + maskStatus + ' và layer nền' : 'layer nền'}; layer gốc được giữ lại nhưng đang ẩn.`
            : `Đã thêm layer chủ thể${maskStatus}. Layer gốc vẫn hiển thị để bạn đối chiếu và có thể tự ẩn khi cần.`, 100, 'success');
    } catch (error) {
        console.error('[AI Layer Splitter]', error);
        updateStatus('Xử lý chưa hoàn tất', error && error.message ? error.message : String(error), 0, 'error');
    } finally {
        btnProcess.disabled = false;
        btnCheck.disabled = false;
        for (const file of createdFiles) {
            try { await file.delete(); } catch (_) { /* Temp cleanup is best-effort. */ }
        }
        if (exportFile) {
            try { await exportFile.delete(); } catch (_) { /* Temp cleanup is best-effort. */ }
        }
    }
});
