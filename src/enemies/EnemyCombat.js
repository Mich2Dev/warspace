import * as THREE from 'three';
import { CONFIG } from '../../config.js';
import { engageEnemy, getRoleConfig } from '../enemyRoles.js';
import { projectWorldToScreen } from '../worldHud.js';
import { cloneMeshMaterials } from '../enemyVisuals.js';
import { segmentHitsSphere, segmentHitsPlayer, playerInFlatRadius, impactPointOnSphere } from '../projectileHit.js';
import { ZONE_META } from './zoneMeta.js';

export const enemyCombatMethods = {
enemyShoot(enemy, direction) {
        if (this.enemyLasers.length >= (this._maxEnemyLasers ?? 28)) return;

        const laserMeta = ZONE_META[enemy.userData.type]?.laser || {
            color: 0xff0000, thickness: 2.0, spawnOffset: 10, lateralOffset: 5,
        };
        const dir = direction.clone().normalize();
        const damage = (CONFIG.COMBAT[enemy.userData.type.toUpperCase() + '_DAMAGE'] || 10)
            * (enemy.userData._currentDamageMult ?? enemy.userData.damageMult ?? 1);
        const squadShot = !!enemy.userData?.isSquadMember;

        this._markCombatAggressor(enemy, 'laser');
        if (!squadShot) {
            if ((this.combatLoadLevel ?? 'light') === 'light') {
                window.__game?.vfx?.muzzleFlash(enemy.position, dir, laserMeta.color ?? 0xff4444);
            }
        }

        this._spawnHostileBolt(enemy.position, dir, {
            color: laserMeta.color,
            thickness: laserMeta.thickness,
            spawnOffset: laserMeta.spawnOffset,
            lateral: squadShot ? 0 : laserMeta.lateralOffset,
            damage,
            speed: squadShot ? 780 : 860,
            enemy,
        });
        if (!squadShot) {
            this._spawnHostileBolt(enemy.position, dir, {
                color: laserMeta.color,
                thickness: laserMeta.thickness,
                spawnOffset: laserMeta.spawnOffset,
                lateral: -laserMeta.lateralOffset,
                damage,
                speed: 860,
                enemy,
            });
        }

        if (this._combatSync && this._mpMode === 'host') {
            this._combatSync.emit('enemy_laser', {
                x: enemy.position.x,
                y: enemy.position.y,
                z: enemy.position.z,
                dx: dir.x,
                dy: dir.y,
                dz: dir.z,
                color: laserMeta.color ?? 0xff4444,
                speed: squadShot ? 780 : 860,
                thickness: laserMeta.thickness,
                spawnOffset: laserMeta.spawnOffset,
                lateralOffset: squadShot ? 0 : laserMeta.lateralOffset,
                aggressorName: enemy.userData?.name,
            });
        }
    },

enemyFireMissile(enemy, targetPos) {
        const active = this._enemyMissiles.filter((m) => !m.visualOnly).length;
        if (active >= (this._maxEnemyMissiles ?? 2)) return;

        const ud = enemy.userData;
        const typeKey = (ud.type || 'Zona1').toUpperCase();

        let mesh;
        if (this._missilePool?.length) {
            mesh = this._missilePool.pop();
            mesh.visible = true;
        } else {
            mesh = new THREE.Mesh(this._missileBodyGeo, this._missileBodyMat);
            this.scene.add(mesh);
        }
        mesh.rotation.x = Math.PI / 2;
        mesh.position.copy(enemy.position);
        mesh.position.y += 4;

        const dir = this._missileVelDir.subVectors(targetPos, enemy.position);
        if (dir.lengthSq() < 1) dir.set(0, 0, -1);
        else dir.normalize();
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);

        this._markCombatAggressor(enemy, 'missile');

        const ownerLabel = ud.patrolDesign === 'droid'
            ? 'Droid'
            : (ud.roleLabel || ud.name || 'Hostil');

        this._enemyMissiles.push({
            mesh,
            velocity: dir.clone().multiplyScalar(280),
            damage: Math.round((CONFIG.COMBAT[`${typeKey}_DAMAGE`] || 12) * (ud.damageMult ?? 1) * 2.0),
            owner: enemy,
            ownerName: ownerLabel,
            ttl: 0,
        });
        if (this._combatSync && this._mpMode === 'host') {
            this._combatSync.emit('enemy_missile', {
                x: mesh.position.x, y: mesh.position.y, z: mesh.position.z,
                dx: dir.x, dy: dir.y, dz: dir.z,
                color: 0xff5533,
                aggressorName: ownerLabel,
                speed: 280,
            });
        }
    },

