/**
 * WarSpace — Settings Manager
 * Panel de ajustes, gráficos, HUD, controles de cámara y modo PC/móvil.
 */

import {
    loadControlState,
    getControlState,
    applyControlState,
    resetControlState,
    configureControlsForDesktop,
    configureControlsForMobile,
    bindDesktopCameraControls,
    shouldUseMobileLayout,
} from './controlSettings.js';
import { onMobilePanelOpen } from './uiLayout.js';
import { applyGraphicsQuality, tickGraphicsAutoScale } from './graphicsQuality.js';

let _bloomPass = null;
let _sceneFog = null;
let _controls = null;
let _unbindDesktopCamera = null;
let _syncMobileLayout = null;
let _fpsVisible = false;
let _fpsFrames = 0;
let _fpsLast = performance.now();
let _lastMeasuredFps = 60;

export function initSettings({ bloomPass, fog, controls, domElement, syncMobileLayout }) {
    _bloomPass = bloomPass;
    _sceneFog = fog;
    _controls = controls;
    _syncMobileLayout = syncMobileLayout;

    loadControlState();
    _syncControlsFromState();
    _applyControlBindings(domElement);

    _setupKeyboard();
    _loadSaved();
}

export function toggleSettings() {
    const panel = document.getElementById('settings-panel');
    if (!panel) return;
    panel.classList.toggle('open');
    document.body.classList.toggle('settings-open', panel.classList.contains('open'));
    if (panel.classList.contains('open')) onMobilePanelOpen();
}

export function applySettings() {
    _readControlsFromDom();

    const fpsOn = document.getElementById('toggle-fps')?.checked;
    const fpsEl = document.getElementById('fps-counter');
    if (fpsEl) fpsEl.style.display = fpsOn ? 'block' : 'none';
    _fpsVisible = !!fpsOn;

    const gq = document.getElementById('graphics-quality')?.value ?? 'auto';
    applyGraphicsQuality(gq);

    if (_bloomPass) {
        const bi = parseFloat(document.getElementById('bloom-intensity')?.value ?? 0.38);
        const bt = parseFloat(document.getElementById('bloom-threshold')?.value ?? 0.9);
        _bloomPass.strength = bi;
        _bloomPass.threshold = bt;
        if (window.__game) {
            if (bi < 0.01) window.__game._useBloom = false;
            else if (_bloomPass.enabled !== false) window.__game._useBloom = true;
        }
    }

    if (_sceneFog) {
        const fd = parseFloat(document.getElementById('fog-density')?.value ?? 0.00008);
        _sceneFog.color.setHex(0xb8ccd8);
        if (_sceneFog.isFog) {
            _sceneFog.near = 900;
            _sceneFog.far = Math.min(14500, Math.max(7500, 7000 + fd * 42000000));
        } else {
            _sceneFog.density = fd;
        }
        const label = document.getElementById('fog-density-val');
        if (label) {
            if (fd < 0.0001) label.textContent = 'apagada';
            else if (fd < 0.0002) label.textContent = 'baja';
            else if (fd < 0.0003) label.textContent = 'media';
            else label.textContent = 'alta';
        }
    }

    const minimap = document.getElementById('minimap');
    if (minimap) {
        const on = document.getElementById('toggle-minimap')?.checked;
        minimap.style.opacity = on ? '' : '0';
        minimap.style.pointerEvents = on ? 'auto' : 'none';
    }

    const log = document.getElementById('combat-log');
    if (log) log.style.opacity = document.getElementById('toggle-combatlog')?.checked ? '1' : '0';

    const mp = document.getElementById('mission-panel');
    if (mp) mp.style.opacity = document.getElementById('toggle-missionpanel')?.checked ? '1' : '0';

    _syncControlsFromState();
    _applyControlBindings(document.querySelector('canvas'));
    _syncMobileLayout?.();
    _updateUiModeButtons();
    window.__navMarker?.refreshStyles?.();
    _save();
}

