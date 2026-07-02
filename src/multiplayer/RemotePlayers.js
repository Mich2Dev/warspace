import * as THREE from 'three';
import { projectWorldToScreen } from '../worldHud.js';
import {
    ensurePlayerShipTemplate,
    createRemoteShipVisual,
    buildRemotePlaceholder,
    onPlayerShipReady,
    setRemoteShipReadyHook,
} from './playerShipTemplate.js';

const _quatTarget = new THREE.Quaternion();
const _trailGeo = new THREE.SphereGeometry(1.4, 5, 5);
const _trailMat = new THREE.MeshBasicMaterial({
    color: 0xff8844,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
});

export class RemotePlayers {
    constructor(scene, environment, gltfLoader) {
        this.scene = scene;
        this.environment = environment;
        this.gltfLoader = gltfLoader;
        this.remote = new Map();
        this.minimapLayer = document.getElementById('minimap-allies');
        this.uiContainer = document.getElementById('ui') || document.body;

        ensurePlayerShipTemplate(gltfLoader);
        setRemoteShipReadyHook(() => this._refreshAllShipVisuals());
    }

    _applyRemoteData(entry, data) {
        if (data.nick) {
            entry.nick = data.nick;
            if (entry.nameTag) {
                entry.nameTag.textContent = data.nick;
                entry.nameTag.dataset.pilotId = entry.id;
            }
            if (entry.minimapDot) entry.minimapDot.title = data.nick;
            if (entry.mesh?.userData) entry.mesh.userData.name = data.nick;
        }
        entry.target.set(data.x ?? 0, data.y ?? 50, data.z ?? 0);

        if (typeof data.qx === 'number' && typeof data.qw === 'number') {
            _quatTarget.set(data.qx, data.qy ?? 0, data.qz ?? 0, data.qw);
            entry.quatTarget.copy(_quatTarget);
        } else if (typeof data.ry === 'number') {
            entry.quatTarget.setFromAxisAngle(new THREE.Vector3(0, 1, 0), data.ry);
        }

        if (typeof data.roll === 'number') entry.rollTarget = data.roll;
        if (typeof data.pitch === 'number') entry.pitchTarget = data.pitch;

        // HP/escudo: respetar eventos de combate recientes (pvp_hit / player_damage)
        const combatFresh = entry._combatSynced
            && (performance.now() - (entry._combatSyncAt ?? 0)) < 450;
        if (!combatFresh) {
            if (typeof data.hp === 'number') entry.hp = data.hp;
            if (typeof data.maxHp === 'number') entry.maxHp = data.maxHp;
            if (typeof data.shieldActive === 'boolean') entry.shieldActive = data.shieldActive;
            if (typeof data.shieldHp === 'number') entry.shieldHp = data.shieldHp;
            if (typeof data.shieldMax === 'number') entry.shieldMax = data.shieldMax;
        }
        if (typeof data.nitro === 'boolean') entry.nitro = data.nitro;
        if (typeof data.vx === 'number' || typeof data.vz === 'number') {
            entry.speed2d = Math.hypot(data.vx ?? entry.vx ?? 0, data.vz ?? entry.vz ?? 0);
            entry.vx = data.vx ?? entry.vx ?? 0;
            entry.vz = data.vz ?? entry.vz ?? 0;
        }

        if ((data.hp ?? entry.hp) <= 0 && !entry.isDead) {
            this.markDead(entry.id);
        } else if (entry.isDead && (data.hp ?? 0) > 0) {
            this.markRespawned(entry.id, data);
        }

        if (entry.mesh?.userData) {
            entry.mesh.userData.hp = entry.hp;
            entry.mesh.userData.maxHp = entry.maxHp;
            entry.mesh.userData.shieldActive = entry.shieldActive;
            entry.mesh.userData.shieldHp = entry.shieldHp;
            entry.mesh.userData.shieldMax = entry.shieldMax;
        }

        window.__game?.combatSync?._syncTargetHudForPlayer?.(entry.id, entry.hp, entry.maxHp);
    }

