import * as THREE from 'three';
import { engageEnemy } from './enemyRoles.js';

const ZONE_EVENT_META = {
    ZONA1: { key: 'Zona1', label: 'SECTOR ALPHA', spawnerProp: 'zona1Spawner', color: '#ff5555', invasionType: 'Invader_Alpha' },
    ZONA2: { key: 'Zona2', label: 'SECTOR BETA', spawnerProp: 'zona2Spawner', color: '#00aaff', invasionType: 'Invader_Beta' },
    ZONA3: { key: 'Zona3', label: 'SECTOR GAMMA', spawnerProp: 'zona3Spawner', color: '#aa55ff', invasionType: 'Invader_Gamma' },
};

function rand(min, max) {
    return min + Math.random() * (max - min);
}

export class EventDirector {
    constructor(player, enemyManager, scene) {
        this.player = player;
        this.enemyManager = enemyManager;
        this.scene = scene;
        this.activeEvent = null;
        this.manualMode = true;
        this.onEventFinished = null;

        this._beaconMesh = null;
        this._beaconRing = null;
        this._distressDot = null;
        this._miniBossDot = null;
        this._audioCtx = null;
        this._bossWarnWasActive = false;

        this.bannerEl = document.getElementById('event-banner');
        this.panelEl = document.getElementById('world-event-panel');
        this.titleEl = document.getElementById('event-title');
        this.descEl = document.getElementById('event-desc');
        this.timerEl = document.getElementById('event-timer');
        this.progressEl = document.getElementById('event-progress-fill');
        this.killsEl = document.getElementById('event-kills');
    }

    update(delta) {
        if (!this.activeEvent) return;
        if (this._isMpGuest()) {
            if (this.activeEvent.type === 'distress') this.animateDistressMarker(delta);
            if (this.activeEvent.type === 'miniBoss') this.updateMiniBossMarker();
            return;
        }

        const eventType = this.activeEvent.type;
        if (eventType === 'invasion') this.updateInvasion(delta);
        else if (eventType === 'distress') this.updateDistress(delta);
        else if (eventType === 'miniBoss') this.updateMiniBoss(delta);
    }

    onEnemyKilled(enemyType, _enemyName, details = {}) {
        if (this._isMpGuest()) return;
        if (!this.activeEvent) return;
        if (!enemyType || typeof enemyType !== 'string') return;

        if (this.activeEvent.type === 'invasion') {
            if (enemyType !== this.activeEvent.invasionType) return;
            this.activeEvent.kills += 1;
            this.renderInvasionUI();
            return;
        }

        if (this.activeEvent.type === 'distress') {
            if (this.activeEvent.phase !== 'defend') return;
            if (enemyType !== this.activeEvent.invasionType) return;
            this.activeEvent.kills += 1;
            this.renderDistressUI();
            return;
        }

        if (this.activeEvent.type === 'miniBoss') {
            if (!details?.isMiniBoss) return;
            if (details?.eventTag !== this.activeEvent.eventTag) return;
            this.finishMiniBoss(true);
        }
    }

    startRandomEvent() {
        return false;
    }

    _finishEvent(type, success) {
        const contractId = this.activeEvent?.contractId || null;
        const ev = this.activeEvent;
        let reward = 0;
        if (success && ev) {
            if (type === 'invasion') reward = 650;
            else if (type === 'distress') {
                reward = Math.round(450 + (ev.kills ?? 0) * 20 + Math.max(0, ev.reachTimeLeft ?? 0) * 4);
            } else if (type === 'miniBoss') reward = 1200;
        }
        if (this._isWorldAuthority() && contractId != null) {
            window.__game?.roomSync?.broadcastEventEnd(contractId, success, reward);
        }
        this.hideEventUI();
        this.activeEvent = null;
        if (typeof this.onEventFinished === 'function') {
            this.onEventFinished(contractId, success);
        }
    }

    _isMpGuest() {
        const mp = window.__game?.multiplayerClient;
        return mp?.isOnline && !mp.isHost;
    }

