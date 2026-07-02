import * as THREE from 'three';

const _seg = new THREE.Vector3();
const _toCenter = new THREE.Vector3();

/**
 * ¿El segmento prev→next intersecta una esfera en center?
 * Evita que proyectiles rápidos atraviesen objetivos en un solo frame.
 */
export function segmentHitsSphere(prev, next, center, radius) {
    _seg.subVectors(next, prev);
    const segLenSq = _seg.lengthSq();
    if (segLenSq < 1e-6) {
        _toCenter.subVectors(center, next);
        const dSq = _toCenter.lengthSq();
        if (dSq > radius * radius) return null;
        return { point: next.clone(), distSq: dSq };
    }

    _toCenter.subVectors(center, prev);
    let t = _toCenter.dot(_seg) / segLenSq;
    t = Math.max(0, Math.min(1, t));

    const closest = _toCenter.copy(prev).addScaledVector(_seg, t);
    const dx = center.x - closest.x;
    const dy = center.y - closest.y;
    const dz = center.z - closest.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    const rSq = radius * radius;
    if (distSq > rSq) return null;

    return {
        point: closest.clone(),
        distSq,
        t,
    };
}

/** Distancia XZ entre dos posiciones (ignora altura). */
export function flatDistSq(ax, az, bx, bz) {
    const dx = ax - bx;
    const dz = az - bz;
    return dx * dx + dz * dz;
}

/**
 * Hitbox del jugador — tolerancia vertical amplia (nave vuela sobre el blanco).
 * Usa distancia horizontal + slack en Y para que láseres y ondas no pasen de largo.
 */
export function segmentHitsPlayer(prev, next, playerPos, opts = {}) {
    const radius = opts.radius ?? 72;
    const ySlack = opts.ySlack ?? 95;
    const rSq = radius * radius;

    _seg.subVectors(next, prev);
    const segLenSq = _seg.lengthSq();
    if (segLenSq < 1e-6) {
        if (flatDistSq(next.x, next.z, playerPos.x, playerPos.z) > rSq) return null;
        if (Math.abs(next.y - playerPos.y) > ySlack) return null;
        return { point: next.clone(), distSq: 0 };
    }

    let t = 0;
    let tEnd = 1;
    const steps = opts.steps ?? 6;
    for (let s = 0; s <= steps; s++) {
        t = s / steps;
        const px = prev.x + _seg.x * t;
        const py = prev.y + _seg.y * t;
        const pz = prev.z + _seg.z * t;
        if (flatDistSq(px, pz, playerPos.x, playerPos.z) <= rSq
            && Math.abs(py - playerPos.y) <= ySlack) {
            tEnd = t;
            break;
        }
    }
    if (tEnd === 1 && flatDistSq(next.x, next.z, playerPos.x, playerPos.z) > rSq) return null;
    if (Math.abs(next.y - playerPos.y) > ySlack && Math.abs(prev.y - playerPos.y) > ySlack) {
        const midY = (prev.y + next.y) * 0.5;
        if (Math.abs(midY - playerPos.y) > ySlack) return null;
    }

    const hit = prev.clone().lerp(next, tEnd);
    return { point: hit, distSq: flatDistSq(hit.x, hit.z, playerPos.x, playerPos.z) };
}

/** ¿El jugador está dentro de un radio horizontal (onda de choque, AoE)? */
export function playerInFlatRadius(playerPos, origin, radius) {
    return flatDistSq(playerPos.x, playerPos.z, origin.x, origin.z) <= radius * radius;
}

/** Punto de impacto desplazado hacia el objetivo desde el borde de la esfera. */
export function impactPointOnSphere(segmentHit, center, radius) {
    if (!segmentHit?.point) return center.clone();
    const out = segmentHit.point.clone();
    const dx = out.x - center.x;
    const dy = out.y - center.y;
    const dz = out.z - center.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const push = Math.max(0, radius - len * 0.35);
    out.x += (dx / len) * push;
    out.y += (dy / len) * push;
    out.z += (dz / len) * push;
    return out;
}
