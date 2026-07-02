/** Fix missing commas between methods in extracted EnemyManager modules. */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'src', 'enemies');
for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith('EnemyManager') || !f.endsWith('.js')) continue;
    const p = path.join(dir, f);
    let s = fs.readFileSync(p, 'utf8');
    const before = s;
    // Method closes with `    }` then next method `    name(` without comma
    s = s.replace(/(\n    \})\n(\n    [a-zA-Z_])/g, '$1,$2');
    // Same without blank line
    s = s.replace(/(\n    \})\n(    [a-zA-Z_])/g, '$1,\n$2');
    if (s !== before) {
        fs.writeFileSync(p, s);
        console.log('fixed commas in', f);
    }
}