    /** Invitados: evento de sala sincronizado desde HOST. */
    applyRoomEvent(p) {
        if (!p || this._isWorldAuthority()) return;

        if (p.action === 'start') {
            const ev = this._deserializeEvent(p.event);
            if (!ev) return;
            this.activeEvent = ev;
            this._setPanelType(ev.type);
            if (ev.type === 'distress' && ev.distressPos) {
                this.createDistressMarker(ev.distressPos, ev.zoneColor);
            } else if (ev.type === 'miniBoss') {
                this.createMiniBossMarker();
            }
            window.__eventBoard?.onRoomEventStart(ev.contractId);
            this.showBanner(this._eventStartBanner(ev), ev.zoneColor || '#7fe4ff', 'eventStart');
            this._renderEventUI(true);
            return;
        }

        if (p.action === 'sync') {
            if (!this.activeEvent || p.contractId !== this.activeEvent.contractId) return;
            this._mergeEventState(p.event);
            this._renderEventUI();
            return;
        }

        if (p.action === 'end') {
            if (p.contractId && this.activeEvent?.contractId !== p.contractId) return;
            const success = !!p.success;
            if (success && p.reward && typeof this.player?.gainCredits === 'function') {
                this.player.gainCredits(p.reward, this.player.position);
            }
            this.destroyDistressMarker();
            this.destroyMiniBossMarker();
            this.hideEventUI();
            const contractId = p.contractId || this.activeEvent?.contractId || null;
            this.activeEvent = null;
            if (typeof this.onEventFinished === 'function') {
                this.onEventFinished(contractId, success);
            }
        }
    }

    _deserializeEvent(raw) {
        if (!raw) return null;
        const ev = { ...raw };
        if (ev.distressPos && !(ev.distressPos instanceof THREE.Vector3)) {
            const d = ev.distressPos;
            ev.distressPos = new THREE.Vector3(d.x ?? 0, d.y ?? 0, d.z ?? 0);
        }
        ev.boss = null;
        return ev;
    }

    _mergeEventState(raw) {
        if (!raw || !this.activeEvent) return;
        const keep = { contractId: this.activeEvent.contractId, type: this.activeEvent.type, boss: this.activeEvent.boss };
        Object.assign(this.activeEvent, raw, keep);
        if (raw.distressPos && !(this.activeEvent.distressPos instanceof THREE.Vector3)) {
            const d = raw.distressPos;
            this.activeEvent.distressPos = new THREE.Vector3(d.x ?? 0, d.y ?? 0, d.z ?? 0);
        }
    }

    _eventStartBanner(ev) {
        if (ev.type === 'invasion') return `ALERTA: INVASION EN ${ev.zoneLabel}`;
        if (ev.type === 'distress') return `SENAL DE AUXILIO - ${ev.zoneLabel}`;
        if (ev.type === 'miniBoss') return `MINI-JEFE DETECTADO - ${ev.zoneLabel}`;
        return 'EVENTO DE SALA';
    }

    _renderEventUI(forceOpen = false) {
        const t = this.activeEvent?.type;
        if (t === 'invasion') this.renderInvasionUI(forceOpen);
        else if (t === 'distress') this.renderDistressUI(forceOpen);
        else if (t === 'miniBoss') this.renderMiniBossUI(forceOpen);
    }

    _broadcastEventStart() {
        if (!this._isWorldAuthority() || !this.activeEvent) return;
        window.__game?.roomSync?.broadcastEventStart(
            this.activeEvent.contractId,
            this.activeEvent,
        );
    }

    _isWorldAuthority() {
        const mp = window.__game?.multiplayerClient;
        if (!mp?.isOnline) return true;
        return mp.isHost;
    }

    startInvasionEvent(options = {}) {
        if (!this._isWorldAuthority()) return false;
        if (this.activeEvent) return false;
        const zoneKey = this.pickZone();
        const zoneMeta = ZONE_EVENT_META[zoneKey];

        this.activeEvent = {
            type: 'invasion',
            contractId: options.contractId || null,
            zoneKey,
            zoneType: zoneMeta.key,
            invasionType: zoneMeta.invasionType,
            zoneLabel: zoneMeta.label,
            zoneColor: zoneMeta.color,
            totalTime: 75,
            timeLeft: 75,
            totalWaves: 4,
            waveIndex: 0,
            waveInterval: 14,
            nextWaveIn: 1.5,
            kills: 0,
            targetKills: 16,
        };

        this._setPanelType('invasion');
        this.showBanner(`ALERTA: INVASION EN ${zoneMeta.label}`, zoneMeta.color, 'eventStart');
        this.renderInvasionUI(true);
        this._broadcastEventStart();
        return true;
    }

