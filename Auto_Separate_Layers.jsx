#target photoshop

function main() {
    if (app.documents.length === 0) {
        alert("Vui lòng mở một bức ảnh trong Photoshop trước khi chạy!");
        return;
    }

    var doc = app.activeDocument;
    var tempPath = Folder.temp + "/ps_current_export.png";

    // 1. Export tài liệu hiện tại ra ảnh tạm thời
    var exportFile = new File(tempPath);
    var exportOptions = new ExportOptionsSaveForWeb();
    exportOptions.format = SaveDocumentType.PNG;
    exportOptions.PNG8 = false;
    exportOptions.transparency = true;
    doc.exportDocument(exportFile, ExportType.SAVEFORWEB, exportOptions);

    // 2. Gọi Curl gửi tới Python AI Server
    var batPath = Folder.temp + "/call_ai.bat";
    var resultPath = Folder.temp + "/ai_result.json";
    
    var batFile = new File(batPath);
    batFile.open("w");
    batFile.writeln('@echo off');
    batFile.writeln('curl -s -X POST -F "file=@' + tempPath + '" http://127.0.0.1:5000/process > "' + resultPath + '"');
    batFile.close();
    batFile.execute();

    // Chờ server xử lý (khoảng 3 giây)
    $.sleep(3000);

    // 3. Đọc kết quả JSON trả về
    var resFile = new File(resultPath);
    if (!resFile.exists) {
        alert("Không nhận được phản hồi từ AI Server!\nHãy đảm bảo bạn đã chạy file run_ai_server.bat.");
        return;
    }

    resFile.open("r");
    var content = resFile.read();
    resFile.close();

    // 4. Nhúng layer mới đã tách vào Photoshop Document
    try {
        var json = eval("(" + content + ")");
        if (json.status === "success") {
            var fgFile = new File(json.foreground);
            if (fgFile.exists) {
                var fgDoc = app.open(fgFile);
                fgDoc.activeLayer.duplicate(doc);
                fgDoc.close(SaveOptions.DONOTSAVECHANGES);
                doc.activeLayer.name = "Layer: Chủ thể (Người & Vật phẩm)";
                alert("Tách layer thành công! Đã thêm Layer chủ thể riêng biệt.");
            }
        } else {
            alert("Lỗi từ AI: " + json.error);
        }
    } catch(e) {
        alert("Lỗi đọc kết quả: " + e);
    }
}

main();
