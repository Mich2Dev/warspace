import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { database } from './database.js';

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
  console.log('Un cliente se ha conectado, esperando login:', socket.id);
  
  // Login Event
  socket.on('login', (data) => {
    let user = database.login(data.username, data.password);
    
    // Si no logueó, veamos por qué
    if (!user) {
      if (database.userExists(data.username)) {
        // Existe pero puso mala contraseña
        socket.emit('login_failed', { message: "Contraseña incorrecta para el piloto existente." });
        return;
      } else {
        // No existe, lo registramos
        user = database.register(data.username, data.password);
        console.log(`Nuevo piloto registrado: ${data.username}`);
      }
    }
    
    if (user) {
      console.log(`Jugador logueado: ${user.username}`);
      
      // Enviar jugadores actuales al que acaba de entrar
      socket.emit('current_players', players);
      
      // Guardar estado inicial en memoria basado en la DB
      players[socket.id] = {
        id: socket.id,
        dbId: user.id,
        username: user.username,
        position: { x: user.pos_x, y: user.pos_y, z: user.pos_z },
        rotation: { x: user.rot_x, y: user.rot_y, z: user.rot_z, w: user.rot_w },
        flameScale: 0,
        hp: user.hp,
        clanId: user.clan_id,
        credits: user.credits,
        xp: user.xp,
        isDead: user.hp <= 0
      };
      
      // Confirmar login al cliente enviando su estado cargado
      socket.emit('login_success', players[socket.id]);
      
      // Avisar a los demás
      socket.broadcast.emit('player_joined', players[socket.id]);
    } else {
      socket.emit('login_failed', { message: "Credenciales incorrectas" });
    }
  });
  
  // Cuando el jugador se mueve o acelera, recibimos la actualización
  socket.on('player_moved', (data) => {
    if (players[socket.id] && !players[socket.id].isDead) {
      players[socket.id].position = data.position;
      players[socket.id].rotation = data.rotation;
      players[socket.id].flameScale = data.flameScale;
      // Reenviamos la información a TODOS LOS DEMÁS jugadores
      socket.broadcast.emit('player_moved', players[socket.id]);
    }
  });

  // =========================================
  // SOCIAL / CLANS LOGIC
  // =========================================
  socket.on('create_clan', (clanName) => {
    if (players[socket.id]) {
      players[socket.id].clanId = clanName;
      io.emit('player_clan_updated', { id: socket.id, clanId: clanName });
    }
  });

  socket.on('leave_clan', () => {
    if (players[socket.id]) {
      players[socket.id].clanId = null;
      io.emit('player_clan_updated', { id: socket.id, clanId: null });
    }
  });

  // To request joining another player's clan
  socket.on('join_clan', (clanName) => {
    if (players[socket.id]) {
      players[socket.id].clanId = clanName;
      io.emit('player_clan_updated', { id: socket.id, clanId: clanName });
    }
  });

  // Chat: Player sends a message
  socket.on('chat_message', (msg) => {
    if (players[socket.id]) {
      // Broadcast to everyone including the sender
      io.emit('chat_message', {
        username: players[socket.id].username,
        clanId: players[socket.id].clanId,
        message: msg
      });
    }
  });

  // Combat: Player Shoots
  socket.on('player_shoot', (data) => {
    if (players[socket.id] && !players[socket.id].isDead) {
      // Reenviar el disparo a todos para que rendericen el láser
      socket.broadcast.emit('player_shoot', {
        id: socket.id,
        position: data.position,
        velocity: data.velocity
      });
    }
  });

  // Combat: Player Hits another
  socket.on('player_hit', (targetId) => {
    const target = players[targetId];
    if (target && !target.isDead) {
      target.hp -= 20; // 20 damage per laser hit
      io.emit('player_health_changed', { id: targetId, hp: target.hp });

      if (target.hp <= 0) {
        target.isDead = true;
        io.emit('player_died', targetId);

        // Respawn timer (3 seconds)
        setTimeout(() => {
          if (players[targetId]) {
            players[targetId].hp = 100;
            players[targetId].isDead = false;
            // Ponerlo en el centro
            players[targetId].position = { x: 0, y: 0, z: 0 };
            io.emit('player_respawned', players[targetId]);
          }
        }, 3000);
      }
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Un jugador se ha desconectado:', socket.id);
    if (players[socket.id]) {
      // Guardar en DB antes de borrar de memoria
      database.savePlayerState(players[socket.id]);
      delete players[socket.id];
      // Avisamos a los demás para que borren su nave de la pantalla
      io.emit('player_left', socket.id);
    }
  });
});

// Auto-guardado global de progreso cada 10 segundos
setInterval(() => {
  for (const id in players) {
    if (players[id]) {
      database.savePlayerState(players[id]);
    }
  }
  console.log("Auto-guardado de Base de Datos completado.");
}, 10000);

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor con SQLite corriendo en el puerto ${PORT}`);
});
