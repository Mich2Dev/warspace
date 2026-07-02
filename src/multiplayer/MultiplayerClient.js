/** Cliente WebSocket — envía estado local y recibe otros pilotos. */

const SEND_HZ = 12;
const RECONNECT_MS = 4000;

export class MultiplayerClient {
    constructor(handlers = {}) {
        this.onWelcome = handlers.onWelcome || (() => {});
        this.onSnapshot = handlers.onSnapshot || (() => {});
        this.onPlayerJoined = handlers.onPlayerJoined || (() => {});
        this.onPlayerLeft = handlers.onPlayerLeft || (() => {});
        this.onStatus = handlers.onStatus || (() => {});
        this.onEvent = handlers.onEvent || (() => {});
        this.onWorldSync = handlers.onWorldSync || (() => {});
        this.onHostChanged = handlers.onHostChanged || (() => {});

        this.hostId = null;
        this.roomId = 'pvp';
        this.roomName = 'Sala';
        this.playerCount = 0;

        this.ws = null;
        this.connected = false;
        this.playerId = null;
        this._url = '';
        this._nick = '';
        this._sendTimer = null;
        this._pendingState = null;
        this._reconnectTimer = null;
        this._manualDisconnect = false;
        this._welcomeIsHost = false;
    }

    get isOnline() {
        return this.connected && this.ws?.readyState === WebSocket.OPEN && !!this.playerId;
    }

    /** Host = quien controla bichos (comparar id con hostId del servidor). */
    get isHost() {
        if (!this.isOnline || !this.playerId) return false;
        if (this.hostId) return String(this.playerId) === String(this.hostId);
        return this._welcomeIsHost === true;
    }

    _syncHostFromServer(hostId) {
        if (hostId != null) this.hostId = String(hostId);
    }

    connect(url, nick) {
        this._manualDisconnect = false;
        this._url = url;
        this._nick = nick;
        this._openSocket();
    }

    disconnect() {
        this._manualDisconnect = true;
        this._clearTimers();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
        this.playerId = null;
        this.hostId = null;
        this.playerCount = 0;
        this.onStatus('offline', 'Desconectado');
    }

    pushState(state) {
        this._pendingState = state;
    }

    sendEvent(kind, payload) {
        if (!this.isOnline) return;
        this.ws.send(JSON.stringify({ type: 'event', kind, payload }));
    }

    sendWorldSync(enemies) {
        if (!this.isOnline) return;
        this.ws.send(JSON.stringify({ type: 'world_sync', enemies }));
    }

    _openSocket() {
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
        }

        this.onStatus('connecting', 'Conectando…');

        try {
            this.ws = new WebSocket(this._url);
        } catch (err) {
            this.onStatus('error', err.message || 'No se pudo conectar');
            this._scheduleReconnect();
            return;
        }

        this.ws.onopen = () => {
            this.connected = true;
            this.onStatus('online', 'Conectado');
            this.ws.send(JSON.stringify({ type: 'join', nick: this._nick }));
            this._startSendLoop();
        };

        this.ws.onmessage = (ev) => {
            let msg;
            try {
                msg = JSON.parse(ev.data);
            } catch {
                return;
            }
            this._handleMessage(msg);
        };

        this.ws.onclose = () => {
            this.connected = false;
            this.playerId = null;
            this.hostId = null;
            this.playerCount = 0;
            this._clearSendLoop();
            if (!this._manualDisconnect) {
                this.onStatus('reconnecting', 'Reconectando…');
                this._scheduleReconnect();
            } else {
                this.onStatus('offline', 'Desconectado');
            }
        };

        this.ws.onerror = () => {
            this.onStatus('error', 'Error de conexión');
        };
    }

    _handleMessage(msg) {
        switch (msg.type) {
            case 'welcome':
                this.playerId = String(msg.id);
                this._syncHostFromServer(msg.hostId);
                this._welcomeIsHost = msg.isHost === true;
                if (msg.roomId) this.roomId = msg.roomId;
                if (msg.roomName) this.roomName = msg.roomName;
                if (typeof msg.playerCount === 'number') this.playerCount = msg.playerCount;
                this.onWelcome(msg);
                if (msg.players?.length) {
                    this.onSnapshot(msg.players);
                }
                break;
            case 'snapshot':
                if (msg.hostId) this._syncHostFromServer(msg.hostId);
                if (typeof msg.playerCount === 'number') this.playerCount = msg.playerCount;
                if (msg.players) this.onSnapshot(msg.players);
                break;
            case 'player_joined':
                if (msg.player) this.onPlayerJoined(msg.player);
                break;
            case 'player_left':
                if (msg.id) this.onPlayerLeft(msg.id, msg.nick);
                break;
            case 'event':
                if (msg.kind) this.onEvent(msg.from, msg.kind, msg.payload);
                break;
            case 'world_sync':
                if (msg.enemies) this.onWorldSync(msg.enemies);
                break;
            case 'host_changed':
                this._syncHostFromServer(msg.hostId);
                this._welcomeIsHost = this.isHost;
                this.onHostChanged(this.isHost);
                break;
            default:
                break;
        }
    }

    _startSendLoop() {
        this._clearSendLoop();
        const interval = 1000 / SEND_HZ;
        this._sendTimer = setInterval(() => {
            if (!this.isOnline || !this._pendingState) return;
            const s = this._pendingState;
            this.ws.send(JSON.stringify({
                type: 'state',
                x: s.x,
                y: s.y,
                z: s.z,
                ry: s.ry,
                qx: s.qx,
                qy: s.qy,
                qz: s.qz,
                qw: s.qw,
                roll: s.roll,
                pitch: s.pitch,
                vx: s.vx,
                vz: s.vz,
                hp: s.hp,
                maxHp: s.maxHp,
                shieldActive: s.shieldActive,
                shieldHp: s.shieldHp,
                shieldMax: s.shieldMax,
                shieldTimer: s.shieldTimer,
                nitro: !!s.nitro,
            }));
        }, interval);
    }

    _clearSendLoop() {
        if (this._sendTimer) {
            clearInterval(this._sendTimer);
            this._sendTimer = null;
        }
    }

    _scheduleReconnect() {
        if (this._manualDisconnect || this._reconnectTimer) return;
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            if (!this._manualDisconnect && this._url) this._openSocket();
        }, RECONNECT_MS);
    }

    _clearTimers() {
        this._clearSendLoop();
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
    }
}

/** Misma URL que el juego — /mp va por el túnel o LAN sin config extra. */
export function defaultMultiplayerUrl() {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.host || '127.0.0.1:5174';
    return `${proto}://${host}/mp`;
}

export function loadSavedMultiplayerPrefs() {
    try {
        const raw = localStorage.getItem('warspace_mp_prefs_v1');
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export function saveMultiplayerPrefs(prefs) {
    try {
        const prev = loadSavedMultiplayerPrefs() || {};
        localStorage.setItem('warspace_mp_prefs_v1', JSON.stringify({ ...prev, ...prefs }));
    } catch { /* ignore */ }
}

export function loadCallsignFromProfile() {
    try {
        const raw = localStorage.getItem('warspace_pilot_profile_v1');
        if (!raw) return 'Piloto';
        const p = JSON.parse(raw);
        return (p.callsign || 'Piloto').trim().slice(0, 18) || 'Piloto';
    } catch {
        return 'Piloto';
    }
}
