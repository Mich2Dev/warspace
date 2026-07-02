/**
 * Variables de viewport lógico y refresco de layout móvil (HUD + modales).
 */

import { getViewportSize } from './orientationLock.js';

export function syncGameViewportVars() {
    const root = document.documentElement;
    const mobile = document.body.classList.contains('layout-mobile');

    if (!mobile) {
        root.style.removeProperty('--game-w');
        root.style.removeProperty('--game-h');
        return;
    }

    const { width, height } = getViewportSize();
    root.style.setProperty('--game-w', `${width}px`);
    root.style.setProperty('--game-h', `${height}px`);
}

export function syncMobileUiLayout() {
    syncGameViewportVars();
    window.__syncHudLayout?.();
    window.dispatchEvent(new Event('viewport-resize'));
}

/** Llamar al abrir paneles/modales en móvil para recalcular tamaños. */
export function onMobilePanelOpen() {
    syncMobileUiLayout();
    requestAnimationFrame(() => {
        syncGameViewportVars();
        window.__syncHudLayout?.();
    });
}

export function initUiLayout() {
    syncGameViewportVars();
    window.syncMobileUiLayout = syncMobileUiLayout;
    window.addEventListener('viewport-resize', syncGameViewportVars);
}