_updateEnemyMissiles(delta, environment) {
        const playerPos = this.player.position;
        const steer = this._missileSteer;
        const velDir = this._missileVelDir;
        let nearestThreat = null;
        let nearestDistSq = Infinity;
        const heavyCombat = this.combatLoadLevel === 'heavy';
        this._missileTick = (this._missileTick ?? 0) + 1;
        const steerEvery = heavyCombat ? 2 : 1;

        for (let i = this._enemyMissiles.length - 1; i >= 0; i--) {
            const m = this._enemyMissiles[i];
            m.ttl += delta;

            const prevPos = m._prevPos || m.mesh.position.clone();
            if (!m._prevPos) m._prevPos = prevPos;
            else prevPos.copy(m.mesh.position);

            m.mesh.position.addScaledVector(m.velocity, delta);

            if (!m.visualOnly) {
                const dSq = m.mesh.position.distanceToSquared(playerPos);
                if (dSq < nearestDistSq) {
                    nearestDistSq = dSq;
                    nearestThreat = m;
                }

                const segHit = segmentHitsSphere(prevPos, m.mesh.position, playerPos, 48);
                if (segHit) {
                    m.mesh.position.copy(impactPointOnSphere(segHit, playerPos, 48));
                    const mp = window.__game?.multiplayerClient;
                    const hitOpts = {
                        hitFrom: m.mesh.position,
                        attackKind: 'missile',
                        attackerName: m.ownerName,
                    };
                    if (mp?.isOnline) {
                        this._combatSync?.emit('player_damage', {
                            playerId: mp.playerId,
                            amount: m.damage,
                            hitFrom: hitOpts.hitFrom,
                            attackKind: 'missile',
                            attackerName: m.ownerName,
                        });
                    } else {
                        this.player.takeDamage(m.damage, hitOpts);
                    }
                    if (m.owner) this._markCombatAggressor(m.owner, 'missile', 1.2);
                    this._disposeMissileVisual(m);
                    this._enemyMissiles.splice(i, 1);
                    continue;
                }
            }

            if (this._missileTick % steerEvery === 0 && !m.visualOnly) {
                steer.subVectors(playerPos, m.mesh.position);
                if (steer.lengthSq() > 400) {
                    steer.normalize().multiplyScalar(320);
                    m.velocity.lerp(steer, 2.0 * delta);
                }
                if (m.velocity.lengthSq() > 0.01) {
                    velDir.copy(m.velocity).normalize();
                    m.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), velDir);
                }
            }

            if (m.ttl > 8 || m.mesh.position.distanceToSquared(playerPos) > 4500 * 4500) {
                this._disposeMissileVisual(m);
                this._enemyMissiles.splice(i, 1);
            }
        }

        if (nearestThreat) {
            this._missileThreat = {
                ownerName: nearestThreat.ownerName,
                dist: Math.round(Math.sqrt(nearestDistSq)),
            };
        } else {
            this._missileThreat = null;
        }
    },

spawnVisualMissileFromNetwork(p) {
        const dir = this._missileVelDir.set(p.dx ?? 0, p.dy ?? 0, p.dz ?? 1);
        if (dir.lengthSq() < 0.01) dir.set(0, 0, -1);
        else dir.normalize();

        const mesh = new THREE.Mesh(this._missileBodyGeo, this._missileBodyMat);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(p.x ?? 0, p.y ?? 0, p.z ?? 0);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
        this.scene.add(mesh);

        this._enemyMissiles.push({
            mesh,
            velocity: dir.clone().multiplyScalar(p.speed ?? 280),
            damage: 0,
            ownerName: p.aggressorName || 'Hostil',
            ttl: 0,
            visualOnly: true,
        });
    },

