/**
 * Streaming estratégico de terreno — NO cargar el mapa entero.
 *
 * Técnicas aplicadas (estándar en mundos abiertos):
 * 1. View-cone streaming — cono hacia cámara / velocidad (solo adelante).
 * 2. Anillo asimétrico — más radio al frente, mínimo atrás.
 * 3. Hysteresis unload — descargar un anillo más lejos que el de carga (evita ping-pong).
 * 4. LOD direccional — yerba/full solo en lo visible; atrás = terreno ligero o nada.
 * 5. Cola priorizada — adelante primero, atrás se purga de la cola.
 *
 * Lo lejano lo cubre horizonMesh (billboard barato), no chunks completos.
 */

/** @typedef {{ fx: number, fz: number, speed: number, source: string }} StreamForward */

/**
 * Eje “hacia adelante” para streaming: velocidad si te mueves, si no la cámara.
 * @param {{ x?: number, z?: number } | null} velocity
 * @param {{ x?: number, z?: number } | null} viewDir
 * @returns {StreamForward}
 */
export function resolveStreamForward(velocity, viewDir) {
    const vx = velocity?.x ?? 0;
    const vz = velocity?.z ?? 0;
    const speedSq = vx * vx + vz * vz;
    if (speedSq > 36) {
        const s = Math.sqrt(speedSq);
        return { fx: vx / s, fz: vz / s, speed: s, source: 'velocity' };
    }
    const vx2 = viewDir?.x ?? 0;
    const vz2 = viewDir?.z ?? 0;
    if (vx2 * vx2 + vz2 * vz2 > 0.01) {
        const len = Math.hypot(vx2, vz2);
        return { fx: vx2 / len, fz: vz2 / len, speed: 0, source: 'camera' };
    }
    return { fx: 0, fz: -1, speed: 0, source: 'default' };
}

/** Coseno direccional del chunk respecto al forward (−1 atrás, +1 adelante). */
export function chunkForwardDot(dx, dz, forward) {
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return 1;
    return (dx * forward.fx + dz * forward.fz) / len;
}

/**
 * Radio máximo (manhattan) para CARGAR un chunk en esa dirección.
 */
export function maxLoadManhattan(dx, dz, forward, fastTravel = false) {
    const manhattan = Math.abs(dx) + Math.abs(dz);
    if (manhattan <= 1) return 99;

    const dot = chunkForwardDot(dx, dz, forward);
    if (fastTravel) {
        if (dot > 0.2) return 4;
        if (dot > -0.35) return 2;
        return 1;
    }
    if (dot > 0.25) return 3;
    if (dot > -0.3) return 2;
    return 0;
}

/** ¿Debemos mantener / encolar este chunk? */
export function shouldStreamChunk(dx, dz, forward, fastTravel = false) {
    const manhattan = Math.abs(dx) + Math.abs(dz);
    if (manhattan <= 1) return true;
    const maxR = maxLoadManhattan(dx, dz, forward, fastTravel);
    return maxR > 0 && manhattan <= maxR;
}

/** Prioridad de cola (menor = antes). */
export function streamChunkPriority(dx, dz, forward, velocity) {
    const manhattan = Math.abs(dx) + Math.abs(dz);
    let score = manhattan;
    score -= chunkForwardDot(dx, dz, forward) * 2.8;
    if (velocity) {
        const speedSq = velocity.x * velocity.x + velocity.z * velocity.z;
        if (speedSq > 25) {
            const speed = Math.sqrt(speedSq);
            const len = Math.hypot(dx, dz) || 1;
            score -= ((dx * velocity.x + dz * velocity.z) / (len * speed)) * 2.2;
        }
    }
    return score;
}

/** Hysteresis: descargar solo si supera el umbral de carga + margen. */
export function shouldUnloadChunk(dx, dz, forward, fastTravel = false) {
    const manhattan = Math.abs(dx) + Math.abs(dz);
    if (manhattan <= 1) return false;

    const dot = chunkForwardDot(dx, dz, forward);
    let loadMax;
    if (fastTravel) {
        if (dot > 0.2) loadMax = 4;
        else if (dot > -0.35) loadMax = 2;
        else loadMax = 1;
    } else {
        if (dot > 0.25) loadMax = 3;
        else if (dot > -0.3) loadMax = 2;
        else loadMax = 1;
    }
    const unloadMax = loadMax + 1;
    return manhattan > unloadMax;
}

/** Yerba / decoración densa solo donde tiene sentido verla. */
export function shouldDecorChunk(dx, dz, forward, detailLevel) {
    if (detailLevel === 'low') return false;
    const manhattan = Math.abs(dx) + Math.abs(dz);
    if (manhattan <= 1) return true;
    const dot = chunkForwardDot(dx, dz, forward);
    if (dot < -0.12) return false;
    if (dot < 0.15 && manhattan > 2) return false;
    return detailLevel === 'full' || (detailLevel === 'mid' && dot > 0);
}

/** Detalle según distancia + visibilidad (LOD direccional). */
export function detailForStreamCell(dx, dz, forward, fastTravel, radiusFull = 2) {
    const manhattan = Math.abs(dx) + Math.abs(dz);
    const dot = chunkForwardDot(dx, dz, forward);

    if (fastTravel) {
        if (manhattan === 0) return 'mid';
        if (manhattan <= 1 && dot > -0.2) return 'mid';
        return 'low';
    }
    if (manhattan <= radiusFull && dot > -0.15) return 'full';
    if (manhattan <= radiusFull + 1 && dot > 0.1) return 'mid';
    if (dot > -0.25) return 'mid';
    return 'low';
}

/** Itera celdas candidatas en un bounding box, filtradas por cono. */
export function* iterStreamCells(pcx, pcz, forward, fastTravel, searchRadius = 4) {
    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
        for (let dz = -searchRadius; dz <= searchRadius; dz++) {
            if (!shouldStreamChunk(dx, dz, forward, fastTravel)) continue;
            yield { dx, dz, cx: pcx + dx, cz: pcz + dz };
        }
    }
}
