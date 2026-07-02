
/** @typedef {import('../EnemyManager.js').EnemyManager} EnemyManager */

export const enemyManagerLifecycleMethods = {
    _destroyEnemyAt(i) {
        const enemy = this.enemies[i];
        if (!enemy) return;

        if (enemy.userData.syncId) {
            this._syncGhosts.delete(enemy.userData.syncId);
        }

        this._clearPlayerTargetFor(enemy);
        this._detachEnemyNameTag(enemy);
        if (enemy.userData.minimapDot) {
            enemy.userData.minimapDot.remove();
        }
        this.scene.remove(enemy);
        this.enemies.splice(i, 1);
    },
    _detachEnemyNameTag(enemy) {
        if (enemy?.userData?.nameTag) {
            enemy.userData.nameTag.remove();
            enemy.userData.nameTag = null;
        }
    },
    _clearPlayerTargetFor(enemy) {
        const p = this.player;
        if (!p?.target || !enemy) return;
        if (p.target === enemy) {
            p.setTarget(null);
            return;
        }
        const targetId = p.targetSyncId || p.target.userData?.syncId;
        const enemyId = enemy.userData?.syncId;
        if (targetId && enemyId && targetId === enemyId) p.setTarget(null);
    },

    /** ¿Este enemigo es el objetivo bloqueado del jugador? */
    _isPlayerTarget(enemy) {
        const p = this.player;
        if (!p?.target || !enemy) return false;
        if (p.target === enemy) return true;
        const targetId = p.targetSyncId || p.target.userData?.syncId;
        const enemyId = enemy.userData?.syncId;
        return !!(targetId && enemyId && targetId === enemyId);
    },

    forceDespawnEnemy(enemy, noRewards = true) {
        if (!enemy) return;
        if (noRewards) enemy.userData.noRewards = true;
        enemy.userData.hp = 0;

        this._detachEnemyNameTag(enemy);
        this._clearPlayerTargetFor(enemy);

        if (enemy.userData.minimapDot && enemy.userData.minimapDot.parentNode) {
            enemy.userData.minimapDot.parentNode.removeChild(enemy.userData.minimapDot);
        }

        this.scene.remove(enemy);
        this.enemies = this.enemies.filter(e => e !== enemy);

        if (this.player && this.player.target === enemy) {
            this.player.setTarget(null);
        }
    },
    _processRespawnQueue() {
        // Patrullas sueltas desactivadas — no respawn automático de unidades sueltas.
    },
    _disposeMissileVisual(m) {
        if (!m?.mesh) return;
        this.scene.remove(m.mesh);
        m.mesh.visible = false;
        if (!this._missilePool) this._missilePool = [];
        if (this._missilePool.length < (this._missilePoolMax ?? 6)) {
            this._missilePool.push(m.mesh);
        }
    }
};
