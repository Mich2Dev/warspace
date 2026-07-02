/**
 * Capa L2 — Colisión de terreno (gameplay estable, independiente del visual).
 * @see docs/LAYERS.md @see docs/WORLD_ACCESSIBILITY.md
 *
 * Reglas de colisión del terreno — ESTABLES.
 * Cambia el relieve visual en Environment.js (L1) libremente; ajusta aquí solo si cambia gameplay.
 */
import {
    clampPointToDisc,
    isInsidePlayableDisc,
    isPlayerReachablePoint,
    WORLD_MAP,
    isStructureBlocking,
} from './worldNav.js';

export const TERRAIN_COLLISION = {
    /** Altura Y absoluta con vuelo muy alto para ignorar relieve */
    turboClearY: 320,
    /** Hover de la nave sobre getHeightAt (≈ Player.js targetHover) */
    hoverClearance: 35,
    /** Subida máxima transitable en un paso (m) — solo picos muy empinados */
    maxStepRise: 52,
    /** Altura del suelo que bloquea (montaña natural visible, no muros artificiales) */
    naturalPeakMin: 260,
    /** Muestreos a lo largo del movimiento (anti-colado) */
    moveSamples: 5,
};

/**
 * Bloqueo = lo que ves. Solo picos naturales muy altos o subidas bruscas.
 * Sin muros invisibles ni corredores obligatorios.
 * @param {import('./Environment.js').Environment} env
 */
export function isTerrainBlocking(env, fromX, fromZ, toX, toZ, flightY) {
    if (isStructureBlocking(toX, toZ)) return true;

    const { turboClearY, hoverClearance, maxStepRise, naturalPeakMin } = TERRAIN_COLLISION;
    if (flightY > turboClearY) return false;

    const hFrom = env.getHeightAt(fromX, fromZ);
    const hTo = env.getHeightAt(toX, toZ);
    const neededY = hTo + hoverClearance;
    const rise = hTo - hFrom;

    if (hTo >= naturalPeakMin && flightY < neededY - 8) return true;
    if (flightY < neededY - 8 && rise > maxStepRise) return true;

    return false;
}

/** Punto apto para spawn — mismo criterio que puede alcanzar el jugador. */
export function isAccessibleSpawnPoint(env, x, z) {
    if (!env) return false;
    return isPlayerReachablePoint(env, x, z);
}

/** Bloqueo duro en el borde del disco jugable. */
export function isWorldBoundaryBlocking(fromX, fromZ, toX, toZ) {
    const maxR = WORLD_MAP.playableRadius * WORLD_MAP.playerClampScale;
    const toInside = isInsidePlayableDisc(toX, toZ, WORLD_MAP.playerClampScale);
    const fromInside = isInsidePlayableDisc(fromX, fromZ, WORLD_MAP.playerClampScale);
    if (toInside) return false;
    if (!fromInside) return true;
    return true;
}

/** Muestrea el movimiento enemigo con las mismas reglas que el jugador. */
export function resolveEnemyMove(env, fromX, fromZ, toX, toZ, flightY) {
    return resolveTerrainMove(env, fromX, fromZ, toX, toZ, flightY);
}

/** Movimiento completo: terreno + borde del mundo. */
export function resolveFullMove(env, fromX, fromZ, toX, toZ, flightY) {
    const terrain = resolveTerrainMove(env, fromX, fromZ, toX, toZ, flightY);
    let { x, z, blocked } = terrain;

    if (isWorldBoundaryBlocking(fromX, fromZ, x, z)) {
        const clamped = clampPointToDisc(x, z, WORLD_MAP.playerClampScale);
        x = clamped.x;
        z = clamped.z;
        blocked = true;
        return { x, z, blocked, boundary: true };
    }

    const clamped = clampPointToDisc(x, z, WORLD_MAP.playerClampScale);
    if (clamped.clamped) {
        return { x: clamped.x, z: clamped.z, blocked: true, boundary: true };
    }

    return { ...terrain, x, z, boundary: false };
}

/** Muestrea el movimiento para evitar atravesar muros en diagonal o a alta velocidad. */
export function resolveTerrainMove(env, fromX, fromZ, toX, toZ, flightY) {
    const samples = TERRAIN_COLLISION.moveSamples;
    for (let i = 1; i <= samples; i++) {
        const t = i / samples;
        const sx = fromX + (toX - fromX) * t;
        const sz = fromZ + (toZ - fromZ) * t;
        if (isTerrainBlocking(env, fromX, fromZ, sx, sz, flightY)) {
            const blockX = isTerrainBlocking(env, fromX, fromZ, toX, fromZ, flightY);
            const blockZ = isTerrainBlocking(env, fromX, fromZ, fromX, toZ, flightY);
            let outX = blockX ? fromX : toX;
            let outZ = blockZ ? fromZ : toZ;
            if (isTerrainBlocking(env, fromX, fromZ, outX, outZ, flightY)) {
                outX = fromX;
                outZ = fromZ;
            }
            return { x: outX, z: outZ, blocked: true };
        }
    }
    return { x: toX, z: toZ, blocked: false };
}
