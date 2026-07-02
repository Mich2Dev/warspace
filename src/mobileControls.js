/** Controles táctiles — multitouch: joystick (izq) + cámara (centro/dcha). */

import {
    applyCameraDrag,
    configureControlsForMobile,
    configureControlsForDesktop,
    shouldUseMobileLayout,
} from './controlSettings.js';
import {
    getViewportSize,
    mapClientToLandscape,
    mapDeltaToLandscape,
    syncOrientationLock,
    initOrientationLock,
} from './orientationLock.js';
import { syncGameViewportVars, initUiLayout, onMobilePanelOpen } from './uiLayout.js';

export function isMobileLayout() {
    return document.body.classList.contains('layout-mobile');
}

export { shouldUseMobileLayout, detectMobileDevice } from './controlSettings.js';
export { configureControlsForMobile, configureControlsForDesktop } from './controlSettings.js';

function bindHoldButton(el, onStart, onEnd) {
    if (!el) return;
    const start = (e) => {
        e.preventDefault();
        e.stopPropagation();
        onStart();
    };
    const end = (e) => {
        e.preventDefault();
        e.stopPropagation();
        onEnd();
    };
    el.addEventListener('touchstart', start, { passive: false });
    el.addEventListener('touchend', end, { passive: false });
    el.addEventListener('touchcancel', end, { passive: false });
}

function bindTapButton(el, action) {
    if (!el) return;
    const tap = (e) => {
        e.preventDefault();
        e.stopPropagation();
        action();
        el.classList.add('mob-btn-pulse');
        setTimeout(() => el.classList.remove('mob-btn-pulse'), 120);
    };
    el.addEventListener('touchstart', tap, { passive: false });
    el.addEventListener('click', (e) => e.preventDefault());
}

class MobileTouchRouter {
    constructor(player, controls) {
        this.player = player;
        this.controls = controls;
        this.touches = new Map();
        this.joyRadius = 52;
        this.joyVisual = document.getElementById('mobile-joystick');
        this.joyStick = document.getElementById('mobile-joystick-stick');

        this._onStart = this._onStart.bind(this);
        this._onMove = this._onMove.bind(this);
        this._onEnd = this._onEnd.bind(this);

        document.addEventListener('touchstart', this._onStart, { capture: true, passive: false });
        document.addEventListener('touchmove', this._onMove, { capture: true, passive: false });
        document.addEventListener('touchend', this._onEnd, { capture: true, passive: false });
        document.addEventListener('touchcancel', this._onEnd, { capture: true, passive: false });
    }

    dispose() {
        document.removeEventListener('touchstart', this._onStart, { capture: true });
        document.removeEventListener('touchmove', this._onMove, { capture: true });
        document.removeEventListener('touchend', this._onEnd, { capture: true });
        document.removeEventListener('touchcancel', this._onEnd, { capture: true });
    }

    _isUiElement(target) {
        if (!target?.closest) return false;
        return !!target.closest(
            '.mobile-actions, .mob-btn, .mobile-menu-sheet, #minimap, #minimap-size-toggle, ' +
            '#settings-panel, .game-modal, .hud-panel, #credits-hud, #pilot-profile-chip, #system-menu'
        );
    }

    _zone(x, y) {
        const { width: w, height: h } = getViewportSize();
        if (x > w * 0.54 && y > h * 0.36) return 'ui';
        if (x < w * 0.2 && y > h * 0.52 && y < h * 0.82) return 'ui';
        if (x < w * 0.5 && y > h * 0.22) return 'joy';
        if (y < h * 0.16) return 'hud';
        return 'camera';
    }

    _mapTouch(t) {
        return mapClientToLandscape(t.clientX, t.clientY);
    }

    _onStart(e) {
        if (!isMobileLayout()) return;

        for (const t of e.changedTouches) {
            if (this.touches.has(t.identifier)) continue;

            const hit = document.elementFromPoint(t.clientX, t.clientY);
            if (this._isUiElement(hit)) continue;

            const { x, y } = this._mapTouch(t);
            const zone = this._zone(x, y);
            if (zone === 'ui' || zone === 'hud') continue;

            if (zone === 'joy') {
                this.touches.set(t.identifier, {
                    role: 'joy',
                    ox: x,
                    oy: y,
                });
                this._showJoystick(t.clientX, t.clientY);
                e.preventDefault();
            } else if (zone === 'camera') {
                this.touches.set(t.identifier, {
                    role: 'camera',
                    lastX: t.clientX,
                    lastY: t.clientY,
                });
            }
        }
    }

