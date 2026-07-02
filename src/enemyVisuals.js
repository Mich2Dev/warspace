import * as THREE from 'three';
import { isAccessibleSpawnPoint } from './terrainRules.js';
import { isPlayerReachablePoint, snapToNavPoint } from './worldNav.js';

/** Perfil de vuelo por tier — más pesado = más lento girando, menos jitter. */
export const MOVEMENT_PROFILE = {
    Zona1: { accel: 0.07, turnRate: 3.2, orbitMul: 0.85, patrolSpeed: 0.42, hover: 38, bank: 0.004 },
    Zona2: { accel: 0.055, turnRate: 2.6, orbitMul: 0.95, patrolSpeed: 0.38, hover: 40, bank: 0.003 },
    Zona3: { accel: 0.038, turnRate: 2.0, orbitMul: 1.05, patrolSpeed: 0.32, hover: 44, bank: 0.002 },
    Invader_Alpha: { accel: 0.06, turnRate: 2.8, orbitMul: 0.9, patrolSpeed: 0.4, hover: 40, bank: 0.0035 },
    Invader_Beta: { accel: 0.05, turnRate: 2.4, orbitMul: 0.95, patrolSpeed: 0.36, hover: 42, bank: 0.003 },
    Invader_Gamma: { accel: 0.04, turnRate: 1.8, orbitMul: 1.1, patrolSpeed: 0.3, hover: 46, bank: 0.002 },
    Boss: { accel: 0.015, turnRate: 0.8, orbitMul: 0.5, patrolSpeed: 0.25, hover: 120, bank: 0.0008 },
};

/** Distancia mínima al hub según tier (lógica de dificultad espacial). */
export const MIN_HUB_DISTANCE = {
    Zona1: 2200,
    Zona2: 3400,
    Zona3: 5000,
    Invader_Alpha: 4000,
    Invader_Beta: 4500,
    Invader_Gamma: 5500,
};

const ROLE_VARIANTS = {
    patrol_mantis: { preserveOriginal: false, tint: 0x44ff88, emissive: 0x22aa55, tintStrength: 0.22, scale: 1.0 },
    patrol_border: { preserveOriginal: false, tint: 0xffcc44, emissive: 0xaa8822, tintStrength: 0.25, scale: 1.02 },
    ambush: { preserveOriginal: false, tint: 0x8844ff, emissive: 0x4422aa, tintStrength: 0.3, scale: 0.95 },
    scavenger_roam: { preserveOriginal: false, tint: 0x4499ff, emissive: 0x2266cc, tintStrength: 0.2, scale: 1.0 },
    disruptor: { preserveOriginal: false, tint: 0xff44aa, emissive: 0xaa2266, tintStrength: 0.28, scale: 1.05 },
    heavy_escort: { preserveOriginal: false, tint: 0xcccccc, emissive: 0x888888, tintStrength: 0.18, scale: 1.12 },
};

const TYPE_DEFAULTS = {
    Zona1: { preserveOriginal: true, scale: 1.0 },
    Zona2: { preserveOriginal: true, scale: 1.0 },
    Zona3: { preserveOriginal: true, scale: 1.0 },
};

/** Colores de propulsor / emissive por zona (mismo GLB, distinto glow). */
export const ZONE_PROPULSOR = {
    Zona1: { emissive: 0xff4400, intensity: 2.8 },
    Zona2: { emissive: 0x00ddff, intensity: 2.8 },
    Zona3: { emissive: 0xcc55ff, intensity: 2.8 },
    Invader_Alpha: { emissive: 0xff5533, intensity: 2.5 },
    Invader_Beta: { emissive: 0x44bbff, intensity: 2.5 },
    Invader_Gamma: { emissive: 0xbb44ff, intensity: 2.5 },
};

const ENGINE_NAME_RE = /engine|motor|thruster|exhaust|propuls|jet|flame|boost|reactor|light/i;

