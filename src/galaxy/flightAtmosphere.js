import * as THREE from 'three';

/**
 * Atmósfera aérea — visibilidad y color según altitud (modelo simplificado realista).
 */
export function computeFlightAtmosphere(agl) {
    const alt = Math.max(0, agl ?? 0);
    const t = THREE.MathUtils.smoothstep(0, 4200, alt);

    const horizon = new THREE.Color(0x7a9ec8).lerp(new THREE.Color(0x0c1424), t);
    const zenith = new THREE.Color(0x3d6a9a).lerp(new THREE.Color(0x03060e), t);

    const visibility = THREE.MathUtils.lerp(520, 4200, Math.min(1, alt / 1800));
    const fogDensity = THREE.MathUtils.clamp(2.6 / (visibility * visibility), 0.000002, 0.000042);

    const surfaceVis = THREE.MathUtils.smoothstep(2800, 400, alt);
    const chunkMaxDist = THREE.MathUtils.lerp(2200, 240, Math.min(1, alt / 2400));
    const spacePeek = THREE.MathUtils.smoothstep(2800, 4800, alt);
    const atmoShell = THREE.MathUtils.smoothstep(400, 2200, alt) * (1 - spacePeek * 0.9);

    return {
        horizon,
        zenith,
        fogDensity,
        visibility,
        surfaceVis,
        chunkMaxDist,
        spacePeek,
        atmoShell,
        skyDarken: t,
    };
}
