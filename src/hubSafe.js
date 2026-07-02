import planet01 from '../data/planet_01.json';

export function getHub() {
    return planet01.hub || { x: 0, z: 4000, safeRadius: 2600, label: 'Base Aegis' };
}

export function hubDistanceSq(x, z, hub = getHub()) {
    const dx = x - hub.x;
    const dz = z - hub.z;
    return dx * dx + dz * dz;
}

export function hubDistance(x, z, hub = getHub()) {
    return Math.sqrt(hubDistanceSq(x, z, hub));
}

/** Zona segura alrededor del hub — sin spawn ni combate hostil. */
export function isInHubSafeZone(x, z, margin = 0) {
    const hub = getHub();
    const r = (hub.safeRadius ?? 2600) + margin;
    return hubDistanceSq(x, z, hub) <= r * r;
}

export function isPlayerInHubSafeZone(player) {
    if (!player?.position) return false;
    return isInHubSafeZone(player.position.x, player.position.z);
}

export function getHubSpawnPoint(y = 50) {
    const hub = getHub();
    return { x: hub.x, y, z: hub.z };
}

/** Empuja un punto fuera del borde de la zona segura. */
export function pushOutOfSafeZone(x, z, pad = 320) {
    const hub = getHub();
    const r = (hub.safeRadius ?? 2600) + pad;
    const dx = x - hub.x;
    const dz = z - hub.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    if (d >= r) return { x, z };
    return {
        x: hub.x + (dx / d) * r,
        z: hub.z + (dz / d) * r,
    };
}

export function squadRouteViolatesSafeZone(waypoints, margin = 180) {
    if (!waypoints?.length) return true;
    for (const wp of waypoints) {
        if (isInHubSafeZone(wp.x, wp.z, margin)) return true;
    }
    return false;
}

/** Empuja waypoints de patrulla fuera del hub — evita rechazar trenes enteros. */
export function clampSquadWaypoints(waypoints, pad = 240) {
    const hub = getHub();
    const minR = (hub.safeRadius ?? 2600) + pad;
    return (waypoints || []).map((wp) => {
        const dx = wp.x - hub.x;
        const dz = wp.z - hub.z;
        const d = Math.sqrt(dx * dx + dz * dz) || 1;
        if (d >= minR) return { x: wp.x, z: wp.z };
        const s = minR / d;
        return { x: hub.x + dx * s, z: hub.z + dz * s };
    });
}