    updateInvasion(delta) {
        if (!this.activeEvent || this.activeEvent.type !== 'invasion') return;
        this.activeEvent.timeLeft -= delta;
        this.activeEvent.nextWaveIn -= delta;

        if (this.activeEvent.nextWaveIn <= 0 && this.activeEvent.waveIndex < this.activeEvent.totalWaves) {
            this.spawnInvasionWave();
            this.activeEvent.waveIndex++;
            this.activeEvent.nextWaveIn = this.activeEvent.waveInterval;
        }

        if (this.activeEvent.kills >= this.activeEvent.targetKills) {
            this.finishInvasion(true);
            return;
        }

        if (this.activeEvent.timeLeft <= 0) {
            this.finishInvasion(false);
            return;
        }

        this.renderInvasionUI();
    }

    spawnInvasionWave() {
        if (!this._isWorldAuthority()) return;
        const event = this.activeEvent;
        if (!event) return;

        const zoneMeta = ZONE_EVENT_META[event.zoneKey];
        const spawner = this.enemyManager[zoneMeta.spawnerProp];

        const amount = 3 + event.waveIndex * 2;
        for (let i = 0; i < amount; i++) {
            const anchor = spawner ? spawner.position : null;
            this.enemyManager.spawnInvasionUnit(event.zoneKey, anchor, { eventTag: 'invasion' });
        }

        this.showBanner(`OLEADA ${event.waveIndex + 1}/${event.totalWaves} - ${zoneMeta.label}`, zoneMeta.color, 'wave');
    }

    finishInvasion(success) {
        if (!this.activeEvent) return;

        if (success) {
            const reward = 650;
            if (typeof this.player.gainCredits === 'function') {
                this.player.gainCredits(reward, this.player.position);
            }
            const log = document.getElementById('log-text');
            if (log) {
                log.innerHTML = `<span style="color:#ffcc44;font-weight:bold;">EVENTO COMPLETADO: +${reward} CR de bonificacion</span>`;
            }
            this.showBanner('EVENTO COMPLETADO - RECOMPENSA OBTENIDA', '#ffcc44', 'success');
        } else {
            const log = document.getElementById('log-text');
            if (log) {
                log.innerHTML = `<span style="color:#ff6666;font-weight:bold;">EVENTO FALLIDO: la invasion se disperso</span>`;
            }
            this.showBanner('EVENTO FALLIDO', '#ff6666', 'fail');
        }

        this._finishEvent('invasion', success);
    }

    startDistressEvent(options = {}) {
        if (!this._isWorldAuthority()) return false;
        if (this.activeEvent) return false;
        const zoneKey = this.pickZone();
        const zoneMeta = ZONE_EVENT_META[zoneKey];
        const center = this._pickPointInZone(zoneKey);
        const color = zoneMeta.color;

        this.activeEvent = {
            type: 'distress',
            contractId: options.contractId || null,
            zoneKey,
            zoneLabel: zoneMeta.label,
            zoneColor: color,
            invasionType: zoneMeta.invasionType,
            phase: 'reach',
            reachTimeTotal: 55,
            reachTimeLeft: 55,
            defendTimeTotal: 38,
            defendTimeLeft: 38,
            nextWaveIn: 2.2,
            waveInterval: 7.2,
            kills: 0,
            distressPos: center,
        };

        this._setPanelType('distress');
        this.createDistressMarker(center, color);
        this.showBanner(`SENAL DE AUXILIO - ${zoneMeta.label}`, color, 'eventStart');
        this.renderDistressUI(true);
        this._broadcastEventStart();
        return true;
    }