    _onMove(e) {
        if (!isMobileLayout()) return;

        for (const t of e.changedTouches) {
            const data = this.touches.get(t.identifier);
            if (!data) continue;

            if (data.role === 'joy') {
                e.preventDefault();
                const { x: cx, y: cy } = this._mapTouch(t);
                const dx = cx - data.ox;
                const dy = cy - data.oy;
                const dist = Math.sqrt(dx * dx + dy * dy);
                let nx = dx;
                let ny = dy;
                if (dist > this.joyRadius) {
                    nx = (dx / dist) * this.joyRadius;
                    ny = (dy / dist) * this.joyRadius;
                }
                if (this.joyStick) {
                    this.joyStick.style.transform =
                        `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
                }
                const vx = nx / this.joyRadius;
                const vz = ny / this.joyRadius;
                this.player.mobileInput = { x: vx, z: vz };
                if (Math.abs(vx) > 0.1 || Math.abs(vz) > 0.1) {
                    this.player.autoPilot = false;
                }
            } else if (data.role === 'camera' && this.controls) {
                let dx = t.clientX - data.lastX;
                let dy = t.clientY - data.lastY;
                ({ dx, dy } = mapDeltaToLandscape(dx, dy));
                data.lastX = t.clientX;
                data.lastY = t.clientY;
                if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
                    e.preventDefault();
                    this.player._mobileCameraDrag = true;
                    this.player.markCameraManualOverride?.();
                    applyCameraDrag(this.controls, dx, dy, true);
                }
            }
        }
    }

    _onEnd(e) {
        for (const t of e.changedTouches) {
            const data = this.touches.get(t.identifier);
            if (!data) continue;

            if (data.role === 'joy') {
                this.player.mobileInput = { x: 0, z: 0 };
                this._hideJoystick();
            }
            this.touches.delete(t.identifier);
        }
        if (![...this.touches.values()].some((d) => d.role === 'camera')) {
            if (this.player._mobileCameraDrag) {
                this.player.markCameraManualOverride?.();
            }
            this.player._mobileCameraDrag = false;
        }
    }

    _showJoystick(x, y) {
        if (!this.joyVisual) return;
        this.joyVisual.style.display = 'block';
        this.joyVisual.style.left = `${x - 54}px`;
        this.joyVisual.style.top = `${y - 54}px`;
        this.joyVisual.style.bottom = 'auto';
        this.joyVisual.classList.add('active');
        if (this.joyStick) this.joyStick.style.transform = 'translate(-50%, -50%)';
    }

    _hideJoystick() {
        if (!this.joyVisual) return;
        this.joyVisual.classList.remove('active');
        if (this.joyStick) this.joyStick.style.transform = 'translate(-50%, -50%)';
    }
}

function setupMobileMenu(hooks) {
    const sheet = document.getElementById('mobile-menu-sheet');
    const menuBtn = document.getElementById('mob-btn-menu');
    const closeBtn = document.getElementById('mobile-menu-close');
    if (!sheet || !menuBtn) return;

    const open = () => {
        sheet.hidden = false;
        onMobilePanelOpen();
    };
    const close = () => { sheet.hidden = true; };

    bindTapButton(menuBtn, open);
    closeBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); close(); }, { passive: false });
    closeBtn?.addEventListener('click', (e) => { e.preventDefault(); close(); });

    const actions = {
        missions: () => hooks.openMissions?.(),
        events: () => hooks.openEvents?.(),
        hangar: () => hooks.toggleHangar?.(),
        armory: () => hooks.openArmory?.() || hooks.openShop?.(),
        shop: () => hooks.openArmory?.() || hooks.openShop?.(),
        upgrades: () => hooks.openUpgrades?.(),
        profile: () => hooks.openProfile?.(),
        settings: () => hooks.openSettings?.(),
    };

    sheet.querySelectorAll('[data-mob-action]').forEach((btn) => {
        const run = () => {
            actions[btn.getAttribute('data-mob-action')]?.();
            close();
        };
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            run();
        }, { passive: false });
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            run();
        });
    });
}

let _player = null;
let _hooks = null;
let _touchRouter = null;
let _mobileActive = false;

function _bindActionButtons() {
    if (!_player || !_hooks) return;

    bindHoldButton(
        document.getElementById('mob-btn-fire'),
        () => { _player._mobileFire = true; },
        () => { _player._mobileFire = false; }
    );

    bindHoldButton(
        document.getElementById('mob-btn-nitro'),
        () => { _player.keys.shift = true; },
        () => { _player.keys.shift = false; }
    );

    bindTapButton(document.getElementById('mob-btn-missile'), () => _player.shootMissile());
    bindTapButton(document.getElementById('mob-btn-repair'), () => _player.activateRepairBurst());
    bindTapButton(document.getElementById('mob-btn-shield'), () => _player.activateShield());
    bindTapButton(document.getElementById('mob-btn-target'), () => {
        const em = _hooks.getEnemyManager?.();
        if (em) _player.activateAutoPilot(em);
    });

    setupMobileMenu(_hooks);
}

function _enableMobile() {
    if (_mobileActive) return;
    _mobileActive = true;

    const root = document.getElementById('mobile-controls');
    document.body.classList.add('layout-mobile');
    document.documentElement.classList.add('layout-mobile-root');
    if (root) root.hidden = false;
    document.documentElement.style.touchAction = 'none';

    const controls = _hooks?.getControls?.();
    configureControlsForMobile(controls);

    const joyVisual = document.getElementById('mobile-joystick');
    if (joyVisual) joyVisual.style.display = 'none';

    _touchRouter?.dispose();
    _touchRouter = new MobileTouchRouter(_player, controls);
}

function _disableMobile() {
    if (!_mobileActive) return;
    _mobileActive = false;

    _touchRouter?.dispose();
    _touchRouter = null;

    document.body.classList.remove('layout-mobile');
    document.documentElement.classList.remove('layout-mobile-root');
    document.documentElement.style.touchAction = '';

    const root = document.getElementById('mobile-controls');
    if (root) root.hidden = true;

    if (_player) {
        _player.mobileInput = { x: 0, z: 0 };
        _player._mobileFire = false;
        _player._mobileCameraDrag = false;
        _player.keys.shift = false;
    }

    const controls = _hooks?.getControls?.();
    configureControlsForDesktop(controls);
}

export function syncMobileLayout() {
    if (!_player || !_hooks) return;
    if (shouldUseMobileLayout()) _enableMobile();
    else _disableMobile();
    syncOrientationLock();
    syncGameViewportVars();
}

export function initMobileControls(player, hooks = {}) {
    _player = player;
    _hooks = hooks;

    _bindActionButtons();
    initUiLayout();
    initOrientationLock();
    syncMobileLayout();

    window.addEventListener('resize', () => syncMobileLayout());

    return () => {
        _disableMobile();
        _touchRouter?.dispose();
    };
}
