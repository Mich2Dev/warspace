import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CONFIG } from '../../config.js';
import { isAccessibleSpawnPoint } from '../terrainRules.js';
import { snapToNavPoint } from '../worldNav.js';
import { isInHubSafeZone, pushOutOfSafeZone } from '../hubSafe.js';
import { resolveEnemyDisplayName, getRoleDisplayLabel } from '../enemyNames.js';
import { getMovementProfile, getVisualVariant } from '../enemyVisuals.js';
import { applyRoleToEnemy } from '../enemyRoles.js';
import { mergeSquadRoleIntoEnemy, SQUAD_VISUAL, SQUAD_ROLES } from '../patrols/squadRoles.js';
import { MobileEnemy, Spawner } from './EnemyEntities.js';
import { ZONE_META } from './zoneMeta.js';
import { getEnemyTemplate, getSquadUnitTemplate, PATROL_DESIGN_KEYS, getPatrolDesignVisuals } from './enemyModelCatalog.js';
import { applyZoneBehaviorToEnemy } from './zoneBehaviors.js';

export const enemySpawnerMethods = {
_bootstrapHostEnemies() {
        if (this._gameRef && !this._gameRef._sessionActive) return;
        for (const spawner of this.enemies) {
            if (spawner.spawnType === undefined) continue;
            const alive = spawner.spawnedUnits.filter(
                (u) => this.enemies.includes(u) && (u.userData?.hp ?? 0) > 0,
            ).length;
            for (let i = alive; i < spawner.maxUnits; i++) {
                this.spawnUnitFromSpawner(spawner);
            }
        }
    },

    _checkAndSpawnWorldBoss() {
        if (this._mpMode === 'guest') return;
        const bossAlive = this.enemies.some(e => e.userData?.type === 'Boss' && (e.userData?.hp ?? 0) > 0);
        if (!bossAlive && this._modelsReady?.boss) {
            this.spawnWorldBoss();
        }
    },

    spawnWorldBoss() {
        if (!this.environment) return;
        const spawnType = 'Boss';
        const zoneMeta = ZONE_META[spawnType];
        if (!zoneMeta) return;

        const hp = CONFIG.COMBAT.BOSS_HP;
        const speed = CONFIG.COMBAT.BOSS_SPEED;
        const template = getEnemyTemplate(this, spawnType);
        const ringSize = CONFIG.VISUALS.BOSS_RING_SIZE;
        const boxSize = CONFIG.VISUALS.BOSS_BOX_SIZE;

        if (!template) return;

        // Try to spawn far away from player but on valid nav ground
        let sx, sz;
        let found = false;
        for (let i = 0; i < 30; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 3000 + Math.random() * 5000;
            const rawX = this.player.position.x + Math.cos(angle) * dist;
            const rawZ = this.player.position.z + Math.sin(angle) * dist;
            const snapped = snapToNavPoint(this.environment, rawX, rawZ);
            if (isAccessibleSpawnPoint(this.environment, snapped.x, snapped.z)) {
                sx = snapped.x;
                sz = snapped.z;
                found = true;
                break;
            }
        }
        if (!found) {
            // Fallback
            sx = 0; sz = -4000;
        }

        const enemy = new MobileEnemy(this, spawnType, zoneMeta.name, hp, speed);
        enemy.userData.dangerColor = zoneMeta.dangerColor;
        enemy.userData.isWorldBoss = true;
        
        this._setupEnemyVisuals(enemy, spawnType, template, ringSize, boxSize, null);
        enemy.createMinimapDot(document.getElementById('minimap-enemies'), zoneMeta.minimapClass);
        enemy.userData.nameTag = this.createEnemyNameTag(zoneMeta.name);
        if (!enemy.userData.syncId) {
            enemy.userData.syncId = `boss_${Date.now()}`;
        }

        this._placeEnemyAt(enemy, sx, sz);

        const bZ = boxSize * 0.45;
        enemy.userData.engineAnchors = [];
        this.createEngineAnchor(enemy, new THREE.Vector3(0, boxSize*0.1, bZ), boxSize*0.8);
        this.createEngineAnchor(enemy, new THREE.Vector3(-boxSize*0.3, 0, bZ), boxSize*0.6);
        this.createEngineAnchor(enemy, new THREE.Vector3(boxSize*0.3, 0, bZ), boxSize*0.6);

        applyZoneBehaviorToEnemy(enemy);
        this.scene.add(enemy);
        this.enemies.push(enemy);

        const log = document.getElementById('log-text');
        if (log) {
            log.innerHTML = `<span style="color:#ffaa00; font-weight:bold;">¡ADVERTENCIA: EL JEFE DE MUNDO HA SIDO DETECTADO EN LA ÓRBITA INFERIOR!</span>`;
        }
    },

_findSpawnNear(spawner, spread) {
        const env = this.environment;
        const baseX = spawner.position.x;
        const baseZ = spawner.position.z;
        const minDist = Math.max(520, spread * 0.38);
        const minSepSq = 320 * 320;

        const siblings = (spawner.spawnedUnits || []).filter(
            (u) => u?.userData?.hp > 0,
        );

        for (let i = 0; i < 48; i++) {
            let x, z;
            
            // 25% chance to spawn on a random wide location / corridor to populate empty areas
            if (Math.random() < 0.25) {
                const angle = Math.random() * Math.PI * 2;
                const r = 2000 + Math.random() * 7000;
                x = baseX + Math.cos(angle) * r;
                z = baseZ + Math.sin(angle) * r;
            } else {
                // Uniform scatter across the entire zone radius (no donut hole)
                const angle = Math.random() * Math.PI * 2;
                const dist = Math.random() * (spread * 1.8);
                x = baseX + Math.cos(angle) * dist;
                z = baseZ + Math.sin(angle) * dist;
            }

            if (env && !isAccessibleSpawnPoint(env, x, z)) continue;

            let crowded = false;
            for (const other of siblings) {
                const dx = x - other.position.x;
                const dz = z - other.position.z;
                if (dx * dx + dz * dz < minSepSq) {
                    crowded = true;
                    break;
                }
            }
            if (crowded) continue;
            return { x, z };
        }

        const fallbackAngle = Math.random() * Math.PI * 2;
        const fallbackDist = minDist + spread * 0.55;
        const rawX = baseX + Math.cos(fallbackAngle) * fallbackDist;
        const rawZ = baseZ + Math.sin(fallbackAngle) * fallbackDist;
        const snapped = snapToNavPoint(this.environment, rawX, rawZ);
        if (isAccessibleSpawnPoint(this.environment, snapped.x, snapped.z)) {
            return { x: snapped.x, z: snapped.z };
        }
        return null;
    },

_placeEnemyAt(enemy, x, z) {
        const y = this._hoverYFor(enemy, x, z);
        enemy.position.set(x, y, z);
        if (this.environment) {
            enemy.userData._cachedTerrainH = this.environment.getHeightAt(x, z);
        }
    },

_hoverYFor(enemy, x, z) {
        const profile = getMovementProfile(enemy.userData?.type || 'Zona1');
        const hover = enemy.userData?.hoverHeight ?? profile.hover ?? 40;
        const h = this.environment?.getHeightAt(x, z) ?? 0;
        return Math.max(hover, h + hover);
    },

spawnUnitFromSpawner(spawner) {
        if (this._mpMode === 'guest') return;
        let spawnType = spawner.spawnType;
        if (!this._isZoneModelReady(spawnType)) return;
        let hp, speed, template, ringSize, boxSize;
        const zoneMeta = ZONE_META[spawnType];

        if (!zoneMeta) return;

        hp = CONFIG.COMBAT[`${spawnType.toUpperCase()}_HP`];
        speed = CONFIG.COMBAT[`${spawnType.toUpperCase()}_SPEED`];
        template = getEnemyTemplate(this, spawnType);

        ringSize = CONFIG.VISUALS[spawnType.toUpperCase() + '_RING_SIZE'];
        boxSize = CONFIG.VISUALS[spawnType.toUpperCase() + '_BOX_SIZE'];

        const enemy = new MobileEnemy(this, spawnType, zoneMeta.name, hp, speed);
        enemy.userData.spawner = spawner;
        enemy.userData.dangerColor = zoneMeta.dangerColor;
        const variant = getVisualVariant(spawnType, null);

        this._setupEnemyVisuals(enemy, spawnType, template, ringSize, boxSize, variant);
        enemy.createMinimapDot(document.getElementById('minimap-enemies'), zoneMeta.minimapClass);
        enemy.userData.nameTag = this.createEnemyNameTag(zoneMeta.name);
        if (!enemy.userData.syncId) {
            enemy.userData.syncId = `e_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        }

        this.scene.add(enemy);

        const zoneKey = { Zona1: 'ZONA1', Zona2: 'ZONA2', Zona3: 'ZONA3' }[spawnType];
        const zone = CONFIG.ZONES[zoneKey];
        const spread = zone?.radius ? zone.radius * 0.52 : 900;
        const pos = this._findSpawnNear(spawner, spread);
        if (!pos) {
            this.scene.remove(enemy);
            return;
        }
        this._placeEnemyAt(enemy, pos.x, pos.z);

        enemy.userData.homeX = spawner.position.x;
        enemy.userData.homeZ = spawner.position.z;
        enemy.userData.leashRadius = (zone?.radius ?? 2800) * 0.78;
        enemy.userData.regionId = zone?.regionId ?? null;

        // Colocar "Anclajes" de motor invisibles
        const bZ = boxSize * 0.45; // Parte trasera de la nave
        enemy.userData.engineAnchors = [];

        if (spawnType === 'Zona1') {
            const positions = [
                new THREE.Vector3(0, boxSize*0.05, bZ),
                new THREE.Vector3(boxSize*0.25, boxSize*0.2, bZ),
                new THREE.Vector3(-boxSize*0.25, boxSize*0.2, bZ),
                new THREE.Vector3(boxSize*0.6, 0, bZ * 0.9),
                new THREE.Vector3(-boxSize*0.6, 0, bZ * 0.9)
            ];
            const sizes = [boxSize*0.4, boxSize*0.3, boxSize*0.3, boxSize*0.5, boxSize*0.5];
            positions.forEach((pos, i) => {
                this.createEngineAnchor(enemy, pos, sizes[i]);
            });
        } else if (spawnType === 'Zona2') {
            const p1 = new THREE.Vector3(boxSize*0.3, 0, bZ);
            const p2 = new THREE.Vector3(-boxSize*0.3, 0, bZ);
            this.createEngineAnchor(enemy, p1, boxSize*0.6);
            this.createEngineAnchor(enemy, p2, boxSize*0.6);
        } else {
            this.createEngineAnchor(enemy, new THREE.Vector3(0, 0, bZ), boxSize*1.0);
        }

        applyZoneBehaviorToEnemy(enemy);
        this.enemies.push(enemy);
        spawner.spawnedUnits.push(enemy);
    },

spawnPatrolUnit(x, z, spawnType, options = {}) {
        if (this._mpMode === 'guest' && !options._allowGuest) return null;
        const zoneMeta = ZONE_META[spawnType];
        if (!zoneMeta) return null;

        const hp = CONFIG.COMBAT[`${spawnType.toUpperCase()}_HP`];
        const speed = CONFIG.COMBAT[`${spawnType.toUpperCase()}_SPEED`];
        const template = this.getPatrolTemplate(spawnType);
        const ringSize = CONFIG.VISUALS[spawnType.toUpperCase() + '_RING_SIZE'];
        const boxSize = CONFIG.VISUALS[spawnType.toUpperCase() + '_BOX_SIZE'];

        if (!options._allowGuest && !template && !this._patrolReady({ type: spawnType, role: options.role })) return null;
        if (!options._allowGuest && template && !this._patrolReady({ type: spawnType, role: options.role })) return null;

        if (!options._allowGuest && this.environment && !isAccessibleSpawnPoint(this.environment, x, z)) {
            return null;
        }
        if (!options._allowGuest && isInHubSafeZone(x, z, 120)) {
            return null;
        }

        const displayName = resolveEnemyDisplayName(spawnType, options.role || null, options.label || '');
        const roleLabel = getRoleDisplayLabel(options.role || null);
        const variant = getVisualVariant(spawnType, options.role || options.label || '');

        const enemy = new MobileEnemy(this, spawnType, displayName, hp, speed);
        enemy.userData.dangerColor = zoneMeta.dangerColor;
        enemy.userData.isPatrol = !!options.isPatrol;
        enemy.userData.patrolAnchor = { x, z };
        enemy.userData.patrolRole = options.role || null;
        enemy.userData.roleLabel = roleLabel;
        enemy.userData.patrolRegionId = options.regionId || null;

        this._setupEnemyVisuals(enemy, spawnType, template, ringSize, boxSize, variant);
        enemy.createMinimapDot(document.getElementById('minimap-enemies'), zoneMeta.minimapClass);
        enemy.userData.nameTag = this.createEnemyNameTag(zoneMeta.name);
        if (!enemy.userData.syncId) {
            enemy.userData.syncId = `e_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        }

        this._placeEnemyAt(enemy, x, z);

        const bZ = boxSize * 0.45;
        enemy.userData.engineAnchors = [];
        if (spawnType === 'Zona1') {
            this.createEngineAnchor(enemy, new THREE.Vector3(0, boxSize * 0.05, bZ), boxSize * 0.4);
        } else if (spawnType === 'Zona2') {
            this.createEngineAnchor(enemy, new THREE.Vector3(boxSize * 0.3, 0, bZ), boxSize * 0.6);
            this.createEngineAnchor(enemy, new THREE.Vector3(-boxSize * 0.3, 0, bZ), boxSize * 0.6);
        } else {
            this.createEngineAnchor(enemy, new THREE.Vector3(0, 0, bZ), boxSize * 1.0);
        }

        this.scene.add(enemy);
        applyRoleToEnemy(enemy, options.role || null);
        applyZoneBehaviorToEnemy(enemy);
        this.enemies.push(enemy);
        return enemy;
    },

spawnSquadUnit(x, z, spawnType, options = {}) {
        const roleKey = options.role;
        if (!roleKey?.startsWith?.('squad_')) return null;

        const unitType = options.enemyType || spawnType;
        const zoneMeta = ZONE_META[unitType];
        if (!zoneMeta) return null;
        if (!this._patrolSlotReady?.(options.patrolDesign, unitType)) return null;

        let sx = x;
        let sz = z;
        if (this.environment && !isAccessibleSpawnPoint(this.environment, sx, sz)) {
            let ok = false;
            for (let k = 0; k < 16; k++) {
                const ox = x + (Math.random() - 0.5) * 640;
                const oz = z + (Math.random() - 0.5) * 640;
                if (isAccessibleSpawnPoint(this.environment, ox, oz)) {
                    sx = ox;
                    sz = oz;
                    ok = true;
                    break;
                }
            }
            if (!ok) {
                const snapped = snapToNavPoint(this.environment, x, z);
                sx = snapped.x;
                sz = snapped.z;
            }
        }
        if (isInHubSafeZone(sx, sz, 80)) {
            const out = pushOutOfSafeZone(sx, sz, 280);
            sx = out.x;
            sz = out.z;
        }
        if (this.environment) {
            if (!isAccessibleSpawnPoint(this.environment, sx, sz)) {
                const snapped = snapToNavPoint(this.environment, sx, sz);
                sx = snapped.x;
                sz = snapped.z;
            }
            if (!isAccessibleSpawnPoint(this.environment, sx, sz)) return null;
        }

        const hp = CONFIG.COMBAT[`${unitType.toUpperCase()}_HP`];
        const speed = CONFIG.COMBAT[`${unitType.toUpperCase()}_SPEED`];
        let resolvedTemplate = getSquadUnitTemplate(this, unitType, roleKey, options.patrolDesign);
        if (!resolvedTemplate) return null;

        const patrolVisuals = options.patrolDesign
            ? getPatrolDesignVisuals(options.patrolDesign)
            : null;
        const ringSize = patrolVisuals?.ringSize ?? CONFIG.VISUALS[unitType.toUpperCase() + '_RING_SIZE'];
        const boxSize = patrolVisuals?.boxSize ?? CONFIG.VISUALS[unitType.toUpperCase() + '_BOX_SIZE'];
        const squadVisual = SQUAD_VISUAL[roleKey];
        const patrolDef = options.patrolDesign ? PATROL_DESIGN_KEYS[options.patrolDesign] : null;
        const variant = options.patrolDesign && patrolDef
            ? { preserveOriginal: true, scale: 1.0 }
            : roleKey === 'squad_commander'
            ? { preserveOriginal: true, scale: 1.05 }
            : squadVisual?.tint
            ? {
                preserveOriginal: false,
                tint: squadVisual.tint,
                emissive: squadVisual.emissive,
                tintStrength: squadVisual.tintStrength ?? 0.28,
                scale: squadVisual.scale ?? 1.0,
            }
            : { preserveOriginal: true, scale: 1.0 };

        const designLabels = { comandante: 'Comandante', escolta: 'Escolta', droid: 'Droid' };
        const roleLabel = SQUAD_ROLES[roleKey]?.label || getRoleDisplayLabel(roleKey) || 'Patrulla';
        let designLabel = designLabels[options.patrolDesign] || roleLabel;
        if (options.patrolDesign === 'droid' && typeof options.squadSlot === 'number') {
            designLabel = options.squadSlot >= 3 ? 'Droid 2' : 'Droid 1';
        }
        const displayName = options.squadName ? designLabel : resolveEnemyDisplayName(unitType, roleKey);

        const enemy = new MobileEnemy(this, unitType, displayName, hp, speed);
        enemy.userData.dangerColor = zoneMeta.dangerColor;
        enemy.userData.isPatrol = false;
        enemy.userData.isSquadMember = true;
        enemy.userData.squadId = options.squadId || null;
        enemy.userData.squadSlot = options.squadSlot ?? 0;
        enemy.userData._formationScale = options.formationScale ?? boxSize;
        enemy.userData.squadName = options.squadName || null;
        enemy.userData.patrolRole = roleKey;
        enemy.userData.patrolDesign = options.patrolDesign || null;
        enemy.userData.patrolRegionId = options.regionId || null;
        enemy.userData.regionId = options.regionId || null;
        enemy.userData.roleLabel = roleLabel;

        this._setupEnemyVisuals(enemy, unitType, resolvedTemplate, ringSize, boxSize, variant);
        const minimapClass = squadVisual?.minimapClass || zoneMeta.minimapClass;
        const minimapText = roleKey === 'squad_commander' ? '★'
            : roleKey === 'squad_missile' ? 'M'
            : roleKey === 'squad_escort' ? 'Esc'
            : zoneMeta.minimapText;
        enemy.createMinimapDot(document.getElementById('minimap-enemies'), minimapClass, minimapText);

        const nameTag = this.createEnemyNameTag(displayName);
        if (squadVisual?.nameTagColor) nameTag.style.color = squadVisual.nameTagColor;
        if (!enemy.userData.syncId) {
            enemy.userData.syncId = `sq_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        }

        this._placeEnemyAt(enemy, sx, sz);
        mergeSquadRoleIntoEnemy(enemy, roleKey);
        applyZoneBehaviorToEnemy(enemy);
        if (roleKey === 'squad_missile') {
            const slot = options.squadSlot ?? 0;
            enemy.userData.nextMissileAt = (Date.now() * 0.001) + (slot - 1) * 8 + 4;
        }

        const bZ = boxSize * 0.45;
        enemy.userData.engineAnchors = [];
        if (unitType === 'Zona1') {
            this.createEngineAnchor(enemy, new THREE.Vector3(0, boxSize * 0.05, bZ), boxSize * 0.4);
        } else if (unitType === 'Zona2') {
            this.createEngineAnchor(enemy, new THREE.Vector3(boxSize * 0.3, 0, bZ), boxSize * 0.6);
            this.createEngineAnchor(enemy, new THREE.Vector3(-boxSize * 0.3, 0, bZ), boxSize * 0.6);
        } else {
            this.createEngineAnchor(enemy, new THREE.Vector3(0, 0, bZ), boxSize * 1.0);
        }

        this.scene.add(enemy);
        this.enemies.push(enemy);
        return enemy;
    },

spawnInvasionUnit(zoneKey, anchorPosition = null, options = {}) {
        if (this._mpMode === 'guest') return null;
        const byZone = {
            ZONA1: { type: 'Invader_Alpha', ringSize: 46, boxSize: 56, template: this.invader_alphaGroup },
            ZONA2: { type: 'Invader_Beta', ringSize: 50, boxSize: 62, template: this.invader_betaGroup },
            ZONA3: { type: 'Invader_Gamma', ringSize: 55, boxSize: 70, template: this.invader_gammaGroup },
        };
        const plan = byZone[zoneKey];
        if (!plan) return null;

        const meta = ZONE_META[plan.type];
        if (!meta) return null;

        const hpBase = CONFIG.COMBAT[`${plan.type.toUpperCase()}_HP`] || 180;
        const speedBase = CONFIG.COMBAT[`${plan.type.toUpperCase()}_SPEED`] || 180;
        const hp = Math.round(hpBase * (options.hpMultiplier || 1));
        const speed = speedBase * (options.speedMultiplier || 1);
        const enemyName = options.nameOverride || meta.name;
        const enemy = new MobileEnemy(this, plan.type, enemyName, hp, speed);
        enemy.userData.dangerColor = meta.dangerColor;
        enemy.userData.isEventUnit = true;
        enemy.userData.eventTag = options.eventTag || null;
        enemy.userData.eventZoneKey = zoneKey;
        enemy.userData.isMiniBoss = !!options.isMiniBoss;

        enemy.setupVisuals(plan.template, plan.ringSize, plan.boxSize);
        enemy.createMinimapDot(document.getElementById('minimap-enemies'), meta.minimapClass, meta.minimapText);
        enemy.userData.nameTag = this.createEnemyNameTag(enemyName);
        const zoneCenter = CONFIG.ZONES[zoneKey] || { x: 0, z: 0 };
        const anchor = anchorPosition || zoneCenter;
        const angle = Math.random() * Math.PI * 2;
        const dist = options.spawnRadius !== undefined ? options.spawnRadius : (260 + Math.random() * 520);
        const rawX = anchor.x + Math.cos(angle) * dist;
        const rawZ = anchor.z + Math.sin(angle) * dist;
        const snapped = snapToNavPoint(this.environment, rawX, rawZ);
        if (this.environment && !isAccessibleSpawnPoint(this.environment, snapped.x, snapped.z)) return null;
        this._placeEnemyAt(enemy, snapped.x, snapped.z);

        const bZ = plan.boxSize * 0.45;
        enemy.userData.engineAnchors = [];
        this.createEngineAnchor(enemy, new THREE.Vector3(0, 0, bZ), plan.boxSize * 0.8);
        this.createEngineAnchor(enemy, new THREE.Vector3(plan.boxSize * 0.22, 0, bZ * 0.95), plan.boxSize * 0.55);
        this.createEngineAnchor(enemy, new THREE.Vector3(-plan.boxSize * 0.22, 0, bZ * 0.95), plan.boxSize * 0.55);

        if (enemy.userData.isMiniBoss) {
            enemy.scale.setScalar(1.35);
            if (enemy.userData.nameTag) {
                enemy.userData.nameTag.style.fontSize = '14px';
            }
            const teleRingMat = new THREE.MeshBasicMaterial({
                color: meta.dangerColor || 0xffaa44,
                transparent: true,
                opacity: 0.65,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const teleRing = new THREE.Mesh(new THREE.RingGeometry(35, 44, 40), teleRingMat);
            teleRing.rotation.x = Math.PI / 2;
            teleRing.position.y = -8;
            teleRing.visible = false;
            enemy.add(teleRing);
            enemy.userData.bossTelegraphRing = teleRing;
        }

        this.scene.add(enemy);
        this.enemies.push(enemy);
        return enemy;
    },

ensureZoneUnits(spawnType) {
        if (this._mpMode === 'guest') return;
        const key = (spawnType || '').toLowerCase();
        const spawner = this[`${key}Spawner`];
        if (!spawner) return;

        const modelKey = { zona1: 'e1', zona2: 'e2', zona3: 'e3' }[key];
        if (modelKey && !this._modelsReady[modelKey]) return;

        const alive = spawner.spawnedUnits.filter((u) => (u.userData?.hp ?? 1) > 0).length;
        const toSpawn = Math.max(0, Math.min(2, spawner.maxUnits - alive));
        for (let i = 0; i < toSpawn; i++) {
            this.spawnUnitFromSpawner(spawner);
        }
    },

_trySpawnPatrolQueue() {
        if (this._mpMode === 'guest') return;
        if (!this._patrolQueue?.length) return;

        const pending = [];
        for (const p of this._patrolQueue) {
            const key = `${p.x},${p.z},${p.type},${p.role}`;
            if (this._spawnedPatrolKeys.has(key)) continue;
            if (!this._patrolReady(p)) {
                pending.push(p);
                continue;
            }
            this.spawnPatrolUnit(p.x, p.z, p.type, { role: p.role, isPatrol: true, regionId: p.regionId });
            this._spawnedPatrolKeys.add(key);
        }
        this._patrolQueue = pending;
    },

queuePatrolSpawns(patrols) {
        this._patrolQueue = patrols || [];
        this._trySpawnPatrolQueue();
    },
};
