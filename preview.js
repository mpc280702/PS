(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var notice = $("previewNotice");
  var buttonProcess = $("btnProcess");
  var buttonCheck = $("btnCheck");
  var statusText = $("statusText");
  var detailText = $("detailText");
  var progressBar = $("progressBar");
  var progressTrack = document.querySelector(".progress-track");
  var statusDot = $("statusDot");

  if (notice) notice.hidden = false;
  if (buttonProcess) buttonProcess.innerHTML = '<span aria-hidden="true">✦</span> Cách dùng trong Photoshop';
  if (statusText) statusText.textContent = "Bản xem trước website";
  if (detailText) detailText.textContent = "Giao diện đã tải. Chế độ web không thể thao tác tài liệu Photoshop; mở plugin trong Photoshop để tách ảnh thật.";
  if (statusDot) statusDot.className = "status-dot warning";
  if (progressBar) progressBar.style.width = "0%";
  if (progressTrack) progressTrack.setAttribute("aria-valuenow", "0");

  if (buttonProcess) buttonProcess.addEventListener("click", function () {
    if (statusText) statusText.textContent = "Cách mở công cụ trong Photoshop";
    if (detailText) detailText.textContent = "1) Cài Python và thư viện trong requirements.txt. 2) Chạy run_ai_server.bat. 3) Mở Adobe UXP Developer Tool, chọn Add Plugin và trỏ đến manifest.json, sau đó Load. 4) Trong Photoshop, mở Plugins → AI Layer Splitter.";
    if (statusDot) statusDot.className = "status-dot warning";
  });
  var buttonAnalyzeBanner = $("btnAnalyzeBanner");
  if (buttonAnalyzeBanner) buttonAnalyzeBanner.addEventListener("click", function () {
    if (statusText) statusText.textContent = "Tách banner cần chạy trong Photoshop";
    if (detailText) detailText.textContent = "Để dò nhiều phần trên banner, cài model bằng cai_dat_sam.bat, khởi động lại run_ai_server.bat, rồi mở panel AI Layer Splitter trong Photoshop và bấm Phân tích toàn banner.";
    if (statusDot) statusDot.className = "status-dot warning";
  });
  var buttonLoadSegImage = $("btnLoadSegImage");
  if (buttonLoadSegImage) buttonLoadSegImage.addEventListener("click", function () {
    if (statusText) statusText.textContent = "Tách vật thể cần chạy trong Photoshop";
    if (detailText) detailText.textContent = "Website GitHub Pages chỉ xem trước giao diện. Để tách từng vật thể, hãy chạy cai_dat_sam.bat, khởi động lại AI Server, rồi mở plugin trong Photoshop và bấm Nạp ảnh từ Photoshop.";
    if (statusDot) statusDot.className = "status-dot warning";
  });
  if (buttonCheck) buttonCheck.addEventListener("click", function () {
    if (statusText) statusText.textContent = "Kiểm tra server trong plugin";
    if (detailText) detailText.textContent = "Trình duyệt GitHub Pages không kiểm tra được AI Server cục bộ một cách đáng tin cậy. Hãy mở panel AI Layer Splitter bên trong Photoshop rồi bấm Kiểm tra AI Server.";
    if (statusDot) statusDot.className = "status-dot warning";
  });

  var btnViewList = $("btnViewList");
  var btnViewGrid = $("btnViewGrid");
  var autoSegObjectList = $("autoSegObjectList");
  if (btnViewList && btnViewGrid && autoSegObjectList) {
    btnViewList.addEventListener("click", function () {
      btnViewList.classList.add("active");
      btnViewGrid.classList.remove("active");
      autoSegObjectList.classList.remove("gallery-mode");
    });
    btnViewGrid.addEventListener("click", function () {
      btnViewGrid.classList.add("active");
      btnViewList.classList.remove("active");
      autoSegObjectList.classList.add("gallery-mode");
    });
  }
}());
