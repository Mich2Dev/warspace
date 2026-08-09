@echo off
color 0b
echo ===================================================
echo     INICIANDO WARSPACE
echo ===================================================
echo.
echo  [1] App de escritorio (recomendado ? sin navegador)
echo  [2] Modo navegador clasico (Vite + servidor)
echo  [3] Solo tunel Ngrok (si ya tienes el juego corriendo)
echo.
choice /C 123 /N /M "Elige opcion: "
if errorlevel 3 goto NGROK
if errorlevel 2 goto BROWSER
if errorlevel 1 goto DESKTOP

:DESKTOP
call "%~dp0Jugar.bat"
goto END

:BROWSER
echo.
echo [1/2] Levantando Servidor Central (Socket.io en puerto 3000)...
start "Warspace - Servidor Backend" cmd /k "node server.js"

echo [2/2] Levantando Motor Grafico (Vite en puerto 5173)...
start "Warspace - Motor Grafico" cmd /k "npm run dev"

echo.
echo Abre http://localhost:5173/ en el navegador si no se abre solo.
echo.
goto END

:NGROK
echo [3] Abriendo tunel publico...
start "Warspace - Tunel Ngrok" cmd /k "ngrok http --domain=itinerary-primer-enjoyer.ngrok-free.dev 5173"

:END
