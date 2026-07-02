/**
 * Verifica que todo método llamado desde Player.js exista en fachada o en módulos bind.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const playerSrc = fs.readFileSync(path.join(root, 'src', 'Player.js'), 'utf8');

const moduleFiles = [
    'src/player/PlayerTargeting.js',
    'src/player/PlayerCameraNav.js',
    'src/player/PlayerEconomy.js',
    'src/player/PlayerCombat.js',
];

const boundMethods = new Set();
for (const f of moduleFiles) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of src.matchAll(/^(\w+)\(/gm)) boundMethods.add(m[1]);
}

const facadeMethods = new Set();
for (const m of playerSrc.matchAll(/^    (\w+)\(/gm)) facadeMethods.add(m[1]);

const calls = new Set();
for (const m of playerSrc.matchAll(/this\.(\w+)\(/g)) calls.add(m[1]);

const missing = [...calls].filter(
    (name) => !facadeMethods.has(name) && !boundMethods.has(name),
);

if (missing.length) {
    console.error('Player methods called but not defined in facade or bind modules:');
    missing.sort().forEach((n) => console.error('  -', n));
    process.exit(1);
}

console.log('Player binding audit OK:', calls.size, 'this.*() calls,', boundMethods.size, 'bound methods');
