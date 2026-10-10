#target photoshop

function main() {
    if (app.documents.length === 0) {
        alert("Vui lòng mở một bức ảnh trong Photoshop trước khi chạy!");
        return;
    }

    var doc = app.activeDocument;
    var stamp = new Date().getTime();
    var tempPath = Folder.temp + "/ps_current_export_" + stamp + ".png";
    var batPath = Folder.temp + "/call_ai_" + stamp + ".bat";
    var resultPath = Folder.temp + "/ai_result_" + stamp + ".json";
    var donePath = Folder.temp + "/ai_done_" + stamp + ".txt";

    // 1. Export tài liệu hiện tại ra ảnh PNG tạm thời
    var exportFile = new File(tempPath);
    var exportOptions = new ExportOptionsSaveForWeb();
    exportOptions.format = SaveDocumentType.PNG;
    exportOptions.PNG8 = false;
    exportOptions.transparency = true;
    doc.exportDocument(exportFile, ExportType.SAVEFORWEB, exportOptions);

    if (!exportFile.exists || exportFile.length === 0) {
        alert("Không xuất được ảnh tạm từ Photoshop.");
        return;
    }

    // 2. Gọi Curl gửi tới Python AI Server
    var batFile = new File(batPath);
    var doneFile = new File(donePath);
    var resFile = new File(resultPath);

    batFile.open("w");
    batFile.writeln('@echo off');
    batFile.writeln('chcp 65001 > nul');
    batFile.writeln('curl -s -m 180 -X POST -F "file=@' + tempPath + '" -F "extract_subject=true" -F "inpaint_background=true" http://127.0.0.1:5000/process > "' + resultPath + '"');
    batFile.writeln('echo DONE > "' + donePath + '"');
    batFile.close();
    batFile.execute();

    // Chờ server xử lý đến khi hoàn tất (tối đa 180 giây)
    var waited = 0;
    while (!doneFile.exists && waited < 900) {
        $.sleep(200);
        waited++;
    }
    $.sleep(200);

    // 3. Đọc kết quả JSON trả về
    if (!doneFile.exists || !resFile.exists || resFile.length === 0) {
        try { batFile.remove(); } catch (_) {}
        try { exportFile.remove(); } catch (_) {}
        try { doneFile.remove(); } catch (_) {}
        try { resFile.remove(); } catch (_) {}
        alert("Không nhận được phản hồi từ AI Server!\nHãy đảm bảo bạn đã chạy file run_ai_server.bat.");
        return;
    }

    resFile.open("r");
    var content = resFile.read();
    resFile.close();

    try { batFile.remove(); } catch (_) {}
    try { exportFile.remove(); } catch (_) {}
    try { doneFile.remove(); } catch (_) {}
    try { resFile.remove(); } catch (_) {}

    // 4. Nhúng layer mới đã tách vào Photoshop Document
    try {
        var json = eval("(" + content + ")");
        if (json.status === "success") {
            // Nền đã bù (nếu có)
            if (json.background) {
                var bgFile = new File(json.background);
                if (bgFile.exists) {
                    var bgDoc = app.open(bgFile);
                    bgDoc.activeLayer.duplicate(doc);
                    bgDoc.close(SaveOptions.DONOTSAVECHANGES);
                    doc.activeLayer.name = "Layer: Nền đã bù (AI Inpaint)";
                }
            }
            // Chủ thể
            if (json.foreground) {
                var fgFile = new File(json.foreground);
                if (fgFile.exists) {
                    var fgDoc = app.open(fgFile);
                    fgDoc.activeLayer.duplicate(doc);
                    fgDoc.close(SaveOptions.DONOTSAVECHANGES);
                    doc.activeLayer.name = "Layer: Chủ thể (Người & Vật phẩm)";
                }
            }
            alert("Tách layer thành công! Đã thêm Layer chủ thể và nền riêng biệt.");
        } else {
            alert("Lỗi từ AI Server: " + json.error);
        }
    } catch (e) {
        alert("Lỗi đọc kết quả: " + e);
    }
}

main();
