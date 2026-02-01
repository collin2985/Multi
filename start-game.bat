@echo off
echo Starting Horse Game Servers...
echo.

REM Check if we're running inside Windows Terminal
if defined WT_SESSION (
    echo Adding tabs to current Windows Terminal window...
    REM Use -w 0 to target current window, add new tabs with PowerShell
    wt -w 0 nt -d "%cd%" --title "Game Server" powershell -NoExit -Command "node server.js"
    wt -w 0 nt -d "%cd%" --title "Web Server" cmd /k "http-server . -p 8000"
    wt -w 0 nt -d "%cd%" --title "Claude" cmd /k "claude"
) else (
    REM Check if Windows Terminal is available for new window
    where wt >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        echo Opening new Windows Terminal with tabs...
        REM Create new window with tabs using PowerShell
        wt -w new -d "%cd%" --title "Game Server" powershell -NoExit -Command "node server.js" ; ^
           nt -d "%cd%" --title "Web Server" cmd /k "http-server . -p 8000" ; ^
           nt -d "%cd%" --title "Claude" cmd /k "claude"
    ) else (
        REM Fallback to PowerShell windows if Windows Terminal not available
        echo Using PowerShell windows...
        powershell -Command "Start-Process powershell -ArgumentList '-NoExit', '-Command', 'cd ''%cd%''; Write-Host ''Game Server - Port 8080'' -ForegroundColor Green; node server.js'"
        powershell -Command "Start-Process cmd -ArgumentList '/k', 'cd /d \"%cd%\" && echo Web Server - Port 8000 && http-server . -p 8000'"
        powershell -Command "Start-Process cmd -ArgumentList '/k', 'cd /d \"%cd%\" && claude'"
    )
)

