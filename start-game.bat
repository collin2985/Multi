@echo off
echo Starting Horse Game Servers...
echo.

REM Check if Windows Terminal is available
where wt >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Using Windows Terminal with tabs...
    REM Open Windows Terminal with two tabs
    wt -w 0 nt -d "%cd%" --title "Game Server" cmd /k "node server.js" ; ^
       nt -d "%cd%" --title "Web Server" cmd /k "http-server . -p 8000"
) else (
    REM Fallback to PowerShell if Windows Terminal not available
    echo Using PowerShell...
    powershell -Command "Start-Process powershell -ArgumentList '-NoExit', '-Command', 'cd ''%cd%''; Write-Host ''Game Server - Port 8080'' -ForegroundColor Green; node server.js'"
    powershell -Command "Start-Process powershell -ArgumentList '-NoExit', '-Command', 'cd ''%cd%''; Write-Host ''Web Server - Port 8000'' -ForegroundColor Green; http-server . -p 8000'"
)

echo.
echo Waiting for servers to start...
timeout /t 3 /nobreak > nul

echo Opening game in browser...
start http://localhost:8000/public/client.html

REM Auto-close this window after launching everything
timeout /t 2 /nobreak > nul
exit