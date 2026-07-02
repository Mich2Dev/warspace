/**
 * Comprueba símbolos compartidos usados en módulos split sin import explícito.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const SHARED_SYMBOLS = [
    'ZONE_META',
    'getMovementProfile',
    'getVisualVariant',
    'applyVisualVariant',
    'applyRoleToEnemy',
    'getRoleConfig',
    'isEnemyInCombat',
    'engageEnemy',
    'buildEnemyIntel',
    'isPlayerInHubSafeZone',
    'isInHubSafeZone',
    'MobileEnemy',
    'Spawner',
    'SkeletonUtils',
    'mergeSquadRoleIntoEnemy',
    'resolveEnemyDisplayName',
    'getRoleDisplayLabel',
    'SQUAD_VISUAL',
    'SQUAD_ROLES',
    'PARTS',
    'missileDamage',
    'effectiveSpreadDeg',
];

const MODULES = [
    'src/enemies/EnemySpawner.js',
    'src/enemies/EnemyCombat.js',
    'src/player/PlayerTargeting.js',
    'src/player/PlayerCameraNav.js',
    'src/player/PlayerEconomy.js',
    'src/player/PlayerCombat.js',
];

function stripStrings(src) {
    return src
        .replace(/'(?:\\.|[^'\\])*'/g, "''")
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`(?:\\.|[^`\\])*`/g, '``');
}
function getImports(src) {
    const imported = new Set();
    for (const m of src.matchAll(/import\s+(?:\{([^}]+)\}|(\w+))\s+from/g)) {
        if (m[1]) {
            m[1].split(',').forEach((part) => {
                const name = part.trim().split(/\s+as\s+/).pop().trim();
                if (name) imported.add(name);
            });
        }
        if (m[2]) imported.add(m[2]);
    }
    for (const m of src.matchAll(/import\s+\*\s+as\s+(\w+)/g)) imported.add(m[1]);
    return imported;
}

let failed = false;
for (const rel of MODULES) {
    const src = stripStrings(fs.readFileSync(path.join(root, rel), 'utf8'));
    const imported = getImports(src);
    const missing = SHARED_SYMBOLS.filter(
        (sym) => new RegExp(`\\b${sym}\\b`).test(src) && !imported.has(sym),
    );
    if (missing.length) {
        failed = true;
        console.error(`${rel} — falta import:`);
        missing.forEach((s) => console.error('  -', s));
    }
}

if (failed) process.exit(1);
console.log('Module import audit OK:', MODULES.length, 'files');