takeDamage(enemy, amount, opts = {}) {
        const quietVfx = opts.quietVfx === true;
        if (enemy.userData?.isRemotePlayer) {
            const entry = window.__game?.remotePlayers?._resolveRemoteEntry?.(enemy.userData.playerId)
                ?? window.__game?.remotePlayers?.remote.get(String(enemy.userData.playerId));
            if (entry && this.player?._damageRemotePlayer) {
                this.player._damageRemotePlayer(entry, amount);
            }
            return;
        }

        if (enemy.userData.syncGhost && this._mpMode === 'guest') {
            enemy.userData.hp = Math.max(0, (enemy.userData.hp ?? 0) - amount);
            if (enemy.userData._syncTarget) {
                enemy.userData._syncTarget.hp = enemy.userData.hp;
            }
            if (this.player?.target === enemy) this.player.updateTargetUI();
            this._combatSync?.emit('enemy_damage', { id: enemy.userData.syncId, amount });
            this._vfx?.combatImpact(enemy.position, amount >= 40 ? 'crit' : 'hull', {
                severity: Math.min(1, amount / 50),
                amount,
            });
            this.createExplosion(enemy.position, 0.15);
            this._flashEnemyHit(enemy);
            return;
        }

        const nowSec = Date.now() * 0.001;
        engageEnemy(enemy, nowSec);

        if (enemy.userData?.isSquadMember && enemy.userData.squadId != null && this.patrolSquads?.breakCombatFormation) {
            this.patrolSquads.breakCombatFormation(enemy.userData.squadId, nowSec);
        }

        if (enemy.userData.enemyShieldActive && (enemy.userData.enemyShieldHp ?? 0) > 0) {
            enemy.userData.enemyShieldHp -= amount;
            this._flashEnemyShield(enemy);
            if (enemy.userData.enemyShieldHp > 0) {
                this._vfx?.combatImpact(enemy.position, 'shield', {
                    severity: Math.min(1, amount / 60),
                    amount,
                });
                return;
            }
            amount = Math.max(0, -enemy.userData.enemyShieldHp);
            enemy.userData.enemyShieldHp = 0;
            enemy.userData.enemyShieldActive = false;
            if (enemy.userData.enemyShieldMesh) enemy.userData.enemyShieldMesh.visible = false;
            this._vfx?.combatImpact(enemy.position, 'shieldBreak', { amount, hullLost: amount });
            this.createExplosion(enemy.position, 1.2);
        }

        enemy.userData.hp -= amount;
        this.invalidateWorldSyncCache?.();
        
        const caps = this._combatCaps;
        if (!caps?.skipFloatingText || amount >= 50) {
            this.createFloatingText(enemy.position, amount, amount >= 50);
        }

        if (amount >= 8 && !quietVfx) {
            this._vfx?.combatImpact(enemy.position, amount >= 50 ? 'crit' : 'hull', {
                severity: Math.min(1, amount / 80),
                amount,
            });
        }

        if (enemy.userData.hp > 0 && !quietVfx) {
            const skipTinyBlast = caps?.skipSmallExplosions && amount < 50;
            if (!skipTinyBlast) {
                this.createExplosion(enemy.position, amount >= 50 ? 1.5 : 0.2);
            }
            this._flashEnemyHit(enemy);
        }

        if (enemy.userData.hp <= 0) {
            const hasRewards = !enemy.userData.noRewards;
            // Reward XP + Credits to player
            const type = enemy.userData.type ? enemy.userData.type.toUpperCase() : 'DESCONOCIDO';
            const xpDrop = CONFIG.COMBAT[`${type}_XP_DROP`] || 10;
            const crDrop = CONFIG.COMBAT[`${type}_CR_DROP`] || 20;
            if (hasRewards && this.player && typeof this.player.gainXP === 'function') {
                this.player.gainXP(xpDrop);
            }
            if (hasRewards && this.player && typeof this.player.gainCredits === 'function') {
                this.player.gainCredits(crDrop, enemy.position);
            }

            // Notificar al sistema de misiones (usar el nombre para mayor claridad)
            if (this.onEnemyKilled) {
                this.onEnemyKilled(
                    enemy.userData.type || 'Desconocido',
                    enemy.userData.name || '',
                    {
                        crDrop,
                        xpDrop,
                        enemyTier: CONFIG.COMBAT[`${type}_LEVEL`] || 1,
                        isPatrol: !!enemy.userData.isPatrol,
                        patrolRole: enemy.userData.patrolRole || null,
                    }
                );
            }

            if (enemy.userData.syncId && this._combatSync && this._mpMode === 'host') {
                this._combatSync.emit('enemy_dead', { id: enemy.userData.syncId });
            }

            this._detachEnemyNameTag(enemy);
            this._clearPlayerTargetFor(enemy);

            let explosionScale = 1.0;
            if (enemy.userData.type.includes('Spawner')) explosionScale = 8.0;
            this.createExplosion(enemy.position, explosionScale);

            this.scene.remove(enemy);
            this.enemies = this.enemies.filter(e => e !== enemy);
            this.invalidateWorldSyncCache?.();
            
            if (enemy.userData.minimapDot && enemy.userData.minimapDot.parentNode) {
                enemy.userData.minimapDot.parentNode.removeChild(enemy.userData.minimapDot);
            }

            if (enemy.userData.syncId) {
                this._syncGhosts.delete(enemy.userData.syncId);
            }

            if (enemy.userData.isSquadMember && this.patrolSquads) {
                this.patrolSquads.onMemberKilled(enemy);
            } else if (enemy.userData.isPatrol && enemy.userData.patrolRegionId && this._mpMode !== 'guest') {
                // Sin respawn de patrullas sueltas — solo trenes V (PatrolSquadManager).
            }
        }
    },

