(function () {
  "use strict";
  if (typeof require === "function") {
    try {
      require("./index.js");
      return;
    } catch (err) {
      console.error("[AI Layer Splitter] Error loading index.js via require:", err);
    }
  }

  // Browser fallback for preview
  var entry = document.createElement("script");
  entry.src = "preview.js";
  entry.onerror = function () {
    var title = document.getElementById("statusText");
    var detail = document.getElementById("detailText");
    if (title) title.textContent = "Không tải được giao diện";
    if (detail) detail.textContent = "Hãy tải lại trang hoặc kiểm tra các file script.";
  };
  document.body.appendChild(entry);
}());