    applyCombatState(playerId, data) {
        const entry = this._resolveRemoteEntry(playerId);
        if (!entry) return;
        entry._combatSynced = true;
        entry._combatSyncAt = performance.now();
        if (typeof data.hp === 'number') entry.hp = data.hp;
        if (typeof data.maxHp === 'number') entry.maxHp = data.maxHp;
        if (typeof data.shieldActive === 'boolean') entry.shieldActive = data.shieldActive;
        if (typeof data.shieldHp === 'number') entry.shieldHp = data.shieldHp;
        if (typeof data.shieldMax === 'number') entry.shieldMax = data.shieldMax;
        if (entry.mesh?.userData) {
            entry.mesh.userData.hp = entry.hp;
            entry.mesh.userData.maxHp = entry.maxHp;
            entry.mesh.userData.shieldActive = entry.shieldActive;
            entry.mesh.userData.shieldHp = entry.shieldHp;
            entry.mesh.userData.shieldMax = entry.shieldMax;
        }
        window.__game?.combatSync?._syncTargetHudForPlayer?.(entry.id, entry.hp, entry.maxHp);
    }

    _resolveRemoteEntry(playerId) {
        if (playerId == null) return null;
        const key = String(playerId);
        if (this.remote.has(key)) return this.remote.get(key);
        for (const [id, entry] of this.remote) {
            if (String(id) === key) return entry;
        }
        return null;
    }

    _hideRemoteHud(entry) {
        if (entry.nameTag) entry.nameTag.style.display = 'none';
        if (entry.minimapDot) entry.minimapDot.style.display = 'none';
    }

    _clearTrailParticles(entry) {
        if (!entry._trailParticles) return;
        for (const p of entry._trailParticles) {
            this.scene.remove(p);
            p.geometry?.dispose?.();
        }
        entry._trailParticles.length = 0;
    }

    _spawnTrailSpark(entry, nitro) {
        if (!entry.mesh || entry.isDead) return;
        if (!entry._trailParticles) entry._trailParticles = [];
        const p = new THREE.Mesh(_trailGeo, _trailMat.clone());
        p.position.copy(entry.mesh.position);
        p.position.y -= 4;
        const back = new THREE.Vector3(0, 0, 1).applyQuaternion(entry.mesh.quaternion);
        p.position.addScaledVector(back, nitro ? 22 : 14);
        p.userData.life = nitro ? 0.55 : 0.35;
        p.scale.setScalar(nitro ? 2.2 : 1.2);
        if (nitro) p.material.color.setHex(0xffcc44);
        this.scene.add(p);
        entry._trailParticles.push(p);
    }

    _updateTrailParticles(entry, delta) {
        if (!entry._trailParticles?.length) return;
        for (let i = entry._trailParticles.length - 1; i >= 0; i--) {
            const p = entry._trailParticles[i];
            p.userData.life -= delta * 3.5;
            if (p.userData.life <= 0) {
                this.scene.remove(p);
                p.material?.dispose?.();
                entry._trailParticles.splice(i, 1);
            } else {
                p.scale.setScalar(p.userData.life * (p.userData.life > 0.4 ? 2 : 1.2));
            }
        }
    }

    markDead(playerId, deathPos = null) {
        const entry = this._resolveRemoteEntry(playerId);
        if (!entry) return;
        entry.isDead = true;
        entry.hp = 0;
        entry.nitro = false;
        entry.shieldActive = false;
        if (deathPos) {
            entry.target.copy(deathPos);
            entry.display.copy(deathPos);
        }
        if (entry.mesh) {
            entry.mesh.visible = false;
            entry.mesh.userData.hp = 0;
            if (deathPos) entry.mesh.position.copy(deathPos);
        }
        if (entry.shieldMesh) entry.shieldMesh.visible = false;
        if (entry.mesh?.userData?.selectionRing) entry.mesh.userData.selectionRing.visible = false;
        if (entry.markerLight) entry.markerLight.intensity = 0;
        this._hideRemoteHud(entry);
        this._clearTrailParticles(entry);
        this._clearTargetForPlayerId(playerId);
    }

