(function () {
  "use strict";
  var isPhotoshopUXP = false;
  try {
    if (typeof require === "function") {
      var photoshopModule = require("photoshop");
      var uxpModule = require("uxp");
      isPhotoshopUXP = !!(photoshopModule && photoshopModule.app && photoshopModule.core &&
        uxpModule && uxpModule.storage && uxpModule.storage.localFileSystem);
    }
  } catch (_) { isPhotoshopUXP = false; }

  var entry = document.createElement("script");
  entry.src = isPhotoshopUXP ? "index.js" : "preview.js";
  entry.onerror = function () {
    var title = document.getElementById("statusText");
    var detail = document.getElementById("detailText");
    if (title) title.textContent = "Không tải được giao diện";
    if (detail) detail.textContent = "Hãy tải lại trang hoặc kiểm tra các file bootstrap.js, index.js và preview.js.";
  };
  document.body.appendChild(entry);
}());