    updateDistress(delta) {
        const e = this.activeEvent;
        if (!e || e.type !== 'distress') return;
        this.animateDistressMarker(delta);

        if (e.phase === 'reach') {
            e.reachTimeLeft -= delta;
            const d = this.player.position.distanceTo(new THREE.Vector3(e.distressPos.x, this.player.position.y, e.distressPos.z));
            if (d <= 240) {
                e.phase = 'defend';
                this.showBanner('SENAL FIJADA - DEFIENDE LA TRANSMISION', e.zoneColor, 'warning');
            } else if (e.reachTimeLeft <= 0) {
                this.finishDistress(false);
                return;
            }
            this.renderDistressUI();
            return;
        }

        if (e.phase === 'defend') {
            e.defendTimeLeft -= delta;
            e.nextWaveIn -= delta;

            if (e.nextWaveIn <= 0) {
                const amount = 2 + Math.floor((e.defendTimeTotal - e.defendTimeLeft) / 8);
                for (let i = 0; i < amount; i++) {
                    this.enemyManager.spawnInvasionUnit(e.zoneKey, e.distressPos, {
                        eventTag: 'distress',
                        spawnRadius: 180 + Math.random() * 240,
                    });
                }
                e.nextWaveIn = e.waveInterval;
            }

            if (e.defendTimeLeft <= 0) {
                this.finishDistress(true);
                return;
            }
            this.renderDistressUI();
        }
    }

    finishDistress(success) {
        const e = this.activeEvent;
        if (!e || e.type !== 'distress') return;

        if (success) {
            const bonus = Math.round(450 + e.kills * 20 + Math.max(0, e.reachTimeLeft) * 4);
            if (typeof this.player.gainCredits === 'function') this.player.gainCredits(bonus, this.player.position);
            const log = document.getElementById('log-text');
            if (log) log.innerHTML = `<span style="color:#7fe4ff;font-weight:bold;">AUXILIO EXITOSO: +${bonus} CR</span>`;
            this.showBanner('AUXILIO RESUELTO - CIVILES EXTRAIDOS', '#7fe4ff', 'success');
        } else {
            const log = document.getElementById('log-text');
            if (log) log.innerHTML = `<span style="color:#ff6666;font-weight:bold;">AUXILIO FALLIDO: senal perdida</span>`;
            this.showBanner('AUXILIO PERDIDO', '#ff6666', 'fail');
        }

        this.destroyDistressMarker();
        this._finishEvent('distress', success);
    }

    startMiniBossEvent(options = {}) {
        if (!this._isWorldAuthority()) return false;
        if (this.activeEvent) return false;
        const zoneKey = this.pickZone();
        const zoneMeta = ZONE_EVENT_META[zoneKey];
        const spawnPos = this._pickPointInZone(zoneKey);
        const eventTag = `miniBoss_${Date.now()}`;

        const boss = this.enemyManager.spawnInvasionUnit(zoneKey, spawnPos, {
            eventTag,
            isMiniBoss: true,
            hpMultiplier: 4.0,
            speedMultiplier: 0.9,
            nameOverride: `NEMESIS ${zoneMeta.invasionType.replace('Invader_', '')}`,
            spawnRadius: 0,
        });
        if (!boss) {
            return false;
        }
        engageEnemy(boss, Date.now() * 0.001);
        boss.userData.forcedAggroUntil = (Date.now() * 0.001) + 120;

        this.activeEvent = {
            type: 'miniBoss',
            contractId: options.contractId || null,
            zoneKey,
            zoneLabel: zoneMeta.label,
            zoneColor: zoneMeta.color,
            timerTotal: 95,
            timerLeft: 95,
            boss,
            eventTag,
        };

        this._setPanelType('miniBoss');
        this.createMiniBossMarker();
        this.showBanner(`MINI-JEFE DETECTADO - ${zoneMeta.label}`, '#ffbb55', 'bossSpawn');
        this.renderMiniBossUI(true);
        this._broadcastEventStart();
        return true;
    }

    updateMiniBoss(delta) {
        const e = this.activeEvent;
        if (!e || e.type !== 'miniBoss') return;
        e.timerLeft -= delta;
        this.updateMiniBossMarker();

        if (!e.boss || !this.enemyManager.enemies.includes(e.boss) || e.boss.userData.hp <= 0) {
            this.finishMiniBoss(true);
            return;
        }

        if (e.timerLeft <= 0) {
            this.finishMiniBoss(false);
            return;
        }

        this._syncMiniBossTelegraph(e.boss);
        this.renderMiniBossUI();
    }

