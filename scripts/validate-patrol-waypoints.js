/**
 * Falla el build si algún waypoint de patrulla está fuera del disco jugable.
 */
const fs = require('fs');
const path = require('path');

const PLAYABLE_RADIUS = 11500;
const SPAWN_CLAMP_SCALE = 0.94;
const maxR = PLAYABLE_RADIUS * SPAWN_CLAMP_SCALE;

const data = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../data/patrol_squads.json'), 'utf8'),
);

let failed = false;

for (const squad of data.squads || []) {
    for (const wp of squad.waypoints || []) {
        const dSq = wp.x * wp.x + wp.z * wp.z;
        if (dSq > maxR * maxR) {
            console.error(
                `[validate-patrol] ${squad.id}: waypoint (${wp.x}, ${wp.z}) fuera del disco (r<=${maxR})`,
            );
            failed = true;
        }
    }
}

if (failed) process.exit(1);
console.log('Patrol waypoint audit OK');
