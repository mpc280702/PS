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

async function fileToBase64(file) {
    let base64Data = '';
    try {
        base64Data = await file.read({ format: formats.base64 });
    } catch (readError) {
        const arrayBuffer = await file.read({ format: formats.binary });
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        const chunkSize = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, chunk);
        }
        base64Data = btoa(binary);
    }
    return String(base64Data || '')
        .replace(/^data:image\/[^;]+;base64,/i, '')
        .replace(/[\r\n\s]/g, '');
}

async function base64ToFile(base64Data, file) {
    if (typeof base64Data !== 'string' || !base64Data.length) {
        throw new Error(`Dữ liệu ảnh trả về cho ${file.name} đang trống.`);
    }
    const cleanData = base64Data.replace(/^data:image\/[^;]+;base64,/i, '').replace(/[\r\n\s]/g, '');
    try {
        await file.write(cleanData, { format: formats.base64 });
    } catch (err) {
        let binary;
        try {
            binary = atob(cleanData);
        } catch (_) {
            throw new Error(`Dữ liệu Base64 của ${file.name} không hợp lệ.`);
        }
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        await file.write(bytes.buffer, { format: formats.binary });
    }
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

async function importPngAsLayer(file, targetDoc, name) {
    let tempDoc = null;
    try {
        tempDoc = await app.open(file);
        if (!tempDoc.layers || tempDoc.layers.length === 0) {
            throw new Error(`File kết quả không có layer: ${name}`);
        }
        const importedLayer = await tempDoc.layers[0].duplicate(targetDoc);
        importedLayer.name = name;
        await tempDoc.closeWithoutSaving();
        tempDoc = null;
        return importedLayer;
    } finally {
        if (tempDoc) {
            try { await tempDoc.closeWithoutSaving(); } catch (_) { /* Best-effort cleanup. */ }
        }
    }
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
    if (btnProcess.disabled) return;
    if (!app.documents || app.documents.length === 0) {
        updateStatus('Chưa có ảnh đang mở', 'Hãy mở một tài liệu trong Photoshop trước khi chạy.', 0, 'warning');
        return;
    }

    const extractSubject = $('chkPerson').checked;
    const inpaintBackground = $('chkInpaint').checked;
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
        originalTopLayers = Array.from(sourceDoc.layers);
        tempFolder = await fs.getTemporaryFolder();
        exportFile = await tempFolder.createFile('ai_layer_splitter_input.png', { overwrite: true });

        updateStatus('Đang kiểm tra AI Server…', 'Kiểm tra kết nối trước khi xuất ảnh.', 5, 'warning');
        await checkServer(false);

        updateStatus('Đang chuẩn bị ảnh…', 'Tạo bản xuất hợp nhất, không chỉnh sửa tài liệu gốc.', 12);
        await exportCompositeToPng(sourceDoc, exportFile);

        updateStatus('Đang gửi ảnh tới AI…', 'Đang phân tích chủ thể. Ảnh lớn có thể cần thêm thời gian.', 28);
        const imageBase64 = await fileToBase64(exportFile);
        const response = await requestFromServer('/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image_base64: imageBase64,
                extract_subject: extractSubject,
                inpaint_background: inpaintBackground
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

        updateStatus('Đang chuẩn bị các layer…', `Ảnh ${data.width} × ${data.height}px · Đang tạo file trung gian.`, 65);
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
                await importPngAsLayer(resultFiles.foreground, sourceDoc, 'AI - Chủ thể tách rời');
            }
            // Only hide originals after all requested result layers were imported successfully.
            if (inpaintBackground) {
                for (const layer of originalTopLayers) {
                    try { layer.visible = false; }
                    catch (visibilityError) { console.error('Không thể ẩn layer gốc:', visibilityError); }
                }
            }
        }, { commandName: 'AI Layer Splitter - Import Layers' });

        updateStatus('Tách layer thành công', inpaintBackground
            ? `Đã thêm ${extractSubject ? 'layer chủ thể và layer nền' : 'layer nền'}; layer gốc được giữ lại nhưng đang ẩn.`
            : 'Đã thêm layer chủ thể. Layer gốc vẫn hiển thị để bạn đối chiếu và có thể tự ẩn khi cần.', 100, 'success');
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