/** Esferas rojo/cian del GLB de patrulla — con escala ×20 se ven como globos gigantes. */
export function stripPoliceLightMeshes(modelRoot) {
    if (!modelRoot) return;
    const toRemove = [];
    modelRoot.traverse((child) => {
        if (child.userData?.policeLightRole) toRemove.push(child);
    });
    for (const mesh of toRemove) {
        mesh.parent?.remove(mesh);
        mesh.geometry?.dispose?.();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => m?.dispose?.());
    }
    delete modelRoot.userData.policeLights;
}

/** Tinta emissive de meshes de motor en el GLB (o cualquier emissive del modelo). */
export function applyZonePropulsorTint(root, spawnType) {
    const cfg = ZONE_PROPULSOR[spawnType];
    if (!root || !cfg) return;

    root.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        const name = child.name || '';
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        const isEngine = ENGINE_NAME_RE.test(name);
        mats.forEach((mat, i) => {
            if (!mat) return;
            const hadEmissive = mat.emissive && mat.emissive.getHex() !== 0;
            if (!isEngine && !hadEmissive) return;
            const clone = mat.clone();
            if (!clone.emissive) return;
            clone.emissive.setHex(cfg.emissive);
            clone.emissiveIntensity = Math.max(clone.emissiveIntensity ?? 0, cfg.intensity);
            if (Array.isArray(child.material)) child.material[i] = clone;
            else child.material = clone;
        });
    });
}

/** Nave procedural mínima cuando falla el GLB — no caja plana. */
export function buildSimpleEnemyShip(group, spawnType, boxSize) {
    const cfg = ZONE_PROPULSOR[spawnType] || ZONE_PROPULSOR.Zona1;
    const hullColor = { Zona1: 0x553333, Zona2: 0x334455, Zona3: 0x443355 }[spawnType] || 0x444455;
    const s = boxSize * 0.018;

    const bodyMat = new THREE.MeshStandardMaterial({
        color: hullColor,
        metalness: 0.75,
        roughness: 0.3,
    });
    const engineMat = new THREE.MeshStandardMaterial({
        color: cfg.emissive,
        emissive: cfg.emissive,
        emissiveIntensity: cfg.intensity,
        metalness: 0.2,
        roughness: 0.4,
    });

    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(2.2 * s, 3.5 * s, 14 * s, 10), bodyMat);
    fuselage.rotation.x = Math.PI / 2;
    group.add(fuselage);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(2.2 * s, 5 * s, 10), bodyMat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -9.5 * s;
    group.add(nose);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(12 * s, 0.5 * s, 5 * s), bodyMat);
    wing.position.z = 1 * s;
    group.add(wing);

    const engineL = new THREE.Mesh(new THREE.CylinderGeometry(1.1 * s, 1.4 * s, 2.5 * s, 8), engineMat);
    engineL.rotation.x = Math.PI / 2;
    engineL.position.set(-3 * s, 0, 7 * s);
    group.add(engineL);

    const engineR = engineL.clone();
    engineR.position.set(3 * s, 0, 7 * s);
    group.add(engineR);

    group.traverse((c) => { if (c.isMesh) c.frustumCulled = false; });
}

export function getMovementProfile(enemyType) {
    return MOVEMENT_PROFILE[enemyType] || MOVEMENT_PROFILE.Zona1;
}

export function getVisualVariant(enemyType, roleOrLabel = '') {
    if (roleOrLabel && ROLE_VARIANTS[roleOrLabel]) return { ...ROLE_VARIANTS[roleOrLabel] };
    return { ...(TYPE_DEFAULTS[enemyType] || TYPE_DEFAULTS.Zona1) };
}

export function hubDistance(x, z, hub) {
    const dx = x - (hub?.x ?? 0);
    const dz = z - (hub?.z ?? 4000);
    return Math.sqrt(dx * dx + dz * dz);
}

