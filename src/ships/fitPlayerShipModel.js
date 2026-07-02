import * as THREE from 'three';
import { getPlayerShipTargetLength, getPlayerShipFallbackScale } from './playerShipVisuals.js';

/** Centra y escala el GLB del jugador para que sea visible (independiente del export Blender). */
export function fitPlayerShipModel(model, targetLength = null) {
    const length = targetLength ?? getPlayerShipTargetLength();
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    model.position.sub(center);

    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0.001) {
        model.scale.multiplyScalar(length / maxDim);
    } else {
        model.scale.setScalar(getPlayerShipFallbackScale());
    }

    model.updateMatrixWorld(true);
    return { size, box: new THREE.Box3().setFromObject(model) };
}

export function boostPlayerShipMaterials(model) {
    model.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        child.frustumCulled = false;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((mat, i) => {
            if (!mat) return;
            const clone = mat.clone();
            if (clone.emissive && (clone.emissive.r + clone.emissive.g + clone.emissive.b > 0)) {
                clone.emissiveIntensity = Math.max(clone.emissiveIntensity ?? 0, 6);
            }
            if (Array.isArray(child.material)) child.material[i] = clone;
            else child.material = clone;
        });
    });
}

export const PLAYER_SHIP_ROTATION_Y = 0;
