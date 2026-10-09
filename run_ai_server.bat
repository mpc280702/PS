@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
title AI Photoshop Backend Server
cd /d "%~dp0"

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
    echo [ERROR] Khong tim thay Python 3.11!
    pause
    exit /b 1
)

%PY_EXE% server.py
if errorlevel 1 (
    pause
)