export function distanceToRegion(x, z, region) {
    const dx = x - region.center.x;
    const dz = z - region.center.z;
    return Math.sqrt(dx * dx + dz * dz);
}

export function isInsideRegion(x, z, region, margin = 1.0) {
    return distanceToRegion(x, z, region) <= region.radius * margin;
}

export function isValidPatrolPosition(x, z, enemyType, hub, region = null, env = null) {
    const safe = hub?.safeRadius ?? 2600;
    if (hubDistance(x, z, hub) < safe) return false;

    const minDist = MIN_HUB_DISTANCE[enemyType] ?? 2500;
    if (hubDistance(x, z, hub) < minDist) return false;

    if (region && !isInsideRegion(x, z, region, 0.98)) return false;

    if (env && !isPlayerReachablePoint(env, x, z)) return false;

    return true;
}

/** Punto aleatorio dentro de una región — anillo exterior, lejos del centro/base. */
export function randomPointInRegion(region, hub, attempts = 48, env = null) {
    const pick = (minFrac, maxFrac) => {
        const angle = Math.random() * Math.PI * 2;
        const r = region.radius * (minFrac + Math.random() * (maxFrac - minFrac));
        return {
            x: region.center.x + Math.cos(angle) * r,
            z: region.center.z + Math.sin(angle) * r,
        };
    };

    for (let i = 0; i < attempts; i++) {
        const { x, z } = pick(0.42, 0.88);
        if (env?.isCorridorAt?.(x, z) && isValidPatrolPosition(x, z, region.enemyType, hub, region, env)) {
            return { x, z };
        }
    }

    for (let i = 0; i < attempts; i++) {
        const { x, z } = pick(0.35, 0.92);
        if (isValidPatrolPosition(x, z, region.enemyType, hub, region, env)) {
            return { x, z };
        }
    }

    if (env) {
        const snapped = snapToNavPoint(env, region.center.x, region.center.z);
        if (isValidPatrolPosition(snapped.x, snapped.z, region.enemyType, hub, region, env)) {
            return snapped;
        }
    }

    return null;
}

const MIN_PATROL_SEPARATION = 850;

export function isPatrolTooClose(x, z, others) {
    const minSq = MIN_PATROL_SEPARATION * MIN_PATROL_SEPARATION;
    for (const p of others) {
        const dx = x - p.x;
        const dz = z - p.z;
        if (dx * dx + dz * dz < minSq) return true;
    }
    return false;
}

/** Materiales únicos por instancia — evita que un impacto tiña a todos los del mismo GLB. */
export function cloneMeshMaterials(root) {
    if (!root) return;
    root.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        if (Array.isArray(child.material)) {
            child.material = child.material.map((m) => (m?.clone ? m.clone() : m));
        } else if (child.material.clone) {
            child.material = child.material.clone();
        }
    });
}

