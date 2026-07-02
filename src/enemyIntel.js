/** Dossier táctico — lore + estrategia por facción y rol. */
import { SPECIES_DISPLAY } from './enemyNames.js';
import { getRoleConfig } from './enemyRoles.js';

const FACTION_INTEL = {
    Zona1: {
        faction: 'Colmena Mantis',
        tier: 1,
        threat: '★☆☆',
        lore: 'Drones de asalto de la colmena del norte. Rápidos, numerosos, presionan en enjambre.',
        strengths: ['Velocidad', 'Detección en patrulla'],
        weaknesses: ['HP bajo', 'Blindaje ligero'],
        tip: 'Mantén distancia media; usa misil en grupos. Prioriza emboscadas antes del burst.',
    },
    Zona2: {
        faction: 'Clan Carroñero',
        tier: 2,
        threat: '★★☆',
        lore: 'Saqueadores del este. Golpean y huyen; los disruptores jammean tus misiles.',
        strengths: ['Movilidad', 'Jam de misiles (Disruptor)'],
        weaknesses: ['Resistencia', 'Poco HP en carroñeros sueltos'],
        tip: 'Acorrala antes de que huyan. Contra Disruptor: cañón primero, misil fuera de su aura.',
    },
    Zona3: {
        faction: 'Mando Pesado',
        tier: 3,
        threat: '★★★',
        lore: 'Fortaleza del oeste. Escoltas blindadas, misiles y escudos de energía.',
        strengths: ['HP alto', 'Misiles', 'Escudo reactivo'],
        weaknesses: ['Lentitud', 'Ventana tras activar escudo'],
        tip: 'Rompe el escudo con cañón sostenido; esquiva el misil lateral. No pelees en su órbita cerrada.',
    },
};

const ABILITY_TAGS = {
    standard_patrol: { icon: '◎', label: 'Patrulla estándar' },
    border_watch: { icon: '◉', label: 'Vigía — alerta aliados' },
    ambush: { icon: '⚡', label: 'Emboscada — burst' },
    hit_and_run: { icon: '↩', label: 'Hit & run' },
    disruptor_jam: { icon: '⊘', label: 'Jam misiles' },
    heavy_tank: { icon: '▣', label: 'Tanque pesado' },
    missile_salvo: { icon: '◈', label: 'Misil guiado' },
    energy_shield: { icon: '⬡', label: 'Escudo energético' },
    ion_burst: { icon: '✦', label: 'Ráfaga iónica' },
    paralyze_pulse: { icon: '⦿', label: 'Pulso paralizador' },
    squad_escort: { icon: '⬢', label: 'Escolta de tren' },
};

export function buildEnemyIntel(enemy) {
    if (!enemy?.userData) return null;
    const type = enemy.userData.type || 'Zona1';
    const roleKey = enemy.userData.patrolRole;
    const role = getRoleConfig(roleKey);
    const fac = FACTION_INTEL[type] || FACTION_INTEL.Zona1;
    const abilities = [];
    if (role?.ability) {
        const tag = ABILITY_TAGS[role.ability];
        if (tag) abilities.push(tag);
    }
    for (const extra of role?.extraAbilities || []) {
        const tag = ABILITY_TAGS[extra];
        if (tag) abilities.push(tag);
    }
    let tip = role?.strategyTip || fac.tip;
    if (enemy.userData.squadName) {
        tip = `Escuadrón «${enemy.userData.squadName}». ${tip}`;
    }
    return {
        name: enemy.userData.name || SPECIES_DISPLAY[type] || type,
        type,
        roleLabel: role?.label || 'Hostil',
        faction: fac.faction,
        tier: fac.tier,
        threat: fac.threat,
        lore: role?.lore || fac.lore,
        strengths: fac.strengths,
        weaknesses: fac.weaknesses,
        tip,
        abilities,
        hp: enemy.userData.hp,
        maxHp: enemy.userData.maxHp,
        regionId: enemy.userData.patrolRegionId || enemy.userData.regionId,
        squadId: enemy.userData.squadId || null,
        squadName: enemy.userData.squadName || null,
    };
}
