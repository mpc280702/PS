const { app, core } = require('photoshop');
const fs = require('uxp').storage.localFileSystem;
const formats = require('uxp').storage.formats;

document.getElementById('btnProcess').addEventListener('click', async () => {
    const statusText = document.getElementById('statusText');
    const progressBar = document.getElementById('progressBar');

    if (app.documents.length === 0) {
        statusText.innerText = "❌ Vui lòng mở ảnh trong Photoshop!";
        return;
    }

    try {
        statusText.innerText = "⏳ Đang xuất ảnh hiện tại...";
        progressBar.style.width = "20%";

        const doc = app.activeDocument;
        const tempFolder = await fs.getTemporaryFolder();
        const exportFile = await tempFolder.createFile("input_current.png", { overwrite: true });

        await core.executeAsModal(async () => {
            await doc.saveAs.png(exportFile);
        }, { commandName: "Export For AI" });

        statusText.innerText = "🚀 Đang gửi AI tách layer...";
        progressBar.style.width = "40%";

        // Đọc ảnh và chuyển sang Base64
        let base64Data = "";
        try {
            base64Data = await exportFile.read({ format: formats.base64 });
        } catch (readErr) {
            const arrayBuffer = await exportFile.read({ format: formats.binary });
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            base64Data = btoa(binary);
        }

        let response;
        try {
            response = await fetch("http://127.0.0.1:5000/process", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    image_base64: base64Data
                })
            });
        } catch (fetchErr) {
            throw new Error("Không thể kết nối AI Server! Hãy chắc chắn bạn đã chạy file 'run_ai_server.bat'.");
        }

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `HTTP ${response.status}: Lỗi từ AI Server`);
        }

        const data = await response.json();
        if (data.status !== "success" || !data.foreground_base64) {
            throw new Error(data.error || "Không nhận được kết quả từ AI");
        }

        statusText.innerText = "🎨 Đang đưa Layer vào Photoshop...";
        progressBar.style.width = "75%";

        // Giải mã Base64 sang nhị phân
        const binaryString = atob(data.foreground_base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const fgFile = await tempFolder.createFile("layer_foreground.png", { overwrite: true });
        await fgFile.write(bytes.buffer, { format: formats.binary });

        await core.executeAsModal(async () => {
            const fgDoc = await app.open(fgFile);
            await fgDoc.layers[0].duplicate(doc);
            await fgDoc.closeWithoutSaving();
            doc.activeLayers[0].name = "Layer: Chủ thể tách rời (AI)";
        }, { commandName: "Insert AI Layer" });

        progressBar.style.width = "100%";
        statusText.innerText = "✅ Tách Layer thành công!";
    } catch (err) {
        console.error(err);
        statusText.innerText = "❌ Lỗi: " + err.message;
        progressBar.style.width = "0%";
    }
});
