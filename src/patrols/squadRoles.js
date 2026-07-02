/** Roles de escuadrón — colores, formación tren, habilidades. */

export const SQUAD_ROLES = {
    squad_commander: {
        label: 'Comandante',
        hpMult: 1.35,
        speedMult: 0.92,
        damageMult: 0.9,
        aggroMult: 1.2,
        attackDistMult: 1.55,
        engageMult: 1.45,
        engageDuration: 26,
        ability: 'paralyze_pulse',
        paralyzeRange: 680,
        paralyzeCooldown: 7.5,
        paralyzeDuration: 3.8,
        slowMult: 0.32,
        abilityDesc: 'Comandante — pulso iónico que relentiza tu nave',
        strategyTip: 'Mata al comandante dorado primero o no podrás esquivar la cola del tren.',
        lootTable: 'role_border',
    },
    squad_escort: {
        label: 'Escolta',
        hpMult: 1.2,
        speedMult: 1.08,
        damageMult: 1.18,
        aggroMult: 1.3,
        attackDistMult: 1.45,
        engageMult: 1.55,
        engageDuration: 22,
        ability: 'squad_escort',
        fireRateMult: 0.68,
        suppressionDamageMult: 1.12,
        abilityDesc: 'Escolta — fuego de supresión en flanco, protege al comandante',
        strategyTip: 'Elimina escoltas para despejar el flanco; el comandante relentiza tu nave.',
        lootTable: 'patrol_bonus',
    },
    squad_missile: {
        label: 'Misilero de Patrulla',
        hpMult: 0.95,
        speedMult: 0.88,
        damageMult: 1.0,
        aggroMult: 1.1,
        attackDistMult: 1.5,
        engageMult: 1.35,
        engageDuration: 22,
        ability: 'missile_salvo',
        extraAbilities: ['missile_salvo'],
        missileCooldown: 18,
        missileRange: 2200,
        abilityDesc: 'Misilero — cola del tren, lanza misiles guiados',
        strategyTip: 'Quédate móvil; el naranja dispara desde la retaguardia.',
        lootTable: 'patrol_bonus',
    },
};

/** Offset en formación V (x lateral, z atrás respecto al líder). */
export const TRAIN_FORMATION = {
    0: { x: 0, z: 0, label: 'Comandante' },
    1: { x: -170, z: -240, label: 'Escolta Izq' },
    2: { x: 170, z: -240, label: 'Escolta Der' },
};

/** Fila india — distancias compactas (droides pegados al tren). */
export const COLUMN_FORMATION = {
    0: { x: 0, z: 0, label: 'Líder' },
    1: { x: 0, z: -68, label: 'Escolta' },
    2: { x: 0, z: -118, label: 'Droid 1' },
    3: { x: 0, z: -168, label: 'Droid 2' },
};

/** Distancia en el rastro del líder por slot. */
export const COLUMN_TRAIL_DIST = {
    0: 0,
    1: 68,
    2: 118,
    3: 168,
};

/** Escala offsets según tamaño del líder del tren. */
export function getFormationOffset(slotIndex, boxSize = 56, formation = 'column') {
    const table = formation === 'v' ? TRAIN_FORMATION : COLUMN_FORMATION;
    const base = table[slotIndex] || { x: 0, z: -92 * Math.max(1, slotIndex) };
    const scale = Math.max(0.95, boxSize / 56);
    return { x: base.x * scale, z: base.z * scale };
}

export function getTrailFollowDistance(slotIndex, boxSize = 56) {
    const base = COLUMN_TRAIL_DIST[slotIndex] ?? slotIndex * 92;
    return base * Math.max(0.95, boxSize / 56);
}

/** Identificación — comandante usa GLB dedicado; escolta/misilero tintan el GLB de zona. */
export const SQUAD_VISUAL = {
    squad_commander: {
        preserveOriginal: true,
        scale: 1.05,
        minimapClass: 'minimap-squad-cmd',
        nameTagColor: '#ffdd66',
    },
    squad_escort: {
        preserveOriginal: true,
        scale: 1.0,
        minimapClass: 'minimap-squad-escort',
        nameTagColor: '#aaccff',
    },
    squad_missile: {
        tint: 0xff7744,
        emissive: 0xcc3300,
        tintStrength: 0.28,
        scale: 1.0,
        minimapClass: 'minimap-squad-missile',
        nameTagColor: '#ff8844',
    },
};

export function getSquadRoleConfig(roleKey) {
    return SQUAD_ROLES[roleKey] || null;
}

export function mergeSquadRoleIntoEnemy(enemy, roleKey) {
    const role = getSquadRoleConfig(roleKey);
    if (!role || !enemy?.userData) return;
    enemy.userData.patrolRole = roleKey;
    enemy.userData.roleConfig = role;
    enemy.userData.maxHp = Math.round(enemy.userData.maxHp * role.hpMult);
    enemy.userData.hp = enemy.userData.maxHp;
    enemy.userData.maxSpeed = enemy.userData.maxSpeed * role.speedMult;
    enemy.userData.damageMult = role.damageMult ?? 1;
    enemy.userData.aggroMult = role.aggroMult ?? 1;
    enemy.userData.attackDistMult = role.attackDistMult ?? 1;
    enemy.userData.engageMult = role.engageMult ?? 1.5;
    enemy.userData.engageDuration = role.engageDuration ?? 20;
    if (role.extraAbilities?.includes('missile_salvo') || role.ability === 'missile_salvo') {
        enemy.userData.missileCooldown = role.missileCooldown ?? 14;
        enemy.userData.missileRange = role.missileRange ?? 2400;
        enemy.userData.nextMissileAt = 0;
    }
    if (role.ability === 'squad_escort') {
        enemy.userData.damageMult = (enemy.userData.damageMult ?? 1) * (role.suppressionDamageMult ?? 1.1);
    }
}
