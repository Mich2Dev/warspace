/**
 * Capa L2 — Navegación (gameplay estable).
 * @see docs/LAYERS.md @see docs/WORLD_ACCESSIBILITY.md
 *
 * Red de navegación del planeta — FUENTE DE VERDAD para límites, corredores y spawns.
 * Minimapa cuadrado ±MAP_HALF; jugabilidad = disco PLAYABLE_RADIUS + corredores + cuencas.
 *
 * Reglas:
 * - Jugador y bots NUNCA fuera del disco jugable.
 * - Spawns/patrullas solo en isPlayerReachablePoint.
 * - Corredores verdes = rutas seguras; anillos marrones = muros divisorios.
 */
import { CONFIG } from '../config.js';
import { getHub } from './hubSafe.js';

export const WORLD_MAP = {
    half: 12000,
    size: 24000,
    /** Radio exterior transitable — coincide con anillo cyan del minimapa. */
    playableRadius: 11500,
    /** Margen interior donde el jugador deja de avanzar (antes del borde visual). */
    playerClampScale: 0.975,
    /** Margen para spawns/bots — un poco más adentro que el borde. */
    spawnClampScale: 0.94,
};

export const STRUCTURE_COLLIDERS = [
    { id: 'zona1_base', x: -4200, z: 9600, radiusSq: 350 * 350 },
    { id: 'zona3_base', x: -9800, z: -600, radiusSq: 450 * 450 }
];

export function isStructureBlocking(x, z) {
    for (const collider of STRUCTURE_COLLIDERS) {
        const dx = x - collider.x;
        const dz = z - collider.z;
        if ((dx * dx + dz * dz) < collider.radiusSq) return true;
    }
    return false;
}

export const NAV_CORRIDOR_WIDTH = 1150;

const _clipPt = { x: 0, z: 0 };

/** Recorta un punto al disco (scale 1 = borde exacto). */
export function clampPointToDisc(x, z, scale = 1) {
    const maxR = WORLD_MAP.playableRadius * scale;
    const dSq = x * x + z * z;
    if (dSq <= maxR * maxR) {
        return { x, z, clamped: false, atEdge: dSq >= (maxR * 0.92) ** 2 };
    }
    const d = Math.sqrt(dSq) || 1;
    return {
        x: (x / d) * maxR,
        z: (z / d) * maxR,
        clamped: true,
        atEdge: true,
    };
}

export function distToSegmentSq(px, pz, ax, az, bx, bz) {
    const abx = bx - ax;
    const abz = bz - az;
    const lenSq = abx * abx + abz * abz;
    if (lenSq < 0.01) {
        const dx = px - ax;
        const dz = pz - az;
        return dx * dx + dz * dz;
    }
    let t = ((px - ax) * abx + (pz - az) * abz) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * abx;
    const cz = az + t * abz;
    const dx = px - cx;
    const dz = pz - cz;
    return dx * dx + dz * dz;
}

function _clipSegmentToDisc(ax, az, bx, bz, scale = WORLD_MAP.spawnClampScale) {
    const a = clampPointToDisc(ax, az, scale);
    const b = clampPointToDisc(bx, bz, scale);
    return { ax: a.x, az: a.z, bx: b.x, bz: b.z };
}

/** Segmentos de corredor verde — rutas transitables (endpoints recortados al disco). */
export function getNavCorridorSegments() {
    const hub = getHub();
    const Z1 = CONFIG.ZONES.ZONA1;
    const Z2 = CONFIG.ZONES.ZONA2;
    const Z3 = CONFIG.ZONES.ZONA3;
    const hx = hub.x ?? 0;
    const hz = hub.z ?? 4000;

    const raw = [
        { ax: 0, az: 0, bx: Z1.x, bz: Z1.z },
        { ax: Z1.x, az: Z1.z, bx: Z2.x, bz: Z2.z },
        { ax: Z2.x, az: Z2.z, bx: Z3.x, bz: Z3.z },
        { ax: 0, az: 0, bx: Z3.x, bz: Z3.z },
        { ax: hx, az: hz, bx: 0, bz: 0 },
        { ax: hx, az: hz, bx: Z1.x, bz: Z1.z },
        { ax: hx, az: hz, bx: Z2.x, bz: Z2.z },
        { ax: hx, az: hz, bx: Z3.x, bz: Z3.z },
        { ax: Z1.x, az: Z1.z, bx: -7200, bz: 8800 },
        { ax: Z1.x, az: Z1.z, bx: -8800, bz: 7200 },
        { ax: Z1.x, az: Z1.z, bx: 800, bz: 9000 },
        { ax: Z2.x, az: Z2.z, bx: 8800, bz: -6800 },
        { ax: Z2.x, az: Z2.z, bx: 7200, bz: -8800 },
        { ax: Z2.x, az: Z2.z, bx: 9800, bz: -1200 },
        { ax: Z3.x, az: Z3.z, bx: -9800, bz: -5200 },
        { ax: Z3.x, az: Z3.z, bx: -9600, bz: -6800 },
        { ax: Z3.x, az: Z3.z, bx: -1200, bz: -7800 },
        { ax: -7200, az: 8800, bx: 800, bz: 9000 },
        { ax: 8800, az: -6800, bx: 7200, bz: -8800 },
        { ax: -9600, az: -6800, bx: -1200, bz: -7800 },
    ];

    return raw.map((s) => _clipSegmentToDisc(s.ax, s.az, s.bx, s.bz));
}

