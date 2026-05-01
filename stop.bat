@echo off
title Stop AI Quiz App

echo Stopping all services...
taskkill /F /FI "WINDOWTITLE eq Backend*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq Frontend*" >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1

echo Done!
ping 127.0.0.1 -n 3 >nul