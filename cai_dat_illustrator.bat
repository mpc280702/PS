@echo off
chcp 65001 > nul
title Cai dat AI Layer Splitter cho Adobe Illustrator

:: Kiem tra quyen Administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo =====================================================================
    echo Dang yeu cau quyen Administrator de sao chep vao Program Files...
    echo Vui long bam YES neu cua so UAC hien len.
    echo =====================================================================
    powershell -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

color 0b
echo =====================================================================
echo    CAI DAT AI LAYER SPLITTER CHO ADOBE ILLUSTRATOR
echo =====================================================================
echo.

set SCRIPT_SOURCE=%~dp0Illustrator_AI_Layer_Splitter.jsx

if not exist "%SCRIPT_SOURCE%" (
    echo [LOI] Khong tim thay file Illustrator_AI_Layer_Splitter.jsx!
    pause
    exit /b 1
)

set FOUND_AI=0
echo Dang quet cac phien ban Adobe Illustrator tren may...
echo.

for /d %%A in ("C:\Program Files\Adobe\Adobe Illustrator*") do (
    if exist "%%A" (
        echo [PHAT HIEN] %%A
        for /d %%P in ("%%A\Presets\*") do (
            if exist "%%P\Scripts" (
                echo   - Dang sao chep script vao: %%P\Scripts
                copy /Y "%SCRIPT_SOURCE%" "%%P\Scripts\AI_Layer_Splitter.jsx" > nul
                if %ERRORLEVEL% equ 0 (
                    echo   -^> [THANH CONG] Da cai dat vao: %%P\Scripts\AI_Layer_Splitter.jsx
                    set FOUND_AI=1
                )
            )
        )
    )
)

echo.
if %FOUND_AI% equ 1 (
    echo =====================================================================
    echo   [DA HOAN TAT CAI DAT VAO ADOBE ILLUSTRATOR!]
    echo =====================================================================
    echo.
    echo Cach su dung trong Adobe Illustrator:
    echo  1. Mo Adobe Illustrator va mo file banner / artboard can tach.
    echo  2. Vao menu tren cung: File ^> Scripts ^> AI_Layer_Splitter
    echo     (Neu khong thay, khoi dong lai Illustrator hoac bam Ctrl + F12
    echo      va chon file: %SCRIPT_SOURCE%).
    echo  3. Chon tac vu: Tach chu the, Bu nen (Inpaint) hoac Ra banner SAM.
    echo  4. Bam "Bat dau xu ly AI".
    echo =====================================================================
) else (
    echo [THONG BAO] Ban co the dung ngay ma khong can cai vao thu muc he thong:
    echo  1. Mo Adobe Illustrator.
    echo  2. Nhan phim: Ctrl + F12 (File ^> Scripts ^> Other Script...).
    echo  3. Chon file: %SCRIPT_SOURCE%
    echo =====================================================================
)

echo.
pause
