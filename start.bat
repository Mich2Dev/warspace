@echo off
title WarSpace
cd /d "%~dp0"
echo.
echo  WarSpace - Iniciando juego...
echo.
npm start
if errorlevel 1 (
    echo.
    echo  Error al iniciar. Asegurate de haber ejecutado "npm install" al menos una vez.
    echo.
    pause
)
