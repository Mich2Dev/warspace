/**
 * WarSpace — Fuente única de balance.
 * Componentes, enemigos, loot, craft y recompensas derivan de aquí.
 */

export const RARITY_MULT = {
    common: 1.0,
    uncommon: 1.08,
    rare: 1.18,
    epic: 1.32,
    legendary: 1.5,
};

export const LEVEL_GROWTH = 0.07; // +7% por nivel de componente

export const DIFFICULTY_MULT = {
    1: { cr: 1.0, xp: 1.0, label: 'FÁCIL', stars: '★☆☆' },
    2: { cr: 1.65, xp: 1.6, label: 'MEDIO', stars: '★★☆' },
    3: { cr: 2.5, xp: 2.2, label: 'DIFÍCIL', stars: '★★★' },
};

/** Stats base Lvl1 — equivalencia ~1.0 CEV por slot. */
export const COMPONENT_BASE = {
    weapon: {
        damage: 8,
        energyCost: 4,
        fireRate: 4.0,
        spreadDeg: 4,
        lasersPerShot: 2,
    },
    missile: {
        damageMultiplier: 12,
        cooldown: 2.5,
        aoeRadius: 100,
        homingStrength: 3.5,
        accuracyBase: 0.72,
        speed: 620,
        maxRange: 3200,
    },
    engine: {
        speed: 240,
        nitroMultiplier: 2.8,
        nitroGlobal: 1.8,
    },
    hull: {
        maxHp: 120,
        maxEnergy: 100,
    },
    shield: {
        shieldHp: 250,
        duration: 12,
        cooldown: 28,
        activateCost: 25,
    },
    repair: {
        repairRate: 12,
        combatDelay: 3,
        energyCost: 2,
        channelDuration: 4.5,
        maxRepairPct: 0.85,
    },
    sight: {
        spreadReduction: 0.6,
        accuracyBonus: 0.22,
        homingBonus: 1.5,
        lockRangeBonus: 0.15,
    },
};

/** Tier de amenaza por tipo de enemigo (Planeta 1). */
export const ENEMY_TIER = {
    Zona1: {
        tier: 1,
        level: 2,
        hp: 150,
        speed: 140,
        damage: 12,
        fireRate: 1.5,
        cr: 30,
        xp: 20,
        aggro: 920,
        attackDist: 340,
        engageMult: 1.7,
        engageDuration: 24,
        traits: ['thermal', 'rapid_fire'],
        lootTable: 'zona1_parts',
    },
    Zona2: {
        tier: 2,
        level: 4,
        hp: 165,
        speed: 180,
        damage: 9,
        fireRate: 1.0,
        cr: 60,
        xp: 50,
        aggro: 880,
        attackDist: 320,
        engageMult: 1.55,
        engageDuration: 20,
        traits: ['scavenger', 'speed'],
        lootTable: 'zona2_parts',
    },
    Zona3: {
        tier: 3,
        level: 6,
        hp: 200,
        speed: 250,
        damage: 20,
        fireRate: 1.2,
        cr: 120,
        xp: 100,
        aggro: 980,
        attackDist: 380,
        engageMult: 1.45,
        engageDuration: 28,
        traits: ['armored', 'command'],
        lootTable: 'zona3_parts',
    },
    Invader_Alpha: { tier: 4, level: 5, hp: 185, speed: 205, damage: 18, fireRate: 1.1, cr: 75, xp: 45, traits: ['invasion', 'thermal'], lootTable: 'invasion_parts' },
    Invader_Beta: { tier: 5, level: 6, hp: 220, speed: 235, damage: 21, fireRate: 1.0, cr: 95, xp: 60, traits: ['invasion', 'scavenger'], lootTable: 'invasion_parts' },
    Invader_Gamma: { tier: 6, level: 7, hp: 290, speed: 260, damage: 28, fireRate: 0.9, cr: 130, xp: 85, traits: ['invasion', 'command'], lootTable: 'invasion_parts' },
};

