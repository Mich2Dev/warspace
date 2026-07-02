/**
 * WarSpace — Upgrade Panel
 * Renders and manages the ship upgrade shop.
 * Call initUpgrades(player) once, then toggleUpgrades() / refreshUpgradePanel().
 */

import { toggleModal } from './ui/UiAnimator.js';

let _player = null;

const UPGRADE_DEFS = [
    {
        key: 'damage',
        code: 'DMG',
        name: 'Daño de cañón',
        desc: '+30% daño por nivel',
        maxTiers: 3,
    },
    {
        key: 'fireRate',
        code: 'ROF',
        name: 'Cadencia',
        desc: 'Disparo 20% más rápido por nivel',
        maxTiers: 3,
    },
    {
        key: 'speed',
        code: 'VEL',
        name: 'Velocidad',
        desc: '+20% velocidad máxima por nivel',
        maxTiers: 3,
    },
    {
        key: 'maxHp',
        code: 'HP',
        name: 'Blindaje',
        desc: '+75 HP máximo por nivel · cura parcial',
        maxTiers: 3,
    },
    {
        key: 'energyRegen',
        code: 'ENR',
        name: 'Celda de energía',
        desc: '+30% regeneración de energía por nivel',
        maxTiers: 3,
    },
    {
        key: 'missiles',
        code: 'MSL',
        name: 'Misiles',
        desc: '-25% enfriamiento por nivel',
        maxTiers: 2,
    },
    {
        key: 'earnings',
        code: 'CR',
        name: 'Modificador de créditos',
        desc: '+20% créditos por bajas por nivel',
        maxTiers: 2,
    },
];
export function initUpgrades(player) {
    _player = player;
    _buildGrid();

    document.getElementById('close-upgrades')?.addEventListener('click', () => toggleUpgrades());

    // Keyboard shortcut U
    window.addEventListener('keydown', e => {
        if (e.key.toLowerCase() === 'u') toggleUpgrades();
    });

    // Global refresh hook
    window.refreshUpgradePanel = refreshUpgradePanel;
}

export function toggleUpgrades() {
    const modal = document.getElementById('upgrades-modal');
    if (!modal) return;
    if (!modal.classList.contains('modal-open') && modal.style.display !== 'flex') {
        refreshUpgradePanel();
    }
    toggleModal(modal);
}

export function refreshUpgradePanel() {
    if (!_player) return;
    // Update wallet display
    const wallet = document.getElementById('upgrades-credits');
    if (wallet) wallet.textContent = _player.credits.toLocaleString();
    // Refresh each card button
    UPGRADE_DEFS.forEach(def => _refreshCard(def));
}

function _buildGrid() {
    const grid = document.getElementById('upgrades-grid');
    if (!grid) return;
    grid.innerHTML = '';
    UPGRADE_DEFS.forEach(def => {
        const card = _createCard(def);
        grid.appendChild(card);
    });
}

function _createCard(def) {
    const card = document.createElement('div');
    card.className = 'upgrade-row-item';
    card.id = `ucard-${def.key}`;

    card.innerHTML = `
        <div class="upgrade-row-main">
            <span class="upgrade-row-code">${def.code}</span>
            <div class="upgrade-row-info">
                <span class="upgrade-row-name">${def.name}</span>
                <span class="upgrade-row-desc">${def.desc}</span>
            </div>
        </div>
        <div class="upgrade-row-meta">
            <span class="upgrade-row-tier" id="utier-${def.key}">0 / ${def.maxTiers}</span>
            <button class="upgrade-buy-btn" id="ubtn-${def.key}" onclick="window._buyUpgrade('${def.key}')">
                —
            </button>
        </div>
    `;
    return card;
}
function _refreshCard(def) {
    if (!_player) return;
    const tier    = _player.upgrades[def.key] ?? 0;
    const costs   = _player.UPGRADE_COSTS[def.key] ?? [];
    const maxed   = tier >= costs.length;
    const cost    = maxed ? 0 : costs[tier];
    const canAfford = _player.credits >= cost;

    // Tier label
    const tierEl = document.getElementById(`utier-${def.key}`);
    if (tierEl) tierEl.textContent = `${tier} / ${def.maxTiers}`;

    // Button
    const btn = document.getElementById(`ubtn-${def.key}`);
    if (!btn) return;

    if (maxed) {
        btn.textContent = 'Máximo';
        btn.className = 'upgrade-buy-btn maxed';
        btn.disabled = true;
    } else if (!canAfford) {
        btn.textContent = `${cost.toLocaleString()} CR`;
        btn.className = 'upgrade-buy-btn cant-afford';
        btn.disabled = true;
    } else {
        btn.textContent = `${cost.toLocaleString()} CR`;
        btn.className = 'upgrade-buy-btn';
        btn.disabled = false;
    }
}
// Global buy function called from onclick
window._buyUpgrade = function(key) {
    if (!_player) return;
    const success = _player.buyUpgrade(key);
    if (success) {
        _flashCard(key);
        refreshUpgradePanel();
        // Log purchase
        const def = UPGRADE_DEFS.find(d => d.key === key);
        const logText = document.getElementById('log-text');
        if (logText && def) {
            const tier = _player.upgrades[key];
            logText.innerHTML = `<span style="color:#c8d4dc;font-weight:600;">${def.name} · nivel ${tier}</span>`;
        }    }
};

function _flashCard(key) {
    const card = document.getElementById(`ucard-${key}`);
    if (!card) return;
    card.classList.add('upgrade-row-flash');
    setTimeout(() => card.classList.remove('upgrade-row-flash'), 420);
}