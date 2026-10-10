$ErrorActionPreference = 'Stop'
$targetDir = $PSScriptRoot
$serverScript = Join-Path $targetDir 'server.py'
$startup = [System.Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup 'AI_Photoshop_Server.lnk'

if (-not (Test-Path $serverScript)) {
    throw "Khong tim thay server.py tai: $serverScript"
}

# Find pythonw without assuming Python was installed in only one location.
$candidates = @(
    "$env:LOCALAPPDATA\Programs\Python\Python311\pythonw.exe",
    "$env:ProgramFiles\Python311\pythonw.exe"
)
$pywExe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $pywExe) {
    $command = Get-Command 'pythonw.exe' -ErrorAction SilentlyContinue
    if ($command) { $pywExe = $command.Source }
}
if (-not $pywExe) {
    throw "Khong tim thay pythonw.exe. Hay cai Python 3.11 hoac them Python vao PATH."
}

# Create/update the Startup shortcut.
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $pywExe
$shortcut.Arguments = '"' + $serverScript + '"'
$shortcut.WorkingDirectory = $targetDir
$shortcut.Description = "AI Photoshop Layer Splitter Backend Server"
$shortcut.Save()
Write-Host "[OK] Da them AI Layer Splitter vao Startup." -ForegroundColor Green

# Reuse the server if it is already healthy. Never stop unrelated Python processes.
try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5000/health' -TimeoutSec 2
    if ($health.status -eq 'ok') {
        Write-Host "[OK] AI Server da chay san; khong mo them tien trinh." -ForegroundColor Green
        exit 0
    }
} catch {
    # No healthy server responded, so start this project's server.
}

Start-Process -FilePath $pywExe -ArgumentList ('"' + $serverScript + '"') -WorkingDirectory $targetDir
Write-Host "[OK] Da gui lenh khoi dong AI Server trong nen." -ForegroundColor Green
Write-Host "Neu plugin chua ket noi duoc, hay doi server khoi tao model AI va kiem tra server_debug.log."