    markRespawned(playerId, data = {}) {
        const entry = this._resolveRemoteEntry(playerId);
        if (!entry) return;
        entry.isDead = false;
        entry._combatSynced = false;
        entry.hp = data.maxHp ?? data.hp ?? entry.maxHp ?? 200;
        entry.maxHp = data.maxHp ?? entry.maxHp ?? 200;
        entry.shieldActive = false;
        entry.shieldHp = 0;
        if (entry.mesh) {
            entry.mesh.visible = true;
            entry.mesh.userData.hp = entry.hp;
            entry.mesh.userData.maxHp = entry.maxHp;
        }
        if (entry.minimapDot) entry.minimapDot.style.display = 'block';
        if (entry.markerLight) entry.markerLight.intensity = 3;
        if (typeof data.x === 'number' && typeof data.z === 'number') {
            entry.target.set(data.x, data.y ?? 50, data.z);
            entry.display.set(data.x, data.y ?? 50, data.z);
        }
    }

    _remoteRoot(obj) {
        let o = obj;
        while (o) {
            if (o.userData?.isRemotePlayer) return o;
            o = o.parent;
        }
        return null;
    }

    _clearTargetForPlayerId(id) {
        const player = window.__game?.player;
        if (!player?.target) return;
        const root = this._remoteRoot(player.target);
        if (root?.userData?.playerId === id) player.setTarget(null);
    }

    _clearStalePlayerTarget() {
        const player = window.__game?.player;
        if (!player?.target?.userData?.isRemotePlayer) return;
        const root = this._remoteRoot(player.target);
        const pid = root?.userData?.playerId;
        if (!pid || !this.remote.has(pid)) player.setTarget(null);
    }

    /** Elimina etiquetas DOM huérfanas (nick flotando sin piloto). */
    pruneOrphanTags() {
        const live = new Set();
        for (const entry of this.remote.values()) {
            if (entry.nameTag) {
                entry.nameTag.dataset.pilotId = entry.id;
                live.add(entry.nameTag);
            }
        }
        document.querySelectorAll('.remote-pilot-tag').forEach((el) => {
            if (!live.has(el)) el.remove();
        });
    }

    _clearTargetIf(id, mesh) {
        const player = window.__game?.player;
        if (!player?.target) return;
        const root = this._remoteRoot(player.target);
        if (root === mesh || root?.userData?.playerId === id) player.setTarget(null);
    }

    /** Naves 3D huérfanas (desconectado pero mesh aún en escena). */
    purgeOrphanMeshes() {
        const validIds = new Set(this.remote.keys());
        const orphans = [];
        this.scene.traverse((obj) => {
            const pid = obj.userData?.playerId;
            if (obj.userData?.isRemotePlayer && pid && !validIds.has(pid)) {
                orphans.push({ obj, id: pid });
            }
        });
        for (const { obj, id } of orphans) {
            obj.visible = false;
            this._clearTargetIf(id, obj);
            this.scene.remove(obj);
            document.querySelectorAll(`.remote-pilot-tag[data-pilot-id="${id}"]`).forEach((el) => el.remove());
        }
        if (orphans.length) this.pruneOrphanTags();
        return orphans.length;
    }

    _shipHasVisibleMesh(entry) {
        let ok = false;
        entry.mesh?.traverse((c) => {
            if (c.isMesh && c.visible !== false && c.geometry) ok = true;
        });
        return ok;
    }

    _resetShipVisual(entry) {
        if (!entry.visualGroup) return;
        while (entry.visualGroup.children.length > 0) {
            entry.visualGroup.remove(entry.visualGroup.children[0]);
        }
        entry.placeholder = buildRemotePlaceholder();
        entry.visualGroup.add(entry.placeholder);
        entry.shipReady = false;
        this._attachShipVisual(entry);
    }

    /** Tras desconexión, reconstruye naves rotas por dispose cruzado previo. */
    revalidateAllShips() {
        for (const entry of this.remote.values()) {
            if (!entry.shipReady || !this._shipHasVisibleMesh(entry)) {
                this._resetShipVisual(entry);
            }
        }
    }

