/**
 * Gobernador de rendimiento en tiempo real — ajusta bloom, terreno y simulación según FPS.
 */

let _game = null;
let _tier = 'normal';
let _fpsRing = [];
let _bloomForcedOff = false;

export function initPerfBudget(game) {
    _game = game;
    _tier = 'normal';
    _fpsRing = [];
    _bloomForcedOff = false;
}

export function getPerfTier() {
    return _tier;
}

/** Llamar cada frame tras medir FPS. */
export function tickPerfBudget(fps) {
    if (!Number.isFinite(fps) || fps <= 0) return _tier;

    _fpsRing.push(fps);
    if (_fpsRing.length > 10) _fpsRing.shift();
    if (_fpsRing.length < 4) return _tier;

    const avg = _fpsRing.reduce((a, b) => a + b, 0) / _fpsRing.length;
    const prev = _tier;

    if (avg < 22) _tier = 'critical';
    else if (avg < 34) _tier = 'economy';
    else if (avg < 48) _tier = 'balanced';
    else if (avg >= 58) _tier = 'normal';
    else if (_tier === 'critical' && avg < 28) _tier = 'economy';
    else if (_tier === 'economy' && avg < 40) _tier = 'balanced';

    if (_tier !== prev) _applyTier(_tier);
    else if (_tier !== 'normal' && _tier !== 'balanced') _applyTier(_tier);

    return _tier;
}

function _applyTier(tier) {
    const g = _game;
    if (!g) return;

    const needOffBloom = tier === 'critical' || tier === 'economy';
    if (needOffBloom && g._useBloom) {
        g._useBloom = false;
        _bloomForcedOff = true;
        if (g.bloomPass) g.bloomPass.enabled = false;
    } else if (!needOffBloom && _bloomForcedOff) {
        _bloomForcedOff = false;
        const preset = g._resolvedGraphicsPreset;
        const bloomOn = preset === 'high' || (preset === 'medium');
        g._useBloom = bloomOn;
        if (g.bloomPass) g.bloomPass.enabled = bloomOn;
    }

    g._perfTier = tier;
    g.environment?.setPerfTier?.(tier);
}
