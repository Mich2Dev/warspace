@echo off
color 0b
echo ===================================================
echo     INICIANDO NO MAN'S SKY CLONE (MULTIJUGADOR)
echo ===================================================
echo.

echo [1/3] Levantando Servidor Central (Socket.io en puerto 3000)...
start "NoMansSky - Servidor Backend" cmd /k "node server.js"

echo [2/3] Levantando Motor Grafico (Vite en puerto 5173)...
start "NoMansSky - Motor Grafico" cmd /k "npm run dev"

echo.
echo ===================================================
echo Servidores locales corriendo. 
echo Si quieres jugar con un amigo por internet, 
echo presiona cualquier tecla para abrir el tunel Ngrok.
echo (Cierra esta ventana si solo quieres jugar solo/local)
echo ===================================================
pause

echo [3/3] Abriendo tunel publico...
start "NoMansSky - Tunel Ngrok" cmd /k "ngrok http --domain=itinerary-primer-enjoyer.ngrok-free.dev 5173"
