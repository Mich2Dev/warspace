import * as THREE from 'three';
import { CONFIG } from '../../config.js';
import { isPlayerShieldUp, isPlayerRepairChannelUp, resetPlayerAbilityState, syncPlayerAbilityVisuals } from './syncPlayerAbilityVisuals.js';
import {
    effectiveSpreadDeg,
    computeMissileHitChance,
    missileDamage,
    homingStrength,
} from '../balance.js';
import { isPlayerInHubSafeZone, getHubSpawnPoint } from '../hubSafe.js';
import { segmentHitsSphere, impactPointOnSphere } from '../projectileHit.js';
import { getShipById, syncShipActionBar } from '../ships/playerShipCatalog.js';

export const playerCombatMethods = {
_getCurrentAbilities() {
    const ship = getShipById(this.activeShipId);
    return ship?.abilities || {};
},

_pulseScreen(type) {
        const el = document.getElementById('screen-pulse');
        if (!el) return;
        el.className = 'screen-pulse ' + type;
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animation = '';
    },

_getImpactPosition(hitFrom) {
        if (this.shieldMesh?.visible) {
            return this._getShieldImpactPoint(hitFrom);
        }
        return this.position.clone();
    },

_asVector3(v) {
        if (v?.isVector3) return v;
        if (v && typeof v.x === 'number') return new THREE.Vector3(v.x, v.y ?? 0, v.z ?? 0);
        return null;
    },

_getShieldImpactPoint(hitFrom) {
        const center = new THREE.Vector3();
        this.shieldMesh.getWorldPosition(center);
        const from = this._asVector3(hitFrom);
        if (!from) return center;

        const dir = from.clone().sub(center);
        if (dir.lengthSq() < 0.01) return center;
        dir.normalize();
        const r = (this._shieldBaseRadius || 45) * (this.shieldMesh.scale.x || 1);
        return center.clone().add(dir.multiplyScalar(r * 1.04));
    },

_showHitSourceLog(attackKind, attackerName, amount) {
        const labels = {
            missile: '🚀 MISIL',
            laser: '⚡ LÁSER',
            shockwave: '🌊 ONDA',
        };
        const label = labels[attackKind] || '💥 IMPACTO';
        const log = document.getElementById('log-text');
        if (!log) return;
        log.innerHTML = `<span style="color:#ff5533;font-weight:bold;">${label} de <b>${attackerName || 'Hostil'}</b> — ${Math.round(amount)} daño</span>`;
    },

_feedbackCombatHit({
        shieldHit = false,
        hullLost = 0,
        amount = 0,
        hitFrom = null,
        attackKind = null,
        attackerName = null,
    } = {}) {
        const vfx = window.__game?.vfx;
        const severity = Math.min(1, Math.max(0.06, amount / 130));
        const pos = this._getImpactPosition(shieldHit ? hitFrom : null);

        this.lastDamageTime = Date.now();
        if (attackKind) {
            this._showHitSourceLog(attackKind, attackerName, amount);
        }

        if (shieldHit && hullLost <= 0) {
            vfx?.combatImpact(pos, 'shield', {
                severity,
                amount,
                shieldShell: this.shieldShell,
                hitFrom,
            });
            this._flashShieldHit();
            this.damageShake = 0.12 + severity * 0.1;
        } else if (shieldHit && hullLost > 0) {
            vfx?.combatImpact(pos, 'shieldBreak', {
                severity,
                amount,
                hullLost,
                shieldShell: this.shieldShell,
                hitFrom,
            });
            this._flashShieldHit();
            this.damageShake = 0.35 + severity * 0.15;
        } else {
            vfx?.hitSparks(pos, {
                color: 0xff5544,
                count: 4,
                spread: 11,
                size: 2.2,
                duration: 0.2,
            });
            this.damageShake = 0.1 + severity * 0.08;
        }
    },

_fitShieldScale() {
        if (!this.shieldMesh || !this.visualGroup) return;
        this.visualGroup.updateMatrixWorld(true);

        const box = new THREE.Box3();
        let hasMesh = false;
        for (const child of this.visualGroup.children) {
            if (child === this.shieldGroup) continue;
            const cb = new THREE.Box3().setFromObject(child);
            if (!cb.isEmpty()) {
                box.union(cb);
                hasMesh = true;
            }
        }
        if (!hasMesh || box.isEmpty()) return;

        const size = new THREE.Vector3();
        const centerWorld = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(centerWorld);

        const centerLocal = this.visualGroup.worldToLocal(centerWorld.clone());
        this.shieldMesh.position.copy(centerLocal);

        const maxDim = Math.max(size.x, size.y, size.z);
        const r = maxDim * 0.78;
        const s = Math.max(2.15, r / (this._shieldBaseRadius || 45));
        this._shieldTargetScale = s;

        if (this.shieldActive) {
            this.shieldMesh.scale.setScalar(s);
        }
        if (this.repairGlow) {
            this.repairGlow.position.copy(centerLocal);
            this.repairGlow.scale.setScalar(s * 0.78);
        }
    },

    _animateShieldExpand() {
        if (!this.shieldMesh || !isPlayerShieldUp(this)) return;
        this._fitShieldScale();
        const target = this._shieldTargetScale || 2.4;
        const expand = () => {
            if (!isPlayerShieldUp(this) || !this.shieldMesh) {
                syncPlayerAbilityVisuals(this, window.__game?.vfx, 0);
                return;
            }
            const cur = this.shieldMesh.scale.x;
            const next = THREE.MathUtils.lerp(cur, target, 0.16);
            this.shieldMesh.scale.setScalar(next);
            if (target - next > 0.03) requestAnimationFrame(expand);
            else this.shieldMesh.scale.setScalar(target);
        };
        this.shieldMesh.scale.setScalar(Math.max(0.04, target * 0.06));
        expand();
    },

    _flashShieldHit() {
        if (!this.shieldMesh || !isPlayerShieldUp(this)) return;
        if (this.shieldShell?.material) this.shieldShell.material.opacity = 0.72;
        const base = this._shieldTargetScale || this.shieldMesh.scale.x;
        this.shieldMesh.scale.setScalar(base * 1.025);

        setTimeout(() => {
            if (this.shieldShell?.material && isPlayerShieldUp(this)) {
                this.shieldShell.material.opacity = 0.38;
            }
            if (isPlayerShieldUp(this)) this.shieldMesh.scale.setScalar(this._shieldTargetScale || 2.4);
            syncPlayerAbilityVisuals(this, window.__game?.vfx, 0);
        }, 140);
    },

shoot() {
        const ab = this._getCurrentAbilities();
        if (!ab.slot1) return;
        const slot1Id = ab.slot1.id;

        let baseEnergy = this.equipment.weapon.stats.energyCost || 5;
        let energyCost = baseEnergy;
        let damageMult = 1.0;
        let scale = 1.0;
        let colorInner = 0xffffff;

        if (slot1Id === 'canon_pesado') {
            energyCost = baseEnergy * 3;
            damageMult = 2.5;
            scale = 2.0;
        } else if (slot1Id === 'canon_laser') {
            energyCost = baseEnergy * 0.5;
            damageMult = 0.6;
            scale = 0.6;
            colorInner = 0x66ffaa;
        }

        if (this.energy < energyCost) {
            const log = document.getElementById('log-text');
            if (log) log.innerHTML = '<span style="color:#ffaa66;">Sin energía para disparar</span>';
            return;
        }
        if (isPlayerInHubSafeZone(this)) this._showSafeZoneHint();
        const now = Date.now();
        if (now - this.lastShotTime < this.shootCooldownMs) return;

        const combatLoad = window.__game?.enemyManager?.combatLoadLevel ?? 'light';
        const maxLasers = combatLoad === 'heavy' ? 8 : combatLoad === 'medium' ? 12 : 22;
        while (this.lasers.length >= maxLasers) {
            const drop = this.lasers.shift();
            if (drop?.mesh) this.scene.remove(drop.mesh);
        }

        const { target, aimPoint, dir } = this._resolveFireContext();

        this.lastShotTime = now;
        this.energy -= energyCost;
        this.updateUI();

        const spawnLaser = (offsetX) => {
            const laser = new THREE.Group();
            
            const outerLaser = new THREE.Mesh(this.laserGeo, this.laserMat);
            outerLaser.scale.setScalar(scale);
            
            const innerGeo = new THREE.CylinderGeometry(0.3 * scale, 0.3 * scale, 130 * scale, 8);
            innerGeo.rotateX(Math.PI / 2);
            const innerMat = new THREE.MeshStandardMaterial({ 
                color: colorInner, 
                emissive: colorInner, 
                emissiveIntensity: 10.0 
            });
            const innerLaser = new THREE.Mesh(innerGeo, innerMat);
            
            laser.add(outerLaser);
            laser.add(innerLaser);
            
            const offset = new THREE.Vector3(offsetX, 0, 0);
            offset.applyQuaternion(this.mesh.quaternion);
            
            laser.position.copy(this.mesh.position).add(offset);
            laser.position.y += 2;

            const shotTarget = aimPoint.clone();
            if (target) {
                const spreadRad = effectiveSpreadDeg(this) * (Math.PI / 180);
                shotTarget.x += (Math.random() - 0.5) * spreadRad * 40;
                shotTarget.y += (Math.random() - 0.5) * spreadRad * 40;
            }
            laser.lookAt(shotTarget);
            
            this.scene.add(laser);
            this.lasers.push({ mesh: laser, target, speed: 2200, damageMult });
        };
        
        spawnLaser(12 * scale);
        spawnLaser(-12 * scale);

        const vfx = window.__game?.vfx;
        if (vfx) {
            const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
            if (right.lengthSq() < 0.001) right.set(1, 0, 0);
            vfx.muzzleFlash(this.mesh.position.clone().add(right.clone().multiplyScalar(12)), dir);
            vfx.muzzleFlash(this.mesh.position.clone().add(right.clone().multiplyScalar(-12)), dir);
        }

        const mp = window.__game?.multiplayerClient;
        const cs = window.__game?.combatSync;
        if (mp?.isOnline && cs) {
            const tp = target ? this._resolveTargetPos(target) : aimPoint;
            const shootDir = target
                ? tp.clone().sub(this.mesh.position).normalize()
                : dir.clone();

            const remoteEntry = this._getRemoteTargetEntry();
            const shootPayload = {
                ox: this.mesh.position.x,
                oy: this.mesh.position.y + 2,
                oz: this.mesh.position.z,
                ax: this.mesh.position.x,
                ay: this.mesh.position.y,
                az: this.mesh.position.z,
                dx: shootDir.x,
                dy: shootDir.y,
                dz: shootDir.z,
                tx: tp.x,
                ty: tp.y,
                tz: tp.z,
            };

            if (remoteEntry && !remoteEntry.isDead) {
                const dist = tp.distanceTo(this.mesh.position);
                if (dist <= CONFIG.COMBAT.PLAYER_ATTACK_DIST * 1.15) {
                    shootPayload.targetId = remoteEntry.id;
                    shootPayload.amount = this.baseDamage * damageMult;
                    remoteEntry.hitFlash = 1;
                }
            } else {
                const nearRemote = this._findRemotePlayerAt(this.mesh.position, CONFIG.COMBAT.PLAYER_ATTACK_DIST * 0.85);
                if (nearRemote && !nearRemote.isDead) {
                    const tp2 = nearRemote.display || nearRemote.mesh?.position;
                    if (tp2) {
                        shootPayload.targetId = nearRemote.id;
                        shootPayload.amount = this.baseDamage * damageMult;
                        shootPayload.tx = tp2.x;
                        shootPayload.ty = tp2.y;
                        shootPayload.tz = tp2.z;
                        const d2 = tp2.clone().sub(this.mesh.position).normalize();
                        shootPayload.dx = d2.x;
                        shootPayload.dy = d2.y;
                        shootPayload.dz = d2.z;
                        nearRemote.hitFlash = 1;
                    }
                }
            }

            cs.emit('player_shoot', shootPayload);
        }
    },

shootMissile() {
        const ab = this._getCurrentAbilities();
        if (!ab.slot2) return; // Nave sin misiles
        const slot2Id = ab.slot2.id;
        
        const isBurst = slot2Id === 'rafaga_misiles';
        const isHeavy = slot2Id === 'misil_pesado';
        const isGuided = slot2Id === 'misil_guidado';

        const { target } = this._resolveFireContext();
        if (!this._targetAlive(target)) {
            const log = document.getElementById('log-text');
            if (log) log.innerHTML = '<span style="color:#ffaa66;">Sin objetivo para misil — clic en enemigo o Tab</span>';
            return;
        }
        const now = this.time || 0;
        if (now - this.lastMissileTime < this.missileCooldown) return;

        const combatLoad = window.__game?.enemyManager?.combatLoadLevel ?? 'light';
        const maxMissiles = combatLoad === 'heavy' ? 4 : combatLoad === 'medium' ? 6 : 10;
        while (this.missiles.length >= maxMissiles) {
            const drop = this.missiles.shift();
            if (drop?.mesh) this.scene.remove(drop.mesh);
        }

        this.lastMissileTime = now;
        
        const mStats = this._combatDerived?.missile || this.equipment.missile.stats;
        let numMissiles = isBurst ? 3 : 1;
        let scale = isHeavy ? 2.5 : 1.0;
        let damageMult = isHeavy ? 3.0 : (isBurst ? 0.6 : (isGuided ? 0.85 : 1.0));
        let speedMult = isHeavy ? 0.7 : (isGuided ? 1.15 : 1.0);
        let delayMs = isBurst ? 200 : 0;

        const tp = this._resolveTargetPos(target);
        const dist = this.mesh.position.distanceTo(tp);
        const hitChance = computeMissileHitChance(this, target, dist);
        const maxRange = mStats.maxRange ?? 3200;

        const fireSingleMissile = (offsetDelay) => {
            setTimeout(() => {
                const missile = new THREE.Mesh(this.missileGeo, this.missileMat);
                missile.scale.setScalar(scale);
                missile.position.copy(this.mesh.position);
                missile.position.y += 2;
                missile.lookAt(tp);
                this.scene.add(missile);

                const initialDir = new THREE.Vector3().subVectors(tp, this.mesh.position).normalize();
                
                this.missiles.push({
                    mesh: missile,
                    target,
                    speed: (mStats.speed || 620) * speedMult,
                    velocity: initialDir.multiplyScalar((mStats.speed || 620) * speedMult),
                    hitChance,
                    hitResolved: false,
                    damage: missileDamage(this) * damageMult,
                    aoeRadius: (mStats.aoeRadius || 100) * (isHeavy ? 1.5 : 1.0),
                    maxRange,
                    originDist: 0,
                });

                const mp = window.__game?.multiplayerClient;
                const cs = window.__game?.combatSync;
                if (mp?.isOnline && cs) {
                    const remoteEntry = this._getRemoteTargetEntry();
                    cs.emit('player_missile', {
                        ox: missile.position.x,
                        oy: missile.position.y,
                        oz: missile.position.z,
                        dx: initialDir.x,
                        dy: initialDir.y,
                        dz: initialDir.z,
                        speed: (mStats.speed || 800) * speedMult,
                        targetId: remoteEntry?.id ?? null,
                    });
                }
            }, offsetDelay);
        };

        for(let i=0; i<numMissiles; i++) {
            fireSingleMissile(i * delayMs);
        }
    },

    _activateNanoBurst() {
        const now = this.time || 0;
        if (now - this.lastMissileTime < 15) return; // 15s cooldown
        this.lastMissileTime = now;
        
        // Curación instantánea
        const heal = 60;
        this.hp = Math.min(this.maxHp, this.hp + heal);
        this.updateUI();
        this._showFloatingHeal(heal);
        window.__game?.vfx?.shieldActivate?.(this.mesh.position); // Reusar efecto
        
        const log = document.getElementById('log-text');
        if (log) log.innerHTML = `<span style="color:#66ddaa;font-weight:bold;">⚕ Nano-Cura aplicada (+${heal} HP)</span>`;
    },

_findRemotePlayerAt(position, radius) {
        const rp = window.__game?.remotePlayers;
        if (!rp) return null;
        for (const entry of rp.remote.values()) {
            const pos = entry.display || entry.mesh?.position;
            if (pos && position.distanceTo(pos) < radius) {
                return entry;
            }
        }
        return null;
    },

_getRemoteTargetEntry() {
        if (!this.target) return null;
        let root = this.target;
        while (root.parent && !root.userData?.isRemotePlayer) root = root.parent;
        const pid = root.userData?.playerId;
        if (!pid) return null;
        const rp = window.__game?.remotePlayers;
        if (!rp) return null;
        return rp._resolveRemoteEntry?.(pid) ?? rp.remote.get(String(pid)) ?? null;
    },

_damageRemotePlayer(entry, amount) {
        if (!entry?.id || entry.isDead) return;
        const dmg = Math.max(1, Math.round(amount));
        if ((entry.hp ?? 200) <= 0) return;

        const mp = window.__game?.multiplayerClient;
        const cs = window.__game?.combatSync;
        if (mp?.isOnline && cs) {
            entry.hitFlash = 1;
            const tp = entry.display || entry.mesh?.position;
            cs.emit('player_shoot', {
                targetId: entry.id,
                amount: dmg,
                ox: this.mesh.position.x,
                oy: this.mesh.position.y + 2,
                oz: this.mesh.position.z,
                ax: this.mesh.position.x,
                ay: this.mesh.position.y,
                az: this.mesh.position.z,
                tx: tp?.x ?? 0,
                ty: tp?.y ?? 0,
                tz: tp?.z ?? 0,
            });
            return;
        }

        entry.hitFlash = 1;
        cs?.emit('pvp_hit', { targetId: entry.id, amount: dmg });
    },

_damageRemotePlayersInRadius(position, radius, amount) {
        const mp = window.__game?.multiplayerClient;
        const cs = window.__game?.combatSync;
        if (mp?.isOnline && cs) {
            cs.emit('player_pvp_aoe', {
                cx: position.x,
                cy: position.y,
                cz: position.z,
                radius,
                amount: Math.round(amount),
                ax: this.mesh.position.x,
                ay: this.mesh.position.y,
                az: this.mesh.position.z,
            });
            return;
        }

        const rp = window.__game?.remotePlayers;
        if (!rp) return;
        for (const entry of rp.remote.values()) {
            const pos = entry.display || entry.mesh?.position;
            if (pos && position.distanceTo(pos) < radius) {
                this._damageRemotePlayer(entry, Math.round(amount * 0.65));
            }
        }
    },

updateLasers(delta, enemyManager, environment) {
        const mpOnline = window.__game?.multiplayerClient?.isOnline;
        const laserDir = this._laserMoveDir || (this._laserMoveDir = new THREE.Vector3());
        const prevPos = this._laserPrev || (this._laserPrev = new THREE.Vector3());
        const nextPos = this._laserNext || (this._laserNext = new THREE.Vector3());

        for (let i = this.lasers.length - 1; i >= 0; i--) {
            const laser = this.lasers[i];
            prevPos.copy(laser.mesh.position);

            laser.mesh.getWorldDirection(laserDir);
            laser.mesh.position.addScaledVector(laserDir, laser.speed * delta);
            nextPos.copy(laser.mesh.position);

            let hitRadius = 48;
            if (laser.target?.userData?.type === 'Drone') hitRadius = 30;

            const finishHit = (impact) => {
                if (impact) laser.mesh.position.copy(impact);
                this.scene.remove(laser.mesh);
                this.lasers.splice(i, 1);
            };

            // En multijugador el daño PvP va por hitscan en shoot(); aquí solo enemigos
            if (!mpOnline) {
                const rp = window.__game?.remotePlayers;
                if (rp) {
                    for (const entry of rp.remote.values()) {
                        const rpos = entry.display || entry.mesh?.position;
                        if (!rpos) continue;
                        const segHit = segmentHitsSphere(prevPos, nextPos, rpos, hitRadius + 8);
                        if (!segHit) continue;
                        finishHit(impactPointOnSphere(segHit, rpos, hitRadius));
                        this._damageRemotePlayer(entry, this.baseDamage);
                        break;
                    }
                    if (i >= this.lasers.length || this.lasers[i] !== laser) continue;
                }
            }

            if (laser.target) {
                const isRemote = laser.target.userData?.isRemotePlayer;
                if (mpOnline && isRemote) {
                    if (laser.mesh.position.distanceTo(this.mesh.position) > CONFIG.COMBAT.PLAYER_ATTACK_DIST) {
                        finishHit(null);
                    }
                    continue;
                }

                const tpos = this._resolveTargetPos(laser.target);
                const segHit = segmentHitsSphere(prevPos, nextPos, tpos, hitRadius);
                if (segHit) {
                    if (isRemote) {
                        const entry = window.__game?.remotePlayers?.remote.get(laser.target.userData.playerId);
                        if (entry) this._damageRemotePlayer(entry, this.baseDamage);
                    } else {
                        enemyManager.takeDamage(laser.target, this.baseDamage);
                        this.updateTargetUI();
                    }
                    finishHit(impactPointOnSphere(segHit, tpos, hitRadius));
                    continue;
                }
            } else if (enemyManager?.findEnemyOnSegment) {
                const hit = enemyManager.findEnemyOnSegment(prevPos, nextPos, hitRadius);
                if (hit) {
                    enemyManager.takeDamage(hit.enemy, this.baseDamage);
                    if (!this.target) this.setTarget(hit.enemy);
                    this.updateTargetUI();
                    finishHit(impactPointOnSphere(hit.segHit, hit.enemy.position, hitRadius));
                    continue;
                }
            }

            if (laser.mesh.position.distanceTo(this.mesh.position) > CONFIG.COMBAT.PLAYER_ATTACK_DIST) {
                finishHit(null);
            }
        }
    },

updateMissiles(delta, enemyManager) {
        const toTarget = this._msToTarget;
        const lookPos = this._msLook;

        for (let i = this.missiles.length - 1; i >= 0; i--) {
            const missile = this.missiles[i];

            if (missile.target && missile.target.userData.hp > 0) {
                const tpos = this._resolveTargetPos(missile.target);
                toTarget.subVectors(tpos, missile.mesh.position).normalize();
                const homing = homingStrength(this);
                missile.velocity.lerp(toTarget.multiplyScalar(missile.speed), homing * delta);
            }

            missile.mesh.position.addScaledVector(missile.velocity, delta);
            missile.originDist = (missile.originDist || 0) + missile.velocity.length() * delta;

            lookPos.copy(missile.mesh.position).add(missile.velocity);
            missile.mesh.lookAt(lookPos);

            let hitRadius = 40;
            if (missile.target && missile.target.userData.type === 'Drone') hitRadius = 30;

            const distToTarget = missile.target
                ? missile.mesh.position.distanceTo(this._resolveTargetPos(missile.target))
                : Infinity;

            if (missile.target && !missile.hitResolved && distToTarget < hitRadius * 2.5) {
                missile.hitResolved = true;
                if (Math.random() > (missile.hitChance ?? 0.85)) {
                    missile.target = null;
                }
            }

            if (missile.target && distToTarget < hitRadius) {
                const dmg = missile.damage ?? missileDamage(this);
                const radius = missile.aoeRadius ?? 120;
                const hitPos = missile.mesh.position.clone();
                enemyManager.takeDamageArea(hitPos, radius, dmg, { quietVfx: true, aoe: true });
                this._damageRemotePlayersInRadius(hitPos, radius, dmg);
                this.updateTargetUI();

                window.__game?.vfx?.abilityBurst(hitPos, 'missile');

                this.scene.remove(missile.mesh);
                this.missiles.splice(i, 1);
            } else if ((missile.originDist ?? 0) > (missile.maxRange ?? 3200)) {
                this.scene.remove(missile.mesh);
                this.missiles.splice(i, 1);
            }
        }

        for (const light of this.explosionLights) {
            if (light.intensity > 0) light.intensity = Math.max(0, light.intensity - delta * 28);
        }
    },

updateActionBar() {
        const slotCannon = document.getElementById('slot-cannon');
        const slotMissile = document.getElementById('slot-missile');
        const slotRepair = document.getElementById('slot-repair');
        const slotShield = document.getElementById('slot-shield');
        const slotNitro = document.getElementById('slot-nitro');
        
        const cdMissile = document.getElementById('cd-missile');
        const cdRepair = document.getElementById('cd-repair');
        const cdShield = document.getElementById('cd-shield');

        if (slotCannon) {
            if (this.keys['1'] || this.keys[' '] || this._mobileFire) slotCannon.classList.add('active');
            else slotCannon.classList.remove('active');
        }

        if (slotNitro) {
            if (this.keys.shift && this.energy > 0) slotNitro.classList.add('active');
            else slotNitro.classList.remove('active');
        }

        if (slotMissile && cdMissile) {
            if (this.keys['2']) slotMissile.classList.add('active');
            else slotMissile.classList.remove('active');

            const now = this.time || 0;
            const timeSinceMissile = now - this.lastMissileTime;
            if (timeSinceMissile < this.missileCooldown) {
                const percent = Math.floor(100 - (timeSinceMissile / this.missileCooldown) * 100);
                if (cdMissile.dataset.percent !== String(percent)) {
                    cdMissile.style.height = percent + '%';
                    cdMissile.dataset.percent = percent;
                }
            } else {
                if (cdMissile.dataset.percent !== '0') {
                    cdMissile.style.height = '0%';
                    cdMissile.dataset.percent = '0';
                }
            }
        }
        
        if (slotShield && cdShield) {
            if (this._shieldKeyPulse > 0 || this.shieldActive) slotShield.classList.add('active');
            else slotShield.classList.remove('active');

            const now = this.time || 0;
            const cooldown = this.equipment.shield.stats.cooldown;
            const timeSinceShield = now - this.lastShieldTime;
            if (timeSinceShield < cooldown) {
                const percent = Math.floor(100 - (timeSinceShield / cooldown) * 100);
                if (cdShield.dataset.percent !== String(percent)) {
                    cdShield.style.height = percent + '%';
                    cdShield.dataset.percent = percent;
                }
            } else {
                if (cdShield.dataset.percent !== '0') {
                    cdShield.style.height = '0%';
                    cdShield.dataset.percent = '0';
                }
            }
        }

        if (slotRepair && cdRepair) {
            const now = this.time || 0;
            const channelActive = isPlayerRepairChannelUp(this);
            if (channelActive || this._repairKeyPulse > 0) {
                slotRepair.classList.add('active');
            } else {
                slotRepair.classList.remove('active');
            }
            const left = (this._repairBurstCooldown || 0) - now;
            if (left > 0) {
                const percent = Math.floor(100 - (left / 14) * 100);
                cdRepair.style.height = `${percent}%`;
            } else {
                cdRepair.style.height = '0%';
            }
        }
    },

activateRepairBurst() {
        if (this.isDead) return;
        const now = this.time || 0;
        const log = document.getElementById('log-text');
        if ((this._repairChannelUntil ?? 0) > now) {
            if (log) {
                const left = Math.ceil(this._repairChannelUntil - now);
                log.innerHTML = `<span style="color:#88aa99;">Reparación en curso (${left}s)</span>`;
            }
            return;
        }
        const cdLeft = (this._repairBurstCooldown || 0) - now;
        if (cdLeft > 0) {
            if (log) {
                log.innerHTML = `<span style="color:#88aa99;">Reparador en recarga (${Math.ceil(cdLeft)}s)</span>`;
            }
            return;
        }
        if (this.hp >= this.maxHp * 0.98) {
            if (log) log.innerHTML = '<span style="color:#88aa99;">Casco al máximo — reparador no necesario</span>';
            return;
        }
        const rep = this._combatDerived?.repair || this.equipment.repair?.stats || {};
        const ab = this._getCurrentAbilities();
        const repairId = ab.slot3?.id || 'reparar_basico';
        const repairMult = repairId === 'reparar_area' ? 1.45 : repairId === 'reparar_blindaje' ? 0.85 : 1;
        const energyCost = Math.max(6, Math.round((rep.energyCost ?? 2) * 4));
        if (this.energy < energyCost) {
            if (log) log.innerHTML = `<span style="color:#ffaa66;">Energía insuficiente (${energyCost} EN)</span>`;
            return;
        }
        const channelDuration = (rep.channelDuration ?? 4.5) * (repairId === 'reparar_blindaje' ? 1.25 : 1);
        const totalHeal = Math.round((rep.repairRate ?? 12) * 2.8 * repairMult);

        this._repairBurstCooldown = now + 14;
        this.energy -= energyCost;
        this._repairChannelUntil = now + channelDuration;
        this._repairChannelRate = totalHeal / channelDuration;
        this._repairChannelAccum = 0;
        this._repairKeyPulse = 0.35;
        syncPlayerAbilityVisuals(this, window.__game?.vfx, 0);
        this.updateUI();

        const fxPos = this.mesh?.position ?? this.position;
        window.__game?.vfx?.setPlayerRepairActive(this, true, 'active');
        window.__game?.vfx?.repairBurst(fxPos, totalHeal);
        if (log) {
            log.innerHTML = `<span style="color:#66ddaa;font-weight:bold;">✚ Nanobots activos (${channelDuration.toFixed(1)}s)</span>`;
        }
    },

_tickRepairChannel(delta) {
        const now = this.time || 0;
        if (!this._repairChannelUntil || now >= this._repairChannelUntil) {
            if (this._repairChannelUntil && now >= this._repairChannelUntil) {
                const healed = Math.round(this._repairChannelAccum ?? 0);
                if (healed > 0) {
                    this._showFloatingHeal(healed);
                    const log = document.getElementById('log-text');
                    if (log) {
                        log.innerHTML = `<span style="color:#66ddaa;font-weight:bold;">✚ Nanobots +${healed} HP</span>`;
                    }
                }
                this._repairChannelUntil = 0;
                this._repairChannelRate = 0;
                this._repairChannelAccum = 0;
                syncPlayerAbilityVisuals(this, window.__game?.vfx, 0);
            }
            return;
        }
        const step = (this._repairChannelRate ?? 0) * delta;
        if (step <= 0) return;
        const before = this.hp;
        this.hp = Math.min(this.maxHp, this.hp + step);
        this._repairChannelAccum = (this._repairChannelAccum ?? 0) + (this.hp - before);
        this.updateUI();
    },

_cancelRepairChannel() {
        this._repairChannelUntil = 0;
        this._repairChannelRate = 0;
        this._repairChannelAccum = 0;
        this._repairKeyPulse = 0;
        syncPlayerAbilityVisuals(this, window.__game?.vfx, 0);
    },

applySlow(mult = 0.4, duration = 3.5) {
        if (this.isDead) return;
        const now = this.time || 0;
        const wasSlowed = this._slowUntil && now < this._slowUntil;
        this._slowMult = Math.min(this._slowMult ?? 1, mult);
        this._slowUntil = Math.max(this._slowUntil || 0, now + duration);
        window.__game?.vfx?.playerSlowField(this, duration);
        if (!wasSlowed) {
            window.__game?.vfx?.ionPulse(this.position);
            window.__game?.vfx?.addShake(0.38);
        }
        const pct = Math.round((1 - mult) * 100);
        const log = document.getElementById('log-text');
        if (log) {
            log.innerHTML = `<span style="color:#44ddff;font-weight:bold;">⚠ Pulso iónico — −${pct}% velocidad (${duration.toFixed(1)}s)</span>`;
        }
        const debuff = document.getElementById('debuff-slow');
        if (debuff) {
            debuff.style.display = 'block';
            debuff.textContent = `ION −${pct}%`;
        }
    },

_getShieldStats() {
        const s = this.equipment?.shield?.stats || this._combatDerived?.shield || {};
        return {
            shieldHp: s.shieldHp ?? 250,
            duration: s.duration ?? 12,
            cooldown: s.cooldown ?? 28,
            activateCost: s.activateCost ?? 25,
        };
    },

_isShieldUp() {
        return isPlayerShieldUp(this);
    },

_syncShieldVisual() {
        syncPlayerAbilityVisuals(this, window.__game?.vfx, 0);
    },

activateShield() {
        if (this.isDead) return;
        const stats = this._getShieldStats();
        const now = this.time || 0;

        if (this._isShieldUp()) return;

        if (this.lastShieldTime > 0 && now - this.lastShieldTime < stats.cooldown) {
            const left = Math.ceil(stats.cooldown - (now - this.lastShieldTime));
            const log = document.getElementById('log-text');
            if (log) log.innerHTML = `<span style="color:#88aaff;">Escudo en recarga — ${left}s</span>`;
            this._pulseScreen?.('error');
            return;
        }
        if ((this.energy ?? 0) < stats.activateCost) {
            this._pulseScreen?.('error');
            return;
        }

        this.energy = Math.max(0, this.energy - stats.activateCost);
        this.lastShieldTime = now;
        this.shieldActive = true;
        this.shieldHp = stats.shieldHp;
        this.shieldTimer = stats.duration;
        this.shieldMax = stats.shieldHp;
        this._syncShieldVisual();
        this.updateUI();

        this._animateShieldExpand();
        window.__game?.vfx?.shieldActivate?.(this.mesh.position);
        syncPlayerAbilityVisuals(this, window.__game?.vfx, 0);
    },

updateShieldLogic(delta) {
        if (!this.shieldActive && !isPlayerShieldUp(this)) {
            syncPlayerAbilityVisuals(this, window.__game?.vfx, delta);
            return;
        }

        this.shieldTimer = Math.max(0, (this.shieldTimer ?? 0) - delta);
        if (!isPlayerShieldUp(this)) {
            this.shieldActive = false;
            this.shieldHp = Math.max(0, this.shieldHp ?? 0);
            this.updateUI();
        }
        syncPlayerAbilityVisuals(this, window.__game?.vfx, delta);
    },

takeDamage(amount, opts = {}) {
        if (this.isInvulnerable || this.isDead) return;
        const mp = window.__game?.multiplayerClient;
        if (mp?.isOnline && !opts.fromNetwork) return;

        let shieldHit = false;
        let hullLost = 0;

        if (this.shieldActive && (this.shieldHp ?? 0) > 0) {
            shieldHit = true;
            this.shieldHp -= amount;
            if (this.shieldHp < 0) {
                hullLost = -this.shieldHp;
                this.hp = Math.max(0, this.hp - hullLost);
                this.shieldHp = 0;
                this.shieldActive = false;
                this._syncShieldVisual();
            }
        } else {
            hullLost = amount;
            this.hp = Math.max(0, this.hp - amount);
        }

        this._feedbackCombatHit({
            shieldHit,
            hullLost,
            amount,
            hitFrom: opts.hitFrom,
            attackKind: opts.attackKind,
            attackerName: opts.attackerName,
        });

        if (hullLost > 0 && (this._repairChannelUntil ?? 0) > (this.time || 0)) {
            this._cancelRepairChannel();
        }

        if (this.hp <= 0 && !this.isDead) {
            this.hp = 0;
            this.isDead = true;
            this.die(opts.fromNetwork ? { fromNetwork: true } : {});
        }
        this.updateUI();
    },

applyNetworkDamage(p) {
        if (this.isInvulnerable || this.isDead) return;

        const prevHp = this.hp;
        const prevShield = this.shieldHp ?? 0;

        const localShieldUp = this._isShieldUp();
        if (typeof p.shieldHp === 'number') {
            const nextHp = Math.max(0, p.shieldHp);
            if (localShieldUp) {
                if ((p.shieldHit || p.shieldActive) && nextHp < (this.shieldHp ?? 0) - 0.01) {
                    this.shieldHp = nextHp;
                }
            } else if (nextHp < (this.shieldHp ?? 0) - 0.01) {
                this.shieldHp = nextHp;
            }
        }
        if (p.shieldActive === true && !localShieldUp && typeof p.shieldTimer === 'number' && p.shieldTimer > 0) {
            this.shieldActive = true;
            this.shieldTimer = p.shieldTimer;
        }
        this._syncShieldVisual();
        if (typeof p.shieldMax === 'number') this.shieldMax = p.shieldMax;

        if (typeof p.hp === 'number') {
            this.hp = Math.max(0, p.hp);
        } else if (p.amount) {
            const amount = Math.max(0, p.amount);
            if (this.shieldActive && (this.shieldHp ?? 0) > 0) {
                const absorbed = Math.min(this.shieldHp, amount);
                this.shieldHp -= absorbed;
                const overflow = amount - absorbed;
                if (this.shieldHp <= 0) {
                    this.shieldHp = 0;
                    this.shieldActive = false;
                    this._syncShieldVisual();
                }
                if (overflow > 0) this.hp = Math.max(0, this.hp - overflow);
            } else {
                this.hp = Math.max(0, this.hp - amount);
            }
        }

        const hullLost = Math.max(0, prevHp - this.hp);
        const shieldDrop = Math.max(0, prevShield - (this.shieldHp ?? 0));
        const shieldHit = p.shieldHit === true
            || (shieldDrop > 0.01 && hullLost <= 0.01);
        const amount = p.amount ?? Math.max(hullLost, shieldDrop, 12);

        if (hullLost > 0.01 || shieldDrop > 0.01 || p.shieldHit) {
            this._feedbackCombatHit({
                shieldHit,
                hullLost,
                amount,
                hitFrom: p.hitFrom,
                attackKind: p.attackKind,
                attackerName: p.attackerName,
            });
        }

        this.updateUI();
        if (this.hp <= 0 && !this.isDead) {
            this.hp = 0;
            this.isDead = true;
            this.die({ fromNetwork: true });
        }
    },

_getRespawnPoint() {
        const sp = this.mpSpawn || window.__game?._mpSpawn;
        if (sp) return new THREE.Vector3(sp.x, sp.y ?? 50, sp.z);
        const hub = getHubSpawnPoint(50);
        return new THREE.Vector3(hub.x, hub.y, hub.z);
    },

die(opts = {}) {
        if (this._deathSequenceActive) return;
        this._deathSequenceActive = true;
        this._disposeLevelUpFx?.();

        const mp = window.__game?.multiplayerClient;
        const deathPos = this.position.clone();
        const deathSeq = (this._deathSeq = (this._deathSeq || 0) + 1);

        if (this._deathFxTimers) {
            for (const t of this._deathFxTimers) clearTimeout(t);
        }
        this._deathFxTimers = [];

        const logText = document.getElementById('log-text');
        if (logText) {
            logText.innerHTML = "<span style='color:#ff4455; font-weight:bold; letter-spacing:1px;'>⚠ FALLO CRITICO — NAVE DESTRUIDA — REAPARECIENDO...</span>";
        }

        if (this.enemyManager) {
            window.__game?.vfx?.combatImpact(deathPos, 'kill', { scale: 2.8 });
            this.enemyManager.createExplosion(deathPos, 2.8);
            this._deathFxTimers.push(setTimeout(() => {
                if (this._deathSeq !== deathSeq) return;
                this.enemyManager?.createExplosion(
                    deathPos.clone().add(new THREE.Vector3(12, 4, 8)),
                    1.6,
                );
            }, 180));
        }

        this.mesh.visible = false;
        this.shieldActive = false;
        resetPlayerAbilityState(this, window.__game?.vfx);
        this.velocity.set(0, 0, 0);
        this.setTarget(null);

        const ui = document.getElementById('ui');
        if (ui) {
            ui.style.transition = 'box-shadow 0.1s';
            ui.style.boxShadow = 'inset 0 0 300px rgba(255,0,0,1)';
        }

        this._deathFxTimers.push(setTimeout(() => {
            if (this._deathSeq !== deathSeq) return;

            window.__game?.vfx?.clearTransientCombat?.();
            this.enemyManager?.purgeExplosions?.();

            this.hp = this.maxHp;
            this.energy = this.maxEnergy;

            const respawnPt = this._getRespawnPoint();
            this.position.copy(respawnPt);
            this.camera.position.copy(respawnPt).add(new THREE.Vector3(0, 150, 400));
            this.camera.lookAt(respawnPt);

            if (ui) {
                ui.style.transition = 'box-shadow 2.0s';
                ui.style.boxShadow = 'none';
                setTimeout(() => { ui.style.transition = 'none'; }, 2000);
            }

            this.mesh.visible = true;
            this.mesh.position.set(respawnPt.x, 2000, respawnPt.z);

            const drop = setInterval(() => {
                if (this._deathSeq !== deathSeq) {
                    clearInterval(drop);
                    return;
                }
                this.mesh.position.y -= 100;
                if (this.mesh.position.y <= this.position.y) {
                    this.mesh.position.y = this.position.y;
                    this.isDead = false;
                    this._deathSequenceActive = false;
                    this.updateUI();
                    if (logText) logText.textContent = '';
                    if (mp?.isOnline && window.__game?.combatSync) {
                        window.__game.combatSync.emit('player_respawn', {
                            playerId: mp.playerId,
                            x: this.position.x,
                            y: this.position.y,
                            z: this.position.z,
                            hp: this.hp,
                            maxHp: this.maxHp,
                        });
                    }
                    clearInterval(drop);
                }
            }, 16);
        }, 2800));
    },
};