export function tickFps() {
    _fpsFrames++;
    const now = performance.now();
    if (now - _fpsLast >= 500) {
        const fps = Math.round(_fpsFrames * 1000 / (now - _fpsLast));
        _lastMeasuredFps = fps;
        tickGraphicsAutoScale(fps);

        if (_fpsVisible) {
            const el = document.getElementById('fps-value');
            if (el) {
                el.textContent = fps;
                el.style.color = fps >= 50 ? '#a8bcc8' : fps >= 30 ? '#8898a4' : '#687880';
            }
        }
        _fpsFrames = 0;
        _fpsLast = now;
    }
    return _lastMeasuredFps;
}

export function getLastFps() {
    return _lastMeasuredFps;
}

export function applyLayout(preset, btn) {
    document.body.classList.remove('layout-compact', 'layout-cinematic');
    if (preset !== 'classic') document.body.classList.add('layout-' + preset);

    document.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    localStorage.setItem('ws_layout', preset);
}

export function applyUiMode(mode, btn) {
    applyControlState({ uiMode: mode });
    _setSelect('ui-mode-select', mode);
    _updateUiModeButtons(btn);
    applySettings();
}

export function updateSliderLabel(input, labelId, isFog = false) {
    if (isFog) return;
    const label = document.getElementById(labelId);
    if (label) label.textContent = parseFloat(input.value).toFixed(2);
}

export function resetSettings() {
    resetControlState();

    const bi = document.getElementById('bloom-intensity');
    const bt = document.getElementById('bloom-threshold');
    const fd = document.getElementById('fog-density');
    if (bi) { bi.value = 0.38; document.getElementById('bloom-intensity-val').textContent = '0.38'; }
    if (bt) { bt.value = 0.9; document.getElementById('bloom-threshold-val').textContent = '0.90'; }
    if (fd) fd.value = 0.00008;

    ['toggle-fps', 'toggle-minimap', 'toggle-combatlog', 'toggle-missionpanel'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.checked = id !== 'toggle-fps';
    });

    _writeControlsToDom();
    applyLayout('classic', document.querySelector('[data-preset="classic"]'));
    applySettings();
}

function _readControlsFromDom() {
    applyControlState({
        uiMode: document.getElementById('ui-mode-select')?.value ?? 'auto',
        invertX: !!document.getElementById('toggle-invert-x')?.checked,
        invertY: !!document.getElementById('toggle-invert-y')?.checked,
        sensitivity: parseFloat(document.getElementById('camera-sensitivity')?.value ?? 1),
        mobileSensitivity: parseFloat(document.getElementById('camera-mobile-sensitivity')?.value ?? 1),
        clickToMove: document.getElementById('toggle-click-move')?.checked ?? true,
        showNavPreview: document.getElementById('toggle-nav-preview')?.checked ?? true,
        navMarkerStyle: document.getElementById('nav-marker-style')?.value ?? 'ring',
        navMarkerColor: document.getElementById('nav-marker-color')?.value ?? '#a8bcc8',
        chaseCameraAuto: document.getElementById('toggle-chase-camera')?.checked ?? true,
        chaseCameraOnAutopilot: !!document.getElementById('toggle-chase-autopilot')?.checked,
        chaseCameraResumeDelay: parseFloat(document.getElementById('chase-camera-delay')?.value ?? 2),
        chaseCameraSmoothness: parseFloat(document.getElementById('chase-camera-smooth')?.value ?? 1),
        combatCameraFollow: !!document.getElementById('toggle-combat-camera')?.checked,
    });
}

