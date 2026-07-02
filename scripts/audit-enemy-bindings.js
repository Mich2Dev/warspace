/**
 * Verifica métodos this.*() en EnemyManager vs fachada + módulos bind.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'src', 'EnemyManager.js'), 'utf8');

const moduleFiles = fs.readdirSync(path.join(root, 'src', 'enemies'))
    .filter((f) => (
        f === 'EnemySpawner.js'
        || f === 'EnemyCombat.js'
        || (f.startsWith('EnemyManager') && f.endsWith('.js'))
    ))
    .map((f) => path.join('src', 'enemies', f));

const boundMethods = new Set();
for (const rel of moduleFiles) {
    const msrc = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const m of msrc.matchAll(/^    (\w+)\(|^(\w+)\(/gm)) {
        boundMethods.add(m[1] || m[2]);
    }
}

const facadeMethods = new Set();
for (const m of src.matchAll(/^    (\w+)\(/gm)) facadeMethods.add(m[1]);

const calls = new Set();
for (const rel of moduleFiles) {
    const msrc = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const m of msrc.matchAll(/this\.(\w+)\(/g)) calls.add(m[1]);
}
for (const m of src.matchAll(/this\.(\w+)\(/g)) calls.add(m[1]);

const SKIP = new Set(['onEnemyKilled']);

const missing = [...calls].filter(
    (name) => !SKIP.has(name) && !facadeMethods.has(name) && !boundMethods.has(name),
);

if (missing.length) {
    console.error('EnemyManager methods called but not defined:');
    missing.sort().forEach((n) => console.error('  -', n));
    process.exit(1);
}

console.log('EnemyManager binding audit OK:', calls.size, 'calls,', boundMethods.size, 'bound');
