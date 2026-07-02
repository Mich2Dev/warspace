import { CONFIG } from '../../config.js';
import { getRegionSpawnConfig } from '../zoneSpawn.js';

/**
 * Diseños enemigos móviles en disco → un grupo de spawn por diseño.
 * 3 GLB (E1, E2, E3) = 3 bases / 3 zonas en el mapa.
/** Jefe de Mundo (World Boss) único */
export const BOSS_DESIGN = {
    spawnType: 'Boss',
    modelKey: 'boss',
    groupRef: 'bossGroup',
    glbPath: '/models/jefe/jefe1.glb',
    targetSize: CONFIG.VISUALS.BOSS_BOX_SIZE,
    ringSize: CONFIG.VISUALS.BOSS_RING_SIZE,
    scaleKey: 'BOSS_SCALE',
    rotationY: Math.PI,
};

export const ENEMY_DESIGNS = [
    {
        spawnType: 'Zona1',
        modelKey: 'e1',
        groupRef: 'zona1Group',
        spawnerRef: 'zona1Spawner',
        glbPath: '/models/zona1/E1.glb',
        baseGlbPath: '/models/zona1/base1.glb',
        baseModelKey: 'base1',
        zoneConfigKey: 'ZONA1',
        regionId: 'north_mantis',
        scaleKey: 'ZONA1_SCALE',
        baseScaleKey: 'ZONA1_BASE_SCALE',
        ringKey: 'ZONA1_RING_SIZE',
        boxKey: 'ZONA1_BOX_SIZE',
        spawnerRingKey: 'ZONA1_SPAWNER_RING',
        spawnerBoxKey: 'ZONA1_SPAWNER_BOX',
        spawnerVisual: 'colmena',
        minimapLabel: 'E1',
        rotationY: Math.PI,
        cloneForTemplate: false,
    },
    {
        spawnType: 'Zona2',
        modelKey: 'e2',
        groupRef: 'zona2Group',
        spawnerRef: 'zona2Spawner',
        glbPath: '/models/zona2/E2.glb',
        zoneConfigKey: 'ZONA2',
        regionId: 'east_scavenger',
        scaleKey: 'ZONA2_SCALE',
        ringKey: 'ZONA2_RING_SIZE',
        boxKey: 'ZONA2_BOX_SIZE',
        spawnerRingKey: 'ZONA2_SPAWNER_RING',
        spawnerBoxKey: 'ZONA2_SPAWNER_BOX',
        spawnerVisual: 'scavenger',
        minimapLabel: 'E2',
        rotationY: Math.PI,
        cloneForTemplate: true,
    },
    {
        spawnType: 'Zona3',
        modelKey: 'e3',
        groupRef: 'zona3Group',
        spawnerRef: 'zona3Spawner',
        glbPath: '/models/zona3/E3.glb',
        baseGlbPath: '/models/zona3/base3.glb',
        baseModelKey: 'base3',
        zoneConfigKey: 'ZONA3',
        regionId: 'west_command',
        scaleKey: 'ZONA3_SCALE',
        baseScaleKey: 'ZONA3_BASE_SCALE',
        ringKey: 'ZONA3_RING_SIZE',
        boxKey: 'ZONA3_BOX_SIZE',
        spawnerRingKey: 'ZONA3_SPAWNER_RING',
        spawnerBoxKey: 'ZONA3_SPAWNER_BOX',
        spawnerVisual: 'fortress',
        minimapLabel: 'E3',
        cloneForTemplate: false,
    },
    BOSS_DESIGN
];

/** Comandante de patrulla — GLB dedicado (public/models/patrols/comandante.glb) */
export const PATROL_COMMANDER = {
    modelKey: 'patrolCmd',
    groupRef: 'patrolCommanderGroup',
    glbPath: '/models/patrols/comandante.glb',
    targetSize: Math.round(CONFIG.VISUALS.ZONA3_BOX_SIZE * 1.72),
    ringSize: Math.round(CONFIG.VISUALS.ZONA3_RING_SIZE * 1.2),
    rotationY: 0,
};

/** Escolta de patrulla — GLB dedicado (public/models/patrols/escolta.glb) */
export const PATROL_ESCORT = {
    modelKey: 'patrolEscort',
    groupRef: 'patrolEscortGroup',
    glbPath: '/models/patrols/escolta.glb',
    targetSize: CONFIG.VISUALS.ZONA2_BOX_SIZE,
    ringSize: CONFIG.VISUALS.ZONA2_RING_SIZE,
    rotationY: 0,
};

/** Droid de patrulla — GLB dedicado (public/models/patrols/droid.glb) */
export const PATROL_DROID = {
    modelKey: 'patrolDroid',
    groupRef: 'patrolDroidGroup',
    glbPath: '/models/patrols/droid.glb',
    targetSize: Math.round(CONFIG.VISUALS.ZONA1_BOX_SIZE * 1.08),
    ringSize: CONFIG.VISUALS.ZONA1_RING_SIZE,
    rotationY: 0,
};