    finishMiniBoss(success) {
        const e = this.activeEvent;
        if (!e || e.type !== 'miniBoss') return;

        if (success) {
            const reward = 1200;
            if (typeof this.player.gainCredits === 'function') this.player.gainCredits(reward, this.player.position);
            const log = document.getElementById('log-text');
            if (log) log.innerHTML = `<span style="color:#ffcc44;font-weight:bold;">MINI-JEFE ELIMINADO: +${reward} CR</span>`;
            this.showBanner('MINI-JEFE ELIMINADO', '#ffcc44', 'success');
        } else {
            if (e.boss && this.enemyManager.enemies.includes(e.boss)) {
                this.enemyManager.forceDespawnEnemy(e.boss, true);
            }
            const log = document.getElementById('log-text');
            if (log) log.innerHTML = `<span style="color:#ff6666;font-weight:bold;">MINI-JEFE ESCAPO</span>`;
            this.showBanner('MINI-JEFE ESCAPO', '#ff6666', 'fail');
        }

        this.destroyMiniBossMarker();
        this._finishEvent('miniBoss', success);
    }

    pickZone() {
        const keys = Object.keys(ZONE_EVENT_META);
        return keys[Math.floor(Math.random() * keys.length)];
    }

    renderInvasionUI(forceOpen = false) {
        const e = this.activeEvent;
        if (!e || e.type !== 'invasion' || !this.panelEl) return;
        if (forceOpen) this.panelEl.style.display = 'block';
        this.panelEl.style.display = 'block';

        if (this.titleEl) this.titleEl.textContent = `INVASION - ${e.zoneLabel}`;
        if (this.descEl) this.descEl.textContent = `Elimina escuadrones ${e.invasionType.replace('_', ' ')} antes de que termine el tiempo.`;
        if (this.timerEl) {
            const t = Math.max(0, Math.ceil(e.timeLeft));
            this.timerEl.textContent = `${t}s`;
            this.timerEl.classList.toggle('critical-timer', t <= 12);
        }
        if (this.killsEl) this.killsEl.textContent = `${e.kills}/${e.targetKills}`;
        if (this.progressEl) this.progressEl.style.width = `${Math.max(0, Math.min(1, e.kills / e.targetKills)) * 100}%`;
    }

    renderDistressUI(forceOpen = false) {
        const e = this.activeEvent;
        if (!e || e.type !== 'distress' || !this.panelEl) return;
        if (forceOpen) this.panelEl.style.display = 'block';
        this.panelEl.style.display = 'block';

        if (this.titleEl) this.titleEl.textContent = `AUXILIO - ${e.zoneLabel}`;
        if (e.phase === 'reach') {
            if (this.descEl) this.descEl.textContent = 'Llega al punto de auxilio antes de que la señal colapse.';
            if (this.timerEl) {
                const t = Math.max(0, Math.ceil(e.reachTimeLeft));
                this.timerEl.textContent = `${t}s`;
                this.timerEl.classList.toggle('critical-timer', t <= 10);
            }
            if (this.killsEl) this.killsEl.textContent = 'LLEGA';
            if (this.progressEl) this.progressEl.style.width = `${(1 - Math.max(0, e.reachTimeLeft) / e.reachTimeTotal) * 100}%`;
        } else {
            if (this.descEl) this.descEl.textContent = 'Defiende la señal mientras se completa la extraccion.';
            if (this.timerEl) {
                const t = Math.max(0, Math.ceil(e.defendTimeLeft));
                this.timerEl.textContent = `${t}s`;
                this.timerEl.classList.toggle('critical-timer', t <= 10);
            }
            if (this.killsEl) this.killsEl.textContent = `${e.kills} hostiles`;
            if (this.progressEl) this.progressEl.style.width = `${(1 - Math.max(0, e.defendTimeLeft) / e.defendTimeTotal) * 100}%`;
        }
    }

