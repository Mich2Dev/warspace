import recipesData from '../data/recipes.json';
import {
    buildSlotStats,
    planetComponentCap,
    applyEquipmentToPlayer,
} from './balance.js';
import { toggleModal } from './ui/UiAnimator.js';

let _player = null;

export function initCraft(player) {
    _player = player;
    window.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'c' && !e.repeat && e.target.tagName !== 'INPUT') toggleCraft();
    });
    document.getElementById('close-craft')?.addEventListener('click', toggleCraft);
    window.refreshCraftPanel = refreshCraftPanel;
    window.craftBuild = craftBuild;
    refreshCraftPanel();
}

export function toggleCraft() {
    const modal = document.getElementById('craft-modal');
    if (!modal) return;
    if (!modal.classList.contains('modal-open') && modal.style.display !== 'flex') {
        refreshCraftPanel();
    }
    toggleModal(modal);
}

export function refreshCraftPanel() {
    if (!_player) return;
    const wallet = document.getElementById('craft-credits');
    if (wallet) wallet.textContent = _player.credits.toLocaleString();

    const partsEl = document.getElementById('craft-parts-list');
    if (partsEl) {
        const entries = Object.entries(_player.parts || {}).filter(([, q]) => q > 0);
        partsEl.innerHTML = entries.length
            ? entries.map(([id, q]) => `<span class="craft-part-chip">${_player.getPartLabel(id)} ×${q}</span>`).join('')
            : '<span class="craft-empty">Sin piezas — elimina patrullas y enemigos de zona.</span>';
    }

    const grid = document.getElementById('craft-recipes-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const cap = planetComponentCap(_player.planetId || 'planet_01');

    recipesData.recipes.forEach((recipe) => {
        grid.appendChild(createRecipeCard(recipe, cap));
    });
}

function createRecipeCard(recipe, cap) {
    const card = document.createElement('div');
    card.className = 'shop-item-card craft-recipe-card';

    const blocked = recipe.level > cap;
    const { canCraft, missing } = _player.canCraft(recipe);
    const partsLine = Object.entries(recipe.parts)
        .map(([p, n]) => `${_player.getPartLabel(p)} ×${n}`)
        .join(' · ');

    card.innerHTML = `
        <div class="shop-item-head">
            <span class="shop-item-name">${recipe.name}</span>
            <span class="shop-item-rarity">MK-${recipe.level}</span>
        </div>
        <div class="shop-item-meta">${recipe.slot.toUpperCase()} · ${recipe.manufacturer}</div>
        <div class="shop-item-desc">${recipe.description}</div>
        <div class="shop-item-stats">Piezas: ${partsLine}<br>Coste: ◈ ${recipe.crCost} CR</div>
        <div class="shop-item-actions">
            ${
                blocked
                    ? `<button class="shop-btn disabled" disabled>CAP PLANETA: LVL ${cap}</button>`
                    : canCraft
                        ? `<button class="shop-btn equip" onclick="window.craftBuild('${recipe.id}')">ENSAMBLAR</button>`
                        : `<button class="shop-btn disabled" disabled>FALTA: ${missing}</button>`
            }
        </div>
    `;
    return card;
}

function craftBuild(recipeId) {
    if (!_player) return;
    const ok = _player.craftComponent(recipeId);
    if (ok) refreshCraftPanel();
}

export function getRecipeById(id) {
    return recipesData.recipes.find((r) => r.id === id) || null;
}

export function buildEquipmentFromRecipe(recipe) {
    return {
        id: recipe.id,
        name: recipe.name,
        type: recipe.slot,
        level: recipe.level,
        rarity: recipe.level >= 3 ? 'uncommon' : 'common',
        manufacturer: recipe.manufacturer,
        description: recipe.description,
        stats: buildSlotStats(recipe.slot, recipe.level, recipe.level >= 3 ? 'uncommon' : 'common'),
        crafted: true,
    };
}

export { recipesData };