takeDamageArea(center, radius, damage, opts = {}) {
        // Encontrar todos los enemigos dentro del radio
        const enemiesInArea = this.enemies.filter(e => e.position.distanceTo(center) <= radius);
        
        // Iterar sobre la lista copiada para aplicar el daño de área
        enemiesInArea.forEach(enemy => {
            if (enemy && enemy.userData.hp > 0) {
                this.takeDamage(enemy, damage, opts);
            }
        });
        
        return enemiesInArea.length;
    },

updateEnemyLasers(delta, environment) {
        // Procesar partÃ­culas de motores de enemigos en el mundo global
        for (let i = this.trailParticles.length - 1; i >= 0; i--) {
            const p = this.trailParticles[i];
            // Decaimiento balanceado
            p.userData.life -= delta * 4.0;
            if (p.userData.life <= 0) {
                p.visible = false;
                this.trailParticles.splice(i, 1);
                this.particlePool.push(p);
            }
        }
        for (let i = this.enemyLasers.length - 1; i >= 0; i--) {
            const laser = this.enemyLasers[i];
            laser.userData.life -= delta;
            
            if (laser.userData.life <= 0) {
                this.scene.remove(laser);
                this.enemyLasers.splice(i, 1);
                continue;
            }

            const prevPos = laser.userData._prevPos || laser.position.clone();
            if (!laser.userData._prevPos) laser.userData._prevPos = prevPos;
            else prevPos.copy(laser.position);

            laser.position.addScaledVector(laser.userData.velocity, delta);

            if (laser.userData.velocity?.lengthSq?.() > 0.01) {
                this._laserQuatDir.copy(laser.userData.velocity).normalize();
                laser.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this._laserQuatDir);
            }

            laser.userData.trailTimer = (laser.userData.trailTimer ?? 0) - delta;
            const ownerSquad = laser.userData.owner?.userData?.isSquadMember;
            if (!ownerSquad && laser.userData.trailTimer <= 0) {
                laser.userData.trailTimer = this.enemyLasers.length > 12 ? 0.12 : 0.07;
                if (this.trailParticles.length < (this._maxTrailParticles ?? 28)) {
                    this._spawnBoltTrail(laser.position, laser.userData.color ?? 0xff4444);
                }
            }

            if (environment) {
                const terrainHeight = environment.getHeightAt(laser.position.x, laser.position.z);
                if (!laser.userData.visualOnly && laser.position.y <= terrainHeight) {
                    this.scene.remove(laser);
                    this.enemyLasers.splice(i, 1);
                    continue;
                }
            }

            if (laser.userData.visualOnly) continue;

            const hitRadius = 72;
            const dmg = laser.userData.damage || 0;
            const playerPos = this.player.position;
            const segHit = segmentHitsPlayer(prevPos, laser.position, playerPos, { radius: hitRadius, ySlack: 95 });

            if (segHit) {
                laser.position.copy(segHit.point);
                const mp = window.__game?.multiplayerClient;
                if (mp?.isOnline && this._mpMode === 'host') {
                    this._combatSync?.emit('player_damage', {
                        playerId: mp.playerId,
                        amount: dmg,
                        hitFrom: { x: laser.position.x, y: laser.position.y, z: laser.position.z },
                        attackKind: 'laser',
                        attackerName: laser.userData.ownerName,
                    });
                } else if (!mp?.isOnline) {
                    this.player.takeDamage(dmg, {
                        hitFrom: laser.position,
                        attackKind: 'laser',
                        attackerName: laser.userData.ownerName,
                    });
                }
                if (laser.userData.owner) {
                    this._markCombatAggressor(laser.userData.owner, 'laser', 1.2);
                }
                if (this.combatLoadLevel !== 'heavy') {
                    this._vfx?.hitSparks?.(laser.position, {
                        color: laser.userData.color ?? 0xff4444,
                        count: 4,
                        spread: 10,
                        size: 2.5,
                        duration: 0.18,
                    });
                }
                this.scene.remove(laser);
                this.enemyLasers.splice(i, 1);
                continue;
            }

            if (this._mpMode === 'host') {
                let hitRemote = false;
                for (const t of this._remoteCombatTargets) {
                    const remoteHit = segmentHitsSphere(prevPos, laser.position, t.pos, hitRadius);
                    if (!remoteHit) continue;
                    laser.position.copy(impactPointOnSphere(remoteHit, t.pos, hitRadius));
                    this._combatSync?.emit('player_damage', {
                        playerId: t.id,
                        amount: dmg,
                    });
                    this.createExplosion(laser.position, 0.5);
                    this.scene.remove(laser);
                    this.enemyLasers.splice(i, 1);
                    hitRemote = true;
                    break;
                }
                if (hitRemote) continue;
            }
        }
    },

