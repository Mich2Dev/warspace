/**

 * Presets de rendimiento — bloom, terreno, partículas, pixel ratio.

 */



const PRESETS = {

    low: {

        label: 'Bajo',

        bloom: false,

        pixelRatio: 0.65,

        dust: false,

        haze: false,

        sunHalo: false,

        grass: true,

        carpetPoints: 14000,

        chunkRadiusFull: 2,

        chunkRadiusMid: 2,

        chunkRadiusLow: 2,

        chunkRes: 24,

        chunkResMid: 10,

        chunkResLow: 6,

        horizonInterval: 8,

        buildPerFrame: 1,

    },

    medium: {

        label: 'Medio',

        bloom: false,

        bloomStrength: 0.18,

        pixelRatio: 0.85,

        dust: false,

        haze: true,

        sunHalo: false,

        grass: true,

        carpetPoints: 22000,

        chunkRadiusFull: 3,

        chunkRadiusMid: 2,

        chunkRadiusLow: 2,

        chunkRes: 32,

        chunkResMid: 14,

        chunkResLow: 8,

        horizonInterval: 5,

        buildPerFrame: 1,

    },

    high: {

        label: 'Alto',

        bloom: false,

        bloomStrength: 0.22,

        pixelRatio: 1.0,

        dust: false,

        haze: true,

        sunHalo: false,

        grass: true,

        carpetPoints: 28000,

        chunkRadiusFull: 3,

        chunkRadiusMid: 3,

        chunkRadiusLow: 3,

        chunkRes: 40,

        chunkResMid: 16,

        chunkResLow: 10,

        horizonInterval: 4,

        buildPerFrame: 1,

    },

};



let _game = null;

let _activeMode = 'auto';

let _resolvedPreset = 'medium';

let _fpsSamples = [];

let _autoDowngraded = false;



export function initGraphicsQuality(game) {

    _game = game;

    game._resolvedGraphicsPreset = _resolvedPreset;

}



export function getGraphicsQualityMode() {

    return _activeMode;

}



export function getResolvedGraphicsPreset() {

    return _resolvedPreset;

}



/** Detecta GPU integrada / software renderer — por defecto conservador. */

export function detectQualityPreset(renderer) {

    try {

        const gl = renderer?.getContext?.();

        if (!gl) return 'low';



        const dbg = gl.getExtension('WEBGL_debug_renderer_info');

        const gpu = [

            dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '',

            gl.getParameter(gl.RENDERER) || '',

        ].join(' ').toLowerCase();



        if (/swiftshader|llvmpipe|microsoft basic render|generic/.test(gpu)) return 'low';

        if (/intel.*(uhd|hd graphics|iris)|radeon.*vega 3|mali-|adreno \(tm\) 5|adreno 5/.test(gpu)) return 'low';

        if (/intel|geforce mx|gt 1030|gtx 750|hd 6[0-9]{2}|uhd 6|vega 8/.test(gpu)) return 'low';



        const mem = navigator.deviceMemory;

        if (!mem || mem <= 8) return 'low';



        const dpr = window.devicePixelRatio || 1;

        if (dpr >= 1.5) return 'low';



        if (/rtx|rx 6|rx 7|gtx 16|gtx 10[6-9]|radeon rx/.test(gpu)) return 'medium';

    } catch (_) { /* ignore */ }

    return 'medium';

}



export function applyGraphicsQuality(mode) {

    if (!_game) return;



    _activeMode = mode || 'auto';

    _resolvedPreset = _activeMode === 'auto'

        ? detectQualityPreset(_game.renderer)

        : (PRESETS[_activeMode] ? _activeMode : 'low');



    const p = PRESETS[_resolvedPreset] || PRESETS.low;

    _applyPreset(p);

    _game._resolvedGraphicsPreset = _resolvedPreset;

    _persistMode(_activeMode);



    const log = document.getElementById('log-text');

    if (log && _activeMode === 'auto') {

        log.textContent = `Gráficos: ${p.label} (auto) — O → Calidad si va lento`;

    }

}



function _applyPreset(p) {

    const g = _game;

    g._useBloom = !!p.bloom;



    if (g.bloomPass) {

        g.bloomPass.enabled = p.bloom;

        if (p.bloomStrength != null) g.bloomPass.strength = p.bloomStrength;

    }



    const mob = document.body.classList.contains('layout-mobile');

    const cap = mob ? Math.min(p.pixelRatio, 0.85) : p.pixelRatio;

    g.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));



    g.environment?.applyGraphicsProfile?.(p);



    const bi = document.getElementById('bloom-intensity');

    const bloomRow = bi?.closest('.settings-row');

    if (bloomRow) bloomRow.style.opacity = p.bloom ? '1' : '0.45';

    if (bi && p.bloomStrength != null) {

        bi.value = String(p.bloomStrength);

        const lbl = document.getElementById('bloom-intensity-val');

        if (lbl) lbl.textContent = p.bloomStrength.toFixed(2);

    }

}



/** Si calidad=auto y FPS bajo, baja a preset Bajo. */

export function tickGraphicsAutoScale(fps) {

    if (_activeMode !== 'auto' || _autoDowngraded || !_game) return;

    if (!Number.isFinite(fps) || fps <= 0) return;



    _fpsSamples.push(fps);

    if (_fpsSamples.length < 4) return;



    const avg = _fpsSamples.reduce((a, b) => a + b, 0) / _fpsSamples.length;

    _fpsSamples = [];



    if (avg >= 30) return;



    _autoDowngraded = true;

    _resolvedPreset = 'low';

    _game._resolvedGraphicsPreset = 'low';

    _applyPreset(PRESETS.low);



    const log = document.getElementById('log-text');

    if (log) {

        log.innerHTML = '<span style="color:#8898a4;">Rendimiento bajo — gráficos en modo <b>Bajo</b>. Ajustes → Calidad gráfica.</span>';

    }

}



function _persistMode(mode) {

    try {

        const raw = localStorage.getItem('ws_settings');

        const s = raw ? JSON.parse(raw) : {};

        s.graphicsQuality = mode;

        localStorage.setItem('ws_settings', JSON.stringify(s));

    } catch (_) { /* ignore */ }

}



export function loadSavedGraphicsQuality() {

    try {

        const raw = localStorage.getItem('ws_settings');

        if (raw) {

            const s = JSON.parse(raw);

            if (s.graphicsQuality) return s.graphicsQuality;

        }

    } catch (_) { /* ignore */ }

    return 'auto';

}



export { PRESETS };


