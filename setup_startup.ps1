$targetDir = $PSScriptRoot
$serverScript = Join-Path $targetDir 'server.py'
$startup = [System.Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup 'AI_Photoshop_Server.lnk'

# Tim duong dan pythonw.exe
$pywExe = "$env:LOCALAPPDATA\Programs\Python\Python311\pythonw.exe"
if (-not (Test-Path $pywExe)) {
    if (Test-Path "C:\Program Files\Python311\pythonw.exe") {
        $pywExe = "C:\Program Files\Python311\pythonw.exe"
    } else {
        $pywExe = "pythonw.exe"
    }
}

# Tao shortcut trong Startup chay truc tiep qua pythonw.exe (chay ngam 100% khong hien cua so)
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $pywExe
$shortcut.Arguments = "`"$serverScript`""
$shortcut.WorkingDirectory = $targetDir
$shortcut.Description = "AI Photoshop Layer Splitter Backend Server"
$shortcut.Save()

Write-Host "[OK] Da cai dat loi tat khoi dong: $shortcutPath" -ForegroundColor Green

# Dung server cu neu co
Get-Process -Name python, pythonw -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

# Khoi dong server ngay lap tuc
Start-Process -FilePath $pywExe -ArgumentList "`"$serverScript`"" -WorkingDirectory $targetDir
Start-Sleep -Seconds 2
Write-Host "[OK] Server AI da duoc kich hoat chay ngam!" -ForegroundColor Green