    _createSelectionRing() {
        const geo = new THREE.RingGeometry(38, 48, 32);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xff4466,
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        const ring = new THREE.Mesh(geo, mat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = -6;
        ring.visible = false;
        ring.frustumCulled = false;
        return ring;
    }

    _createHitVolume() {
        const geo = new THREE.SphereGeometry(52, 10, 10);
        const mat = new THREE.MeshBasicMaterial({
            visible: false,
            transparent: true,
            opacity: 0,
            depthWrite: false,
        });
        const vol = new THREE.Mesh(geo, mat);
        vol.frustumCulled = false;
        return vol;
    }

    /** Raíz 3D del piloto remoto para raycast / Tab (null si muerto). */
    findClosestTargetable(fromPos, maxDist = 12000) {
        let best = null;
        let bestD = maxDist;
        for (const entry of this.remote.values()) {
            if (entry.isDead || (entry.hp ?? 200) <= 0) continue;
            const pos = entry.display || entry.mesh?.position;
            if (!pos || !entry.mesh) continue;
            const d = fromPos.distanceTo(pos);
            if (d < bestD) {
                bestD = d;
                best = entry.mesh;
            }
        }
        return best;
    }

    getTargetableMeshes() {
        const list = [];
        for (const entry of this.remote.values()) {
            if (entry.isDead || (entry.hp ?? 200) <= 0 || !entry.mesh) continue;
            list.push(entry.mesh);
        }
        return list;
    }

    _createShieldMesh() {
        const shieldMat = new THREE.MeshBasicMaterial({
            color: 0x44ddff,
            transparent: true,
            opacity: 0.38,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            wireframe: true,
        });
        const shieldMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(48, 1), shieldMat);
        shieldMesh.visible = false;
        shieldMesh.frustumCulled = false;
        return shieldMesh;
    }

    _attachShipVisual(entry) {
        if (entry.shipReady) return;

        onPlayerShipReady(() => {
            if (!this.remote.has(entry.id) || entry.shipReady) return;

            const ship = createRemoteShipVisual();
            if (entry.placeholder) {
                entry.visualGroup.remove(entry.placeholder);
                entry.placeholder = null;
            }
            entry.visualGroup.add(ship);
            entry.shipReady = true;
            entry.mesh.visible = !entry.isDead;
            entry.mesh.updateMatrixWorld(true);
        });
    }

    _refreshAllShipVisuals() {
        for (const entry of this.remote.values()) {
            if (entry.shipReady) continue;
            this._attachShipVisual(entry);
        }
    }

    _ensureTargetHelpers(entry) {
        if (!entry?.mesh) return;
        if (!entry.mesh.userData.selectionRing) {
            const selectionRing = this._createSelectionRing();
            entry.mesh.add(selectionRing);
            entry.mesh.userData.selectionRing = selectionRing;
        }
        if (!entry._hitVolume) {
            entry._hitVolume = this._createHitVolume();
            entry.mesh.add(entry._hitVolume);
        }
    }

