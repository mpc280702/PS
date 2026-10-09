Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set WshShell = CreateObject("WScript.Shell")

userProfile = WshShell.ExpandEnvironmentStrings("%USERPROFILE%")
pyExe = userProfile & "\AppData\Local\Programs\Python\Python311\python.exe"

If Not fso.FileExists(pyExe) Then
    If fso.FileExists("C:\Program Files\Python311\python.exe") Then
        pyExe = "C:\Program Files\Python311\python.exe"
    Else
        pyExe = "python.exe"
    End If
End If

cmdStr = chr(34) & pyExe & chr(34) & " " & chr(34) & scriptDir & "\server.py" & chr(34)
WshShell.CurrentDirectory = scriptDir
WshShell.Run cmdStr, 0, False
