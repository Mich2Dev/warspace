/**
 * Comportamiento de combate por zona (Planeta 1) — polimorfismo por spawnType.
 * E1 misil+láser · E2 carga dura · E3 escudo+láser
 */

export const ZONE_BEHAVIORS = {
    Zona1: {
        id: 'Zona1',
        glb: '/models/zona1/E1.glb',
        label: 'E1',
        abilities: ['laser', 'missile'],
        missileCooldown: 8.5,
        missileRange: 2900,
        doc: 'Dispara cañón dual y lanza misiles guiados en ráfagas.',
    },
    Zona2: {
        id: 'Zona2',
        glb: '/models/zona2/E2.glb',
        label: 'E2',
        abilities: ['laser', 'hard_charge'],
        chargeTriggerDist: 980,
        chargeSpeedMult: 2.45,
        chargeDuration: 3.1,
        chargeCooldown: 5.5,
        chargeStopDist: 200,
        doc: 'Al detectarte embiste a toda velocidad; luego orbita y dispara como E1.',
    },
    Zona3: {
        id: 'Zona3',
        glb: '/models/zona3/E3.glb',
        label: 'E3',
        abilities: ['laser', 'energy_shield'],
        shieldOnEngage: true,
        shieldTriggerPct: 0.78,
        shieldHpPct: 0.42,
        doc: 'Activa escudo energético al entrar en combate y mantiene fuego de cañón.',
    },
    Boss: {
        id: 'Boss',
        glb: '/models/jefe/jefe1.glb',
        label: 'BOSS',
        abilities: ['laser', 'missile', 'hard_charge'],
        missileCooldown: 4.5,
        missileRange: 3800,
        chargeTriggerDist: 1500,
        chargeSpeedMult: 1.8,
        chargeDuration: 4.0,
        chargeCooldown: 12.0,
        chargeStopDist: 300,
        doc: 'Jefe de Mundo implacable. Dispara misiles pesados, rayos de larga distancia y embiste brutalmente.',
    }
};

export function getZoneBehavior(spawnType) {
    return ZONE_BEHAVIORS[spawnType] || null;
}

/** Aplica stats de habilidad de zona a cualquier unidad E1/E2/E3 (spawner o patrulla). */
export function applyZoneBehaviorToEnemy(enemy) {
    const zb = getZoneBehavior(enemy.userData?.type);
    if (!zb || !enemy.userData) return;
    enemy.userData.zoneBehavior = zb;

    const ud = enemy.userData;
    const roleHasMissile = ud.roleConfig?.extraAbilities?.includes('missile_salvo')
        || ud.roleConfig?.ability === 'missile_salvo';
    const squadMissile = roleHasMissile ? {
        missileCooldown: ud.missileCooldown,
        missileRange: ud.missileRange,
        nextMissileAt: ud.nextMissileAt,
    } : null;

    delete enemy.userData.missileCooldown;
    delete enemy.userData.missileRange;
    delete enemy.userData.nextMissileAt;

    if (zb.abilities?.includes('missile')) {
        enemy.userData.missileCooldown = zb.missileCooldown;
        enemy.userData.missileRange = zb.missileRange ?? 2800;
        enemy.userData.nextMissileAt = 0;
    } else if (squadMissile?.missileCooldown) {
        enemy.userData.missileCooldown = squadMissile.missileCooldown;
        enemy.userData.missileRange = squadMissile.missileRange ?? 2400;
        enemy.userData.nextMissileAt = squadMissile.nextMissileAt ?? 0;
    }

    if (zb.abilities?.includes('energy_shield')) {
        enemy.userData.enemyShieldMax = Math.round(enemy.userData.maxHp * (zb.shieldHpPct ?? 0.42));
        enemy.userData.enemyShieldHp = 0;
        enemy.userData.enemyShieldUsed = false;
        enemy.userData.enemyShieldActive = false;
    } else if (!enemy.userData.roleConfig?.extraAbilities?.includes('energy_shield')) {
        delete enemy.userData.enemyShieldMax;
    }

    if (zb.chargeTriggerDist) {
        enemy.userData._chargeCooldown = 0;
        enemy.userData._chargeUntil = 0;
    } else {
        enemy.userData._chargeUntil = 0;
    }
}

/**
 * Lógica de movimiento/estado por zona durante combate.
 * @returns {{ speedMult: number, charging: boolean, skipOrbit: boolean }}
 */
export function tickZoneCombat(enemy, { time, distToPlayer, inCombat, manager }) {
    const zb = enemy.userData?.zoneBehavior;
    const ud = enemy.userData;
    const out = { speedMult: 1, charging: false, skipOrbit: false };

    if (!zb || !inCombat) return out;

    if (zb.id === 'Zona3' && zb.shieldOnEngage && !ud.enemyShieldUsed
        && ud.hp / ud.maxHp <= (zb.shieldTriggerPct ?? 0.75)) {
        manager?.activateEnemyShield?.(enemy);
    } else if (zb.id === 'Zona3' && zb.shieldOnEngage && !ud._shieldEngageTriggered && inCombat) {
        ud._shieldEngageTriggered = true;
        if (!ud.enemyShieldUsed) manager?.activateEnemyShield?.(enemy);
    }

    if (zb.id === 'Zona2' && zb.chargeTriggerDist) {
        const load = manager?.combatLoadLevel ?? 'light';
        const heavyVfx = load !== 'light';

        if (time < (ud._chargeUntil ?? 0)) {
            out.charging = true;
            out.skipOrbit = true;
            out.speedMult = zb.chargeSpeedMult ?? 2.3;
            ud._chargeFxTick = (ud._chargeFxTick ?? 0) + 1;
            const trailEvery = heavyVfx ? 28 : (ud.isSquadMember ? 16 : 8);
            if (!heavyVfx && ud._chargeFxTick % trailEvery === 0) {
                manager?._vfx?.chargeTrail?.(enemy.position, enemy.userData.dangerColor ?? 0x00ddff);
            }
            if (distToPlayer < (zb.chargeStopDist ?? 200)) {
                ud._chargeUntil = time;
                ud._chargeCooldown = time + (zb.chargeCooldown ?? 5);
            }
            return out;
        }

        if (time >= (ud._chargeCooldown ?? 0) && distToPlayer < zb.chargeTriggerDist) {
            const cdMult = ud.isSquadMember ? 1.55 : 1;
            ud._chargeUntil = time + (zb.chargeDuration ?? 3);
            ud._chargeCooldown = time + ((zb.chargeDuration ?? 3) + (zb.chargeCooldown ?? 5)) * cdMult;
            ud._chargeFxTick = 0;
            if (!ud.isSquadMember || !ud._chargeLogUntil || time > ud._chargeLogUntil) {
                ud._chargeLogUntil = time + 6;
                if (!heavyVfx) manager?.logCombatAbility?.(enemy, '¡Embiste a toda velocidad!');
            }
            if (!heavyVfx) {
                manager?._vfx?.chargeBurst?.(enemy.position, enemy.userData.dangerColor ?? 0x00ddff);
            }
            out.charging = true;
            out.skipOrbit = true;
            out.speedMult = zb.chargeSpeedMult ?? 2.3;
        }
    }

    return out;
}
