/**
 * Carga de nave — inventario + mercado unificado.
 */

import {
    getExpandedCatalog,
    getItemById,
    getSlotMeta,
    ARMORY_SLOTS,
} from './itemCatalog.js';
import recipesData from '../data/recipes.json';
import { planetComponentCap } from './balance.js';
import { toggleModal } from './ui/UiAnimator.js';

let _player = null;
let _filter = 'all';
let _selectedId = null;

const FILTERS = [
    { id: 'all', label: 'Todo' },
    { id: 'weapon', label: 'Armas' },
    { id: 'missile', label: 'Misiles' },
    { id: 'shield', label: 'Escudos' },
    { id: 'engine', label: 'Motores' },
    { id: 'hull', label: 'Cascos' },
    { id: 'craft', label: 'Ensamble' },
];

export function initArmory(player) {
    _player = player;

    document.getElementById('close-armory')?.addEventListener('click', toggleArmory);

    document.querySelectorAll('[data-armory-filter]').forEach((btn) => {
        btn.addEventListener('click', () => setFilter(btn.getAttribute('data-armory-filter')));
    });

    window.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        if (k === 'i' || k === 'b') toggleArmory();
    });

    window.toggleArmory = toggleArmory;
    window.refreshArmoryPanel = refreshArmoryPanel;
    window.armoryBuyItem = buyItem;
    window.armoryEquipItem = equipItem;
    window.armorySellItem = sellItem;
    window.armoryCraftBuild = craftBuild;

    refreshArmoryPanel();
}

export function toggleArmory() {
    const modal = document.getElementById('armory-modal');
    if (!modal) return;
    if (!modal.classList.contains('modal-open') && modal.style.display !== 'flex') {
        refreshArmoryPanel();
    }
    toggleModal(modal);
}

export function refreshArmoryPanel() {
    if (!_player) return;

    const wallet = document.getElementById('armory-credits');
    if (wallet) wallet.textContent = _player.credits.toLocaleString();

    renderLoadout();
    renderFilters();
    renderCatalog();
    renderDetail();
    renderPartsBar();
}

function setFilter(id) {
    _filter = id;
    _selectedId = null;
    refreshArmoryPanel();
}

function renderFilters() {
    document.querySelectorAll('[data-armory-filter]').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-armory-filter') === _filter);
    });
}

function renderLoadout() {
    const root = document.getElementById('armory-loadout');
    if (!root) return;
    root.innerHTML = '';

    ARMORY_SLOTS.forEach((slot) => {
        const eq = _player.equipment[slot];
        const meta = getSlotMeta(slot);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `armory-slot${eq ? ' filled' : ''}${_filter === slot ? ' active-filter' : ''}`;
        row.innerHTML = `
            <span class="armory-slot-code">${meta.code}</span>
            <span class="armory-slot-info">
                <span class="armory-slot-label">${meta.label}</span>
                <span class="armory-slot-item">${eq ? `${eq.name}` : 'Vacío'}</span>
            </span>
            <span class="armory-slot-mk">${eq?.level ? `MK-${eq.level}` : '—'}</span>
        `;
        row.addEventListener('click', () => {
            setFilter(slot);
            if (eq) _selectedId = eq.id;
            refreshArmoryPanel();
        });
        root.appendChild(row);
    });
}

function renderPartsBar() {
    const el = document.getElementById('armory-parts-list');
    if (!el) return;
    const entries = Object.entries(_player.parts || {}).filter(([, q]) => q > 0);
    el.innerHTML = entries.length
        ? entries.map(([id, q]) => `<span class="armory-part-chip">${_player.getPartLabel(id)} ×${q}</span>`).join('')
        : '<span class="armory-part-empty">Sin piezas de campo</span>';
}

function getVisibleItems() {
    if (_filter === 'craft') return [];
    let items = getExpandedCatalog();
    if (_filter !== 'all') items = items.filter((i) => i.slot === _filter);
    return items.sort((a, b) => {
        if (a.slot !== b.slot) return a.slot.localeCompare(b.slot);
        if (a.level !== b.level) return a.level - b.level;
        return a.name.localeCompare(b.name);
    });
}

function renderCatalog() {
    const list = document.getElementById('armory-catalog');
    if (!list) return;
    list.innerHTML = '';

    if (_filter === 'craft') {
        renderCraftList(list);
        return;
    }

    const items = getVisibleItems();
    let lastSlot = null;

    items.forEach((item) => {
        if (item.slot !== lastSlot) {
            lastSlot = item.slot;
            const head = document.createElement('div');
            head.className = 'armory-catalog-section';
            head.textContent = getSlotMeta(item.slot).label.toUpperCase();
            list.appendChild(head);
        }

        const owned = _player.hasItem(item.id);
        const equipped = _player.isItemEquipped(item.id);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'armory-catalog-row' +
            (owned ? ' owned' : '') +
            (equipped ? ' equipped' : '') +
            (_selectedId === item.id ? ' selected' : '');
        row.dataset.itemId = item.id;

        const meta = getSlotMeta(item.slot);
        row.innerHTML = `
            <span class="armory-row-code">${meta.code}</span>
            <span class="armory-row-mk">MK-${item.level}</span>
            <span class="armory-row-name">${item.name.replace(/ MK-\d+$/, '')}</span>
            <span class="armory-row-status">${equipped ? 'EQP' : owned ? 'INV' : `${item.price.toLocaleString()} CR`}</span>
        `;
        row.addEventListener('click', () => {
            _selectedId = item.id;
            refreshArmoryPanel();
        });
        list.appendChild(row);
    });
}

