$targetDir = $PSScriptRoot
$vbsPath = Join-Path $targetDir 'start_hidden.vbs'
$startup = [System.Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup 'AI_Photoshop_Server.lnk'

# Tao shortcut trong Startup
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = 'wscript.exe'
$shortcut.Arguments = "`"$vbsPath`""
$shortcut.WorkingDirectory = $targetDir
$shortcut.Description = "AI Photoshop Layer Splitter Backend Server"
$shortcut.Save()

Write-Host "[OK] Da cai dat loi tat khoi dong: $shortcutPath" -ForegroundColor Green

# Dung server cu neu co
Get-Process -Name python, pythonw -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Khoi dong server ngay lap tuc
Start-Process "wscript.exe" -ArgumentList "`"$vbsPath`"" -WorkingDirectory $targetDir
Write-Host "[OK] Server AI da duoc kich hoat chay ngam!" -ForegroundColor Green
