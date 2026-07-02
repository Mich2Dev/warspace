import { NAME_TAG_COLOR } from '../enemyNames.js';

/** @typedef {import('../EnemyManager.js').EnemyManager} EnemyManager */

export const enemyManagerHudMethods = {
    worldToMinimap(worldX, worldZ) {
        const minimap = document.getElementById('minimap');
        const mapW = minimap ? minimap.clientWidth : 200;
        const mapH = minimap ? minimap.clientHeight : 200;
        return {
            x: (worldX + 12000) / 24000 * mapW,
            z: (worldZ + 12000) / 24000 * mapH,
        };
    },
    _updateEnemyMinimapDot(enemy, dist, time) {
        const dot = enemy.userData?.minimapDot;
        if (!dot) return;

        const isBase = enemy.spawnType !== undefined;
        const isSquad = !!enemy.userData?.isSquadMember;
        const isPatrol = !!enemy.userData?.isPatrol;
        const showOnMap = isBase || isSquad || isPatrol || dist < 11000;

        if (!showOnMap) {
            if (dot.style.display !== 'none') dot.style.display = 'none';
            return;
        }
        if (dot.style.display !== 'block') dot.style.display = 'block';

        const interval = isBase ? 0.45 : isSquad ? (this.combatLoadLevel === 'heavy' ? 0.22 : 0.14) : enemy.userData.sleeping ? 0.3 : 0.14;
        const nextAt = enemy.userData._minimapTickAt ?? 0;
        if (time < nextAt) return;
        enemy.userData._minimapTickAt = time + interval;

        if (!this._minimapPxCache || time >= this._minimapPxCache.until) {
            const el = document.getElementById('minimap');
            this._minimapPxCache = {
                w: el?.clientWidth ?? 200,
                h: el?.clientHeight ?? 200,
                until: time + 0.6,
            };
        }
        const { w, h } = this._minimapPxCache;
        dot.style.left = `${(enemy.position.x + 12000) / 24000 * w}px`;
        dot.style.top = `${(enemy.position.z + 12000) / 24000 * h}px`;
    },

    createEnemyNameTag(name) {
        const nameTag = document.createElement('div');
        nameTag.className = 'enemy-name-tag';
        nameTag.innerText = name;
        nameTag.style.position = 'absolute';
        nameTag.style.color = NAME_TAG_COLOR;
        nameTag.style.fontSize = '12px';
        nameTag.style.fontWeight = '600';
        nameTag.style.textShadow = '0 1px 3px #000, 0 0 6px rgba(0,0,0,0.85)';
        nameTag.style.letterSpacing = '0.03em';
        nameTag.style.pointerEvents = 'none';
        nameTag.style.transform = 'translate(-50%, -100%)';
        nameTag.style.display = 'none';
        nameTag.style.zIndex = '5';
        const uiContainer = document.getElementById('ui');
        if (uiContainer) uiContainer.appendChild(nameTag);
        return nameTag;
    }
};