function _writeControlsToDom() {
    const s = getControlState();
    _setSelect('ui-mode-select', s.uiMode);
    _setCheck('toggle-invert-x', s.invertX);
    _setCheck('toggle-invert-y', s.invertY);
    _setVal('camera-sensitivity', s.sensitivity, 'camera-sensitivity-val', (v) => v.toFixed(1));
    _setVal('camera-mobile-sensitivity', s.mobileSensitivity, 'camera-mobile-sensitivity-val', (v) => v.toFixed(1));
    _setCheck('toggle-click-move', s.clickToMove !== false);
    _setCheck('toggle-nav-preview', s.showNavPreview !== false);
    _setSelect('nav-marker-style', s.navMarkerStyle || 'ring');
    const colorEl = document.getElementById('nav-marker-color');
    if (colorEl) colorEl.value = s.navMarkerColor || '#a8bcc8';
    _setCheck('toggle-chase-camera', s.chaseCameraAuto !== false);
    _setCheck('toggle-chase-autopilot', !!s.chaseCameraOnAutopilot);
    _setVal('chase-camera-delay', s.chaseCameraResumeDelay ?? 2, 'chase-camera-delay-val', (v) => `${v}s`);
    _setVal('chase-camera-smooth', s.chaseCameraSmoothness ?? 1, 'chase-camera-smooth-val', (v) => v.toFixed(1));
    _setCheck('toggle-combat-camera', !!s.combatCameraFollow);
    _updateUiModeButtons();
}

function _syncControlsFromState() {
    if (!_controls) return;
    if (shouldUseMobileLayout()) configureControlsForMobile(_controls);
    else configureControlsForDesktop(_controls);
}

function _applyControlBindings(domElement) {
    _unbindDesktopCamera?.();
    _unbindDesktopCamera = null;
    if (!shouldUseMobileLayout() && _controls && domElement) {
        _unbindDesktopCamera = bindDesktopCameraControls(_controls, domElement);
    }
}

function _updateUiModeButtons(activeBtn) {
    const mode = document.getElementById('ui-mode-select')?.value ?? 'auto';
    document.querySelectorAll('[data-ui-mode]').forEach((btn) => {
        btn.classList.toggle('active', activeBtn ? btn === activeBtn : btn.getAttribute('data-ui-mode') === mode);
    });
}

function _setupKeyboard() {
    window.addEventListener('keydown', (e) => {
        if (e.target?.matches?.('input, textarea, select')) return;
        if (e.key.toLowerCase() === 'o') toggleSettings();
    });
}

function _save() {
    try {
        localStorage.setItem('ws_settings', JSON.stringify({
            fps: document.getElementById('toggle-fps')?.checked,
            bloom_i: document.getElementById('bloom-intensity')?.value,
            bloom_t: document.getElementById('bloom-threshold')?.value,
            fog: document.getElementById('fog-density')?.value,
            minimap: document.getElementById('toggle-minimap')?.checked,
            combatlog: document.getElementById('toggle-combatlog')?.checked,
            missionp: document.getElementById('toggle-missionpanel')?.checked,
            graphicsQuality: document.getElementById('graphics-quality')?.value ?? 'auto',
        }));
    } catch (_) {}
}

function _loadSaved() {
    try {
        const raw = localStorage.getItem('ws_settings');
        if (raw) {
            const s = JSON.parse(raw);
            _setCheck('toggle-fps', !!s.fps);
            _setCheck('toggle-minimap', s.minimap ?? true);
            _setCheck('toggle-combatlog', s.combatlog ?? true);
            _setCheck('toggle-missionpanel', s.missionp ?? true);
            _setVal('bloom-intensity', s.bloom_i ?? 0.38, 'bloom-intensity-val', (v) => v.toFixed(2));
            _setVal('bloom-threshold', s.bloom_t ?? 0.9, 'bloom-threshold-val', (v) => v.toFixed(2));
            if (s.fog) {
                const el = document.getElementById('fog-density');
                if (el) el.value = s.fog;
            }
            _setSelect('graphics-quality', s.graphicsQuality ?? 'auto');
        }
        const layout = localStorage.getItem('ws_layout') ?? 'classic';
        const btn = document.querySelector(`[data-preset="${layout}"]`);
        applyLayout(layout, btn);
    } catch (_) {}

    _writeControlsToDom();
    applySettings();
}

function _setCheck(id, val) {
    const el = document.getElementById(id);
    if (el) el.checked = val;
}

function _setVal(id, val, labelId, fmt) {
    const el = document.getElementById(id);
    if (el) {
        el.value = val;
        const label = document.getElementById(labelId);
        if (label) label.textContent = fmt(parseFloat(val));
    }
}

function _setSelect(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}
