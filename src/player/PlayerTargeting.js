import * as THREE from 'three';
import { CONFIG } from '../../config.js';
import { isPlayerInHubSafeZone } from '../hubSafe.js';
import { buildEnemyIntel } from '../enemyIntel.js';

export const playerTargetingMethods = {
_getShipForward() {
        const fwd = new THREE.Vector3(0, 0, -1);
        if (this.mesh) {
            fwd.applyQuaternion(this.mesh.quaternion);
        } else if (this.velocity.lengthSq() > 0.25) {
            fwd.copy(this.velocity);
        }
        fwd.y = 0;
        if (fwd.lengthSq() < 0.0001) fwd.set(0, 0, 1);
        return fwd.normalize();
    },

_getAimDirection() {
        const dir = new THREE.Vector3();
        this.camera.getWorldDirection(dir);
        dir.y *= 0.2;
        if (dir.lengthSq() < 0.001) return this._getShipForward();
        return dir.normalize();
    },

_acquireNearestHostile(maxDist) {
        const em = this.enemyManager;
        let best = null;
        let bestD = maxDist;
        if (em?.enemies) {
            for (const enemy of em.enemies) {
                if ((enemy.userData?.hp ?? 0) <= 0) continue;
                if (enemy.spawnType !== undefined) continue;
                const d = this.position.distanceTo(enemy.position);
                if (d < bestD) {
                    bestD = d;
                    best = enemy;
                }
            }
        }
        const mp = window.__game?.multiplayerClient;
        const rp = window.__game?.remotePlayers;
        if (mp?.isOnline && rp) {
            const remote = rp.findClosestTargetable(this.position, maxDist * 1.05);
            if (remote) {
                const entry = rp._resolveRemoteEntry(remote.userData.playerId);
                const pos = entry?.display || remote.position;
                const d = this.position.distanceTo(pos);
                if (d < bestD) return remote;
            }
        }
        return best;
    },

_resolveFireContext() {
        const maxDist = CONFIG.COMBAT.PLAYER_ATTACK_DIST;
        let target = this.target;
        if (target && (target.userData?.hp ?? 0) <= 0) {
            target = null;
            this.setTarget(null);
        }
        if (!target) {
            target = this._acquireNearestHostile(maxDist * 1.05);
            if (target) this.setTarget(target);
        }

        let aimPoint;
        let dir;
        if (target) {
            aimPoint = this._resolveTargetPos(target);
            dir = aimPoint.clone().sub(this.mesh.position);
            if (dir.lengthSq() > 1) dir.normalize();
            else dir = this._getAimDirection();
        } else {
            dir = this._getAimDirection();
            aimPoint = this.mesh.position.clone().add(dir.clone().multiplyScalar(maxDist * 0.65));
        }
        return { target, aimPoint, dir };
    },

_targetAlive(target) {
        if (!target) return false;
        if (target.userData?.isRemotePlayer) {
            const entry = window.__game?.remotePlayers?._resolveRemoteEntry?.(target.userData.playerId);
            return (entry?.hp ?? target.userData?.hp ?? 200) > 0 && !entry?.isDead;
        }
        return (target.userData?.hp ?? 0) > 0;
    },

_showSafeZoneHint() {
        const now = Date.now();
        if (this._safeZoneHintAt && now - this._safeZoneHintAt < 3500) return;
        this._safeZoneHintAt = now;
        const log = document.getElementById('log-text');
        if (log) log.innerHTML = '<span style="color:#88bbdd;">Zona segura — alejate del hub para combatir</span>';
    },

_showFloatingHeal(amount) {
        const el = document.getElementById('credit-popup');
        if (!el) return;
        clearTimeout(this._healPopupTimeout);
        el.textContent = `+${amount} HP`;
        el.className = 'credit-popup med';
        el.style.color = '#66eeaa';
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
        this._healPopupTimeout = setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(-10px)';
            el.style.color = '';
        }, 900);
    },