export const PARTS = {
    core_ionico: { name: 'Núcleo Iónico', icon: '◆', tier: 1 },
    camara_disparo: { name: 'Cámara de Disparo', icon: '▣', tier: 1 },
    guia_misil: { name: 'Guía de Misil', icon: '◈', tier: 1 },
    celda_propulsion: { name: 'Célula de Propulsión', icon: '▲', tier: 1 },
    rotor_impulsor: { name: 'Rotor Impulsor', icon: '◎', tier: 1 },
    placa_escudo: { name: 'Placa de Escudo', icon: '⬡', tier: 1 },
    generador_campo: { name: 'Generador de Campo', icon: '◉', tier: 1 },
    nanobot_kit: { name: 'Kit Nanobot', icon: '✚', tier: 1 },
    celula_reparadora: { name: 'Célula Reparadora', icon: '✚', tier: 1 },
    lente_mira: { name: 'Lente de Mira', icon: '⊕', tier: 1 },
    sensor_lock: { name: 'Sensor de Lock', icon: '⊛', tier: 1 },
    aleacion_refuerzo: { name: 'Aleación de Refuerzo', icon: '▤', tier: 1 },
};

export function statAtLevel(base, level = 1, rarity = 'common') {
    const lv = Math.max(1, level);
    const r = RARITY_MULT[rarity] ?? 1;
    return base * (1 + LEVEL_GROWTH * (lv - 1)) * r;
}

export function buildSlotStats(slot, level = 1, rarity = 'common') {
    const base = COMPONENT_BASE[slot];
    if (!base) return {};
    const out = {};
    for (const [k, v] of Object.entries(base)) {
        if (typeof v === 'number') out[k] = Math.round(statAtLevel(v, level, rarity) * 100) / 100;
        else out[k] = v;
    }
    return out;
}

export function planetComponentCap(planetId = 'planet_01') {
    if (planetId === 'planet_01') return 4;
    return 10;
}

export function sectorMultiplier(sector = 1) {
    return 1 + Math.max(0, sector - 1) * 0.4;
}

export function planetThreatMultiplier(planetId = 'planet_01', sector = 1) {
    return sectorMultiplier(sector);
}

export function computeEnemyCombatStats(enemyType, planetId = 'planet_01', sector = 1) {
    const base = ENEMY_TIER[enemyType];
    if (!base) return null;
    const mult = planetThreatMultiplier(planetId, sector);
    return {
        ...base,
        hp: Math.round(base.hp * mult),
        damage: Math.round(base.damage * (1 + 0.12 * (sector - 1))),
        cr: Math.round(base.cr * mult),
        xp: Math.round(base.xp * mult),
        speed: Math.round(base.speed * (1 + 0.05 * (sector - 1))),
    };
}

export function syncCombatConfig(CONFIG, planetId = 'planet_01', sector = 1) {
    for (const [type, base] of Object.entries(ENEMY_TIER)) {
        const key = type.toUpperCase();
        const s = computeEnemyCombatStats(type, planetId, sector);
        if (!s) continue;
        CONFIG.COMBAT[`${key}_HP`] = s.hp;
        CONFIG.COMBAT[`${key}_SPEED`] = s.speed;
        CONFIG.COMBAT[`${key}_DAMAGE`] = s.damage;
        CONFIG.COMBAT[`${key}_FIRE_RATE`] = s.fireRate;
        CONFIG.COMBAT[`${key}_CR_DROP`] = s.cr;
        CONFIG.COMBAT[`${key}_XP_DROP`] = s.xp;
        CONFIG.COMBAT[`${key}_LEVEL`] = s.level;
        if (s.aggro) CONFIG.COMBAT[`${key}_AGGRO_DIST`] = s.aggro;
        if (s.attackDist) CONFIG.COMBAT[`${key}_ATTACK_DIST`] = s.attackDist;
    }
}

export function getStarterEquipment() {
    const mk = (slot, id, name, mfg, desc, level = 1) => ({
        id,
        name,
        type: slot,
        level,
        rarity: 'common',
        manufacturer: mfg,
        description: desc,
        stats: buildSlotStats(slot, level, 'common'),
    });
    return {
        weapon: mk('weapon', 'w_01', 'Cañón Láser MK-I', 'Industrias Terran', 'Arma de energía estándar de patrulla fronteriza.'),
        missile: mk('missile', 'm_01', 'Lanzador MK-I', 'Vulcan Corp', 'Ojiva guiada de detonación por proximidad.'),
        engine: mk('engine', 'e_01', 'Propulsor Térmico MK-I', 'AeroSpace Dynamics', 'Inyección de plasma. Consumo alto en nitro.'),
        hull: mk('hull', 'h_01', 'Blindaje MK-I', 'Industrias Terran', 'Aleación estándar contra impactos moderados.'),
        shield: mk('shield', 's_01', 'Escudo Iónico MK-I', 'Aegis Dynamics', 'Burbuja de energía absorbente.'),
        repair: mk('repair', 'r_01', 'Nanobot MK-I', 'MedTech Orbital', 'Reparación automática tras breve respiro de combate.'),
        sight: mk('sight', 'g_01', 'Targeter MK-I', 'Nadir Labs', 'Asistencia de puntería para cañón y misiles.'),
    };
}