/** Claves en patrol_squads.json → GLB en public/models/patrols/ */
export const PATROL_DESIGN_KEYS = {
    comandante: PATROL_COMMANDER,
    escolta: PATROL_ESCORT,
    droid: PATROL_DROID,
};

export const PATROL_MODEL_KEYS = ['patrolCmd', 'patrolEscort', 'patrolDroid'];

/** GLB en rutas que aún no tienen grupo de zona (eventos / futuro). */
export const RESERVE_ENEMY_GLB = [
    '/models/enemis_map/comunlvl1.glb',
    '/models/enemis_map/loky.glb',
    '/models/evil/droid.glb',
    '/models/evil/stargate__bc-303.glb',
];

export function getDesignBySpawnType(spawnType) {
    return ENEMY_DESIGNS.find((d) => d.spawnType === spawnType) || null;
}

export function getDesignByModelKey(modelKey) {
    return ENEMY_DESIGNS.find((d) => d.modelKey === modelKey) || null;
}

export function getDesignSpawnerUnits(design) {
    return getRegionSpawnConfig(design.regionId).spawnerUnits ?? 5;
}

export function getDesignSpawnRate(design) {
    return design.spawnRate ?? 6.0;
}

export function getEnemyTemplate(manager, spawnType) {
    const design = getDesignBySpawnType(spawnType);
    if (!design) return manager[`${spawnType.toLowerCase()}Group`] ?? null;
    return manager[design.groupRef] ?? null;
}

export function getPatrolCommanderTemplate(manager) {
    return manager[PATROL_COMMANDER.groupRef] ?? manager.patrolGroup ?? null;
}

export function isPatrolCommanderReady(manager) {
    return !!manager._modelsReady?.[PATROL_COMMANDER.modelKey];
}

export function getPatrolEscortTemplate(manager) {
    return manager[PATROL_ESCORT.groupRef] ?? null;
}

export function getPatrolDroidTemplate(manager) {
    return manager[PATROL_DROID.groupRef] ?? null;
}

export function getPatrolDesignTemplate(manager, designKey) {
    const def = PATROL_DESIGN_KEYS[designKey];
    if (!def) return null;
    return manager[def.groupRef] ?? null;
}

export function isPatrolEscortReady(manager) {
    return !!manager._modelsReady?.[PATROL_ESCORT.modelKey];
}

export function allPatrolDesignsReady(manager) {
    return PATROL_MODEL_KEYS.every((k) => manager._modelsReady?.[k]);
}

export function isPatrolGlbTemplate(template) {
    return !!template?.userData?.isPatrolGlb;
}

export function getPatrolDesignVisuals(designKey) {
    const def = PATROL_DESIGN_KEYS[designKey];
    if (!def) return null;
    return {
        boxSize: def.targetSize,
        ringSize: def.ringSize,
    };
}

/** Visual de patrulla: siempre el GLB de public/models/patrols/ cuando patrolDesign está definido. */
export function getSquadUnitTemplate(manager, spawnType, roleKey, patrolDesign = null) {
    if (patrolDesign) {
        const def = PATROL_DESIGN_KEYS[patrolDesign];
        if (def && manager._modelsReady?.[def.modelKey]) {
            const patrolTpl = getPatrolDesignTemplate(manager, patrolDesign);
            if (isPatrolGlbTemplate(patrolTpl)) return patrolTpl;
        }
        return null;
    }
    const zoneTpl = getEnemyTemplate(manager, spawnType);
    if (roleKey === 'squad_commander') {
        const cmd = getPatrolCommanderTemplate(manager);
        return isPatrolGlbTemplate(cmd) ? cmd : zoneTpl;
    }
    if (roleKey === 'squad_escort') {
        const esc = getPatrolEscortTemplate(manager);
        return isPatrolGlbTemplate(esc) ? esc : zoneTpl;
    }
    if (roleKey === 'squad_missile') {
        const droid = getPatrolDroidTemplate(manager);
        return isPatrolGlbTemplate(droid) ? droid : zoneTpl;
    }
    return zoneTpl;
}

export function visualKey(design, suffix) {
    return CONFIG.VISUALS[`${design.spawnType.toUpperCase()}_${suffix}`]
        ?? CONFIG.VISUALS[design[suffix === 'RING' ? 'ringKey' : 'boxKey']?.replace?.(/^ZONA\d_/, '')];
}

export function getVisualSize(design, kind) {
    const key = kind === 'ring' ? design.ringKey : design.boxKey;
    return CONFIG.VISUALS[key];
}

export function getSpawnerVisualSize(design, kind) {
    const key = kind === 'ring' ? design.spawnerRingKey : design.spawnerBoxKey;
    return CONFIG.VISUALS[key];
}
