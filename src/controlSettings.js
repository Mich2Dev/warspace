/** Controles de cámara + modo de interfaz (PC / móvil). */

import * as THREE from 'three';

const STORAGE_KEY = 'ws_controls';

const DEFAULTS = {
    uiMode: 'auto',
    invertX: false,
    invertY: false,
    sensitivity: 1.0,
    mobileSensitivity: 1.0,
    clickToMove: true,
    showNavPreview: true,
    navMarkerStyle: 'ring',
    navMarkerColor: '#a8bcc8',
    /** Seguimiento detrás de la nave al mover con WASD/joystick */
    chaseCameraAuto: true,
    /** Segundos sin rotar manual antes de reactivar el seguimiento */
    chaseCameraResumeDelay: 2.0,
    /** Velocidad del giro de cámara hacia atrás (1 = normal) */
    chaseCameraSmoothness: 1.0,
    /** También seguir durante autopilot / clic en mapa */
    chaseCameraOnAutopilot: false,
    /** Orbitar entre jugador y enemigo apuntado */
    combatCameraFollow: false,
};

let state = { ...DEFAULTS };

/** Dispositivo táctil real — no activa móvil en PC con pantalla táctil + ratón. */
export function detectMobileDevice() {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const noHover = window.matchMedia('(hover: none)').matches;
    if (coarse && noHover) return true;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const phoneSized = w <= 768 || (w <= 960 && h <= 500);
    if (phoneSized && coarse) return true;
    if (phoneSized && noHover) return true;

    return false;
}

export function shouldUseMobileLayout() {
    if (state.uiMode === 'desktop') return false;
    if (state.uiMode === 'mobile') return true;
    return detectMobileDevice();
}

export function getControlState() {
    return { ...state };
}

export function applyControlState(partial) {
    Object.assign(state, partial);
    _save();
}

export function loadControlState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) Object.assign(state, { ...DEFAULTS, ...JSON.parse(raw) });
    } catch (_) {
        state = { ...DEFAULTS };
    }
    return getControlState();
}

export function resetControlState() {
    state = { ...DEFAULTS };
    _save();
}

function _save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
}

/** Rotación de cámara unificada (móvil + PC). Convención alineada con OrbitControls. */
export function applyCameraDrag(controls, dx, dy, isMobile = false) {
    if (!controls || (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05)) return;

    const spd = isMobile ? state.mobileSensitivity : state.sensitivity;
    const scale = (isMobile ? 0.005 : 0.004) * spd;

    let ax = state.invertX ? -dx : dx;
    let ay = state.invertY ? -dy : dy;

    controls.rotateLeft(ax * scale);
    controls.rotateUp(ay * scale);
}

export function configureControlsForMobile(controls) {
    if (!controls) return;
    controls.touches = { ONE: THREE.TOUCH.NONE, TWO: THREE.TOUCH.NONE };
    controls.enablePan = false;
    controls.rotateSpeed = 0.55 * state.sensitivity;
}

export function configureControlsForDesktop(controls) {
    if (!controls) return;
    controls.touches = {
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN,
    };
    controls.mouseButtons = {
        LEFT: THREE.MOUSE.NONE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
    };
    controls.enablePan = false;
    controls.rotateSpeed = 0.55 * state.sensitivity;
}

export function bindDesktopCameraControls(controls, domElement) {
    if (!controls || !domElement) return () => {};

    let active = false;
    let lx = 0;
    let ly = 0;

    const onDown = (e) => {
        if (e.button !== 2) return;
        active = true;
        lx = e.clientX;
        ly = e.clientY;
        window.__game?.player?.markCameraManualOverride?.();
    };

    const onMove = (e) => {
        if (!active) return;
        const dx = e.clientX - lx;
        const dy = e.clientY - ly;
        lx = e.clientX;
        ly = e.clientY;
        applyCameraDrag(controls, dx, dy, false);
    };

    const onEnd = () => {
        active = false;
    };

    domElement.addEventListener('pointerdown', onDown);
    domElement.addEventListener('pointermove', onMove);
    domElement.addEventListener('pointerup', onEnd);
    domElement.addEventListener('pointercancel', onEnd);
    domElement.addEventListener('pointerleave', onEnd);

    return () => {
        domElement.removeEventListener('pointerdown', onDown);
        domElement.removeEventListener('pointermove', onMove);
        domElement.removeEventListener('pointerup', onEnd);
        domElement.removeEventListener('pointercancel', onEnd);
        domElement.removeEventListener('pointerleave', onEnd);
    };
}
