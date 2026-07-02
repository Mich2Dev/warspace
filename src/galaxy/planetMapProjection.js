import * as THREE from 'three';
import { clampPointToDisc, WORLD_MAP } from '../worldNav.js';

/**
 * El mapa plano ES la superficie del planeta.
 * La esfera 3D es la vista exterior: cada dirección de entrada
 * corresponde a un punto del disco jugable.
 */

export function getFlatMapRadius() {
    return WORLD_MAP.playableRadius * WORLD_MAP.playerClampScale * 0.92;
}

/**
 * Dirección unitaria (desde el centro del planeta hacia fuera) → coordenadas XZ del mapa.
 * Polo norte (0,1,0) = centro del mapa; ecuador = borde del disco.
 */
export function sphereDirectionToFlatMap(dir, out = { x: 0, z: 0 }) {
    const d = dir.clone().normalize();
    const theta = Math.atan2(d.x, d.z);
    const horiz = Math.hypot(d.x, d.z);
    const colat = Math.atan2(horiz, d.y);
    const maxR = getFlatMapRadius();
    const flatR = maxR * Math.sin(colat);
    out.x = Math.sin(theta) * flatR;
    out.z = Math.cos(theta) * flatR;
    const safe = clampPointToDisc(out.x, out.z, WORLD_MAP.playerClampScale);
    out.x = safe.x;
    out.z = safe.z;
    return out;
}

/**
 * Punto XZ del mapa → dirección en la esfera (salida al espacio).
 */
export function flatMapToSphereDirection(flatX, flatZ, out = new THREE.Vector3()) {
    const maxR = getFlatMapRadius();
    const r = Math.hypot(flatX, flatZ);
    const theta = Math.atan2(flatX, flatZ);
    const colat = THREE.MathUtils.clamp((r / maxR) * (Math.PI / 2), 0, Math.PI / 2 - 0.05);
    const horiz = Math.sin(colat);
    out.set(
        Math.sin(theta) * horiz,
        Math.cos(colat),
        Math.cos(theta) * horiz,
    ).normalize();
    return out;
}

/**
 * Posición del jugador en el universo → punto de aterrizaje en el mapa plano.
 * @param {THREE.Vector3} universePos
 * @param {THREE.Vector3} planetCenter
 */
export function universePosToFlatMap(universePos, planetCenter, environment) {
    const outward = universePos.clone().sub(planetCenter);
    const dist = outward.length();
    const outwardDir = outward.lengthSq() > 1
        ? outward.normalize()
        : new THREE.Vector3(0, 1, 0);

    const flat = sphereDirectionToFlatMap(outwardDir);
    const groundY = Math.max(environment?.getHeightAt(flat.x, flat.z) ?? 0, 0);
    return {
        x: flat.x,
        z: flat.z,
        groundY,
        outwardDir,
        shellDist: dist,
    };
}
