@echo off
setlocal
chcp 65001 > nul
title AI Layer Splitter - Cai model SAM
cd /d "%~dp0"

echo ==========================================================
echo  CAI CHE DO TACH TUNG VAT THE CHI TIET (SAM ViT-B)
echo ==========================================================
echo Model can tai mot lan, dung luong khoang vai tram MB.
echo Sau khi cai dat, AI Server cu van hoat dong nhu truoc.
echo.

set "PY_CMD="
if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
    set "PY_CMD=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
) else if exist "%ProgramFiles%\Python311\python.exe" (
    set "PY_CMD=%ProgramFiles%\Python311\python.exe"
) else (
    where py.exe >nul 2>&1
    if not errorlevel 1 (
        set "PY_CMD=py -3.11"
    ) else (
        where python.exe >nul 2>&1
        if not errorlevel 1 set "PY_CMD=python"
    )
)

if "%PY_CMD%"=="" (
    echo [ERROR] Khong tim thay Python.
    echo Cai Python 3.11 va chon Add Python to PATH, sau do chay lai.
    pause
    exit /b 1
)

echo [1/3] Kiem tra PyTorch va TorchVision...
%PY_CMD% -c "import torch, torchvision" >nul 2>&1
if errorlevel 1 (
    echo Chua tim thay ca torch va torchvision trong moi truong Python nay.
    echo Mac dinh se cai ban CPU de de cai dat tren Windows.
    choice /C YN /M "Tiep tuc cai PyTorch CPU? (chon N neu ban muon tu cai ban CUDA/GPU)"
    if errorlevel 2 goto :manual_torch
    %PY_CMD% -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
    if errorlevel 1 (
        echo [ERROR] Cai PyTorch that bai. Kiem tra mang va phien ban Python.
        pause
        exit /b 1
    )
) else (
    echo [OK] Da tim thay torch va torchvision. Se giu nguyen ban dang cai.
)

echo.
echo [2/3] Cai Segment Anything...
%PY_CMD% -m pip install git+https://github.com/facebookresearch/segment-anything.git
if errorlevel 1 (
    echo [ERROR] Cai segment-anything that bai.
    pause
    exit /b 1
)

echo.
echo [3/3] Tai model SAM ViT-B...
if not exist "%~dp0models" mkdir "%~dp0models"
if exist "%~dp0models\sam_vit_b_01ec64.pth" (
    echo [OK] Da co file model, bo qua tai lai.
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth' -OutFile '%~dp0models\sam_vit_b_01ec64.pth'"
    if errorlevel 1 (
        echo [ERROR] Tai model that bai. Kiem tra mang va thu chay lai file nay.
        pause
        exit /b 1
    )
)

%PY_CMD% -c "import torch, torchvision; from segment_anything import SamPredictor, sam_model_registry; print('PyTorch', torch.__version__, '| CUDA:', torch.cuda.is_available()); print('SAM package: OK')"
if errorlevel 1 (
    echo [ERROR] Kiem tra SAM khong thanh cong.
    pause
    exit /b 1
)

echo.
echo ==========================================================
echo  CAI DAT HOAN TAT
echo  Hay dong va khoi dong lai AI Server, sau do mo panel Photoshop.
echo ==========================================================
pause
exit /b 0

:manual_torch
echo.
echo Da huy cai tu dong de ban co the cai ban GPU/CUDA tu trang chinh thuc:
echo https://pytorch.org/get-started/locally/
echo Sau khi cai xong torch va torchvision, chay lai cai_dat_sam.bat.
pause
exit /b 0
