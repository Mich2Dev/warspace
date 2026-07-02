/** Catálogo de cascos / naves del piloto (sistema_1). */

import { applyStandardActionBarUi } from './actionBarUi.js';
import { getPlayerShipHoverHeight } from './playerShipVisuals.js';

export const DEFAULT_SHIP_ID = 'misilera';

/**
 * abilities: variantes de combate por slot (1=cañón, 2=misiles, 3=reparar, 4=escudo).
 * La barra de acción siempre muestra CAÑÓN / MISILES / REPARAR / ESCUDO / TURBO.
 */
export const PLAYER_SHIPS = [
    {
        id: 'misilera',
        name: 'Misilera Shock',
        glb: '/models/player/sistema_1/misilera.glb',
        description: 'Nave inicial del piloto. Perfil ofensivo con misiles y maniobras rápidas.',
        starter: true,
        price: 0,
        minLevel: 1,
        tag: 'Inicial',
        stats: [
            { label: 'HP', value: '200' },
            { label: 'Daño', value: '5' },
            { label: 'Velocidad', value: '400' },
        ],
        abilities: {
            slot1: { id: 'canon_rapido', type: 'weapon' },
            slot2: { id: 'rafaga_misiles', type: 'missile' },
            slot3: { id: 'reparar_basico', type: 'repair' },
            slot4: { id: 'escudo_ligero', type: 'shield' },
        },
        sizeClass: 'standard',
        rotationY: 0,
        applyStats(player) {
            if (!player) return;
            player.hoverHeight = getPlayerShipHoverHeight(this);
        },
    },
    {
        id: 'medico',
        name: 'Sanitaria Médico',
        glb: '/models/player/sistema_1/medico.glb',
        description: 'Clase soporte. Mayor resistencia y sistemas de reparación reforzados.',
        starter: false,
        price: 3500,
        minLevel: 3,
        tag: 'Compra',
        stats: [
            { label: 'HP', value: '280' },
            { label: 'Daño', value: '4' },
            { label: 'Velocidad', value: '360' },
            { label: 'Reparación', value: '+40%' },
        ],
        abilities: {
            slot1: { id: 'canon_laser', type: 'weapon' },
            slot2: { id: 'misil_guidado', type: 'missile' },
            slot3: { id: 'reparar_area', type: 'repair' },
            slot4: { id: 'escudo_emergencia', type: 'shield' },
        },
        sizeClass: 'support',
        rotationY: 0,
        applyStats(player) {
            if (!player) return;
            player.maxHp = 280;
            player.hp = Math.min(player.hp, 280);
            if (player.equipment?.hull?.stats) player.equipment.hull.stats.maxHp = 280;
            if (player.equipment?.repair?.stats) {
                player.equipment.repair.stats.healAmount = Math.round((player.equipment.repair.stats.healAmount || 40) * 1.4);
            }
            player.hoverHeight = getPlayerShipHoverHeight(this);
        },
    },
    {
        id: 'tanque',
        name: 'Acorazado Tanque',
        glb: '/models/player/sistema_1/tanque.glb',
        description: 'Nave superpesada. Blindaje extremo y escudos reforzados, pero baja maniobrabilidad.',
        starter: false,
        price: 0,
        minLevel: 1,
        tag: 'Pesada',
        stats: [
            { label: 'HP', value: '500' },
            { label: 'Daño', value: '8' },
            { label: 'Velocidad', value: '300' },
            { label: 'Escudos', value: '+50%' },
        ],
        abilities: {
            slot1: { id: 'canon_pesado', type: 'weapon' },
            slot2: { id: 'misil_pesado', type: 'missile' },
            slot3: { id: 'reparar_blindaje', type: 'repair' },
            slot4: { id: 'escudo_fortaleza', type: 'shield' },
        },
        sizeClass: 'heavy',
        rotationY: Math.PI,
        applyStats(player) {
            if (!player) return;
            player.maxHp = 500;
            player.hp = Math.min(player.hp, 500);
            if (player.equipment?.hull?.stats) player.equipment.hull.stats.maxHp = 500;

            if (player.equipment?.shield?.stats) {
                player.equipment.shield.stats.shieldHp = Math.round((player.equipment.shield.stats.shieldHp || 100) * 1.5);
            }
            if (player.equipment?.engine?.stats) {
                player.equipment.engine.stats.speed = 300;
            }
            player.speed = 300;

            if (player.equipment?.weapon?.stats) {
                player.equipment.weapon.stats.damage = 8;
            }
            player.baseDamage = 8;

            player.hoverHeight = getPlayerShipHoverHeight(this);
        },
    },
];

export function getShipById(shipId) {
    return PLAYER_SHIPS.find((s) => s.id === shipId) || PLAYER_SHIPS[0];
}

export function getShipGlb(shipId) {
    return getShipById(shipId).glb;
}

/** Sincroniza HUD de habilidades con la barra estándar. */
export function syncShipActionBar(ship) {
    applyStandardActionBarUi(ship?.abilities);
}

/** @deprecated usar getShipGlb(activeShipId) */
export const PLAYER_SHIP_GLB = getShipGlb(DEFAULT_SHIP_ID);
