@echo off
title AI Quiz App - Launcher

echo.
echo =========================================
echo    AI Quiz App - Quick Start
echo =========================================
echo.

echo [1/3] Starting backend...
start "Backend" cmd /k "cd /d F:\trae\demo_lianxi\backend & node server.js"

echo [2/3] Waiting 3 seconds...
ping 127.0.0.1 -n 4 >nul

echo [3/3] Starting frontend...
start "Frontend" cmd /k "cd /d F:\trae\demo_lianxi\frontend & npm run dev"

echo Waiting 5 seconds for frontend...
ping 127.0.0.1 -n 6 >nul

echo Opening browser...
start http://localhost:5173

echo.
echo =========================================
echo  Started successfully!
echo  Browser: http://localhost:5173
echo  Stop services: run stop.bat
echo =========================================
echo.
pause