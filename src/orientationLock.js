/**
 * Fuerza vista horizontal en móvil aunque el teléfono esté en vertical.
 * Navegadores no pueden girar el hardware; rotamos la UI y mapeamos touch/render.
 */

let _forced = false;
let _lockTried = false;

export function isPortraitViewport() {
    return window.innerHeight > window.innerWidth;
}

export function isForcedLandscape() {
    return _forced;
}

export function shouldForceLandscape() {
    return document.body.classList.contains('layout-mobile') && isPortraitViewport();
}

/** Dimensiones lógicas del juego (siempre landscape en móvil forzado). */
export function getViewportSize() {
    if (_forced) {
        return { width: window.innerHeight, height: window.innerWidth };
    }
    return { width: window.innerWidth, height: window.innerHeight };
}

/** Convierte coords de pantalla física → espacio landscape del juego. */
export function mapClientToLandscape(clientX, clientY) {
    if (!_forced) return { x: clientX, y: clientY };
    return {
        x: clientY,
        y: window.innerWidth - clientX,
    };
}

/** Convierte delta de arrastre táctil al espacio landscape. */
export function mapDeltaToLandscape(dx, dy) {
    if (!_forced) return { dx, dy };
    return { dx: dy, dy: -dx };
}

async function tryLockLandscape() {
    const lock = screen.orientation?.lock;
    if (!lock) return false;
    try {
        await lock.call(screen.orientation, 'landscape');
        return true;
    } catch {
        return false;
    }
}

export function syncOrientationLock() {
    if (!document.body.classList.contains('layout-mobile')) {
        _forced = false;
        document.documentElement.classList.remove('portrait-lock');
        document.body.classList.remove('portrait-lock');
        return;
    }

    _forced = shouldForceLandscape();
    document.documentElement.classList.toggle('portrait-lock', _forced);
    document.body.classList.toggle('portrait-lock', _forced);

    const hint = document.getElementById('mobile-rotate-hint');
    if (hint) hint.hidden = _forced;

    window.dispatchEvent(new Event('viewport-resize'));
}

export function initOrientationLock() {
    syncOrientationLock();

    window.addEventListener('resize', syncOrientationLock);
    window.addEventListener('orientationchange', () => {
        setTimeout(syncOrientationLock, 120);
    });

    const onGesture = async () => {
        if (!_lockTried && shouldForceLandscape()) {
            _lockTried = true;
            const locked = await tryLockLandscape();
            if (locked) syncOrientationLock();
        }
    };
    document.addEventListener('touchstart', onGesture, { passive: true, once: false });
    document.addEventListener('click', onGesture, { once: false });
}
