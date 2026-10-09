@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo =======================================================
echo    HỦY BỎ TỰ ĐỘNG CHẠY NGẦM SERVER CÙNG WINDOWS
echo =======================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$file = Join-Path ([System.Environment]::GetFolderPath('Startup')) 'AI_Photoshop_Server.lnk'; if (Test-Path $file) { Remove-Item $file -Force; Write-Host '[✓] Đã gỡ bỏ lối tắt khởi động.' -ForegroundColor Green } else { Write-Host '[*] Không có lối tắt trong thư mục Startup.' }"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process python, pythonw -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Write-Host '[✓] Đã dừng các tiến trình Server.' -ForegroundColor Green"
echo.
pause
