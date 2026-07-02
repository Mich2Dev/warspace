/**
 * HUD en mundo — vida sobre nave/objetivo, XP inferior, recargas, alerta de misil.
 */

import * as THREE from 'three';
import { getViewportSize } from './orientationLock.js';
import { CONFIG } from '../config.js';
import { isEnemyHostileToPlayer } from './enemyNames.js';

const _proj = new THREE.Vector3();

export function projectWorldToScreen(camera, worldPos, yOffset = 0) {
    _proj.copy(worldPos);
    _proj.y += yOffset;
    _proj.project(camera);
    if (_proj.z > 1) return null;

    const { width, height } = getViewportSize();
    return {
        x: (_proj.x * 0.5 + 0.5) * width,
        y: (-(_proj.y * 0.5) + 0.5) * height,
    };
}

const ENEMY_HUD_OFFSETS = {
    Zona1: 95,
    Zona2: 58,
    Zona3: 64,
    Invader_Alpha: 75,
    Invader_Beta: 82,
    Invader_Gamma: 95,
    PvpPilot: 52,
};

function getEnemyHudYOffset(enemy) {
    if (!enemy) return 66;
    let offset = ENEMY_HUD_OFFSETS[enemy.userData?.type] ?? 60;
    if (enemy.spawnType) offset = 180;
    return offset + 6;
}

export class WorldHudManager {
    constructor() {
        this.playerBar = document.getElementById('player-world-bar');
        this.playerHpFill = document.getElementById('player-world-hp-fill');
        this.playerEnFill = document.getElementById('player-world-en-fill');
        this.playerShRow = document.getElementById('player-world-sh-row');
        this.playerShFill = document.getElementById('player-world-sh-fill');

        this.targetBar = document.getElementById('target-world-bar');
        this.targetName = document.getElementById('target-world-name');
        this.targetHpFill = document.getElementById('target-world-hp-fill');
        this.targetShRow = document.getElementById('target-world-sh-row');
        this.targetShFill = document.getElementById('target-world-sh-fill');

        this.xpStrip = document.getElementById('xp-strip-hud');
        this.xpFill = document.getElementById('xp-strip-fill');
        this.xpLabel = document.getElementById('xp-strip-label');

        this._missileBanner = null;
        this._bannerTick = 0;
        this._xpPulseTimer = 0;
    }

    update(camera, player, delta = 0, enemyManager = null) {
        if (!player?.mesh) return;
        this._updatePlayerBar(camera, player);
        this._updateTargetBar(camera, player);
        this._updateXpStrip(player, delta);
        this._updateComponentCharges(player);
        this._updateIncomingThreatBanner(enemyManager);
    }

    _updateIncomingThreatBanner(enemyManager) {
        const threat = enemyManager?._missileThreat;
        this._bannerTick = (this._bannerTick ?? 0) + 1;
        if (this._bannerTick % 24 !== 0 && threat) return;

        let el = this._missileBanner;
        if (!threat) {
            if (el) el.style.display = 'none';
            return;
        }
        if (!el) {
            el = document.createElement('div');
            el.id = 'incoming-missile-banner';
            el.style.cssText = [
                'position:fixed',
                'top:18%',
                'left:50%',
                'transform:translateX(-50%)',
                'z-index:900',
                'padding:10px 22px',
                'border-radius:8px',
                'background:rgba(180,30,10,0.88)',
                'border:2px solid #ff6644',
                'color:#fff',
                'font-weight:bold',
                'font-size:15px',
                'pointer-events:none',
                'text-shadow:0 0 8px #000',
            ].join(';');
            document.getElementById('ui')?.appendChild(el);
            this._missileBanner = el;
        }

        const label = `🚀 MISIL — ${threat.ownerName || 'Hostil'} · ${threat.dist}m · esquiva`;
        if (el.textContent !== label) el.textContent = label;
        el.style.display = 'block';
    }

    _placeBar(el, screen) {
        if (!el || !screen) return;
        el.hidden = false;
        el.style.left = `${screen.x}px`;
        el.style.top = `${screen.y}px`;
    }

    _hideBar(el) {
        if (el) el.hidden = true;
    }

