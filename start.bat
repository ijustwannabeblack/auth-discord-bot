@echo off
title Key Activation Discord Bot
cd /d "%~dp0"

echo ========================================================
echo  Checking Dependencies for Discord Bot...
echo ========================================================

if not exist node_modules (
    echo Installing discord.js...
    call npm install
)

echo.
echo Starting Discord Bot...
echo ========================================================
node bot.js
echo.
pause