    renderMiniBossUI(forceOpen = false) {
        const e = this.activeEvent;
        if (!e || e.type !== 'miniBoss' || !this.panelEl) return;
        if (forceOpen) this.panelEl.style.display = 'block';
        this.panelEl.style.display = 'block';

        if (this.titleEl) this.titleEl.textContent = `MINI-JEFE - ${e.zoneLabel}`;
        if (this.descEl) this.descEl.textContent = 'Caza al Nemesis antes de que abandone el sector.';
        if (this.timerEl) {
            const t = Math.max(0, Math.ceil(e.timerLeft));
            this.timerEl.textContent = `${t}s`;
            this.timerEl.classList.toggle('critical-timer', t <= 15);
        }
        if (this.killsEl) {
            const hp = e.boss
                ? Math.max(0, Math.floor(e.boss.userData.hp))
                : Math.max(0, Math.floor(e.bossHp ?? 0));
            this.killsEl.textContent = `${hp} HP`;
        }
        if (this.progressEl) {
            const maxHp = e.boss?.userData?.maxHp ?? e.bossMaxHp ?? 1;
            const hp = e.boss?.userData?.hp ?? e.bossHp ?? 0;
            const ratio = 1 - (Math.max(0, hp) / maxHp);
            this.progressEl.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
        }
    }

    hideEventUI() {
        if (this.panelEl) {
            this.panelEl.style.display = 'none';
            this.panelEl.classList.remove('event-invasion', 'event-distress', 'event-miniboss', 'event-boss-warning');
        }
        if (this.timerEl) this.timerEl.classList.remove('critical-timer');
    }

    showBanner(text, color, cueType = 'eventStart') {
        if (!this.bannerEl) return;
        this.bannerEl.textContent = text;
        this.bannerEl.style.borderColor = color;
        this.bannerEl.style.color = color;
        this.bannerEl.classList.remove('show');
        void this.bannerEl.offsetWidth;
        this.bannerEl.classList.add('show');
        this._playCue(color, cueType);
    }

    _setPanelType(type) {
        if (!this.panelEl) return;
        this.panelEl.classList.remove('event-invasion', 'event-distress', 'event-miniboss');
        if (type === 'invasion') this.panelEl.classList.add('event-invasion');
        if (type === 'distress') this.panelEl.classList.add('event-distress');
        if (type === 'miniBoss') this.panelEl.classList.add('event-miniboss');
    }

    _pickPointInZone(zoneKey) {
        const zone = {
            ZONA1: { x: -3000, z: 3000, radius: 2000 },
            ZONA2: { x: 3000, z: 0, radius: 2500 },
            ZONA3: { x: -4000, z: 0, radius: 2000 },
        }[zoneKey] || { x: 0, z: 0, radius: 1800 };

        const angle = Math.random() * Math.PI * 2;
        const dist = zone.radius * (0.25 + Math.random() * 0.55);
        return { x: zone.x + Math.cos(angle) * dist, z: zone.z + Math.sin(angle) * dist };
    }

    createDistressMarker(pos, color) {
        this.destroyDistressMarker();
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
        this._beaconMesh = new THREE.Mesh(new THREE.SphereGeometry(42, 14, 14), mat);
        this._beaconMesh.position.set(pos.x, 80, pos.z);
        this.scene.add(this._beaconMesh);

        const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
        this._beaconRing = new THREE.Mesh(new THREE.RingGeometry(70, 90, 24), ringMat);
        this._beaconRing.rotation.x = Math.PI / 2;
        this._beaconRing.position.set(pos.x, 36, pos.z);
        this.scene.add(this._beaconRing);

        const minimap = document.getElementById('minimap-enemies');
        if (minimap) {
            this._distressDot = document.createElement('div');
            this._distressDot.className = 'minimap-enemy minimap-distress';
            this._distressDot.style.left = `${(pos.x + 12000) / 24000 * 100}%`;
            this._distressDot.style.top = `${(pos.z + 12000) / 24000 * 100}%`;
            minimap.appendChild(this._distressDot);
        }
    }

