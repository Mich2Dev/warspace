/** Habilidades y modificadores por rol de patrulla (Planeta 1). */
import { SQUAD_ROLES } from './patrols/squadRoles.js';

export const ENEMY_ROLES = {
    patrol_mantis: {
        label: 'Patrulla Mantis',
        hpMult: 1.0,
        speedMult: 1.0,
        damageMult: 1.0,
        aggroMult: 1.15,
        attackDistMult: 1.0,
        engageMult: 1.65,
        engageDuration: 22,
        ability: 'standard_patrol',
        lootTable: 'patrol_bonus',
        strategyTip: 'Enjambre ligero — prioriza el que te fija primero para cortar la cadena.',
    },
    patrol_border: {
        label: 'Patrulla Fronteriza',
        hpMult: 1.28,
        speedMult: 0.86,
        damageMult: 0.95,
        aggroMult: 1.15,
        attackDistMult: 1.0,
        engageMult: 1.35,
        engageDuration: 26,
        ability: 'border_watch',
        alertRadius: 880,
        alertDuration: 18,
        abilityDesc: 'Vigía fronterizo — detecta desde lejos y alerta aliados',
        lootTable: 'role_border',
        strategyTip: 'Elimínalo antes de cruzar la frontera o traerá refuerzos.',
    },
    ambush: {
        label: 'Emboscada',
        hpMult: 0.88,
        speedMult: 1.0,
        damageMult: 1.0,
        aggroMult: 0.55,
        attackDistMult: 1.08,
        engageMult: 2.1,
        engageDuration: 18,
        ability: 'ambush',
        ambushTriggerDist: 520,
        ambushSpeedMult: 2.0,
        ambushDamageMult: 1.6,
        ambushDuration: 5.0,
        burstLog: '¡Emboscada! Burst ofensivo activado',
        lootTable: 'role_ambush',
        strategyTip: 'No entres en su radio oculto; provoca el burst y retrocede.',
    },
    scavenger_roam: {
        label: 'Carroñero Suelto',
        hpMult: 0.82,
        speedMult: 1.38,
        damageMult: 0.82,
        aggroMult: 1.25,
        attackDistMult: 0.95,
        engageMult: 1.5,
        engageDuration: 16,
        ability: 'hit_and_run',
        retreatHpPct: 0.38,
        abilityDesc: 'Hit-and-run — rápido, huye si pierde mucho HP',
        lootTable: 'role_scavenger',
        strategyTip: 'Presiona con cañón continuo; no dejes que regenere distancia.',
    },
    disruptor: {
        label: 'Disruptor',
        hpMult: 1.05,
        speedMult: 1.08,
        damageMult: 0.88,
        aggroMult: 1.35,
        attackDistMult: 1.05,
        engageMult: 1.6,
        engageDuration: 24,
        ability: 'disruptor_jam',
        extraAbilities: ['missile_salvo'],
        jamRadius: 620,
        jamStrength: 0.32,
        missileCooldown: 9,
        missileRange: 2400,
        abilityDesc: 'Disruptor — jam de misiles + salva ocasional',
        lootTable: 'role_disruptor',
        strategyTip: 'Cañón dentro del jam; misil solo fuera de su aura púrpura.',
    },
    heavy_escort: {
        label: 'Escolta Pesada',
        hpMult: 1.6,
        speedMult: 0.72,
        damageMult: 1.28,
        aggroMult: 1.22,
        attackDistMult: 1.25,
        engageMult: 1.4,
        engageDuration: 30,
        ability: 'heavy_tank',
        extraAbilities: ['energy_shield', 'missile_salvo'],
        shieldHpPct: 0.35,
        shieldTriggerPct: 0.55,
        missileCooldown: 11,
        missileRange: 2800,
        abilityDesc: 'Escolta blindada — escudo reactivo y misil pesado',
        lootTable: 'role_heavy_escort',
        strategyTip: 'Rompe el escudo violeta; esquiva el misil lateral tras el escudo.',
    },
};

