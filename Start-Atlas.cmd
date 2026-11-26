@echo off
setlocal
cd /d "%~dp0" || exit /b 1

where node.exe >nul 2>&1
if errorlevel 1 (
    echo Node.js 22 or later is required. Install it from https://nodejs.org/
    pause
    exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
    echo Please update Node.js to version 22 or later.
    pause
    exit /b 1
)

set "PORT=3000"
echo Open http://localhost:3000 in your browser after the server starts.
echo Keep this window open while students are playing.
node "%~dp0server.js"
if errorlevel 1 (
    echo Atlas could not start. See the error above.
    pause
    exit /b 1
)