    animateDistressMarker(delta) {
        if (this._beaconMesh) {
            this._beaconMesh.rotation.y += delta * 0.8;
            this._beaconMesh.scale.setScalar(1 + Math.sin(performance.now() * 0.004) * 0.08);
        }
        if (this._beaconRing) {
            this._beaconRing.rotation.z += delta * 0.9;
            this._beaconRing.material.opacity = 0.28 + Math.sin(performance.now() * 0.0032) * 0.15;
        }
    }

    destroyDistressMarker() {
        if (this._beaconMesh) {
            this.scene.remove(this._beaconMesh);
            this._beaconMesh.geometry.dispose();
            this._beaconMesh.material.dispose();
            this._beaconMesh = null;
        }
        if (this._beaconRing) {
            this.scene.remove(this._beaconRing);
            this._beaconRing.geometry.dispose();
            this._beaconRing.material.dispose();
            this._beaconRing = null;
        }
        if (this._distressDot?.parentNode) {
            this._distressDot.parentNode.removeChild(this._distressDot);
            this._distressDot = null;
        }
    }

    createMiniBossMarker() {
        const minimap = document.getElementById('minimap-enemies');
        if (!minimap) return;
        this.destroyMiniBossMarker();
        this._miniBossDot = document.createElement('div');
        this._miniBossDot.className = 'minimap-enemy minimap-miniboss-target';
        minimap.appendChild(this._miniBossDot);
        this.updateMiniBossMarker();
    }

    updateMiniBossMarker() {
        const e = this.activeEvent;
        if (!e || e.type !== 'miniBoss' || !e.boss || !this._miniBossDot) return;
        this._miniBossDot.style.left = `${(e.boss.position.x + 12000) / 24000 * 100}%`;
        this._miniBossDot.style.top = `${(e.boss.position.z + 12000) / 24000 * 100}%`;
    }

    destroyMiniBossMarker() {
        if (this._miniBossDot?.parentNode) {
            this._miniBossDot.parentNode.removeChild(this._miniBossDot);
            this._miniBossDot = null;
        }
    }

    _syncMiniBossTelegraph(boss) {
        if (!boss || !boss.userData) return;
        const telegraph = !!boss.userData.miniBossTelegraph;
        if (!this.panelEl) return;

        this.panelEl.classList.toggle('event-boss-warning', telegraph);
        if (telegraph && !this._bossWarnWasActive) {
            this._playCue('#ff8855', 'warning');
            this._pulseScreen('error');
        }
        this._bossWarnWasActive = telegraph;
    }

    _pulseScreen(kind = 'error') {
        const el = document.getElementById('screen-pulse');
        if (!el) return;
        el.classList.remove('upgrade', 'streak', 'error');
        void el.offsetWidth;
        el.classList.add(kind);
    }

    _playCue(color = '#ffffff', cueType = 'eventStart') {
        try {
            const AudioContextRef = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextRef) return;
            if (!this._audioCtx) this._audioCtx = new AudioContextRef();
            if (this._audioCtx.state === 'suspended') this._audioCtx.resume();

            const ctx = this._audioCtx;
            const baseFreq = color.includes('ff55') ? 280 : color.includes('aaff') ? 420 : color.includes('bb55') ? 250 : 360;
            const patterns = {
                eventStart: [1.0],
                wave: [1.0, 1.12],
                warning: [1.0, 0.85, 1.1],
                bossSpawn: [0.65, 0.92, 1.18],
                success: [1.0, 1.26, 1.52],
                fail: [1.0, 0.82, 0.68],
            };
            const seq = patterns[cueType] || patterns.eventStart;
            const waveType = cueType === 'warning' || cueType === 'fail' ? 'sawtooth' : 'triangle';
            const step = 0.075;

            seq.forEach((mul, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                const t = ctx.currentTime + i * step;
                osc.type = waveType;
                osc.frequency.setValueAtTime(baseFreq * mul, t);
                osc.frequency.exponentialRampToValueAtTime(baseFreq * mul * 1.08, t + 0.06);
                gain.gain.setValueAtTime(0.0001, t);
                gain.gain.exponentialRampToValueAtTime(0.028, t + 0.012);
                gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.085);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(t);
                osc.stop(t + 0.09);
            });
        } catch (_) {
            // non-blocking
        }
    }
}

