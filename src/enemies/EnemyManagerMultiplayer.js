import * as THREE from 'three';
import { CONFIG } from '../../config.js';
import { MobileEnemy, Spawner } from './EnemyEntities.js';
import { ZONE_META } from './zoneMeta.js';
import {
    ENEMY_DESIGNS,
    getPatrolCommanderTemplate,
} from './enemyModelCatalog.js';

/** @typedef {import('../EnemyManager.js').EnemyManager} EnemyManager */

export const enemyManagerMultiplayerMethods = {
    setMultiplayer(mode, combatSync = null) {
        const wasGuest = this._mpMode === 'guest';
        this._mpMode = mode || 'solo';
        this._combatSync = combatSync;
        if (mode === 'guest') {
            this._mpGuestClearPending = true;
            this.patrolSquads?.despawnAll?.();
            return;
        }
        this._mpGuestClearPending = false;
        if (mode === 'host') {
            if (wasGuest) {
                for (const [id, ghost] of [...this._syncGhosts]) {
                    this._removeSyncGhost(id, ghost);
                }
                this._syncGhostMissCount.clear();
                this._pendingSyncData.clear();
            }
            this._ensureHostWorld(wasGuest);
        }
    },

    _aliveMobileCount() {
        if (this._mpMode === 'host') {
            return this.collectWorldSync().length;
        }
        return this.enemies.filter(
            (e) => e.spawnType === undefined && !e.userData.syncGhost && (e.userData.hp ?? 0) > 0,
        ).length;
    },
    _pruneSpawnerUnits() {
        for (const spawner of this.enemies) {
            if (spawner.spawnType === undefined || !spawner.spawnedUnits?.length) continue;
            spawner.spawnedUnits = spawner.spawnedUnits.filter(
                (u) => this.enemies.includes(u) && (u.userData?.hp ?? 0) > 0,
            );
        }
    },

    /** Host debe tener mundo poblado (solo→host, modelos tardíos, promoción guest→host). */
    _ensureHostWorld(reseedPatrols = false) {
        if (this._mpMode !== 'host') return;
        this._pruneSpawnerUnits();
        this._bootstrapHostEnemies();
        const mobileCount = this._aliveMobileCount();
        if (reseedPatrols || mobileCount < ENEMY_DESIGNS.length * 3) {
            this.patrolSquads?.despawnAll?.();
            this._spawnedPatrolKeys.clear();
            this._gameRef?.worldDirector?.spawnPatrols(this.environment);
            this.patrolSquads?.trySpawn(this.environment);
        }
        this._trySpawnPatrolQueue();
        this._gameRef?._pushWorldSync?.();
    },

    updateRemoteCombatTargets(players, localId) {
        this._remoteCombatTargets = [];
        const localKey = localId != null ? String(localId) : null;
        for (const p of players || []) {
            if (localKey && String(p.id) === localKey) continue;
            this._remoteCombatTargets.push({
                id: String(p.id),
                pos: new THREE.Vector3(p.x ?? 0, p.y ?? 50, p.z ?? 0),
                hp: p.hp ?? 200,
                maxHp: p.maxHp ?? 200,
            });
        }
    },
    getCombatTarget(fromPos, localPlayer) {
        this._nearestCombatPos.copy(localPlayer.position);
        let bestDist = fromPos.distanceTo(this._nearestCombatPos);
        for (const t of this._remoteCombatTargets) {
            const d = fromPos.distanceTo(t.pos);
            if (d < bestDist) {
                bestDist = d;
                this._nearestCombatPos.copy(t.pos);
            }
        }
        return this._nearestCombatPos;
    },
    _clearLocalMobileEnemies() {
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];
            if (enemy.spawnType !== undefined) continue;
            if (enemy.userData.syncGhost) continue;
            if (enemy.userData.isSquadMember) continue;
            this._destroyEnemyAt(i);
        }
        this._pruneSpawnerUnits();
    },

    removeSyncGhostById(syncId) {
        if (!syncId) return;
        const ghost = this._syncGhosts.get(syncId);
        if (ghost) this._removeSyncGhost(syncId, ghost);
    },
    purgeAllSyncGhosts() {
        for (const [id, ghost] of [...this._syncGhosts]) {
            this._removeSyncGhost(id, ghost);
        }
        this._syncGhostMissCount.clear();
        this._pendingSyncData.clear();
    },

    /** Daño de invitado → host valida antes de aplicar al enemigo real. */
    applyGuestEnemyDamage(fromPlayerId, payload) {
        if (this._mpMode !== 'host') return false;
        const syncId = payload?.id;
        if (!syncId) return false;

        const enemy = this.enemies.find(
            (e) => e.userData.syncId === syncId && !e.userData.syncGhost,
        );
        if (!enemy || (enemy.userData.hp ?? 0) <= 0) return false;

        const amount = Math.max(1, Math.min(80, Math.round(payload.amount ?? 5)));
        const key = `${fromPlayerId}:${syncId}`;
        const now = Date.now();
        if (now - (this._guestDamageAt.get(key) || 0) < 120) return false;
        this._guestDamageAt.set(key, now);

        const guest = window.__game?.remotePlayers?.remote.get(String(fromPlayerId));
        const guestPos = guest?.display || guest?.mesh?.position;
        if (!guestPos) return false;
        if (guestPos.distanceTo(enemy.position) > 4200) return false;

        this.takeDamage(enemy, amount);
        return true;
    },
    collectWorldSync() {
        const now = performance.now();
        if (this._worldSyncCache && now - (this._worldSyncCacheAt ?? 0) < 280) {
            return this._worldSyncCache;
        }

        const player = this.player;
        const px = player?.position?.x ?? 0;
        const pz = player?.position?.z ?? 0;
        const nowSec = Date.now() * 0.001;
        const farSq = 8200 * 8200;
        const list = [];

        for (const enemy of this.enemies) {
            if (enemy.spawnType !== undefined || enemy.userData.syncGhost) continue;
            if ((enemy.userData.hp ?? 0) <= 0) continue;

            const dx = enemy.position.x - px;
            const dz = enemy.position.z - pz;
            const distSq = dx * dx + dz * dz;
            const engaged = (enemy.userData.forcedAggroUntil ?? 0) > nowSec
                || (enemy.userData.aggressorUntil ?? 0) > nowSec;
            if (distSq > farSq && !engaged && enemy.userData.sleeping) continue;

            if (!enemy.userData.syncId) {
                enemy.userData.syncId = `e_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
            }
            list.push({
                id: enemy.userData.syncId,
                type: enemy.userData.type,
                name: enemy.userData.name,
                x: enemy.position.x,
                y: enemy.position.y,
                z: enemy.position.z,
                ry: enemy.rotation.y,
                hp: enemy.userData.hp,
                maxHp: enemy.userData.maxHp,
                role: enemy.userData.patrolRole || null,
                squadId: enemy.userData.squadId || null,
            });
        }
        this._worldSyncCache = list;
        this._worldSyncCacheAt = now;
        return list;
    },

    invalidateWorldSyncCache() {
        this._worldSyncCache = null;
        this._worldSyncCacheAt = 0;
    },
    applyWorldSync(enemies) {
        if (this._mpMode !== 'guest') return;
        const list = enemies || [];
        // Sync vacÃ­o = host aÃºn poblando el mundo
        if (!list.length) return;

        if (this._mpGuestClearPending) {
            this._clearLocalMobileEnemies();
            this._spawnedPatrolKeys.clear();
            this._mpGuestClearPending = false;
        }

        const seen = new Set();
        for (const data of list) {
            if ((data.hp ?? 0) <= 0) {
                const dead = this._syncGhosts.get(data.id);
                if (dead) this._removeSyncGhost(data.id, dead);
                continue;
            }
            seen.add(data.id);
            let ghost = this._syncGhosts.get(data.id);
            if (!ghost) {
                ghost = this._spawnSyncGhost(data);
                if (ghost) {
                    this._syncGhosts.set(data.id, ghost);
                    this._pendingSyncData.delete(data.id);
                } else {
                    this._pendingSyncData.set(data.id, data);
                }
            }
            if (ghost) {
                this._syncGhostMissCount.delete(data.id);
            }
            if (!ghost) continue;
            ghost.userData._syncTarget = {
                x: data.x, y: data.y, z: data.z, ry: data.ry,
                hp: data.hp, maxHp: data.maxHp,
            };
            ghost.userData.hp = data.hp;
            ghost.userData.maxHp = data.maxHp;
            ghost.visible = true;
        }
        for (const [id, ghost] of this._syncGhosts) {
            if (!seen.has(id)) {
                const miss = (this._syncGhostMissCount.get(id) || 0) + 1;
                this._syncGhostMissCount.set(id, miss);
                if (miss >= 4) {
                    this._removeSyncGhost(id, ghost);
                    this._syncGhostMissCount.delete(id);
                }
            }
        }
    },

    _syncTemplateReady(spawnType, role) {
        if (!this._patrolReady({ type: spawnType, role })) return false;
        const tpl = role === 'squad_commander'
            ? getPatrolCommanderTemplate(this)
            : this.getPatrolTemplate(spawnType);
        if (!tpl) return false;
        let hasMesh = false;
        tpl.traverse((c) => { if (c.isMesh) hasMesh = true; });
        return hasMesh && !this._isPlaceholderTemplate(tpl);
    },
    _spawnSyncGhost(data) {
        const spawnType = data.type || 'Zona1';
        let enemy = null;

        if (this._syncTemplateReady(spawnType, data.role)) {
            enemy = this.spawnPatrolUnit(data.x, data.z, spawnType, {
                role: data.role,
                isPatrol: true,
                label: data.name,
                _allowGuest: true,
            });
        }
        if (!enemy) enemy = this._spawnSyncGhostFallback(data);
        if (!enemy) return null;

        enemy.userData.syncGhost = true;
        enemy.userData.syncId = data.id;
        enemy.userData.hp = data.hp ?? enemy.userData.hp;
        enemy.userData.maxHp = data.maxHp ?? enemy.userData.maxHp;
        if (data.y != null) enemy.position.y = data.y;
        return enemy;
    },

    /** Placeholder visible si los modelos GLB aún no cargaron en el invitado. */
    _spawnSyncGhostFallback(data) {
        const spawnType = data.type || 'Zona1';
        const zoneMeta = ZONE_META[spawnType] || ZONE_META.Zona1;
        const hp = data.maxHp ?? data.hp ?? CONFIG.COMBAT[`${spawnType.toUpperCase()}_HP`] ?? 100;
        const speed = CONFIG.COMBAT[`${spawnType.toUpperCase()}_SPEED`] ?? 80;
        const boxSize = CONFIG.VISUALS[spawnType.toUpperCase() + '_BOX_SIZE'] || 40;
        const ringSize = CONFIG.VISUALS[spawnType.toUpperCase() + '_RING_SIZE'] || 50;
        const tint = { Zona1: 0xff5544, Zona2: 0x4499ff, Zona3: 0xbb55ff };

        const enemy = new MobileEnemy(this, spawnType, data.name || zoneMeta.name, hp, speed);
        enemy.userData.isPatrol = true;
        enemy.userData.patrolRole = data.role || null;
        enemy.userData.dangerColor = zoneMeta.dangerColor;

        const color = tint[spawnType] || 0xff6644;
        const mat = new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: 0.45,
            metalness: 0.6,
            roughness: 0.35,
        });
        const body = new THREE.Mesh(new THREE.BoxGeometry(boxSize, boxSize * 0.45, boxSize * 1.15), mat);
        body.frustumCulled = false;
        enemy.visualGroup.add(body);

        const ringGeo = new THREE.RingGeometry(ringSize * 0.8, ringSize, 32);
        const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
            color: 0xff3333, side: THREE.DoubleSide, transparent: true, opacity: 0.8,
        }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = -2;
        ring.visible = false;
        enemy.add(ring);
        enemy.userData.selectionRing = ring;

        enemy.createMinimapDot(
            document.getElementById('minimap-enemies'),
            zoneMeta.minimapClass,
            zoneMeta.minimapText,
        );
        enemy.userData.nameTag = this.createEnemyNameTag(data.name || zoneMeta.name);
        this._placeEnemyAt(enemy, data.x, data.z);
        if (data.y != null) enemy.position.y = data.y;
        this.scene.add(enemy);
        this.enemies.push(enemy);
        return enemy;
    },
    _retryPendingSyncGhosts() {
        if (this._mpMode !== 'guest' || !this._pendingSyncData.size) return;
        for (const data of this._pendingSyncData.values()) {
            if (this._syncGhosts.has(data.id)) continue;
            const ghost = this._spawnSyncGhost(data);
            if (ghost) {
                this._syncGhosts.set(data.id, ghost);
                this._pendingSyncData.delete(data.id);
                ghost.userData._syncTarget = {
                    x: data.x, y: data.y, z: data.z, ry: data.ry,
                    hp: data.hp, maxHp: data.maxHp,
                };
            }
        }
    },
    _refreshBrokenSyncGhosts() {
        if (this._mpMode !== 'guest') return;
        for (const [id, ghost] of this._syncGhosts) {
            let hasMesh = false;
            ghost.traverse((c) => { if (c.isMesh && c.visible !== false) hasMesh = true; });
            if (hasMesh) continue;
            const data = ghost.userData._syncTarget;
            this._removeSyncGhost(id, ghost);
            if (data) {
                this._pendingSyncData.set(id, {
                    id,
                    type: ghost.userData.type,
                    name: ghost.userData.name,
                    role: ghost.userData.patrolRole,
                    ...data,
                });
            }
        }
        this._retryPendingSyncGhosts();
    },
    _removeSyncGhost(id, ghost) {
        if (this.player?.target === ghost) {
            this.player.setTarget(null);
        }
        const idx = this.enemies.indexOf(ghost);
        if (idx >= 0) this._destroyEnemyAt(idx);
        else this._syncGhosts.delete(id);
    },
    _updateSyncGhost(enemy, delta) {
        const t = enemy.userData._syncTarget;
        if (!t) return;
        const lerp = 1 - Math.pow(0.001, delta);
        enemy.position.x += (t.x - enemy.position.x) * lerp;
        enemy.position.y += (t.y - enemy.position.y) * lerp;
        enemy.position.z += (t.z - enemy.position.z) * lerp;
        enemy.rotation.y += (t.ry - enemy.rotation.y) * lerp;
        enemy.userData.velocity.set(0, 0, 0);
    },

    _snapSpawnerHeights() {
        if (!this.environment) return;
        for (const enemy of this.enemies) {
            if (!(enemy instanceof Spawner)) continue;
            const h = this.environment.getHeightAt(enemy.position.x, enemy.position.z);
            enemy.position.y = Math.max(h + 35, 40);
        }
    },
};
