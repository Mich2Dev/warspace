import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    allowedHosts: ['itinerary-primer-enjoyer.ngrok-free.dev', '.ngrok-free.dev', '.ngrok.app', '.ngrok.io', 'localhost'], // Reglas estrictas para Vite 8
    proxy: {
      // Redirigir todas las conexiones WebSocket de Socket.io al backend local en el puerto 3000
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true
      }
    }
  }
});
