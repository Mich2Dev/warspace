/** Estándar de nombres en pantalla — Title Case, español. */

import { getEffectiveAggroDist, getRoleConfig } from './enemyRoles.js';

export const NAME_TAG_COLOR = '#b8ccd8';
export const NAME_TAG_COLOR_HOSTILE = '#ff4444';

/** Nombre base por especie (unidades de colmena) — igual que archivos GLB. */
export const SPECIES_DISPLAY = {
    Zona1: 'E1',
    Zona2: 'E2',
    Zona3: 'E3',
    Invader_Alpha: 'Invasor Alfa',
    Invader_Beta: 'Invasor Beta',
    Invader_Gamma: 'Invasor Gamma',
};

/** Nombre de bases / spawners. */
export const BASE_DISPLAY = {
    Zona1Spawner: 'Base E1',
    Zona2Spawner: 'Base E2',
    Zona3Spawner: 'Base E3',
};

/** Roles de patrulla (claves en planet_01.json → nombre visible). */
export const PATROL_ROLE_NAMES = {
    patrol_mantis: 'E1',
    patrol_border: 'E1',
    ambush: 'E1',
    scavenger_roam: 'E2',
    disruptor: 'E2',
    heavy_escort: 'E3',
    squad_commander: 'Comandante',
    squad_escort: 'Escolta',
    squad_missile: 'Escolta',
};

/** Resuelve nombre visible — especie (E1/E2/E3) o rol de patrulla (Comandante/Escolta). */
export function resolveEnemyDisplayName(enemyType, roleKey = null, fallback = '') {
    if (roleKey === 'squad_commander') return 'Comandante';
    if (roleKey === 'squad_escort') return 'Escolta';
    if (SPECIES_DISPLAY[enemyType]) return SPECIES_DISPLAY[enemyType];
    if (BASE_DISPLAY[enemyType]) return BASE_DISPLAY[enemyType];
    if (fallback) return toDisplayName(fallback);
    return 'Hostil';
}

/** Etiqueta de rol para tooltip / log (no reemplaza el nombre de especie). */
export function getRoleDisplayLabel(roleKey) {
    if (!roleKey) return null;
    return PATROL_ROLE_NAMES[roleKey] || null;
}

/** Title Case simple para strings legacy. */
export function toDisplayName(raw) {
    if (!raw || typeof raw !== 'string') return 'Hostil';
    const lower = raw.trim().toLowerCase();
    const legacy = {
        'mantis de asalto': 'Mantis de Asalto',
        'carroñero elite': 'Carroñero Elite',
        'comandante pesado': 'Comandante Pesado',
        'patrulla mantis': 'Patrulla Mantis',
        'patrulla fronteriza': 'Patrulla Fronteriza',
        'carroñero suelto': 'Carroñero Suelto',
        'escolta pesada': 'Escolta Pesada',
        'zona 1 base': 'Base Mantis',
        'scavenger nest': 'Nido Carroñero',
        'command fortress': 'Fortaleza Comando',
        'invasor - alfa': 'Invasor Alfa',
        'invasor - beta': 'Invasor Beta',
        'invasor - gamma': 'Invasor Gamma',
    };
    if (legacy[lower]) return legacy[lower];
    return lower.replace(/\b[\p{L}]/gu, (c) => c.toUpperCase());
}

export function isEnemyHostileToPlayer(enemy, player, config) {
    if (!enemy?.userData?.isEnemy || enemy.userData.hp <= 0) return false;
    if (enemy.spawnType !== undefined || enemy.userData.type?.includes('Spawner')) return false;

    const time = Date.now() * 0.001;
    const dist = enemy.position.distanceTo(player.position);

    if (enemy.userData.forcedAggroUntil && time < enemy.userData.forcedAggroUntil) return true;

    const role = getRoleConfig(enemy.userData.patrolRole);
    if (role?.ability === 'ambush') {
        if (enemy.userData.ambushState === 'hidden') {
            return dist < (role.ambushTriggerDist ?? 480) * 0.92;
        }
        return true;
    }

    const aggroDist = getEffectiveAggroDist(enemy, config);
    if (!aggroDist) return false;
    return dist < aggroDist;
}