    upsert(data) {
        if (!data?.id) return;
        const pid = String(data.id);

        let entry = this._resolveRemoteEntry(pid);
        if (entry) {
            this._ensureTargetHelpers(entry);
            this._applyRemoteData(entry, data);
            if (!entry.isDead && (entry.hp ?? 200) > 0 && entry.mesh) entry.mesh.visible = true;
            return;
        }

        const root = new THREE.Group();
        const visualGroup = new THREE.Group();
        const placeholder = buildRemotePlaceholder();
        visualGroup.add(placeholder);
        root.add(visualGroup);

        const shieldMesh = this._createShieldMesh();
        root.add(shieldMesh);

        const markerLight = new THREE.PointLight(0x66ddff, 3, 140);
        markerLight.position.set(0, 12, 0);
        root.add(markerLight);

        const selectionRing = this._createSelectionRing();
        root.add(selectionRing);
        root.userData.selectionRing = selectionRing;

        const hitVolume = this._createHitVolume();
        root.add(hitVolume);

        root.userData.isRemotePlayer = true;
        root.userData.isPvpTarget = true;
        root.userData.isEnemy = true;
        root.userData.playerId = pid;
        root.userData.type = 'PvpPilot';
        root.userData.name = data.nick || 'Piloto';
        root.userData.hp = data.hp ?? 200;
        root.userData.maxHp = data.maxHp ?? 200;

        this.scene.add(root);

        const nameTag = document.createElement('div');
        nameTag.className = 'remote-pilot-tag';
        nameTag.dataset.pilotId = data.id;
        nameTag.textContent = data.nick || 'Piloto';
        nameTag.style.display = 'none';
        if (this.uiContainer) this.uiContainer.appendChild(nameTag);

        const minimapDot = document.createElement('div');
        minimapDot.className = 'minimap-ally';
        minimapDot.title = data.nick || 'Piloto';
        if (this.minimapLayer) this.minimapLayer.appendChild(minimapDot);

        entry = {
            id: pid,
            nick: data.nick || 'Piloto',
            mesh: root,
            visualGroup,
            placeholder,
            shieldMesh,
            markerLight,
            shipReady: false,
            nameTag,
            minimapDot,
            nitro: false,
            speed2d: 0,
            vx: 0,
            vz: 0,
            _trailTimer: 0,
            _trailParticles: [],
            target: new THREE.Vector3(data.x ?? 0, data.y ?? 50, data.z ?? 0),
            display: new THREE.Vector3(data.x ?? 0, data.y ?? 50, data.z ?? 0),
            quat: new THREE.Quaternion(),
            quatTarget: new THREE.Quaternion(),
            rollTarget: 0,
            pitchTarget: 0,
            hp: data.hp ?? 200,
            maxHp: data.maxHp ?? 200,
            shieldActive: false,
            shieldHp: 0,
            shieldMax: 150,
            isDead: false,
            _combatSynced: false,
            hitFlash: 0,
        };

        if (typeof data.qx === 'number' && typeof data.qw === 'number') {
            entry.quatTarget.set(data.qx, data.qy ?? 0, data.qz ?? 0, data.qw);
        } else {
            entry.quatTarget.setFromAxisAngle(new THREE.Vector3(0, 1, 0), data.ry ?? 0);
        }
        entry.quat.copy(entry.quatTarget);

        this.remote.set(pid, entry);
        this._applyRemoteData(entry, data);
        this._attachShipVisual(entry);
        this.pruneOrphanTags();
    }

    remove(id) {
        const entry = this.remote.get(id);
        if (entry) {
            this._clearTargetForPlayerId(id);
            entry.mesh.visible = false;
            if (entry.nameTag) entry.nameTag.style.display = 'none';
            this.scene.remove(entry.mesh);
            entry.nameTag?.remove();
            entry.minimapDot?.remove();
            this.remote.delete(id);
            this.revalidateAllShips();
        }
        this.pruneOrphanTags();
        this.purgeOrphanMeshes();
    }

    removeByNick(nick) {
        if (!nick) return;
        for (const [id, entry] of this.remote) {
            if (entry.nick === nick) this.remove(id);
        }
    }

    applySnapshot(players, localId) {
        const localKey = localId != null ? String(localId) : null;
        const seen = new Set();
        for (const p of players) {
            if (localKey && String(p.id) === localKey) continue;
            seen.add(String(p.id));
            this.upsert(p);
        }
        for (const id of [...this.remote.keys()]) {
            if (!seen.has(String(id))) this.remove(id);
        }
        this._clearStalePlayerTarget();
        this.pruneOrphanTags();
        this.purgeOrphanMeshes();
    }

    onPlayerJoined(player, localId) {
        if (player.id === localId) return;
        this.upsert(player);
    }

