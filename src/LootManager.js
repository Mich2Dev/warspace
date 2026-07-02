import lootTables from '../data/loot_tables.json';
import { ENEMY_TIER, PARTS } from './balance.js';
import { getRoleLootTable } from './enemyRoles.js';

export class LootManager {
    constructor(player) {
        this.player = player;
    }

    rollKillLoot(enemyType, options = {}) {
        const tier = ENEMY_TIER[enemyType];
        if (!tier) return [];

        let tableId;
        if (options.patrolRole) {
            tableId = getRoleLootTable(options.patrolRole);
        } else if (options.isPatrol) {
            tableId = 'patrol_bonus';
        } else {
            tableId = tier.lootTable || null;
        }
        if (!tableId || !lootTables[tableId]) return [];

        const table = lootTables[tableId];
        const drops = [];
        const rolls = table.rolls || 1;

        for (let r = 0; r < rolls; r++) {
            const entry = this._weightedPick(table.entries);
            if (!entry?.part) continue;
            const qty = this._rollQty(entry.qty);
            if (qty > 0) drops.push({ partId: entry.part, qty });
        }

        return drops;
    }

    grantDrops(drops) {
        if (!drops.length || !this.player) return;
        for (const d of drops) {
            this.player.addPart(d.partId, d.qty);
        }
    }

    onEnemyKilled(enemyType, options = {}) {
        const drops = this.rollKillLoot(enemyType, options);
        this.grantDrops(drops);
        return drops;
    }

    _weightedPick(entries) {
        const total = entries.reduce((s, e) => s + (e.weight || 0), 0);
        if (total <= 0) return null;
        let roll = Math.random() * total;
        for (const e of entries) {
            roll -= e.weight || 0;
            if (roll <= 0) return e;
        }
        return entries[entries.length - 1];
    }

    _rollQty(range) {
        const [min, max] = range || [1, 1];
        if (max <= 0) return 0;
        return min + Math.floor(Math.random() * (max - min + 1));
    }

    formatDropMessage(drops) {
        if (!drops.length) return null;
        return drops.map((d) => {
            const meta = PARTS[d.partId];
            const name = meta?.name || d.partId;
            return `${meta?.icon || '◆'} ${name} ×${d.qty}`;
        }).join(' · ');
    }
}
