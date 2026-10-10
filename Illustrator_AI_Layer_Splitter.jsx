#target illustrator

/**
 * AI Layer Splitter for Adobe Illustrator
 * Tự động tách chủ thể, bù nền & rã banner thành nhiều layer bằng AI cục bộ
 */

(function () {
    if (app.documents.length === 0) {
        alert("Vui lòng mở một file thiết kế trong Adobe Illustrator trước khi chạy script!", "AI Layer Splitter");
        return;
    }

    var doc = app.activeDocument;
    var SERVER_URL = "http://127.0.0.1:5000";

    // -------------------------------------------------------------
    // Helper: Thực thi Curl qua file BAT tạm và đọc kết quả
    // -------------------------------------------------------------
    function runCurl(url, args, timeoutSec) {
        var stamp = new Date().getTime();
        var batFile = new File(Folder.temp + "/ai_ill_call_" + stamp + ".bat");
        var resFile = new File(Folder.temp + "/ai_ill_res_" + stamp + ".json");
        var logFile = new File(Folder.temp + "/ai_ill_log_" + stamp + ".txt");

        batFile.open("w");
        batFile.encoding = "UTF-8";
        batFile.writeln("@echo off");
        batFile.writeln('chcp 65001 > nul');
        var cmd = 'curl -s -m ' + (timeoutSec || 180) + ' ' + args + ' "' + url + '" > "' + resFile.fsName + '" 2> "' + logFile.fsName + '"';
        batFile.writeln(cmd);
        batFile.close();

        batFile.execute();

        var maxWait = (timeoutSec || 180) * 10;
        var waited = 0;
        while (!resFile.exists && waited < maxWait) {
            $.sleep(100);
            waited++;
        }

        // Chờ file ghi xong
        $.sleep(300);

        if (!resFile.exists || resFile.length === 0) {
            try { batFile.remove(); } catch (_) {}
            try { logFile.remove(); } catch (_) {}
            return null;
        }

        resFile.open("r");
        resFile.encoding = "UTF-8";
        var content = resFile.read();
        resFile.close();

        try { batFile.remove(); } catch (_) {}
        try { resFile.remove(); } catch (_) {}
        try { logFile.remove(); } catch (_) {}

        try {
            return eval("(" + content + ")");
        } catch (e) {
            return null;
        }
    }

    // -------------------------------------------------------------
    // Helper: Kiểm tra AI Server đang chạy
    // -------------------------------------------------------------
    function checkServer() {
        var res = runCurl(SERVER_URL + "/health", "-X GET", 5);
        return res && res.status === "ok";
    }

    // -------------------------------------------------------------
    // Giao diện ScriptUI
    // -------------------------------------------------------------
    var win = new Window("dialog", "AI Layer Splitter cho Illustrator - v2.7");
    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.spacing = 12;
    win.margins = 16;

    // Header Panel
    var headerPanel = win.add("panel");
    headerPanel.orientation = "column";
    headerPanel.alignChildren = ["left", "center"];
    var titleText = headerPanel.add("statictext", undefined, "✦ AI Layer Splitter (Adobe Illustrator)");
    titleText.graphics.font = ScriptUI.newFont("Tahoma", "Bold", 14);
    var descText = headerPanel.add("statictext", undefined, "Tách người/sản phẩm & rã banner thành từng layer riêng biệt bằng AI");

    // Task Options Panel
    var taskPanel = win.add("panel", undefined, "Chọn tác vụ AI");
    taskPanel.orientation = "column";
    taskPanel.alignChildren = ["left", "center"];
    taskPanel.spacing = 8;

    var rbSubject = taskPanel.add("radiobutton", undefined, "Tách chủ thể chính (Người, sản phẩm, vật thể) - PNG trong suốt");
    var rbInpaint = taskPanel.add("radiobutton", undefined, "Tách chủ thể + Tự bù nền phía sau (Inpainting - Giữ nền liền mạch)");
    var rbBanner = taskPanel.add("radiobutton", undefined, "Rã toàn bộ các thành phần trong Banner thành nhiều Layer (SAM AI)");
    rbSubject.value = true;

    // Model & Settings Panel
    var settingsPanel = win.add("panel", undefined, "Cài đặt & Tùy chọn");
    settingsPanel.orientation = "column";
    settingsPanel.alignChildren = ["fill", "center"];
    settingsPanel.spacing = 8;

    var modelRow = settingsPanel.add("group");
    modelRow.add("statictext", undefined, "Mô hình AI:");
    var modelDropdown = modelRow.add("dropdownlist", undefined, [
        "isnet-general-use (Siêu nét, mặc định)",
        "birefnet-general (Chất lượng cao, giữ chi tiết mảnh)",
        "u2net (Đa dụng, ổn định)",
        "silueta (Nhẹ, tốc độ nhanh)"
    ]);
    modelDropdown.selection = 0;

    var chkEmbed = settingsPanel.add("checkbox", undefined, "Nhúng trực tiếp ảnh vào file AI (Embed) để không mất link");
    chkEmbed.value = true;

    var chkLockOriginal = settingsPanel.add("checkbox", undefined, "Khóa & ẩn các layer cũ sau khi tách");
    chkLockOriginal.value = false;

    // Buttons
    var btnRow = win.add("group");
    btnRow.alignment = ["right", "center"];
    var btnCancel = btnRow.add("button", undefined, "Hủy");
    var btnRun = btnRow.add("button", undefined, "Bắt đầu xử lý AI", { name: "ok" });

    btnCancel.onClick = function () {
        win.close();
    };

    btnRun.onClick = function () {
        // Kiểm tra kết nối AI Server trước
        if (!checkServer()) {
            alert(
                "Không thể kết nối đến AI Server (http://127.0.0.1:5000)!\n\n" +
                "Vui lòng đảm bảo bạn đã chạy file 'run_ai_server.bat' trong thư mục Photoshop_AI_Layer_Splitter.",
                "Lỗi kết nối AI Server"
            );
            return;
        }

        win.close(1);
    };

    var dialogResult = win.show();
    if (dialogResult !== 1) return;

    // -------------------------------------------------------------
    // Tiến hành xử lý trong Illustrator
    // -------------------------------------------------------------
    var modelKeys = ["isnet-general-use", "birefnet-general", "u2net", "silueta"];
    var selectedModel = modelKeys[modelDropdown.selection.index];
    var isSubjectOnly = rbSubject.value;
    var isInpaint = rbInpaint.value;
    var isDecomposeBanner = rbBanner.value;

    // Lưu lại danh sách layer gốc
    var origLayers = [];
    for (var l = 0; l < doc.layers.length; l++) {
        origLayers.push(doc.layers[l]);
    }

    // Lấy kích thước Artboard hiện tại
    var abIdx = doc.artboards.getActiveArtboardIndex();
    var ab = doc.artboards[abIdx];
    var abRect = ab.artboardRect; // [left, top, right, bottom]
    var abLeft = abRect[0];
    var abTop = abRect[1];
    var abWidth = Math.abs(abRect[2] - abRect[0]);
    var abHeight = Math.abs(abRect[1] - abRect[3]);

    // 1. Xuất Artboard hiện tại ra ảnh PNG tạm thời
    var tempExportFile = new File(Folder.temp + "/ai_ill_export_" + (new Date().getTime()) + ".png");
    var exportOptions = new ExportOptionsPNG24();
    exportOptions.antiAliasing = true;
    exportOptions.transparency = true;
    exportOptions.artBoardClipping = true;
    exportOptions.horizontalScale = 100.0;
    exportOptions.verticalScale = 100.0;

    try {
        doc.exportFile(tempExportFile, ExportType.PNG24, exportOptions);
    } catch (expErr) {
        alert("Không thể xuất ảnh tạm từ Illustrator: " + expErr, "Lỗi xuất ảnh");
        return;
    }

    if (!tempExportFile.exists || tempExportFile.length === 0) {
        alert("Ảnh xuất tạm bị rỗng hoặc không tồn tại.", "Lỗi");
        return;
    }

    // 2. Gọi AI Server tương ứng với tác vụ
    if (isSubjectOnly || isInpaint) {
        var curlArgs = '-X POST -F "file=@' + tempExportFile.fsName + '" ' +
            '-F "model=' + selectedModel + '" ' +
            '-F "extract_subject=true" ' +
            '-F "inpaint_background=' + (isInpaint ? "true" : "false") + '"';

        var result = runCurl(SERVER_URL + "/process", curlArgs, 120);

        try { tempExportFile.remove(); } catch (_) {}

        if (!result || result.status !== "success") {
            alert("Lỗi từ AI Server: " + (result ? result.error : "Không nhận được phản hồi."), "Thất bại");
            return;
        }

        // Đặt nền đã bù trước (nếu có)
        if (isInpaint && result.background) {
            var bgFile = new File(result.background);
            if (bgFile.exists) {
                var bgLayer = doc.layers.add();
                bgLayer.name = "AI - Nền đã bù (Inpaint)";
                var bgPlaced = bgLayer.placedItems.add();
                bgPlaced.file = bgFile;
                bgPlaced.left = abLeft;
                bgPlaced.top = abTop;
                bgPlaced.width = abWidth;
                bgPlaced.height = abHeight;
                if (chkEmbed.value) {
                    try { bgPlaced.embed(); } catch (_) {}
                }
            }
        }

        // Đặt chủ thể lên trên
        if (result.foreground) {
            var fgFile = new File(result.foreground);
            if (fgFile.exists) {
                var fgLayer = doc.layers.add();
                fgLayer.name = "AI - Chủ thể (" + selectedModel + ")";
                var fgPlaced = fgLayer.placedItems.add();
                fgPlaced.file = fgFile;
                fgPlaced.left = abLeft;
                fgPlaced.top = abTop;
                fgPlaced.width = abWidth;
                fgPlaced.height = abHeight;
                if (chkEmbed.value) {
                    try { fgPlaced.embed(); } catch (_) {}
                }
            }
        }

        // Khóa/ẩn layer gốc nếu được chọn
        if (chkLockOriginal.value) {
            for (var k = 0; k < origLayers.length; k++) {
                try {
                    origLayers[k].visible = false;
                    origLayers[k].locked = true;
                } catch (_) {}
            }
        }

        alert(
            "Tách layer thành công!\n" +
            "• Đã thêm Layer: " + (isInpaint ? "Chủ thể & Nền đã bù" : "Chủ thể riêng biệt") + "\n" +
            "• Thời gian xử lý: " + (result.elapsed_seconds || "---") + "s",
            "AI Layer Splitter Hoàn Tất"
        );

    } else if (isDecomposeBanner) {
        // Tác vụ rã banner (SAM AI)
        var autoArgs = '-X POST -F "file=@' + tempExportFile.fsName + '" -F "quality=balanced"';
        var autoResult = runCurl(SERVER_URL + "/segment_auto", autoArgs, 300);

        try { tempExportFile.remove(); } catch (_) {}

        if (!autoResult || autoResult.status !== "success" || !autoResult.objects) {
            alert("Lỗi khi phân tích banner bằng AI SAM: " + (autoResult ? autoResult.error : "Không nhận được phản hồi."), "Thất bại");
            return;
        }

        var imageId = autoResult.image_id;
        var objects = autoResult.objects;
        var totalFound = objects.length;

        // Giới hạn số layer nhập để tránh treo Illustrator (ưu tiên các vùng chính default_selected !== false)
        var importList = [];
        for (var o = 0; o < objects.length; o++) {
            if (objects[o].default_selected !== false) {
                importList.push(objects[o]);
            }
        }
        if (importList.length === 0) importList = objects.slice(0, 15);

        var importedCount = 0;
        for (var idx = 0; idx < importList.length; idx++) {
            var item = importList[idx];
            // Gọi export từng vùng
            var exportArgs = '-H "Content-Type: application/json" -d "{\\"image_id\\":\\"' + imageId + '\\",\\"object_id\\":\\"' + item.id + '\\"}"';
            var expRes = runCurl(SERVER_URL + "/segment_auto_export", exportArgs, 60);

            if (expRes && expRes.status === "success" && expRes.foreground_base64) {
                // Giải mã Base64 sang file tạm qua script VBS/BAT
                var objTempFile = new File(Folder.temp + "/ai_obj_" + item.id + "_" + (new Date().getTime()) + ".png");
                var b64TempTxt = new File(Folder.temp + "/ai_obj_" + item.id + ".b64");
                b64TempTxt.open("w");
                b64TempTxt.write(expRes.foreground_base64);
                b64TempTxt.close();

                // Dùng certutil giải mã Base64 sang PNG
                var decBat = new File(Folder.temp + "/decode_" + item.id + ".bat");
                decBat.open("w");
                decBat.writeln('@echo off');
                decBat.writeln('certutil -decode "' + b64TempTxt.fsName + '" "' + objTempFile.fsName + '" > nul');
                decBat.close();
                decBat.execute();

                // Chờ giải mã
                var w = 0;
                while (!objTempFile.exists && w < 30) {
                    $.sleep(100);
                    w++;
                }

                if (objTempFile.exists && objTempFile.length > 0) {
                    var objLayer = doc.layers.add();
                    objLayer.name = "AI - " + (item.category || "Phần") + " (" + item.name + ")";
                    var objPlaced = objLayer.placedItems.add();
                    objPlaced.file = objTempFile;

                    // Tính tỷ lệ vị trí trên Artboard
                    var scaleX = abWidth / expRes.canvas_width;
                    var scaleY = abHeight / expRes.canvas_height;

                    objPlaced.left = abLeft + (expRes.crop_x * scaleX);
                    objPlaced.top = abTop - (expRes.crop_y * scaleY);
                    objPlaced.width = expRes.width * scaleX;
                    objPlaced.height = expRes.height * scaleY;

                    if (chkEmbed.value) {
                        try { objPlaced.embed(); } catch (_) {}
                    }
                    importedCount++;
                }

                try { b64TempTxt.remove(); } catch (_) {}
                try { decBat.remove(); } catch (_) {}
            }
        }

        // Đóng session
        runCurl(SERVER_URL + "/segment_auto_close", '-H "Content-Type: application/json" -d "{\\"image_id\\":\\"' + imageId + '\\"}"', 5);

        if (chkLockOriginal.value) {
            for (var m = 0; m < origLayers.length; m++) {
                try {
                    origLayers[m].visible = false;
                    origLayers[m].locked = true;
                } catch (_) {}
            }
        }

        alert(
            "Đã rã banner thành công!\n" +
            "• Đã tạo " + importedCount + " layer riêng biệt tương ứng với từng chi tiết trên Artboard.\n" +
            "• Tìm thấy tổng cộng " + totalFound + " vùng nhận diện bởi SAM AI.",
            "Rã Banner Hoàn Tất"
        );
    }
})();