    update(delta, camera) {
        this._purgeTimer = (this._purgeTimer ?? 0) + delta;
        if (this._purgeTimer >= 2.0) {
            this._purgeTimer = 0;
            this._clearStalePlayerTarget();
            this.purgeOrphanMeshes();
        }

        const lerp = 1 - Math.pow(0.001, delta);
        const mapEl = document.getElementById('minimap');
        const mapW = mapEl?.clientWidth || 200;
        const mapH = mapEl?.clientHeight || 200;

        for (const entry of this.remote.values()) {
            if (entry.isDead) {
                this._hideRemoteHud(entry);
                this._updateTrailParticles(entry, delta);
                continue;
            }

            entry.display.lerp(entry.target, lerp);
            entry.quat.slerp(entry.quatTarget, lerp);

            const x = entry.display.x;
            const y = entry.display.y;
            const z = entry.display.z;

            entry.mesh.position.set(x, y, z);
            entry.mesh.quaternion.copy(entry.quat);
            entry.mesh.visible = true;

            if (entry.visualGroup) {
                entry.visualGroup.rotation.z += (entry.rollTarget - entry.visualGroup.rotation.z) * lerp;
                entry.visualGroup.rotation.x += (entry.pitchTarget - entry.visualGroup.rotation.x) * lerp;
            }

            entry.mesh.userData.hp = entry.hp;
            entry.mesh.userData.maxHp = entry.maxHp;
            entry.mesh.userData.name = entry.nick;
            entry.mesh.userData.shieldActive = entry.shieldActive;
            entry.mesh.userData.shieldHp = entry.shieldHp;
            entry.mesh.userData.shieldMax = entry.shieldMax;

            if (entry.shieldMesh) {
                const show = entry.shieldActive && entry.shieldHp > 0;
                entry.shieldMesh.visible = show;
                if (show) {
                    entry.shieldMesh.material.opacity = 0.32 + 0.08 * Math.sin(performance.now() * 0.005);
                    entry.shieldMesh.scale.setScalar(0.9 + 0.06 * Math.sin(performance.now() * 0.008));
                }
            }

            if (entry.markerLight) {
                entry.markerLight.intensity = entry.nitro ? 7 : (entry.shieldActive ? 4 : 2.5);
                entry.markerLight.color.setHex(entry.nitro ? 0xffaa44 : 0x66ddff);
            }

            const moving = (entry.speed2d ?? 0) > 12;
            if (moving || entry.nitro) {
                entry._trailTimer -= delta;
                const interval = entry.nitro ? 0.028 : 0.055;
                if (entry._trailTimer <= 0) {
                    entry._trailTimer = interval;
                    this._spawnTrailSpark(entry, !!entry.nitro);
                }
            }
            this._updateTrailParticles(entry, delta);

            if (entry.hitFlash > 0) {
                entry.hitFlash -= delta * 3;
                entry.mesh.traverse((c) => {
                    if (c.isMesh && c.material?.emissive != null) {
                        c.material.emissive.setHex(0xff4444);
                        if (typeof c.material.emissiveIntensity === 'number') {
                            c.material.emissiveIntensity = entry.hitFlash * 2;
                        }
                    }
                });
            }

            if (entry.minimapDot) {
                const mx = (x + 12000) / 24000 * mapW;
                const mz = (z + 12000) / 24000 * mapH;
                entry.minimapDot.style.left = `${mx}px`;
                entry.minimapDot.style.top = `${mz}px`;
            }

            if (entry.nameTag && camera) {
                entry.nameTag.textContent = entry.nick;
                const labelPos = entry.mesh.position.clone().add(new THREE.Vector3(0, 55, 0));
                const screen = projectWorldToScreen(camera, labelPos);
                if (screen && screen.x >= 0 && screen.y >= 0) {
                    entry.nameTag.style.left = `${screen.x}px`;
                    entry.nameTag.style.top = `${screen.y}px`;
                    entry.nameTag.style.display = 'block';
                } else {
                    entry.nameTag.style.display = 'none';
                }
            }
        }
    }

    clear() {
        for (const id of [...this.remote.keys()]) this.remove(id);
        this.pruneOrphanTags();
    }

    count() {
        return this.remote.size;
    }
}
