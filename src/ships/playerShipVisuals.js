/**
 * Visual compartido de naves jugador — un solo lugar para tamaño, escudo y rotación.
 * Todas las naves heredan de CONFIG.VISUALS.PLAYER_SHIP; solo overrides opcionales por casco.
 */
import { CONFIG } from '../../config.js';

const SIZE_CLASS = {
    standard: { lengthMul: 1, shieldMul: 1, hoverHeight: 35 },
    support: { lengthMul: 1, shieldMul: 1.15, hoverHeight: 48 },
    heavy: { lengthMul: 1.32, shieldMul: 1.45, hoverHeight: 60 },
};

function shipVisualConfig() {
    return CONFIG.VISUALS.PLAYER_SHIP ?? {};
}

function resolveSizeClass(shipDef) {
    const cls = shipDef?.sizeClass;
    if (cls && SIZE_CLASS[cls]) return SIZE_CLASS[cls];
    return SIZE_CLASS.standard;
}

/** Longitud objetivo del casco en unidades mundo (fitPlayerShipModel). */
export function getPlayerShipTargetLength(shipDef = null) {
    const cfg = shipVisualConfig();
    const base = cfg.targetLength ?? 96;
    const cls = resolveSizeClass(shipDef);
    const perShip = shipDef?.lengthMul ?? 1;
    return base * cls.lengthMul * perShip;
}

/** Escala del escudo según tamaño del casco. */
export function getPlayerShipShieldScale(shipDef = null) {
    const cfg = shipVisualConfig();
    const base = cfg.shieldBase ?? 3.2;
    const cls = resolveSizeClass(shipDef);
    const lengthRatio = getPlayerShipTargetLength(shipDef) / (cfg.targetLength ?? 96);
    return base * cls.shieldMul * Math.max(0.85, lengthRatio);
}

export function getPlayerShipRotationY(shipDef = null) {
    if (shipDef?.rotationY != null) return shipDef.rotationY;
    return shipVisualConfig().rotationY ?? 0;
}

/** Altura de vuelo sugerida por clase (applyStats puede usarla). */
export function getPlayerShipHoverHeight(shipDef = null) {
    if (shipDef?.hoverHeight != null) return shipDef.hoverHeight;
    return resolveSizeClass(shipDef).hoverHeight;
}

/** Escala del casco procedural / fallback (placeholder sin GLB). */
export function getPlayerShipFallbackScale() {
    const cfg = shipVisualConfig();
    const legacy = CONFIG.VISUALS.PLAYER_SCALE ?? 4.8;
    return legacy * (cfg.fallbackScaleMul ?? 0.35);
}

export { SIZE_CLASS };