export function isNavCorridorAt(x, z, width = NAV_CORRIDOR_WIDTH) {
    if (!isInsidePlayableDisc(x, z, WORLD_MAP.spawnClampScale)) return false;
    const corridorSq = width * width;
    for (const seg of getNavCorridorSegments()) {
        if (distToSegmentSq(x, z, seg.ax, seg.az, seg.bx, seg.bz) < corridorSq) return true;
    }
    return false;
}

export function isInsideZoneBowl(x, z, margin = 0.92) {
    for (const zone of Object.values(CONFIG.ZONES)) {
        const dx = x - zone.x;
        const dz = z - zone.z;
        const r = (zone.radius ?? 3200) * margin;
        if (dx * dx + dz * dz <= r * r) return true;
    }
    return false;
}

export function isInsidePlayableDisc(x, z, scale = 1) {
    const maxR = WORLD_MAP.playableRadius * scale;
    return x * x + z * z <= maxR * maxR;
}

/** Punto apto para spawn — dentro del sector y terreno razonable. */
export function isPlayerReachablePoint(env, x, z) {
    if (!isInsidePlayableDisc(x, z, WORLD_MAP.spawnClampScale)) return false;
    if (!env) return true;
    return env.getHeightAt(x, z) < 340;
}

/** Valida y proyecta destino de nave (minimapa, misiones, clic mundo). */
export function resolveNavDestination(env, x, z) {
    const snapped = snapToNavPoint(env, x, z);
    const h = env?.getHeightAt(snapped.x, snapped.z) ?? 0;
    return {
        x: snapped.x,
        y: h + 1.5,
        z: snapped.z,
        reachable: isPlayerReachablePoint(env, snapped.x, snapped.z),
        wasSnapped: Math.hypot(snapped.x - x, snapped.z - z) > 120,
    };
}

/** Proyecta un waypoint al punto transitable más cercano (sin forzar corredores). */
export function snapToNavPoint(env, x, z, attempts = 24) {
    const clamped = clampPointToDisc(x, z, WORLD_MAP.spawnClampScale);
    x = clamped.x;
    z = clamped.z;

    if (isPlayerReachablePoint(env, x, z)) return { x, z };

    let best = null;
    let bestD = Infinity;

    for (const zone of Object.values(CONFIG.ZONES)) {
        const dx = zone.x - x;
        const dz = zone.z - z;
        const d = dx * dx + dz * dz;
        if (d < bestD && isPlayerReachablePoint(env, zone.x, zone.z)) {
            bestD = d;
            best = { x: zone.x, z: zone.z };
        }
    }
    if (best) return best;

    for (let i = 0; i < attempts; i++) {
        const ang = (i / attempts) * Math.PI * 2;
        const r = 300 + (i % 10) * 280;
        const px = x + Math.cos(ang) * r;
        const pz = z + Math.sin(ang) * r;
        if (isPlayerReachablePoint(env, px, pz)) return { x: px, z: pz };
    }

    const hub = getHub();
    return { x: hub.x, z: (hub.z ?? 4000) + 900 };
}

/** ¿El centro de un chunk debe generarse? Evita mundo infinito fuera del disco. */
export function isChunkInsideWorld(cx, cz, chunkSize) {
    const centerX = (cx + 0.5) * chunkSize;
    const centerZ = (cz + 0.5) * chunkSize;
    return isInsidePlayableDisc(centerX, centerZ, 1.08);
}

/** Coordenadas minimapa (px) desde mundo. */
export function worldToMinimapPx(x, z, mapW, mapH) {
    const half = WORLD_MAP.half;
    return {
        x: ((x + half) / WORLD_MAP.size) * mapW,
        y: ((z + half) / WORLD_MAP.size) * mapH,
    };
}