setTarget(enemy) {
        const resolved = enemy ? this._resolveTargetRoot(enemy) : null;
        if (this.target === resolved) return;
        if (this.target && this.target.userData?.selectionRing) {
            this.target.userData.selectionRing.visible = false;
        }

        this.target = resolved;
        this.targetSyncId = resolved?.userData?.syncId || null;
        const targetStatus = document.getElementById('target-status');
        if (targetStatus) targetStatus.style.display = 'none';

        if (this.target) {
            if (this.target.userData?.selectionRing) {
                this.target.userData.selectionRing.visible = true;
            }
            this.updateTargetUI();
            this._showEnemyIntel(this.target);
            if (!this.navTarget) this.autoPilot = true;
        } else {
            this.targetSyncId = null;
            this._hideEnemyIntel();
        }
        this._updateNavHud();
    },

updateTargetUI() {
        if (!this.target) return;
        if (this.target.userData?.isRemotePlayer) {
            const entry = window.__game?.remotePlayers?._resolveRemoteEntry?.(this.target.userData.playerId);
            if (entry) {
                this.target.userData.hp = entry.hp ?? this.target.userData.hp;
                this.target.userData.maxHp = entry.maxHp ?? this.target.userData.maxHp;
                this.target.userData.name = entry.nick || this.target.userData.name;
            }
        }
        const hpBar = document.getElementById('target-hp-bar');
        const hpText = document.getElementById('target-hp-text');
        const nameEl = document.getElementById('target-name');
        const levelEl = document.getElementById('target-level');
        if (nameEl) nameEl.textContent = this.target.userData.name || 'Objetivo';
        if (levelEl && !this.target.userData?.isRemotePlayer) {
            const intel = buildEnemyIntel(this.target);
            levelEl.textContent = intel ? `${intel.threat} · T${intel.tier}` : '';
        }
        const maxHp = this.target.userData.maxHp || 1;
        const hp = this.target.userData.hp ?? 0;
        if (hpBar) hpBar.style.width = `${Math.max(0, (hp / maxHp) * 100)}%`;
        if (hpText) hpText.textContent = `${Math.max(0, Math.floor(hp))} / ${maxHp} HP`;
        if (!this.target.userData?.isRemotePlayer) this._showEnemyIntel(this.target);
    },

_showEnemyIntel(enemy) {
        const panel = document.getElementById('target-status');
        const intel = buildEnemyIntel(enemy);
        if (!panel || !intel) return;
        panel.style.display = 'block';
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('target-intel-faction', intel.faction);
        set('target-intel-role', intel.roleLabel);
        set('target-intel-lore', intel.lore);
        set('target-intel-tip', intel.tip);
        const abEl = document.getElementById('target-intel-abilities');
        if (abEl) {
            abEl.innerHTML = intel.abilities.map((a) =>
                `<span class="intel-ability">${a.icon} ${a.label}</span>`,
            ).join('');
        }
        const sw = document.getElementById('target-intel-strengths');
        const wk = document.getElementById('target-intel-weaknesses');
        if (sw) sw.textContent = intel.strengths.join(' · ');
        if (wk) wk.textContent = intel.weaknesses.join(' · ');
    },

_hideEnemyIntel() {
        const panel = document.getElementById('target-status');
        if (panel) panel.style.display = 'none';
    },

_resolveTargetPos(target) {
        if (!target) return new THREE.Vector3();
        let root = target;
        while (root.parent && !root.userData?.isRemotePlayer) root = root.parent;
        if (root.userData?.isRemotePlayer) {
            const entry = window.__game?.remotePlayers?._resolveRemoteEntry?.(root.userData.playerId);
            if (entry?.display) return entry.display.clone();
            if (entry?.mesh?.position) return entry.mesh.position.clone();
        }
        return target.position.clone();
    },

_resolveTargetRoot(target) {
        if (!target) return null;
        let node = target;
        let best = null;
        while (node) {
            const ud = node.userData;
            if (ud?.isRemotePlayer) return node;
            if (ud?.isEnemy && ud?.hp !== undefined) best = node;
            node = node.parent;
        }
        return best || target;
    },
};
