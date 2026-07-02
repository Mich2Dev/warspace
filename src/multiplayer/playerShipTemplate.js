import * as THREE from 'three';
import { getShipGlb, DEFAULT_SHIP_ID, getShipById } from '../ships/playerShipCatalog.js';import { resolveModelUrl } from '../ships/resolveModelUrl.js';
import { fitPlayerShipModel, boostPlayerShipMaterials } from '../ships/fitPlayerShipModel.js';
import { getPlayerShipTargetLength, getPlayerShipRotationY, getPlayerShipFallbackScale } from '../ships/playerShipVisuals.js';

function shipUrl() {
    return resolveModelUrl(getShipGlb(DEFAULT_SHIP_ID));
}
/** Grupo off-scene — nunca es la malla viva del jugador local. */
let cachedTemplate = null;
let loadPromise = null;
const readyCallbacks = [];
let onReadyHook = null;

function processPlayerModel(model, shipDef = null) {
    boostPlayerShipMaterials(model);
    fitPlayerShipModel(model, getPlayerShipTargetLength(shipDef ?? getShipById(DEFAULT_SHIP_ID)));

    const rotationGroup = new THREE.Group();
    rotationGroup.rotation.y = getPlayerShipRotationY(shipDef ?? getShipById(DEFAULT_SHIP_ID));
    rotationGroup.add(model);
    model.updateMatrixWorld(true);
    return rotationGroup;
}

function buildTemplateFromScene(scene) {
    const model = scene.clone(true);
    return processPlayerModel(model);
}

/** Avisa a RemotePlayers cuando la nave local terminó de cargar (refresco pendientes). */
export function registerPlayerGltf(_gltf) {
    while (readyCallbacks.length) readyCallbacks.shift()();
    onReadyHook?.();
}

export function onPlayerShipReady(cb) {
    if (cachedTemplate) {
        cb();
        return;
    }
    readyCallbacks.push(cb);
}

export function setRemoteShipReadyHook(fn) {
    onReadyHook = fn;
}

/** Precarga una plantilla off-scene compartida por todos los pilotos remotos. */
export function ensurePlayerShipTemplate(gltfLoader) {
    if (cachedTemplate) return Promise.resolve(cachedTemplate);
    if (loadPromise) return loadPromise;

    loadPromise = new Promise((resolve) => {
        gltfLoader.load(
            shipUrl(),
            (gltf) => {
                cachedTemplate = buildTemplateFromScene(gltf.scene);
                while (readyCallbacks.length) readyCallbacks.shift()();
                onReadyHook?.();
                resolve(cachedTemplate);
            },
            undefined,
            (err) => {
                console.warn('[MP] No se pudo cargar nave para remotos:', err);
                cachedTemplate = buildFallbackShip();
                while (readyCallbacks.length) readyCallbacks.shift()();
                onReadyHook?.();
                resolve(cachedTemplate);
            },
        );
    });

    return loadPromise;
}

function buildFallbackShip() {
    const group = new THREE.Group();
    const scale = getPlayerShipFallbackScale();
    const mat = new THREE.MeshStandardMaterial({
        color: 0x8899aa,
        metalness: 0.8,
        roughness: 0.25,
        emissive: 0x224466,
        emissiveIntensity: 0.6,
    });

    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(2, 5, 40, 12), mat);
    fuselage.rotation.x = Math.PI / 2;
    fuselage.frustumCulled = false;
    group.add(fuselage);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(36, 2, 14), mat.clone());
    wing.frustumCulled = false;
    group.add(wing);

    group.scale.setScalar(scale);
    return group;
}

/** Placeholder visible mientras carga el GLB. */
export function buildRemotePlaceholder() {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
        color: 0x44ddff,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(28, 10, 48), mat);
    body.frustumCulled = false;
    group.add(body);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(6, 18, 8), mat.clone());
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -28;
    nose.frustumCulled = false;
    group.add(nose);

    group.scale.setScalar(getPlayerShipFallbackScale());
    return group;
}

/** Clona la plantilla — geometría independiente por piloto (evita dispose cruzado). */
export function createRemoteShipVisual() {
    if (!cachedTemplate) return buildFallbackShip();

    const ship = cachedTemplate.clone(true);
    ship.traverse((child) => {
        if (!child.isMesh) return;
        child.frustumCulled = false;
        if (child.geometry) child.geometry = child.geometry.clone();
        if (child.material) {
            child.material = Array.isArray(child.material)
                ? child.material.map((m) => m.clone())
                : child.material.clone();
        }
    });
    return ship;
}