createExplosion(position, scale = 1.0) {
        const maxLive = this._maxLiveExplosions ?? 14;
        while (this.explosions.length >= maxLive) {
            const old = this.explosions.shift();
            this.scene.remove(old.mesh);
            old.mesh.geometry.dispose();
            old.mesh.material.dispose();
        }

        const loadMul = this.combatLoadLevel === 'heavy' ? 0.45 : this.combatLoadLevel === 'medium' ? 0.7 : 1;
        const cappedScale = Math.min(scale, 4.5);
        const particleCount = Math.floor(Math.min(50 * cappedScale, 120) * loadMul);
        if (particleCount < 6) return;
        const particles = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = [];

        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = position.x;
            positions[i * 3 + 1] = position.y;
            positions[i * 3 + 2] = position.z;

            const v = new THREE.Vector3(
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2
            ).normalize().multiplyScalar((Math.random() * 250 + 50) * cappedScale);
            velocities.push(v);
        }

        particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        if (!this.explosionMats) this.explosionMats = {};
        if (!this.explosionMats[cappedScale]) {
            this.explosionMats[cappedScale] = new THREE.PointsMaterial({
                color: 0xffffff,
                size: 15 * cappedScale,
                map: this.getParticleTexture(),
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
        }
        const mat = this.explosionMats[cappedScale].clone();
        mat.opacity = 1;

        const pointCloud = new THREE.Points(particles, mat);
        this.scene.add(pointCloud);
        this.explosions.push({ mesh: pointCloud, velocities, life: 1.0 });

        if (cappedScale >= 1.0 && this.combatLoadLevel !== 'heavy') {
            this._vfx?.boostExplosion(position, cappedScale);
        }
    },

    purgeExplosions() {
        if (!this.explosions?.length) return;
        for (const exp of this.explosions) {
            this.scene.remove(exp.mesh);
            exp.mesh.geometry.dispose();
            exp.mesh.material.dispose();
        }
        this.explosions.length = 0;
    },

updateExplosions(delta) {
        for (let i = this.explosions.length - 1; i >= 0; i--) {
            const exp = this.explosions[i];
            exp.life -= delta * 1.5;

            if (exp.life <= 0) {
                this.scene.remove(exp.mesh);
                exp.mesh.geometry.dispose();
                exp.mesh.material.dispose();
                this.explosions.splice(i, 1);
                continue;
            }

            const positions = exp.mesh.geometry.attributes.position.array;
            for (let j = 0; j < exp.velocities.length; j++) {
                positions[j * 3] += exp.velocities[j].x * delta;
                positions[j * 3 + 1] += exp.velocities[j].y * delta;
                positions[j * 3 + 2] += exp.velocities[j].z * delta;
                
                // FricciÃ³n atmosfÃ©rica severa: las partÃ­culas frenan en seco luego del estallido inicial
                exp.velocities[j].multiplyScalar(Math.max(0, 1.0 - (5.0 * delta)));
                
                // Gravedad ligera para que las chispas caigan un poco al final
                exp.velocities[j].y -= 15 * delta;
            }
            exp.mesh.geometry.attributes.position.needsUpdate = true;
            exp.mesh.material.opacity = exp.life;
        }
    },

createFloatingText(position, damage, isCrit) {
        if (!this.player || !this.player.camera) return;
        if ((this._floatTextActive ?? 0) >= 6) return;
        this._floatTextActive = (this._floatTextActive ?? 0) + 1;
        setTimeout(() => { this._floatTextActive = Math.max(0, (this._floatTextActive ?? 1) - 1); }, 900);

        const vector = position.clone();
        vector.x += (Math.random() - 0.5) * 15;
        vector.y += Math.random() * 10 + 5;
        vector.z += (Math.random() - 0.5) * 15;
        
        vector.project(this.player.camera);

        if (vector.z > 1) return;

        const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
        const y = -(vector.y * 0.5 - 0.5) * window.innerHeight;

        const div = document.createElement('div');
        div.innerText = `-${damage}`;
        div.style.position = 'absolute';
        div.style.left = `${x}px`;
        div.style.top = `${y}px`;
        div.style.color = isCrit ? '#ffaa00' : '#ffffff';
        div.style.fontSize = isCrit ? '26px' : '16px';
        div.style.fontWeight = 'bold';
        div.style.pointerEvents = 'none';
        div.style.textShadow = '1px 1px 3px black, 0 0 5px ' + (isCrit ? '#ff0000' : '#00ffff');
        div.style.transition = 'top 1s ease-out, opacity 1s ease-in';
        div.style.zIndex = '1000';
        // Center the text
        div.style.transform = 'translate(-50%, -50%)';
        document.body.appendChild(div);

        // Trigger reflow
        div.getBoundingClientRect();
        
        // AnimaciÃ³n CSS
        div.style.top = `${y - 100}px`;
        div.style.opacity = '0';

        setTimeout(() => {
            if (div.parentNode) div.parentNode.removeChild(div);
        }, 1000);
    },

triggerBossShockwave(enemy, radius = 240, baseDamage = 24) {
        if (!enemy) return;
        const origin = enemy.position.clone();
        const typeKey = (enemy.userData?.type || 'Zona1').toUpperCase();
        const attackDist = (CONFIG.COMBAT[`${typeKey}_ATTACK_DIST`] || 320) * (enemy.userData?.attackDistMult ?? 1);
        const shockRadius = Math.max(radius, attackDist * 1.15, enemy.userData?.isMiniBoss ? 480 : 360);
        this.createExplosion(origin, 2.4);

        const mp = window.__game?.multiplayerClient;
        const isMpHost = mp?.isOnline && this._mpMode === 'host';

        const applyShockTo = (playerId, pos) => {
            if (!playerInFlatRadius(pos, origin, shockRadius)) return;
            const flatD = Math.hypot(pos.x - origin.x, pos.z - origin.z);
            const factor = 1 - flatD / shockRadius;
            const dmg = Math.max(8, Math.round(baseDamage * (0.45 + factor * 0.75)));
            if (isMpHost) {
                this._combatSync?.emit('player_damage', { playerId, amount: dmg });
            } else if (!mp?.isOnline) {
                this.player.takeDamage(dmg, {
                    hitFrom: origin,
                    attackKind: 'shockwave',
                    attackerName: enemy.userData?.name,
                });
            }
        };

        if (this.player) {
            if (isMpHost) {
                applyShockTo(mp.playerId, this.player.position);
                for (const t of this._remoteCombatTargets) {
                    applyShockTo(t.id, t.pos);
                }
            } else if (!mp?.isOnline) {
                if (playerInFlatRadius(this.player.position, origin, shockRadius)) {
                    const flatD = Math.hypot(
                        this.player.position.x - origin.x,
                        this.player.position.z - origin.z,
                    );
                    const factor = 1 - flatD / shockRadius;
                    const dmg = Math.max(8, Math.round(baseDamage * (0.45 + factor * 0.75)));
                    this.player.takeDamage(dmg, {
                        hitFrom: origin,
                        attackKind: 'shockwave',
                        attackerName: enemy.userData?.name,
                    });
                }
            }
        }

        if (this.player?.position) {
            const toPlayer = new THREE.Vector3().subVectors(this.player.position, origin);
            toPlayer.y = 0;
            if (toPlayer.lengthSq() > 0.01) {
                toPlayer.normalize();
                for (let i = 0; i < 3; i++) {
                    const spread = (i - 1) * 0.12;
                    const dir = new THREE.Vector3(
                        toPlayer.x * Math.cos(spread) - toPlayer.z * Math.sin(spread),
                        0,
                        toPlayer.x * Math.sin(spread) + toPlayer.z * Math.cos(spread),
                    ).normalize();
                    this.enemyShoot(enemy, dir);
                }
            }
        }
        enemy.userData.lastShot = Date.now() * 0.001;
    },

_spawnHostileBolt(origin, direction, opts = {}) {
        if (this.enemyLasers.length >= (this._maxEnemyLasers ?? 28)) return null;
        const dir = direction.clone().normalize();
        const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
        const pos = origin.clone()
            .addScaledVector(dir, opts.spawnOffset ?? 12)
            .addScaledVector(perp, opts.lateral ?? 0);
        pos.y += opts.yOffset ?? 2;

        const thickness = opts.thickness ?? 2.2;
        const color = opts.color ?? 0xff4444;
        const boltLen = 34;
        const group = new THREE.Group();

        const coreGeo = new THREE.CylinderGeometry(thickness * 0.22, thickness * 0.22, boltLen, 6);
        coreGeo.translate(0, boltLen * 0.5, 0);
        const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));

        const glowGeo = new THREE.CylinderGeometry(thickness * 0.65, thickness * 0.4, boltLen * 1.1, 6);
        glowGeo.translate(0, boltLen * 0.52, 0);
        const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.72,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }));

        group.add(core, glow);
        group.position.copy(pos);
        group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

        const speed = opts.speed ?? 860;
        group.userData = {
            velocity: dir.clone().multiplyScalar(speed),
            life: opts.life ?? 4.2,
            damage: opts.damage ?? 10,
            owner: opts.enemy || null,
            ownerName: opts.enemy?.userData?.name || 'Hostil',
            color,
            trailTimer: 0,
            visualOnly: !!opts.visualOnly,
        };

        this.scene.add(group);
        this.enemyLasers.push(group);
        return group;
    },

