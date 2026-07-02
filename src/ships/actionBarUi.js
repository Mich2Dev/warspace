/**
 * Barra de acción estándar — misma UI para todas las naves del piloto.
 * Las variantes de casco solo cambian stats/comportamiento (playerShipCatalog + PlayerCombat).
 */
export const ACTION_BAR_SLOTS = {
    slot1: { elementId: 'slot-cannon', name: 'CAÑÓN', symbol: '✦' },
    slot2: { elementId: 'slot-missile', name: 'MISILES', symbol: '◈' },
    slot3: { elementId: 'slot-repair', name: 'REPARAR', symbol: '✚' },
    slot4: { elementId: 'slot-shield', name: 'ESCUDO', symbol: '⬡' },
    nitro: { elementId: 'slot-nitro', name: 'TURBO', symbol: '▲' },
};

/** Aplica etiquetas fijas; `abilities` solo aporta type/id internos en dataset. */
export function applyStandardActionBarUi(abilities = {}) {
    const map = [
        ['slot1', ACTION_BAR_SLOTS.slot1],
        ['slot2', ACTION_BAR_SLOTS.slot2],
        ['slot3', ACTION_BAR_SLOTS.slot3],
        ['slot4', ACTION_BAR_SLOTS.slot4],
    ];

    for (const [key, ui] of map) {
        const el = document.getElementById(ui.elementId);
        const data = abilities[key];
        if (!el) continue;

        const nameEl = el.querySelector('.slot-name');
        const symbolEl = el.querySelector('.slot-symbol');
        if (nameEl) nameEl.textContent = ui.name;
        if (symbolEl) symbolEl.textContent = ui.symbol;

        if (data) {
            el.style.display = '';
            el.style.opacity = '1';
            el.style.pointerEvents = 'auto';
            el.dataset.abilityId = data.id || '';
            el.dataset.abilityType = data.type || '';
        } else {
            el.style.opacity = '0.35';
            el.style.pointerEvents = 'none';
            el.dataset.abilityId = '';
            el.dataset.abilityType = 'none';
        }
    }

    const nitro = ACTION_BAR_SLOTS.nitro;
    const nitroEl = document.getElementById(nitro.elementId);
    if (nitroEl) {
        const nameEl = nitroEl.querySelector('.slot-name');
        const symbolEl = nitroEl.querySelector('.slot-symbol');
        if (nameEl) nameEl.textContent = nitro.name;
        if (symbolEl) symbolEl.textContent = nitro.symbol;
    }
}
