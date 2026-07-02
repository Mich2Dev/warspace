/** Servidor standalone (opcional) — en dev usa Vite /mp en el mismo puerto. */
const { createRoom } = require('./mp-server-core.js');

const PORT = Number(process.env.WARSPACE_MP_PORT || 8765);
const room = createRoom();
const wss = room.listenStandalone(PORT);

process.on('SIGINT', () => {
    wss.close();
    process.exit(0);
});
