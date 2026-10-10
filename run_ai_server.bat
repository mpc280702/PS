@echo off
setlocal
chcp 65001 > nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
title AI Photoshop Backend Server
cd /d "%~dp0"

echo =====================================================
echo  AI LAYER SPLITTER - KIEM TRA MAY CHU
echo =====================================================

rem Reuse this project's server when it is already healthy.
rem Never taskkill python/pythonw globally: that can stop unrelated apps.
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-RestMethod -Uri 'http://127.0.0.1:5000/health' -TimeoutSec 2; if ($r.status -eq 'ok') { exit 0 } } catch {}; exit 1"
if not errorlevel 1 (
    echo [OK] AI Server dang chay tai http://127.0.0.1:5000
    echo Khong can khoi dong them tien trinh.
    pause
    exit /b 0
)

set "PY_EXE="
if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
    set "PY_EXE=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
) else if exist "%ProgramFiles%\Python311\python.exe" (
    set "PY_EXE=%ProgramFiles%\Python311\python.exe"
) else (
    where py.exe >nul 2>&1
    if not errorlevel 1 (
        set "PY_EXE=py -3.11"
    ) else (
        where python.exe >nul 2>&1
        if not errorlevel 1 set "PY_EXE=python"
    )
)

if "%PY_EXE%"=="" (
    echo [ERROR] Khong tim thay Python.
    echo Hay cai Python 3.11 va danh dau Add Python to PATH.
    pause
    exit /b 1
)

echo Dang khoi dong AI Server...
%PY_EXE% server.py
if errorlevel 1 (
    echo.
    echo [ERROR] AI Server dung voi loi. Kiem tra server_debug.log.
    pause
)
