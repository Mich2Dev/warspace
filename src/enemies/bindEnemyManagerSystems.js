import { enemySpawnerMethods } from './EnemySpawner.js';
import { enemyCombatMethods } from './EnemyCombat.js';
import { enemyManagerMultiplayerMethods } from './EnemyManagerMultiplayer.js';
import { enemyManagerLifecycleMethods } from './EnemyManagerLifecycle.js';
import { enemyManagerHudMethods } from './EnemyManagerHud.js';
import { enemyManagerModelsMethods } from './EnemyManagerModels.js';
import { enemyManagerUpdateMethods } from './EnemyManagerUpdate.js';

const MODULES = [
    enemySpawnerMethods,
    enemyCombatMethods,
    enemyManagerMultiplayerMethods,
    enemyManagerLifecycleMethods,
    enemyManagerHudMethods,
    enemyManagerModelsMethods,
    enemyManagerUpdateMethods,
];

export function bindEnemyManagerSystems(manager) {
    for (const mod of MODULES) {
        for (const [key, fn] of Object.entries(mod)) {
            if (typeof fn !== 'function') continue;
            manager[key] = fn.bind(manager);
        }
    }
}
