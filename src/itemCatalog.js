/** Catálogo base + expansion MK-1 … MK-5 por componente. */

const MAX_MK = 5;

export const ITEM_CATALOG = [
    {
        id: 'w_ion',
        slot: 'weapon',
        name: 'Carabina de Iones',
        rarity: 'common',
        manufacturer: 'Industrias Terran',
        description: 'Arma estable de bajo consumo, ideal para sesiones largas.',
        stats: { damage: 6, energyCost: 4 },
        price: 380,
    },
    {
        id: 'w_rail',
        slot: 'weapon',
        name: 'Lanza Riel',
        rarity: 'rare',
        manufacturer: 'Vulcan Corp',
        description: 'Disparo pesado de alta penetración. Menor ritmo, mayor impacto.',
        stats: { damage: 11, energyCost: 7 },
        price: 1050,
    },
    {
        id: 'w_plasma',
        slot: 'weapon',
        name: 'Dispersión de Plasma',
        rarity: 'rare',
        manufacturer: 'Ares Foundry',
        description: 'Proyectil inestable con daño amplio en combate cercano.',
        stats: { damage: 9, energyCost: 8 },
        price: 980,
    },
    {
        id: 'm_hunter',
        slot: 'missile',
        name: 'Misil Cazador',
        rarity: 'common',
        manufacturer: 'Vulcan Corp',
        description: 'Misil guiado estándar para blancos móviles.',
        stats: { areaDamageMultiplier: 18, cooldown: 1.8 },
        price: 520,
    },
    {
        id: 'm_cluster',
        slot: 'missile',
        name: 'Enjambre de Racimo',
        rarity: 'epic',
        manufacturer: 'Black Orbit',
        description: 'Ojiva de racimo para control de área.',
        stats: { areaDamageMultiplier: 26, cooldown: 2.4 },
        price: 1950,
    },
    {
        id: 'm_emp',
        slot: 'missile',
        name: 'Dardo PEM',
        rarity: 'rare',
        manufacturer: 'Nadir Labs',
        description: 'Carga electromagnética contra escudos y sistemas ligeros.',
        stats: { areaDamageMultiplier: 16, cooldown: 1.6 },
        price: 1120,
    },
    {
        id: 's_aegis',
        slot: 'shield',
        name: 'Burbuja Aegis',
        rarity: 'common',
        manufacturer: 'Aegis Dynamics',
        description: 'Escudo base duradero para pilotos de primera línea.',
        stats: { shieldHp: 320, duration: 14.0, cooldown: 28.0 },
        price: 620,
    },
    {
        id: 's_prism',
        slot: 'shield',
        name: 'Prisma Reflectivo',
        rarity: 'rare',
        manufacturer: 'Helion Labs',
        description: 'Matriz prismática con mejor absorción táctica.',
        stats: { shieldHp: 420, duration: 13.0, cooldown: 26.0 },
        price: 1480,
    },
    {
        id: 's_surge',
        slot: 'shield',
        name: 'Barrera de Sobrecarga',
        rarity: 'epic',
        manufacturer: 'Null Dynamics',
        description: 'Barrido de energía de alta densidad para burst.',
        stats: { shieldHp: 520, duration: 11.5, cooldown: 24.0 },
        price: 2300,
    },
    {
        id: 'e_vector',
        slot: 'engine',
        name: 'Propulsores Vectoriales',
        rarity: 'common',
        manufacturer: 'Aerodinámica Espacial',
        description: 'Manejo equilibrado con buen control en giros.',
        stats: { speed: 280, nitroMultiplier: 2.6 },
        price: 500,
    },
    {
        id: 'e_nitro',
        slot: 'engine',
        name: 'Núcleo Turbo',
        rarity: 'rare',
        manufacturer: 'Vortex Systems',
        description: 'Mayor empuje sostenido, respuesta más nerviosa.',
        stats: { speed: 315, nitroMultiplier: 2.8 },
        price: 1320,
    },
    {
        id: 'e_blink',
        slot: 'engine',
        name: 'Motor Destello',
        rarity: 'epic',
        manufacturer: 'NEXA',
        description: 'Propulsión experimental para movilidad extrema.',
        stats: { speed: 355, nitroMultiplier: 3.0 },
        price: 2450,
    },
    {
        id: 'h_titan',
        slot: 'hull',
        name: 'Blindaje Titán',
        rarity: 'common',
        manufacturer: 'Industrias Terran',
        description: 'Blindaje robusto con buena durabilidad estructural.',
        stats: { maxHp: 145, maxEnergy: 110 },
        price: 560,
    },
    {
        id: 'h_reactive',
        slot: 'hull',
        name: 'Casco Reactivo',
        rarity: 'rare',
        manufacturer: 'Arcturus Forge',
        description: 'Casco reactivo con absorción de impacto.',
        stats: { maxHp: 195, maxEnergy: 120 },
        price: 1460,
    },
    {
        id: 'h_capacitor',
        slot: 'hull',
        name: 'Casco Capacitor',
        rarity: 'epic',
        manufacturer: 'Nova Labs',
        description: 'Núcleo de capacidad ampliada para cargas altas.',
        stats: { maxHp: 175, maxEnergy: 170 },
        price: 2280,
    },
];

const SLOT_META = {
    weapon: { code: 'WPN', label: 'Arma' },
    missile: { code: 'MSL', label: 'Misil' },
    shield: { code: 'SHD', label: 'Escudo' },
    engine: { code: 'ENG', label: 'Motor' },
    hull: { code: 'HUL', label: 'Casco' },
};

function scaleStats(stats, level) {
    const out = {};
    for (const [k, v] of Object.entries(stats)) {
        if (typeof v !== 'number') {
            out[k] = v;
            continue;
        }
        if (k.includes('cooldown') || k === 'duration') {
            out[k] = Math.max(0.4, +(v * (1 - (level - 1) * 0.06)).toFixed(2));
        } else {
            out[k] = Math.round(v * (1 + (level - 1) * 0.22));
        }
    }
    return out;
}

function rarityForLevel(level, base) {
    if (level >= 5) return 'legendary';
    if (level >= 4) return 'epic';
    if (level >= 3) return 'rare';
    if (level >= 2) return 'uncommon';
    return base.rarity || 'common';
}

let _expandedCache = null;

export function getExpandedCatalog() {
    if (_expandedCache) return _expandedCache;
    const items = [];
    for (const base of ITEM_CATALOG) {
        for (let lvl = 1; lvl <= MAX_MK; lvl++) {
            items.push({
                ...base,
                id: `${base.id}_mk${lvl}`,
                level: lvl,
                name: `${base.name} MK-${lvl}`,
                stats: scaleStats(base.stats, lvl),
                price: Math.round(base.price * Math.pow(1.72, lvl - 1)),
                rarity: rarityForLevel(lvl, base),
            });
        }
    }
    _expandedCache = items;
    return items;
}

export function getItemById(itemId) {
    const expanded = getExpandedCatalog().find((i) => i.id === itemId);
    if (expanded) return expanded;
    return ITEM_CATALOG.find((i) => i.id === itemId) || null;
}

export function getSlotMeta(slot) {
    return SLOT_META[slot] || { code: slot?.slice(0, 3).toUpperCase() || '???', label: slot };
}

export const ARMORY_SLOTS = ['weapon', 'missile', 'shield', 'engine', 'hull'];
