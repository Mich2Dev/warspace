import systemData from '../../data/galaxy_system_01.json';

/** @typedef {import('./GalaxyDirector.js').GalaxyPlanetDef} GalaxyPlanetDef */

export function loadGalaxySystem() {
    return systemData;
}

/** @returns {GalaxyPlanetDef[]} */
export function getGalaxyPlanets(system = systemData) {
    return system.planets ?? [];
}

/** Planetas activos en el sistema (enabled !== false). */
export function getActivePlanets(system = systemData) {
    return getGalaxyPlanets(system).filter((p) => p.enabled !== false);
}

/** @returns {GalaxyPlanetDef | null} */
export function getPlanetById(id, system = systemData) {
    return getGalaxyPlanets(system).find((p) => p.id === id) ?? null;
}

export function getHomePlanet(system = systemData) {
    return getPlanetById(system.homePlanetId, system) ?? getGalaxyPlanets(system)[0];
}
