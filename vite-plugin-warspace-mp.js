import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createRoom } = require('./scripts/mp-server-core.js');

/** Multijugador en ws://MISMA-URL/mp — funciona con túnel cloudflared/localtunnel. */
export function warspaceMultiplayerPlugin() {
    let bound = false;

    const bind = (httpServer) => {
        if (!httpServer || bound) return;
        bound = true;
        createRoom().attachToHttpServer(httpServer);
    };

    return {
        name: 'warspace-multiplayer',
        configureServer(server) {
            bind(server.httpServer);
        },
        configurePreviewServer(server) {
            bind(server.httpServer);
        },
    };
}
