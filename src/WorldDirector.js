import planet01 from '../data/planet_01.json';
import { syncCombatConfig } from './balance.js';
import { isValidPatrolPosition, randomPointInRegion, isPatrolTooClose } from './enemyVisuals.js';

const SPAWNER_ZONE_KEYS = { Zona1: 'ZONA1', Zona2: 'ZONA2', Zona3: 'ZONA3' };

/** Alinea CONFIG.ZONES con las regiones que tienen base (colmena). */
export function syncSpawnerZonesFromPlanet(config, planet = planet01) {
    if (!config?.ZONES || !planet?.regions) return;
    const assigned = {};
    for (const region of planet.regions) {
        if (!region.hasSpawner) continue;
        const key = SPAWNER_ZONE_KEYS[region.enemyType];
        if (key && !assigned[key]) {
            assigned[key] = {
                x: region.center.x,
                z: region.center.z,
                radius: region.radius,
                regionId: region.id,
            };
        }
    }
    for (const [key, zone] of Object.entries(assigned)) {
        config.ZONES[key] = zone;
    }
}

export class WorldDirector {
    constructor(enemyManager, config, options = {}) {
        this.enemyManager = enemyManager;
        this.config = config;
        this.planet = planet01;
        this.sector = options.sector || 1;
        this.planetId = this.planet.id;
        this.environment = null;

        syncSpawnerZonesFromPlanet(this.config, this.planet);
        syncCombatConfig(this.config, this.planetId, this.sector);
    }

    getPlanet() {
        return this.planet;
    }

    getMaxComponentLevel() {
        return this.planet.maxComponentLevel || 4;
    }

    getRegions() {
        return this.planet.regions || [];
    }

    bootstrap(environment = null) {
        this.environment = environment;
        this.spawnPatrols(environment);
    }

    /** Genera patrullas sueltas — tope global para no saturar FPS. */
    generatePatrolsFromRegions() {
        const hub = this.planet.hub;
        const patrols = [];
        const used = new Set();
        const placed = [];
        const MAX_PATROLS = 14;

        for (const region of this.planet.regions || []) {
            if (patrols.length >= MAX_PATROLS) break;
            const pool = region.rolePool?.length ? region.rolePool : ['patrol_mantis'];
            const want = Math.min(region.patrolCount ?? region.spawn?.patrolMax ?? 3, 4);

            for (let i = 0; i < want; i++) {
                if (patrols.length >= MAX_PATROLS) break;
                let pos = null;
                for (let attempt = 0; attempt < 24; attempt++) {
                    pos = randomPointInRegion(region, hub, 48, this.environment);
                    if (!pos) continue;
                    if (isPatrolTooClose(pos.x, pos.z, placed)) continue;
                    break;
                }
                if (!pos) continue;

                const key = `${region.id}:${Math.round(pos.x / 80)}:${Math.round(pos.z / 80)}`;
                if (used.has(key)) continue;
                used.add(key);
                placed.push({ x: pos.x, z: pos.z });

                patrols.push({
                    x: pos.x,
                    z: pos.z,
                    type: region.enemyType,
                    role: pool[i % pool.length],
                    regionId: region.id,
                });
            }
        }

        return patrols;
    }

    spawnPatrols(environment = null) {
        this.environment = environment ?? this.environment;
        // Patrullas sueltas desactivadas — solo trenes V (patrol_squads.json)
        this.enemyManager.queuePatrolSpawns([]);
        this.enemyManager.patrolSquads?.trySpawn(environment);
    }

    /** Para futuro: validar si el jugador puede craftear nivel N en este planeta. */
    canCraftLevel(level) {
        return level <= this.getMaxComponentLevel();
    }
}