export function getRoleConfig(roleKey) {
    if (!roleKey) return null;
    return ENEMY_ROLES[roleKey] || SQUAD_ROLES[roleKey] || null;
}

export function applyRoleToEnemy(enemy, roleKey) {
    const role = getRoleConfig(roleKey);
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

    if (role.ability === 'ambush') {
        enemy.userData.ambushState = 'hidden';
        enemy.userData.ambushUntil = 0;
    }
    if (role.extraAbilities?.includes('energy_shield')) {
        enemy.userData.enemyShieldMax = Math.round(enemy.userData.maxHp * (role.shieldHpPct ?? 0.35));
        enemy.userData.enemyShieldHp = 0;
        enemy.userData.enemyShieldUsed = false;
    }
    if (role.extraAbilities?.includes('missile_salvo') || role.ability === 'missile_salvo') {
        enemy.userData.missileCooldown = role.missileCooldown ?? 10;
        enemy.userData.missileRange = role.missileRange ?? 2600;
        enemy.userData.nextMissileAt = 0;
    }
}

export function getEffectiveAggroDist(enemy, config, time = Date.now() * 0.001) {
    const typeKey = (enemy.userData?.type || '').toUpperCase();
    const base = config.COMBAT[`${typeKey}_AGGRO_DIST`] || 0;
    const mult = enemy.userData?.aggroMult ?? 1;
    let aggro = base * mult;

    const role = getRoleConfig(enemy.userData.patrolRole);
    if (role?.ability === 'ambush' && enemy.userData.ambushState === 'hidden') {
        aggro = 0;
    }

    if (enemy.userData?.forcedAggroUntil && time < enemy.userData.forcedAggroUntil) {
        const engage = enemy.userData.engageMult ?? role?.engageMult ?? 1.35;
        aggro *= Math.min(engage, 1.35);
    }

    return aggro;
}

export function isEnemyInCombat(enemy, player, config, time) {
    if (!enemy?.userData || enemy.userData.hp <= 0) return false;
    const dist = enemy.position.distanceTo(player.position);

    if (enemy.userData.forcedAggroUntil && time < enemy.userData.forcedAggroUntil) return true;

    const role = getRoleConfig(enemy.userData.patrolRole);
    if (role?.ability === 'ambush' && enemy.userData.ambushState === 'hidden') {
        return dist < (role.ambushTriggerDist ?? 520);
    }

    return dist < getEffectiveAggroDist(enemy, config, time);
}

/** En combate activo — incluye daño reciente, foco del jugador y aggro forzado. */
export function isEnemyEngaged(enemy, player, config, time) {
    if (!enemy?.userData || enemy.userData.hp <= 0) return false;
    if (enemy.userData.forcedAggroUntil && time < enemy.userData.forcedAggroUntil) return true;
    const lastHit = enemy.userData.lastDamagedAt ?? 0;
    if (time - lastHit < 16) return true;
    if (player?.target === enemy) return true;
    return isEnemyInCombat(enemy, player, config, time);
}

export function getRoleLootTable(roleKey) {
    const role = getRoleConfig(roleKey);
    return role?.lootTable || 'patrol_bonus';
}

/** Marca persecución intensa tras primer contacto de daño. */
export function engageEnemy(enemy, time) {
    if (!enemy?.userData) return;
    const role = getRoleConfig(enemy.userData.patrolRole);
    const dur = enemy.userData.engageDuration ?? role?.engageDuration ?? 24;
    enemy.userData.forcedAggroUntil = time + dur;
    enemy.userData.lastDamagedAt = time;
    enemy.userData.engageMult = enemy.userData.engageMult ?? role?.engageMult ?? 1.55;
    if (enemy.userData.isSquadMember) {
        enemy.userData.squadFollow = false;
        enemy.userData.squadRouteActive = false;
    }
}
