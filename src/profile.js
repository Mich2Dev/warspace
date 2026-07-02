import { toggleModal, openModal, closeModal } from './ui/UiAnimator.js';

const STORAGE_KEY = 'warspace_pilot_profile_v1';

const RANKS = [
    { id: 'recluta', label: 'Recluta', minEvents: 0 },
    { id: 'piloto', label: 'Piloto', minEvents: 3 },
    { id: 'veterano', label: 'Veterano', minEvents: 8 },
    { id: 'comandante', label: 'Comandante', minEvents: 15 },
];

const DEFAULT_PROFILE = {
    callsign: 'Piloto',
    role: 'operador',
    createdAt: Date.now(),
    stats: {
        eventsCompleted: 0,
        eventsFailed: 0,
        missionsCompleted: 0,
    },
    wallet: {
        credits: 0,
        parts: {},
    },
    ships: {
        owned: ['misilera'],
        active: 'misilera',
    },
    prefs: {
        /** Si true, el radar puede marcar contratos listos (nunca auto-inicia). */
        radarOffers: true,
        /** Solo rol dev: atajos K/L/M para probar eventos. */
        devShortcuts: false,
    },
};

let profile = null;
let playerRef = null;
let walletSaveTimer = null;

function cloneDefault() {
    return JSON.parse(JSON.stringify(DEFAULT_PROFILE));
}

export function loadProfile() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const base = cloneDefault();
        if (raw) {
            const parsed = JSON.parse(raw);
            profile = {
                ...base,
                ...parsed,
                stats: { ...base.stats, ...(parsed.stats || {}) },
                prefs: { ...base.prefs, ...(parsed.prefs || {}) },
                wallet: {
                    ...base.wallet,
                    ...(parsed.wallet || {}),
                    parts: { ...(parsed.wallet?.parts || {}) },
                },
                ships: {
                    ...base.ships,
                    ...(parsed.ships || {}),
                    owned: [...(parsed.ships?.owned || base.ships.owned)],
                },
            };
        } else {
            profile = base;
        }
    } catch {
        profile = cloneDefault();
    }
    return profile;
}

export function getProfile() {
    if (!profile) loadProfile();
    return profile;
}

export function saveProfile() {
    if (!profile) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    updateProfileHud();
}

export function getRankLabel() {
    const p = getProfile();
    const events = p.stats.eventsCompleted || 0;
    let rank = RANKS[0];
    for (const r of RANKS) {
        if (events >= r.minEvents) rank = r;
    }
    return rank.label;
}

export function recordEventResult(success) {
    const p = getProfile();
    if (success) p.stats.eventsCompleted += 1;
    else p.stats.eventsFailed += 1;
    saveProfile();
}

export function recordMissionComplete() {
    getProfile().stats.missionsCompleted += 1;
    saveProfile();
}

export function updateProfileHud() {
    const p = getProfile();
    const chip = document.getElementById('pilot-profile-chip');
    if (chip) {
        chip.dataset.role = p.role;
        const nameEl = document.getElementById('pilot-callsign');
        const rankEl = document.getElementById('pilot-rank');
        if (nameEl) nameEl.textContent = p.callsign || 'Piloto';
        if (rankEl) rankEl.textContent = getRankLabel();
    }
}

function _fillProfileForm() {
    const p = getProfile();
    const callsign = document.getElementById('profile-callsign-input');
    const role = document.getElementById('profile-role-select');
    const radar = document.getElementById('profile-radar-offers');
    const statsEl = document.getElementById('profile-stats-text');
    if (callsign) callsign.value = p.callsign || '';
    if (role) role.value = p.role || 'operador';
    if (radar) radar.checked = p.prefs.radarOffers !== false;
    if (statsEl) {
        statsEl.textContent = `Eventos: ${p.stats.eventsCompleted} · Fallos: ${p.stats.eventsFailed} · Misiones: ${p.stats.missionsCompleted}`;
    }
}