_spawnBoltTrail(position, color) {
        if (!this.particleGeo) return;
        if (this.trailParticles.length >= (this._maxTrailParticles ?? 40)) return;
        let p;
        if (this.particlePool.length > 0) {
            p = this.particlePool.pop();
            p.visible = true;
        } else {
            const mat = this.getParticleMaterial(color);
            p = new THREE.Mesh(this.particleGeo, mat);
            this.scene.add(p);
        }
        p.position.copy(position);
        p.material = this.getParticleMaterial(color);
        p.userData.life = 0.28;
        p.userData.baseThickness = 1.4;
        p.scale.setScalar(1.8);
        this.trailParticles.push(p);
    },

activateEnemyShield(enemy) {
        const ud = enemy?.userData;
        if (!ud || ud.enemyShieldUsed || !ud.enemyShieldMax) return;
        ud.enemyShieldUsed = true;
        ud.enemyShieldActive = true;
        ud.enemyShieldHp = ud.enemyShieldMax;
        if (!ud.enemyShieldMesh) {
            const r = (enemy.userData._formationScale ?? CONFIG.VISUALS[`${(ud.type || 'Zona1').toUpperCase()}_BOX_SIZE`] ?? 56) * 0.75;
            const geo = new THREE.SphereGeometry(r, 10, 8);
            const mat = new THREE.MeshBasicMaterial({
                color: ud.dangerColor || 0xaa44ff,
                transparent: true,
                opacity: 0.28,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });
            ud.enemyShieldMesh = new THREE.Mesh(geo, mat);
            ud.enemyShieldMesh.frustumCulled = false;
            enemy.add(ud.enemyShieldMesh);
        }
        ud.enemyShieldMesh.visible = true;
        ud.enemyShieldMesh.scale.setScalar(0.2);
        this.logCombatAbility(enemy, 'Escudo energÃ©tico activado');
    },

