@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo =======================================================
echo    CÀI ĐẶT TỰ ĐỘNG CHẠY NGẦM SERVER CÙNG WINDOWS
echo =======================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_startup.ps1"
echo.
echo =======================================================
echo Hoàn tất! Từ nay bạn chỉ cần mở Photoshop và dùng luôn.
echo =======================================================
echo.
pause