export function openProfileModal() {
    _fillProfileForm();
    openModal(document.getElementById('profile-modal'));
}

export function closeProfileModal() {
    closeModal(document.getElementById('profile-modal'));
}

export function toggleProfileModal() {
    const modal = document.getElementById('profile-modal');
    if (!modal) return;
    toggleModal(modal);
}

export function saveProfileFromForm() {
    const p = getProfile();
    const callsign = document.getElementById('profile-callsign-input');
    const role = document.getElementById('profile-role-select');
    const radar = document.getElementById('profile-radar-offers');
    if (callsign) p.callsign = (callsign.value || 'Piloto').trim().slice(0, 18);
    if (role) p.role = role.value;
    if (radar) p.prefs.radarOffers = radar.checked;
    p.prefs.devShortcuts = p.role === 'dev';
    saveProfile();
    closeProfileModal();
    const log = document.getElementById('log-text');
    if (log) log.textContent = `Perfil actualizado — ${p.callsign} (${getRankLabel()})`;
}

export function syncWalletFromPlayer(player) {
    if (!player) return;
    const p = getProfile();
    if (!p.wallet) p.wallet = { credits: 0, parts: {} };
    p.wallet.credits = player.credits || 0;
    p.wallet.parts = { ...(player.parts || {}) };
    saveProfile();
}

export function scheduleWalletSave(player) {
    if (!player) return;
    if (walletSaveTimer) clearTimeout(walletSaveTimer);
    walletSaveTimer = setTimeout(() => syncWalletFromPlayer(player), 1200);
}

function applyWalletToPlayer(player) {
    const p = getProfile();
    if (!p.wallet) p.wallet = { credits: 0, parts: {} };
    player.credits = p.wallet.credits || 0;
    player.parts = { ...(p.wallet.parts || {}) };
    if (typeof player._updateCreditsUI === 'function') player._updateCreditsUI();
    if (typeof window.refreshCraftPanel === 'function') window.refreshCraftPanel();
}

export function initProfile(player) {
    playerRef = player;
    loadProfile();
    applyWalletToPlayer(player);
    updateProfileHud();

    document.getElementById('profile-save-btn')?.addEventListener('click', saveProfileFromForm);
    document.getElementById('close-profile')?.addEventListener('click', closeProfileModal);
    document.getElementById('pilot-profile-chip')?.addEventListener('click', openProfileModal);

    if (!localStorage.getItem(STORAGE_KEY)) {
        setTimeout(openProfileModal, 800);
    }
}

import { getShipById } from './ships/playerShipCatalog.js';

export function isDevRole() {
    return getProfile().role === 'dev';
}

export function getOwnedShipIds() {
    const p = getProfile();
    const owned = p.ships?.owned || ['misilera'];
    if (!owned.includes('misilera')) owned.unshift('misilera');
    return [...new Set(owned)];
}

export function getActiveShipId() {
    const p = getProfile();
    const active = p.ships?.active || 'misilera';
    const owned = getOwnedShipIds();
    return owned.includes(active) ? active : 'misilera';
}

export function isShipOwned(shipId) {
    if (getShipById(shipId)?.starter) return true;
    return getOwnedShipIds().includes(shipId);
}

export function ownShip(shipId) {
    const p = getProfile();
    if (!p.ships) p.ships = { owned: ['misilera'], active: 'misilera' };
    if (!p.ships.owned.includes(shipId)) p.ships.owned.push(shipId);
}

export function setActiveShipId(shipId) {
    const p = getProfile();
    if (!p.ships) p.ships = { owned: ['misilera'], active: 'misilera' };
    if (isShipOwned(shipId)) p.ships.active = shipId;
}

export function applyShipProfileToPlayer(player) {
    if (!player) return;
    player.activeShipId = getActiveShipId();
    player.ownedShipIds = getOwnedShipIds();
    if (typeof player.equipShipHull === 'function') {
        player.equipShipHull(player.activeShipId, { silent: true, force: true });
    }
}
