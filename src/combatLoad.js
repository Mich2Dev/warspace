/** Presión de combate — cuenta enemigos activos cerca del jugador y devuelve caps de VFX. */

const PRESSURE_RADIUS = 2200;

export function countCombatPressure(enemyManager) {
    const player = enemyManager?.player;
    if (!player?.position) return 0;

    const px = player.position.x;
    const pz = player.position.z;
    const rSq = PRESSURE_RADIUS * PRESSURE_RADIUS;
    let n = 0;

    for (const enemy of enemyManager.enemies) {
        if ((enemy.userData?.hp ?? 0) <= 0) continue;
        if (enemy.spawnType !== undefined) continue;
        if (enemy.userData.sleeping) continue;

        const dx = enemy.position.x - px;
        const dz = enemy.position.z - pz;
        if (dx * dx + dz * dz <= rSq) n++;
    }

    // Láseres / misiles enemigos activos también pesan en GPU.
    n += Math.min(enemyManager.enemyLasers?.length ?? 0, 6);
    n += Math.min(enemyManager._enemyMissiles?.filter((m) => !m.visualOnly)?.length ?? 0, 2);

    return n;
}

/** @returns {'light'|'medium'|'heavy'} */
export function getCombatLoadLevel(pressure) {
    if (pressure >= 9) return 'heavy';
    if (pressure >= 3) return 'medium';
    return 'light';
}

export function getCombatLoadCaps(level) {
    switch (level) {
        case 'heavy':
            return {
                maxTrailParticles: 10,
                maxEnemyLasers: 14,
                maxEnemyMissiles: 1,
                maxLiveExplosions: 8,
                engineTrailEvery: 14,
                skipSmallExplosions: true,
                skipFloatingText: true,
                vfxSparkMul: 0.35,
                maxVfx: 28,
            };
        case 'medium':
            return {
                maxTrailParticles: 18,
                maxEnemyLasers: 18,
                maxEnemyMissiles: 1,
                maxLiveExplosions: 10,
                engineTrailEvery: 9,
                skipSmallExplosions: true,
                skipFloatingText: false,
                vfxSparkMul: 0.6,
                maxVfx: 36,
            };
        default:
            return {
                maxTrailParticles: 28,
                maxEnemyLasers: 24,
                maxEnemyMissiles: 2,
                maxLiveExplosions: 14,
                engineTrailEvery: 5,
                skipSmallExplosions: false,
                skipFloatingText: false,
                vfxSparkMul: 1,
                maxVfx: 48,
            };
    }
}