    _updatePlayerBar(camera, player) {
        if (player.isDead) {
            this._hideBar(this.playerBar);
            return;
        }
        const screen = projectWorldToScreen(camera, player.position, 38);
        if (!screen) {
            this._hideBar(this.playerBar);
            return;
        }

        this._placeBar(this.playerBar, screen);

        const hpPct = Math.max(0, Math.min(100, (player.hp / player.maxHp) * 100));
        const enPct = Math.max(0, Math.min(100, (player.energy / player.maxEnergy) * 100));

        if (this.playerHpFill) this.playerHpFill.style.width = `${hpPct}%`;
        if (this.playerEnFill) this.playerEnFill.style.width = `${enPct}%`;

        if (this.playerShRow && this.playerShFill) {
            if (player.shieldActive) {
                const maxSh = player.equipment?.shield?.stats?.shieldHp ?? player.shieldMax ?? 100;
                const shPct = Math.max(0, Math.min(100, (player.shieldHp / maxSh) * 100));
                this.playerShRow.hidden = false;
                this.playerShFill.style.width = `${shPct}%`;
            } else {
                this.playerShRow.hidden = true;
            }
        }

        if (this.playerBar) {
            this.playerBar.classList.toggle('world-bar-low', hpPct < 28);
            this.playerBar.classList.toggle('world-bar-damage', player.damageShake > 0);
        }
    }

    _updateTargetBar(camera, player) {
        const enemy = player.target;
        const remoteStale = enemy?.userData?.isRemotePlayer
            && !window.__game?.remotePlayers?.remote.has(String(enemy.userData.playerId));
        if (!enemy || enemy.userData?.hp <= 0 || !enemy.parent || remoteStale) {
            if (enemy && (enemy.userData?.hp <= 0 || !enemy.parent || remoteStale)) {
                player.setTarget(null);
            }
            this._hideBar(this.targetBar);
            return;
        }

        const screen = projectWorldToScreen(camera, enemy.position, getEnemyHudYOffset(enemy));
        if (!screen) {
            this._hideBar(this.targetBar);
            return;
        }

        this._placeBar(this.targetBar, screen);

        const maxHp = enemy.userData.maxHp || 1;
        const hpPct = Math.max(0, Math.min(100, (enemy.userData.hp / maxHp) * 100));
        if (this.targetHpFill) this.targetHpFill.style.width = `${hpPct}%`;

        if (this.targetName) {
            this.targetName.textContent = enemy.userData.name || 'Objetivo';
            this.targetName.classList.toggle('is-boss', enemy.userData.type === 'Boss');
            const hostile = !enemy.userData?.isRemotePlayer
                && isEnemyHostileToPlayer(enemy, player, CONFIG);
            this.targetName.classList.toggle('is-hostile', hostile);
        }

        if (this.targetShRow && this.targetShFill) {
            const shHp = enemy.userData.enemyShieldHp ?? 0;
            if (enemy.userData.enemyShieldActive && shHp > 0) {
                const shMax = enemy.userData.enemyShieldMax || shHp;
                this.targetShRow.hidden = false;
                this.targetShFill.style.width = `${Math.max(0, Math.min(100, (shHp / shMax) * 100))}%`;
            } else {
                this.targetShRow.hidden = true;
            }
        }
    }

    _updateXpStrip(player, delta) {
        if (!this.xpFill || !this.xpStrip) return;
        const pct = Math.max(0, Math.min(100, (player.xp / (player.xpToNextLevel || 100)) * 100));
        this.xpFill.style.width = `${pct}%`;
        if (this.xpLabel) this.xpLabel.textContent = `NV ${player.level}`;

        if (this._xpPulseTimer > 0) {
            this._xpPulseTimer -= delta;
            if (this._xpPulseTimer <= 0) this.xpStrip.classList.remove('xp-strip-pulse');
        }
    }

    pulseXp() {
        if (!this.xpStrip) return;
        this.xpStrip.classList.add('xp-strip-pulse');
        this._xpPulseTimer = 0.45;
    }

    _updateComponentCharges(player) {
        const now = player.time || 0;
        const missCd = player.missileCooldown || 4;
        const missRem = Math.max(0, 1 - (now - (player.lastMissileTime || 0)) / missCd);
        const cdMissile = document.getElementById('cd-missile');
        if (cdMissile) cdMissile.style.height = `${missRem * 100}%`;

        const shieldStats = player.equipment?.shield?.stats || {};
        const shieldCd = shieldStats.cooldown || 8;
        const shieldRem = Math.max(0, 1 - (now - (player.lastShieldTime || 0)) / shieldCd);
        const cdShield = document.getElementById('cd-shield');
        if (cdShield) cdShield.style.height = `${shieldRem * 100}%`;

        const repairCd = (player.equipment?.repair?.stats?.cooldown) || 6;
        const repairRem = Math.max(0, 1 - (now - (player.lastRepairTime || 0)) / repairCd);
        const cdRepair = document.getElementById('cd-repair');
        if (cdRepair) cdRepair.style.height = `${repairRem * 100}%`;
    }
}
