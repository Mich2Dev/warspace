import planet01 from '../data/planet_01.json';

/** Config de población por región — cantidad, respawn, drama. */
export function getRegionSpawnConfig(regionId) {
    const region = (planet01.regions || []).find((r) => r.id === regionId);
    if (!region) {
        return { patrolMax: 4, respawnMin: 55, respawnMax: 90, spawnerUnits: 5 };
    }
    const s = region.spawn || {};
    return {
        patrolMax: s.patrolMax ?? region.patrolCount ?? 4,
        respawnMin: s.respawnMin ?? 50,
        respawnMax: s.respawnMax ?? 90,
        spawnerUnits: s.spawnerUnits ?? 5,
        drama: s.drama || region.description || region.name,
    };
}

export function getRegionById(regionId) {
    return (planet01.regions || []).find((r) => r.id === regionId) || null;
}