_flashEnemyShield(enemy) {
        const mesh = enemy?.userData?.enemyShieldMesh;
        if (!mesh?.material) return;
        mesh.material.opacity = 0.85;
        mesh.scale.setScalar(1.12);
        setTimeout(() => {
            if (mesh.material) mesh.material.opacity = 0.28;
            mesh.scale.setScalar(1);
        }, 120);
    },

/** Enemigo cerca de un punto — evita O(n) en cada láser del jugador. */
findEnemyNearPoint(point, radius) {
        const rSq = radius * radius;
        for (const enemy of this.enemies) {
            if ((enemy.userData?.hp ?? 0) <= 0 || enemy.spawnType !== undefined) continue;
            if (enemy.position.distanceToSquared(point) < rSq) return enemy;
        }
        return null;
    },

    /** Colisión por segmento — proyectiles rápidos no atraviesan enemigos. */
    findEnemyOnSegment(prev, next, radius) {
        let best = null;
        let bestDist = radius * radius;
        for (const enemy of this.enemies) {
            if ((enemy.userData?.hp ?? 0) <= 0 || enemy.spawnType !== undefined) continue;
            const segHit = segmentHitsSphere(prev, next, enemy.position, radius);
            if (!segHit || segHit.distSq >= bestDist) continue;
            bestDist = segHit.distSq;
            best = { enemy, segHit };
        }
        return best;
    },

    _ensureEnemyUniqueMaterials(enemy) {
        if (!enemy?.userData || enemy.userData._uniqueMaterials) return;
        const root = enemy.visualGroup?.children?.[0];
        if (root) cloneMeshMaterials(root);
        enemy.userData._uniqueMaterials = true;
    },

    _flashEnemyHit(enemy) {
        if (!enemy?.userData || enemy.userData.isBlinking) return;
        this._ensureEnemyUniqueMaterials(enemy);
        enemy.userData.isBlinking = true;
        const prevEmissive = [];
        enemy.visualGroup?.traverse((c) => {
            if (!c.isMesh?.material?.emissive) return;
            const mats = Array.isArray(c.material) ? c.material : [c.material];
            mats.forEach((mat) => {
                if (!mat?.emissive) return;
                prevEmissive.push({ mat, color: mat.emissive.getHex() });
                mat.emissive.setHex(0xff5555);
            });
        });
        setTimeout(() => {
            prevEmissive.forEach(({ mat, color }) => {
                if (mat?.emissive) mat.emissive.setHex(color);
            });
            if (enemy.userData) enemy.userData.isBlinking = false;
        }, 100);
    },

