@echo off
color 0b
cd /d "%~dp0"
echo ===================================================
echo     INICIANDO NO MAN'S SKY CLONE (MULTIJUGADOR)
echo ===================================================
echo.

echo [1/3] Levantando Servidor Central (Socket.io en puerto 3000)...
start "NoMansSky - Servidor Backend" cmd /k "node server.js"

echo [2/3] Levantando Motor Grafico (Vite)...
start "NoMansSky - Motor Grafico" cmd /k "npm run dev"

echo.
echo Esperando a que el juego este listo...
set /a _tries=0
:wait_vite
set /a _tries+=1
if %_tries% GTR 40 goto open_anyway
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://localhost:5173/; if ($r.StatusCode -ge 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if errorlevel 1 goto wait_vite

:open_anyway
echo [3/3] Abriendo el juego en tu navegador...
start "" "http://localhost:5173/"

echo.
echo ===================================================
echo Juego abierto en http://localhost:5173/
echo.
echo Opcional: para jugar con un amigo por internet,
echo escribe S y Enter para abrir el tunel Ngrok.
echo (Enter solo = no, solo local)
echo ===================================================
set /p OPEN_NGROK="Abrir Ngrok? (S/Enter): "
if /i "%OPEN_NGROK%"=="S" (
  echo Abriendo tunel publico...
  start "NoMansSky - Tunel Ngrok" cmd /k "ngrok http --domain=itinerary-primer-enjoyer.ngrok-free.dev 5173"
)

echo.
echo Listo. Puedes cerrar esta ventana.
pause >nul
