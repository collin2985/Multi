@echo off
echo Starting Horse Game Servers...
echo.

REM Check if we're running inside Windows Terminal
if defined WT_SESSION (
    echo Adding tabs to current Windows Terminal window...
    REM Use -w 0 to target current window, add new tabs
    wt -w 0 nt -d "%cd%" --title "Game Server" cmd /k "node server.js"
    wt -w 0 nt -d "%cd%" --title "Web Server" cmd /k "http-server . -p 8000"
) else (
    REM Check if Windows Terminal is available for new window
    where wt >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        echo Opening new Windows Terminal with tabs...
        REM Create new window with tabs
        wt -w new -d "%cd%" --title "Game Server" cmd /k "node server.js" ; ^
           nt -d "%cd%" --title "Web Server" cmd /k "http-server . -p 8000"
    ) else (
        REM Fallback to PowerShell if Windows Terminal not available
        echo Using PowerShell windows...
        powershell -Command "Start-Process powershell -ArgumentList '-NoExit', '-Command', 'cd ''%cd%''; Write-Host ''Game Server - Port 8080'' -ForegroundColor Green; node server.js'"
        powershell -Command "Start-Process powershell -ArgumentList '-NoExit', '-Command', 'cd ''%cd%''; Write-Host ''Web Server - Port 8000'' -ForegroundColor Green; http-server . -p 8000'"
    )
)

echo.
echo Waiting for servers to start...
timeout /t 3 /nobreak > nul

echo Opening game in browser...
start http://localhost:8000/public/client.html

echo.
echo Game servers started! You can close this window.
timeout /t 2 /nobreak > nul