alertNearbyAllies(source, radius, time, duration = 14) {
        let count = 0;
        const srcRegion = source.userData?.patrolRegionId || source.userData?.regionId;
        const srcSquad = source.userData?.squadId;
        for (const ally of this.enemies) {
            if (ally === source || ally.userData.hp <= 0) continue;
            if (ally.spawnType !== undefined) continue;
            if (ally.position.distanceTo(source.position) > radius) continue;

            if (srcSquad) {
                if (ally.userData?.squadId !== srcSquad) continue;
            } else if (srcRegion) {
                const allyRegion = ally.userData?.patrolRegionId || ally.userData?.regionId;
                if (allyRegion !== srcRegion) continue;
            } else {
                continue;
            }

            ally.userData.forcedAggroUntil = time + duration;
            count++;
        }
        if (count > 0) {
            const log = document.getElementById('log-text');
            if (log) {
                log.innerHTML = `<span style="color:#ffaa55;font-weight:bold;">ðŸ“¡ Alerta fronteriza â€” ${count} unidad${count > 1 ? 'es' : ''} en camino</span>`;
            }
        }
    },

logCombatAbility(enemy, message, opts = {}) {
        const now = Date.now() * 0.001;
        if (!opts.force && now < (this._combatLogUntil ?? 0)) return;
        this._combatLogUntil = now + (opts.force ? 2.5 : 3.5);
        const log = document.getElementById('log-text');
        const name = enemy?.userData?.name || 'Hostil';
        if (log) {
            log.innerHTML = `<span style="color:#ff9966;font-weight:bold;">⚠ ${name}: ${message}</span>`;
        }
    },

_markCombatAggressor(enemy, kind = 'laser', duration = 2.8) {
        if (!enemy?.userData) return;
        const t = Date.now() * 0.001;
        enemy.userData.aggressorUntil = t + duration;
        enemy.userData.aggressorKind = kind;
        const ring = enemy.userData.selectionRing;
        if (ring) {
            ring.visible = true;
            ring.material.color.setHex(kind === 'missile' ? 0xff5500 : 0xff2244);
            ring.material.opacity = 0.85;
        }
        if (!this._aggressorSet) this._aggressorSet = new Set();
        this._aggressorSet.add(enemy);
    },

_updateAggressorHighlights(time) {
        const set = this._aggressorSet;
        if (!set?.size) return;
        for (const enemy of set) {
            const until = enemy.userData?.aggressorUntil || 0;
            const ring = enemy.userData?.selectionRing;
            if (!ring || !enemy.parent) {
                set.delete(enemy);
                continue;
            }
            if (until > time) {
                ring.visible = true;
            } else if (!this._isPlayerTarget?.(enemy)) {
                ring.visible = false;
                ring.scale.set(1, 1, 1);
                set.delete(enemy);
            }
        }
    },

_updateDisruptorJam(time) {
        if (!this.player) return;
        let jam = 0;
        let nearest = Infinity;
        for (const e of this.enemies) {
            if (e.userData.patrolRole !== 'disruptor' || e.userData.hp <= 0) continue;
            const cfg = getRoleConfig('disruptor');
            const d = e.position.distanceTo(this.player.position);
            if (d < (cfg?.jamRadius ?? 540)) {
                jam = Math.max(jam, cfg?.jamStrength ?? 0.32);
                nearest = Math.min(nearest, d);
            }
        }
        this.player.missileJamPenalty = jam;

        const inJam = jam > 0;
        if (inJam && !this._disruptorJamActive) {
            this._disruptorJamActive = true;
            this.logCombatAbility({ userData: { name: 'Campo Disruptor' } }, 'Interferencia activa â€” precisiÃ³n de misiles reducida');
        } else if (!inJam && this._disruptorJamActive) {
            this._disruptorJamActive = false;
            const log = document.getElementById('log-text');
            if (log) log.innerHTML = `<span style="color:#88ccaa;">SeÃ±al de misiles restaurada</span>`;
        }
    },
};
