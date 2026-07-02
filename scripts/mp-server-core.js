/**
 * Servidor multijugador — posiciones, host de mundo y relay de combate.
 */
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const TICK_MS = 80;
const STALE_MS = 12000;
const PVP_RANGE = 2500;
const PVP_COOLDOWN_MS = 120;
const PVP_MAX_HIT = 120;
const PVP_AOE_MAX_RADIUS = 400;
const PVP_AOE_RANGE = 6500;
const PVP_AOE_FACTOR = 0.65;
const PVP_AOE_COOLDOWN_MS = 600;
const PVE_DAMAGE_CD_MS = 250;
const PVE_MAX_HIT = 80;
const HUB = { x: 0, z: 4000 };
const SPAWN_RING = 180;
const MP_PATH = '/mp';
const ROOM_ID = 'pvp';
const ROOM_NAME = 'Sala';

function sanitizeNick(raw) {
    const s = String(raw || 'Piloto').trim().slice(0, 18);
    return s.replace(/[<>"'&]/g, '') || 'Piloto';
}

function spawnForIndex(index) {
    const angle = (index * 2.399963) % (Math.PI * 2);
    return {
        x: HUB.x + Math.cos(angle) * SPAWN_RING,
        y: 50,
        z: HUB.z + Math.sin(angle) * SPAWN_RING,
        ry: angle + Math.PI,
        vx: 0,
        vz: 0,
    };
}

function createRoom() {
    const players = new Map();
    let hostId = null;
    let wss = null;
    let tickTimer = null;

    function ensureHost() {
        if (hostId && players.has(hostId)) return hostId;
        hostId = players.size ? players.keys().next().value : null;
        return hostId;
    }

    function snapshot(excludeId = null) {
        const list = [];
        for (const p of players.values()) {
            if (excludeId && p.id === excludeId) continue;
            list.push({
                id: p.id,
                nick: p.nick,
                x: p.x,
                y: p.y,
                z: p.z,
                ry: p.ry,
                qx: p.qx,
                qy: p.qy,
                qz: p.qz,
                qw: p.qw,
                roll: p.roll,
                pitch: p.pitch,
                vx: p.vx,
                vz: p.vz,
                hp: p.hp,
                maxHp: p.maxHp,
                shieldActive: p.shieldActive,
                shieldHp: p.shieldHp,
                shieldMax: p.shieldMax,
                nitro: !!p.nitro,
            });
        }
        return list;
    }

    function broadcast(msg, exceptWs = null) {
        if (!wss) return;
        const data = JSON.stringify(msg);
        for (const client of wss.clients) {
            if (client.readyState === 1 && client !== exceptWs) {
                client.send(data);
            }
        }
    }

    function relayEvent(fromId, kind, payload) {
        broadcast({ type: 'event', from: fromId, kind, payload });
    }

    function applyPvpHit(attackerId, payload) {
        const targetId = payload?.targetId != null ? String(payload.targetId) : null;
        const target = findPlayer(targetId);
        const attacker = findPlayer(attackerId);
        if (!target || !attacker || String(attackerId) === targetId) return;
        if ((target.hp ?? 200) <= 0) return;

        let inRange = false;
        if (targetId && typeof payload.ax === 'number' && typeof payload.tx === 'number') {
            const cdx = payload.tx - payload.ax;
            const cdy = (payload.ty ?? 50) - (payload.ay ?? 50);
            const cdz = payload.tz - payload.az;
            inRange = Math.sqrt(cdx * cdx + cdy * cdy + cdz * cdz) <= PVP_RANGE * 1.35;
        }
        if (!inRange) inRange = dist3(attacker, target) <= PVP_RANGE;
        if (!inRange) return;

        const now = Date.now();
        const cdKey = `${attackerId}:${targetId}`;
        if (now - (lastPvpAt.get(cdKey) || 0) < PVP_COOLDOWN_MS) return;
        lastPvpAt.set(cdKey, now);

        const amount = Math.max(1, Math.min(PVP_MAX_HIT, Math.round(payload?.amount ?? 12)));
        const { shieldHit } = applyDamageToPlayer(target, amount);
        emitPvpHitResult(attackerId, target, amount, { shieldHit });
    }

    function applyDamageToPlayer(target, amount) {
        let remaining = Math.max(0, amount);
        let shieldHit = false;
        if (target.shieldActive && (target.shieldHp ?? 0) > 0) {
            const absorbed = Math.min(target.shieldHp, remaining);
            target.shieldHp = Math.max(0, target.shieldHp - absorbed);
            remaining -= absorbed;
            shieldHit = absorbed > 0;
            if (target.shieldHp <= 0) {
                target.shieldActive = false;
                target.shieldHp = 0;
            }
        }
        target.hp = Math.max(0, (target.hp ?? 200) - remaining);
        return { shieldHit, overflow: remaining };
    }

    function emitPvpHitResult(attackerId, target, amount, extra = {}) {
        const out = {
            targetId: target.id,
            attackerId,
            amount,
            hp: target.hp,
            maxHp: target.maxHp ?? 200,
            shieldHp: target.shieldHp ?? 0,
            shieldMax: target.shieldMax ?? 0,
            shieldActive: !!target.shieldActive,
            shieldHit: extra.shieldHit === true,
        };
        broadcast({ type: 'event', from: attackerId, kind: 'pvp_hit', payload: out });

        if (target.hp <= 0) {
            broadcast({
                type: 'event',
                from: target.id,
                kind: 'player_died',
                payload: { playerId: target.id, x: target.x, y: target.y, z: target.z },
            });
        }
    }

    function applyPvpAoe(attackerId, payload) {
        const attacker = findPlayer(attackerId);
        if (!attacker) return;

        const now = Date.now();
        if (now - (lastPvpAoeAt.get(attackerId) || 0) < PVP_AOE_COOLDOWN_MS) return;
        lastPvpAoeAt.set(attackerId, now);

        const cx = payload?.cx ?? 0;
        const cy = payload?.cy ?? 0;
        const cz = payload?.cz ?? 0;
        const radius = Math.min(PVP_AOE_MAX_RADIUS, Math.max(20, Number(payload?.radius) || 120));
        const baseAmount = Math.max(1, Math.min(PVP_MAX_HIT, Math.round(payload?.amount ?? 12)));
        const perHit = Math.max(1, Math.min(PVP_MAX_HIT, Math.round(baseAmount * PVP_AOE_FACTOR)));

        const ax = payload?.ax ?? attacker.x ?? 0;
        const ay = payload?.ay ?? attacker.y ?? 50;
        const az = payload?.az ?? attacker.z ?? 0;
        const adx = cx - ax;
        const ady = cy - ay;
        const adz = cz - az;
        if (Math.sqrt(adx * adx + ady * ady + adz * adz) > PVP_AOE_RANGE) return;

        for (const target of players.values()) {
            if (String(target.id) === String(attackerId)) continue;
            if ((target.hp ?? 200) <= 0) continue;

            const dx = (target.x ?? 0) - cx;
            const dy = (target.y ?? 50) - cy;
            const dz = (target.z ?? 0) - cz;
            if (Math.sqrt(dx * dx + dy * dy + dz * dz) > radius) continue;

            const cdKey = `${attackerId}:${target.id}`;
            if (now - (lastPvpAt.get(cdKey) || 0) < PVP_COOLDOWN_MS) continue;
            lastPvpAt.set(cdKey, now);

            const { shieldHit } = applyDamageToPlayer(target, perHit);
            emitPvpHitResult(attackerId, target, perHit, { shieldHit });
        }
    }

    function applyPlayerHit(playerId, payload) {
        // MP: HP lo controla pvp_hit / player_damage — ignorar HP de clientes
        return;
    }

    function applyPlayerDamage(senderId, payload) {
        if (senderId !== hostId) return;
        const targetId = payload?.playerId != null ? String(payload.playerId) : null;
        const target = findPlayer(targetId);
        if (!target || (target.hp ?? 200) <= 0) return;

        const amount = Math.max(1, Math.min(PVE_MAX_HIT, Math.round(payload?.amount ?? 10)));
        const now = Date.now();
        const cdKey = `pve:${targetId}`;
        if (now - (lastPveDamage.get(cdKey) || 0) < PVE_DAMAGE_CD_MS) return;
        lastPveDamage.set(cdKey, now);

        const { shieldHit } = applyDamageToPlayer(target, amount);

        const out = {
            playerId: target.id,
            amount,
            hp: target.hp,
            maxHp: target.maxHp ?? 200,
            shieldHp: target.shieldHp ?? 0,
            shieldMax: target.shieldMax ?? 0,
            shieldActive: !!target.shieldActive,
            shieldHit,
            hitFrom: payload?.hitFrom,
            attackKind: payload?.attackKind,
            attackerName: payload?.attackerName,
        };
        broadcast({ type: 'event', from: senderId, kind: 'player_damage', payload: out });

        if (target.hp <= 0) {
            broadcast({
                type: 'event',
                from: target.id,
                kind: 'player_died',
                payload: { playerId: target.id, x: target.x, y: target.y, z: target.z },
            });
        }
    }

    function applyPlayerRespawn(playerId, payload) {
        const p = players.get(playerId);
        if (!p) return;
        const spawn = p.spawn || spawnForIndex(0);
        p.hp = payload?.maxHp ?? payload?.hp ?? p.maxHp ?? 200;
        p.maxHp = p.maxHp ?? 200;
        p.x = spawn.x;
        p.y = spawn.y;
        p.z = spawn.z;
        broadcast({
            type: 'event',
            from: playerId,
            kind: 'player_respawn',
            payload: {
                playerId,
                hp: p.hp,
                maxHp: p.maxHp,
                x: p.x,
                y: p.y,
                z: p.z,
            },
        });
    }

    let lastWorldSync = [];
    const lastPvpAt = new Map();
    const lastPvpAoeAt = new Map();
    const lastPveDamage = new Map();

    function findPlayer(id) {
        if (id == null) return null;
        const key = String(id);
        if (players.has(key)) return players.get(key);
        for (const p of players.values()) {
            if (String(p.id) === key) return p;
        }
        return null;
    }

    function dist3(a, b) {
        const dx = (a.x ?? 0) - (b.x ?? 0);
        const dy = (a.y ?? 0) - (b.y ?? 0);
        const dz = (a.z ?? 0) - (b.z ?? 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    function sendWorldSyncTo(ws, enemies) {
        if (!ws || ws.readyState !== 1 || !Array.isArray(enemies)) return;
        ws.send(JSON.stringify({ type: 'world_sync', enemies }));
    }

    function dropPlayer(id, reason = 'left') {
        const p = players.get(id);
        if (!p) return;
        players.delete(id);
        if (hostId === id) {
            hostId = null;
            lastWorldSync = [];
            ensureHost();
            if (hostId) broadcast({ type: 'host_changed', hostId });
        }
        broadcast({ type: 'player_left', id, nick: p.nick || null });
        console.log(`[MP] - ${p.nick} (${reason}) — ${players.size}`);
    }

    function evictStalePlayers() {
        const now = Date.now();
        for (const [id, p] of players) {
            if (now - (p.lastSeen || 0) > STALE_MS) dropPlayer(id, 'timeout');
        }
    }

    function touchPlayer(id) {
        const p = players.get(id);
        if (p) p.lastSeen = Date.now();
    }

    function onConnection(ws) {
        let playerId = null;

        ws.on('message', (raw) => {
            let msg;
            try {
                msg = JSON.parse(String(raw));
            } catch {
                return;
            }

            if (msg.type === 'join' && !playerId) {
                playerId = crypto.randomUUID();
                const spawn = spawnForIndex(players.size);
                const player = {
                    id: playerId,
                    nick: sanitizeNick(msg.nick),
                    hp: 200,
                    maxHp: 200,
                    shieldActive: false,
                    shieldHp: 0,
                    shieldMax: 0,
                    lastSeen: Date.now(),
                    spawn,
                    ...spawn,
                };
                players.set(playerId, player);
                ws.playerId = playerId;
                ensureHost();

                ws.send(JSON.stringify({
                    type: 'welcome',
                    id: playerId,
                    hostId,
                    isHost: playerId === hostId,
                    roomId: ROOM_ID,
                    roomName: ROOM_NAME,
                    playerCount: players.size,
                    spawn,
                    players: snapshot(),
                }));

                if (lastWorldSync.length) {
                    sendWorldSyncTo(ws, lastWorldSync);
                }

                broadcast({
                    type: 'player_joined',
                    player: {
                        id: player.id,
                        nick: player.nick,
                        hp: player.hp,
                        maxHp: player.maxHp,
                        ...spawn,
                    },
                }, ws);

                console.log(`[MP] + ${player.nick} (${playerId.slice(0, 8)}) host=${hostId?.slice(0, 8)} — ${players.size}`);
                return;
            }

            if (!playerId || !players.has(playerId)) return;
            touchPlayer(playerId);

            if (msg.type === 'state') {
                const p = players.get(playerId);
                // Posición/orientación — sí. HP lo controla el servidor (pvp_hit, respawn…)
                if (typeof msg.x === 'number') p.x = msg.x;
                if (typeof msg.y === 'number') p.y = msg.y;
                if (typeof msg.z === 'number') p.z = msg.z;
                if (typeof msg.ry === 'number') p.ry = msg.ry;
                if (typeof msg.qx === 'number') p.qx = msg.qx;
                if (typeof msg.qy === 'number') p.qy = msg.qy;
                if (typeof msg.qz === 'number') p.qz = msg.qz;
                if (typeof msg.qw === 'number') p.qw = msg.qw;
                if (typeof msg.roll === 'number') p.roll = msg.roll;
                if (typeof msg.pitch === 'number') p.pitch = msg.pitch;
                if (typeof msg.vx === 'number') p.vx = msg.vx;
                if (typeof msg.vz === 'number') p.vz = msg.vz;
                if (typeof msg.shieldActive === 'boolean') p.shieldActive = msg.shieldActive;
                if (typeof msg.shieldHp === 'number') p.shieldHp = msg.shieldHp;
                if (typeof msg.shieldMax === 'number') p.shieldMax = msg.shieldMax;
                if (typeof msg.nitro === 'boolean') p.nitro = msg.nitro;
                return;
            }

            if (msg.type === 'event' && msg.kind) {
                const hostOnlyKinds = ['enemy_laser', 'enemy_missile', 'enemy_dead', 'explosion'];
                if (hostOnlyKinds.includes(msg.kind) && playerId !== hostId) return;
            }

            if (msg.type === 'event' && msg.kind === 'pvp_hit') {
                return;
            }

            if (msg.type === 'event' && msg.kind === 'player_pvp_aoe') {
                applyPvpAoe(playerId, msg.payload || {});
                return;
            }

            if (msg.type === 'event' && msg.kind === 'player_shoot') {
                const payload = msg.payload || {};
                relayEvent(playerId, msg.kind, payload);
                if (payload.targetId) {
                    applyPvpHit(playerId, {
                        targetId: payload.targetId,
                        amount: payload.amount,
                        ax: payload.ax,
                        ay: payload.ay,
                        az: payload.az,
                        tx: payload.tx,
                        ty: payload.ty,
                        tz: payload.tz,
                    });
                }
                return;
            }

            if (msg.type === 'event' && msg.kind === 'player_hit') {
                return;
            }

            if (msg.type === 'event' && msg.kind === 'player_damage') {
                applyPlayerDamage(playerId, msg.payload || {});
                return;
            }

            if (msg.type === 'event' && msg.kind === 'player_died') {
                return;
            }

            if (msg.type === 'event' && msg.kind === 'player_respawn') {
                applyPlayerRespawn(playerId, msg.payload || {});
                return;
            }

            if (msg.type === 'event' && (msg.kind === 'room_mission' || msg.kind === 'room_event')) {
                if (playerId !== hostId) return;
                relayEvent(playerId, msg.kind, msg.payload || {});
                return;
            }

            if (msg.type === 'event' && msg.kind) {
                relayEvent(playerId, msg.kind, msg.payload || {});
                return;
            }

            if (msg.type === 'world_sync' && playerId === hostId && Array.isArray(msg.enemies)) {
                lastWorldSync = msg.enemies;
                broadcast({ type: 'world_sync', enemies: msg.enemies, from: hostId }, ws);
                return;
            }
        });

        ws.on('close', () => {
            if (!playerId) return;
            dropPlayer(playerId, 'disconnect');
            broadcast({ type: 'snapshot', players: snapshot(), hostId: ensureHost() });
        });
    }

    function startTick() {
        if (tickTimer) return;
        tickTimer = setInterval(() => {
            evictStalePlayers();
            if (players.size === 0) return;
            broadcast({
                type: 'snapshot',
                players: snapshot(),
                hostId: ensureHost(),
                roomId: ROOM_ID,
                playerCount: players.size,
            });
        }, TICK_MS);
    }

    function attachToHttpServer(httpServer, path = MP_PATH) {
        wss = new WebSocketServer({ noServer: true });

        httpServer.on('upgrade', (req, socket, head) => {
            const pathname = (req.url || '').split('?')[0];
            if (pathname !== path && !pathname.startsWith(`${path}/`)) return;
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req);
            });
        });

        wss.on('connection', onConnection);
        startTick();
        console.log(`[MP] WebSocket en la misma URL → ${path}`);
    }

    function listenStandalone(port, host = '0.0.0.0') {
        wss = new WebSocketServer({ host, port });
        wss.on('connection', onConnection);
        startTick();
        wss.on('listening', () => {
            console.log(`[MP] WarSpace multijugador en ws://${host}:${port}`);
        });
        return wss;
    }

    return { attachToHttpServer, listenStandalone, MP_PATH };
}

module.exports = { createRoom, MP_PATH };