/** Tinte opcional — Zona1 conserva materiales del GLB original. */
export function applyVisualVariant(root, variant) {
    if (!root || !variant) return;

    if (variant.scale && variant.scale !== 1) {
        root.scale.multiplyScalar(variant.scale);
    }

    if (variant.preserveOriginal) return;

    const strength = variant.tintStrength ?? 0.25;

    root.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        if (child.userData?.policeLightRole) return;
        child.material = child.material.clone();
        const m = child.material;
        if (variant.tint && m.color) m.color.lerp(new THREE.Color(variant.tint), strength);
        if (variant.emissive && m.emissive) {
            m.emissive.lerp(new THREE.Color(variant.emissive), strength);
            m.emissiveIntensity = Math.max(m.emissiveIntensity ?? 0, 0.8);
        }
    });

    const addon = variant.addon;
    if (!addon) return;

    const addonGroup = new THREE.Group();
    addonGroup.name = 'variant-addon';

    if (addon === 'dish') {
        const dish = new THREE.Mesh(
            new THREE.TorusGeometry(8, 1.2, 6, 16),
            new THREE.MeshStandardMaterial({ color: 0xffcc66, emissive: 0xff8800, emissiveIntensity: 1.5, metalness: 0.6, roughness: 0.3 })
        );
        dish.rotation.x = Math.PI / 2;
        dish.position.set(0, 12, -6);
        addonGroup.add(dish);
    } else if (addon === 'stripe') {
        const stripe = new THREE.Mesh(
            new THREE.BoxGeometry(14, 2, 4),
            new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xaaaaaa, emissiveIntensity: 0.8 })
        );
        stripe.position.set(0, 4, 8);
        addonGroup.add(stripe);
    } else if (addon === 'fin') {
        const fin = new THREE.Mesh(
            new THREE.BoxGeometry(2, 10, 14),
            new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xaa0000, emissiveIntensity: 1.0 })
        );
        fin.position.set(10, 0, 0);
        fin.rotation.z = 0.3;
        addonGroup.add(fin.clone());
        fin.position.set(-10, 0, 0);
        fin.rotation.z = -0.3;
        addonGroup.add(fin);
    } else if (addon === 'armor') {
        const plate = new THREE.Mesh(
            new THREE.BoxGeometry(18, 6, 22),
            new THREE.MeshStandardMaterial({ color: 0x665588, metalness: 0.85, roughness: 0.25, emissive: 0x221133, emissiveIntensity: 0.6 })
        );
        plate.position.set(0, -2, 4);
        addonGroup.add(plate);
    } else if (addon === 'command_crown') {
        const crown = new THREE.Mesh(
            new THREE.TorusGeometry(10, 1.4, 6, 5),
            new THREE.MeshStandardMaterial({ color: 0xffdd44, emissive: 0xff9900, emissiveIntensity: 1.8, metalness: 0.7, roughness: 0.2 })
        );
        crown.rotation.x = Math.PI / 2;
        crown.position.set(0, 16, -2);
        addonGroup.add(crown);
        const spike = new THREE.Mesh(
            new THREE.ConeGeometry(3, 8, 4),
            new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xff6600, emissiveIntensity: 1.2 })
        );
        spike.position.set(0, 22, -2);
        addonGroup.add(spike);
    } else if (addon === 'missile_racks') {
        [-1, 1].forEach((side) => {
            const rack = new THREE.Mesh(
                new THREE.BoxGeometry(4, 4, 18),
                new THREE.MeshStandardMaterial({ color: 0x443322, metalness: 0.6, roughness: 0.4 })
            );
            rack.position.set(side * 14, -2, 10);
            addonGroup.add(rack);
            const tip = new THREE.Mesh(
                new THREE.ConeGeometry(2.5, 7, 6),
                new THREE.MeshStandardMaterial({ color: 0xff5522, emissive: 0xff2200, emissiveIntensity: 1.1 })
            );
            tip.rotation.x = Math.PI / 2;
            tip.position.set(side * 14, -2, 20);
            addonGroup.add(tip);
        });
    }

    root.add(addonGroup);
}

/**
 * Steering suave hacia una dirección deseada (sin saltos ni bobbing vertical falso).
 */
export function steerVelocity(currentVel, desiredDir, maxSpeed, accel, delta) {
    const desired = desiredDir.clone().normalize().multiplyScalar(maxSpeed);
    return currentVel.clone().lerp(desired, Math.min(1, accel * (delta * 60)));
}

/** Yaw hacia un punto en plano XZ. */
export function yawToTarget(from, target) {
    return Math.atan2(target.x - from.x, target.z - from.z);
}

/** Giro suave en Y — evita snap de lookAt. */
export function smoothYawRotation(object, targetYaw, delta, turnRate = 2.0) {
    let cur = object.rotation.y;
    let diff = targetYaw - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    object.rotation.y = cur + diff * Math.min(1, turnRate * delta);
    return Math.abs(diff);
}

/** Diferencia angular absoluta entre dos yaws. */
export function yawDelta(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d);
}