export function applyEquipmentToPlayer(player) {
    const eq = player.equipment;
    const w = eq.weapon?.stats || buildSlotStats('weapon');
    const m = eq.missile?.stats || buildSlotStats('missile');
    const e = eq.engine?.stats || buildSlotStats('engine');
    const h = eq.hull?.stats || buildSlotStats('hull');

    player.baseDamage = w.damage;
    player.shootCooldownMs = Math.round(1000 / (w.fireRate || 4));
    player.speed = e.speed;
    player.missileCooldown = m.cooldown;
    player.maxHp = h.maxHp;
    player.maxEnergy = h.maxEnergy;
    player.hp = Math.min(player.hp ?? h.maxHp, h.maxHp);
    player.energy = Math.min(player.energy ?? h.maxEnergy, h.maxEnergy);

    player._combatDerived = {
        spreadDeg: w.spreadDeg ?? 4,
        sight: eq.sight?.stats || buildSlotStats('sight'),
        missile: m,
        repair: eq.repair?.stats || buildSlotStats('repair'),
        engine: e,
        shield: eq.shield?.stats || buildSlotStats('shield'),
    };
}

export function effectiveSpreadDeg(player) {
    const d = player._combatDerived;
    if (!d) return 4;
    const base = d.spreadDeg ?? 4;
    const sight = d.sight || {};
    const red = sight.spreadReduction ?? 0;
    return base * (1 - red);
}

export function computeMissileHitChance(player, target, dist) {
    const d = player._combatDerived?.missile || buildSlotStats('missile');
    const sight = player._combatDerived?.sight || buildSlotStats('sight');
    let acc = d.accuracyBase ?? 0.72;
    acc += sight.accuracyBonus ?? 0;
    if (target?.userData?.maxSpeed) {
        acc -= (target.userData.maxSpeed / 300) * 0.25;
    }
    const lockRange = CONFIG_LOCK_RANGE * (1 + (sight.lockRangeBonus ?? 0));
    if (dist > lockRange) acc -= ((dist - lockRange) / lockRange) * 0.25;
    const jam = player.missileJamPenalty ?? 0;
    if (jam > 0) acc -= jam;
    return Math.max(0.12, Math.min(0.98, acc));
}

const CONFIG_LOCK_RANGE = 3500;

export function missileDamage(player) {
    const m = player._combatDerived?.missile || buildSlotStats('missile');
    return player.baseDamage * (m.damageMultiplier ?? 12);
}

export function homingStrength(player) {
    const m = player._combatDerived?.missile || buildSlotStats('missile');
    const sight = player._combatDerived?.sight || buildSlotStats('sight');
    return (m.homingStrength ?? 3.5) + (sight.homingBonus ?? 0);
}

export function nitroSpeed(player) {
    const e = player._combatDerived?.engine || buildSlotStats('engine');
    const nitroMult = (e.nitroMultiplier ?? 2.8) * (e.nitroGlobal ?? 1.8);
    return player.speed * nitroMult;
}

export function computeMissionCompletionReward(mission, sector = 1) {
    const diff = DIFFICULTY_MULT[mission.difficulty] || DIFFICULTY_MULT[1];
    const sec = sectorMultiplier(sector);
    const credits = Math.round((mission.rewardBase || 150) * diff.cr * sec);
    const xp = Math.round((mission.rewardXp || 50) * diff.xp * sec);
    return { credits, xp, diff, sec };
}

export function previewMissionReward(mission, sector = 1) {
    const { credits, xp, diff } = computeMissionCompletionReward(mission, sector);
    return { credits, xp, label: diff.label, stars: diff.stars };
}

export function enemyThreatValue(enemyType, sector = 1) {
    const s = computeEnemyCombatStats(enemyType, 'planet_01', sector);
    if (!s) return 30;
    return s.cr + s.xp * 0.5;
}