function renderCraftList(list) {
    const cap = planetComponentCap(_player.planetId || 'planet_01');
    recipesData.recipes.forEach((recipe) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'armory-catalog-row craft' + (_selectedId === recipe.id ? ' selected' : '');
        const { canCraft } = _player.canCraft(recipe);
        const blocked = recipe.level > cap;
        row.innerHTML = `
            <span class="armory-row-code">${getSlotMeta(recipe.slot).code}</span>
            <span class="armory-row-mk">MK-${recipe.level}</span>
            <span class="armory-row-name">${recipe.name}</span>
            <span class="armory-row-status">${blocked ? 'BLOQ' : canCraft ? 'LISTO' : 'PIEZAS'}</span>
        `;
        row.addEventListener('click', () => {
            _selectedId = recipe.id;
            refreshArmoryPanel();
        });
        list.appendChild(row);
    });
}

function statSummary(stats) {
    return Object.entries(stats)
        .map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').trim()}: ${v}`)
        .join(' · ');
}

function renderDetail() {
    const panel = document.getElementById('armory-detail');
    if (!panel) return;

    if (_filter === 'craft' && _selectedId) {
        renderCraftDetail(panel);
        return;
    }

    if (!_selectedId) {
        panel.innerHTML = `
            <div class="armory-detail-empty">
                <span class="armory-detail-code">SYS</span>
                <p>Selecciona un componente del catálogo para ver stats, comprar, equipar o vender.</p>
            </div>`;
        return;
    }

    const item = getItemById(_selectedId);
    if (!item) {
        panel.innerHTML = '';
        return;
    }

    const owned = _player.hasItem(item.id);
    const equipped = _player.isItemEquipped(item.id);
    const canAfford = _player.credits >= item.price;
    const sellValue = Math.round(item.price * 0.55);
    const meta = getSlotMeta(item.slot);

    panel.innerHTML = `
        <div class="armory-detail-head">
            <span class="armory-detail-code">${meta.code}</span>
            <div>
                <h3 class="armory-detail-name">${item.name}</h3>
                <p class="armory-detail-meta">${meta.label} · ${item.manufacturer} · ${item.rarity.toUpperCase()}</p>
            </div>
        </div>
        <p class="armory-detail-desc">${item.description}</p>
        <div class="armory-detail-stats">${statSummary(item.stats)}</div>
        <div class="armory-detail-actions">
            ${
                !owned
                    ? `<button class="armory-action primary" ${canAfford ? '' : 'disabled'} onclick="window.armoryBuyItem('${item.id}')">Comprar · ${item.price.toLocaleString()} CR</button>`
                    : equipped
                        ? `<button class="armory-action" disabled>Equipado</button>`
                        : `<button class="armory-action primary" onclick="window.armoryEquipItem('${item.id}')">Equipar</button>`
            }
            ${
                owned && !equipped
                    ? `<button class="armory-action" onclick="window.armorySellItem('${item.id}')">Vender · ${sellValue.toLocaleString()} CR</button>`
                    : ''
            }
        </div>
    `;
}

function renderCraftDetail(panel) {
    const recipe = recipesData.recipes.find((r) => r.id === _selectedId);
    if (!recipe) {
        panel.innerHTML = '<div class="armory-detail-empty"><p>Selecciona una receta de ensamble.</p></div>';
        return;
    }

    const cap = planetComponentCap(_player.planetId || 'planet_01');
    const blocked = recipe.level > cap;
    const { canCraft, missing } = _player.canCraft(recipe);
    const partsLine = Object.entries(recipe.parts)
        .map(([p, n]) => `${_player.getPartLabel(p)} ×${n}`)
        .join(' · ');

    panel.innerHTML = `
        <div class="armory-detail-head">
            <span class="armory-detail-code">${getSlotMeta(recipe.slot).code}</span>
            <div>
                <h3 class="armory-detail-name">${recipe.name}</h3>
                <p class="armory-detail-meta">Ensamble · ${recipe.manufacturer}</p>
            </div>
        </div>
        <p class="armory-detail-desc">${recipe.description}</p>
        <div class="armory-detail-stats">Piezas: ${partsLine}<br>Coste: ${recipe.crCost.toLocaleString()} CR</div>
        <div class="armory-detail-actions">
            ${
                blocked
                    ? `<button class="armory-action" disabled>Requiere planeta nivel ${recipe.level}</button>`
                    : canCraft
                        ? `<button class="armory-action primary" onclick="window.armoryCraftBuild('${recipe.id}')">Ensamblar</button>`
                        : `<button class="armory-action" disabled>Faltan: ${missing || 'piezas'}</button>`
            }
        </div>
    `;
}

function buyItem(itemId) {
    if (!_player?.buyItem(itemId)) return;
    _selectedId = itemId;
    refreshArmoryPanel();
}

function equipItem(itemId) {
    if (!_player?.equipItem(itemId)) return;
    _selectedId = itemId;
    refreshArmoryPanel();
}

function sellItem(itemId) {
    if (!_player?.sellItem(itemId)) return;
    refreshArmoryPanel();
}

function craftBuild(recipeId) {
    if (!_player?.craftComponent(recipeId)) return;
    _selectedId = recipeId;
    refreshArmoryPanel();
}

// Compatibilidad con módulos antiguos
export function toggleShop() { toggleArmory(); }
export function toggleInventory() { toggleArmory(); }
export function refreshShopPanel() { refreshArmoryPanel(); }
export const initShop = initArmory;
