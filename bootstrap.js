(function () {
  "use strict";

  // Tab switching initialization (works in both UXP and browser)
  function initTabs() {
    var tabs = document.querySelectorAll(".tab-btn");
    if (!tabs || tabs.length === 0) return;
    tabs.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var targetId = btn.getAttribute("data-tab");
        tabs.forEach(function (b) {
          b.classList.remove("active");
          b.setAttribute("aria-selected", "false");
        });
        document.querySelectorAll(".tab-pane").forEach(function (pane) {
          pane.classList.remove("active");
          pane.hidden = true;
        });
        btn.classList.add("active");
        btn.setAttribute("aria-selected", "true");
        var targetPane = document.getElementById(targetId);
        if (targetPane) {
          targetPane.classList.add("active");
          targetPane.hidden = false;
        }
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTabs);
  } else {
    initTabs();
  }

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
