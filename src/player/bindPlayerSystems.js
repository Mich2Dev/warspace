import { playerTargetingMethods } from './PlayerTargeting.js';
import { playerCameraNavMethods } from './PlayerCameraNav.js';
import { playerEconomyMethods } from './PlayerEconomy.js';
import { playerCombatMethods } from './PlayerCombat.js';

const MODULES = [
    playerTargetingMethods,
    playerCameraNavMethods,
    playerEconomyMethods,
    playerCombatMethods,
];

/** Une métodos de subsistemas en la instancia Player (misma API pública). */
export function bindPlayerSystems(player) {
    for (const mod of MODULES) {
        for (const [key, fn] of Object.entries(mod)) {
            if (typeof fn !== 'function') continue;
            if (player[key]) {
                console.warn(`[Player] bindPlayerSystems: sobrescribiendo ${key}`);
            }
            player[key] = fn.bind(player);
        }
    }
}
