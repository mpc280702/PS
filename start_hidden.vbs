Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set WshShell = CreateObject("WScript.Shell")

userProfile = WshShell.ExpandEnvironmentStrings("%USERPROFILE%")
pywExe = userProfile & "\AppData\Local\Programs\Python\Python311\pythonw.exe"

If Not fso.FileExists(pywExe) Then
    If fso.FileExists("C:\Program Files\Python311\pythonw.exe") Then
        pywExe = "C:\Program Files\Python311\pythonw.exe"
    ElseIf fso.FileExists(userProfile & "\AppData\Local\Programs\Python\Python311\python.exe") Then
        pywExe = userProfile & "\AppData\Local\Programs\Python\Python311\python.exe"
    Else
        pywExe = "pythonw.exe"
    End If
End If

cmdStr = chr(34) & pywExe & chr(34) & " " & chr(34) & scriptDir & "\server.py" & chr(34)
WshShell.CurrentDirectory = scriptDir
WshShell.Run cmdStr, 0, False
