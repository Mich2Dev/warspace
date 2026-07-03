import express from 'express';
import http from 'http';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);
// Permitimos CORS para que Vite en desarrollo pueda conectarse
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const players = {};

io.on('connection', (socket) => {
  console.log('Un jugador se ha conectado:', socket.id);
  
  // Le enviamos al nuevo jugador la lista de todos los jugadores que ya están
  socket.emit('current_players', players);
  
  // Guardamos al nuevo jugador en el estado del servidor
  players[socket.id] = {
    id: socket.id,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    flameScale: 0
  };
  
  // Le avisamos a los demás que alguien nuevo llegó
  socket.broadcast.emit('player_joined', players[socket.id]);
  
  // Cuando el jugador se mueve o acelera, recibimos la actualización
  socket.on('player_moved', (data) => {
    if (players[socket.id]) {
      players[socket.id].position = data.position;
      players[socket.id].rotation = data.rotation;
      players[socket.id].flameScale = data.flameScale;
      // Reenviamos la información a TODOS LOS DEMÁS jugadores
      socket.broadcast.emit('player_moved', players[socket.id]);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Un jugador se ha desconectado:', socket.id);
    delete players[socket.id];
    // Avisamos a los demás para que borren su nave de la pantalla
    io.emit('player_left', socket.id);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor de Sincronización Galáctica corriendo en el puerto ${PORT}`);
});
