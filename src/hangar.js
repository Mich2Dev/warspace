/**
 * Hangar de naves — lista, vista previa 3D, compra y equipado.
 */

import { toggleModal, openModal, closeModal as closeUiModal } from './ui/UiAnimator.js';
import { HangarPreview } from './ui/HangarPreview.js';
import { PLAYER_SHIPS, getShipById } from './ships/playerShipCatalog.js';
import {
    getActiveShipId,
    getOwnedShipIds,
    isShipOwned,
    ownShip,
    setActiveShipId,
    saveProfile,
} from './profile.js';
let _preview = null;
let _selectedId = null;
let _player = null;

export function initHangar(player) {
    _player = player;
    _selectedId = getActiveShipId();

    const canvas = document.getElementById('hangar-preview-canvas');
    if (canvas) _preview = new HangarPreview(canvas);

    window.toggleHangar = toggleHangar;
    window.hangarBuyShip = buySelectedShip;
    window.hangarEquipShip = equipSelectedShip;

    refreshHangarPanel();
}

export function closeHangar() {
    _preview?.stop();
    closeUiModal(document.getElementById('hangar-modal'));
}

export function toggleHangar() {
    const modal = document.getElementById('hangar-modal');
    if (!modal) return;
    const opening = !modal.classList.contains('modal-open') && modal.style.display !== 'flex';
    if (opening) {
        _selectedId = getActiveShipId();
        refreshHangarPanel();
        openModal(modal);
        _preview?.resize();
        _preview?.start();
    } else {
        _preview?.stop();
        toggleModal(modal);
    }
}

export function refreshHangarPanel() {
    if (!_player) return;
    renderShipList();
    renderShipDetail();
    _preview?.showShip(_selectedId || getActiveShipId());
}

function renderShipList() {
    const root = document.getElementById('hangar-ship-list');
    if (!root) return;
    root.innerHTML = '';

    const active = getActiveShipId();
    const owned = new Set(getOwnedShipIds());

    PLAYER_SHIPS.forEach((ship) => {
        const isOwned = owned.has(ship.id) || ship.starter;
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'inv-slot' +
            (_selectedId === ship.id ? ' active' : '') +
            (active === ship.id ? ' equipped' : '') +
            (!isOwned ? ' locked' : '');
        row.innerHTML = `
            <div class="slot-type">${ship.tag || 'Nave'}</div>
            <div class="slot-name">${ship.name}</div>
            ${!isOwned ? `<div class="slot-req">${ship.price.toLocaleString()} CR · Nv.${ship.minLevel}</div>` : ''}
            ${active === ship.id ? '<div class="slot-badge">ACTIVA</div>' : ''}
        `;
        row.addEventListener('click', () => {
            _selectedId = ship.id;
            refreshHangarPanel();
        });
        root.appendChild(row);
    });
}

function renderShipDetail() {
    const panel = document.getElementById('hangar-ship-info');
    if (!panel || !_selectedId) return;

    const ship = getShipById(_selectedId);
    const owned = isShipOwned(ship.id);
    const active = getActiveShipId() === ship.id;
    const canAfford = _player.credits >= ship.price;
    const levelOk = _player.level >= ship.minLevel;
    const statsHtml = (ship.stats || [])
        .map((s) => `<div class="upgrade-row"><span>${s.label}</span><span class="up-new">${s.value}</span></div>`)
        .join('');

    panel.innerHTML = `
        <h3 class="hangar-ship-title">${ship.name}</h3>
        <p class="hangar-ship-desc">${ship.description}</p>
        <div class="stat-upgrade-block">
            <div class="upgrade-title">PERFIL</div>
            ${statsHtml}
        </div>
        <div class="hangar-ship-actions">
            ${
                !owned
                    ? `<button class="upgrade-btn" id="hangar-action-btn" ${canAfford && levelOk ? '' : 'disabled'}>
                        Comprar · ${ship.price.toLocaleString()} CR
                       </button>
                       ${!levelOk ? `<p class="hangar-hint">Requiere nivel ${ship.minLevel}</p>` : ''}
                       ${levelOk && !canAfford ? `<p class="hangar-hint">Créditos insuficientes</p>` : ''}`
                    : active
                        ? `<button class="upgrade-btn" disabled>Nave activa</button>`
                        : `<button class="upgrade-btn" id="hangar-action-btn">Equipar nave</button>`
            }
        </div>
    `;

    document.getElementById('hangar-action-btn')?.addEventListener('click', () => {
        if (!owned) buySelectedShip();
        else if (!active) equipSelectedShip();
    });
}

function buySelectedShip() {
    const ship = getShipById(_selectedId);
    if (!ship || isShipOwned(ship.id)) return;
    if (_player.level < ship.minLevel) return;
    if (!_player.spendCredits(ship.price)) return;

    ownShip(ship.id);
    setActiveShipId(ship.id);
    _player.equipShipHull(ship.id);
    saveProfile();

    const log = document.getElementById('log-text');
    if (log) log.textContent = `Nave adquirida: ${ship.name}`;

    refreshHangarPanel();
}

function equipSelectedShip() {
    const ship = getShipById(_selectedId);
    if (!ship || !isShipOwned(ship.id)) return;
    if (getActiveShipId() === ship.id) return;

    setActiveShipId(ship.id);
    _player.equipShipHull(ship.id);
    saveProfile();
    refreshHangarPanel();
}
