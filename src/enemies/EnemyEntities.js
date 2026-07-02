import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CONFIG } from '../../config.js';
import { getMovementProfile, applyVisualVariant, cloneMeshMaterials, steerVelocity, smoothYawRotation, yawToTarget, yawDelta, stripPoliceLightMeshes } from '../enemyVisuals.js';
import { isPlayerInHubSafeZone, isInHubSafeZone, pushOutOfSafeZone } from '../hubSafe.js';
import { NAME_TAG_COLOR } from '../enemyNames.js';
import { applyRoleToEnemy, getRoleConfig, isEnemyInCombat, isEnemyEngaged, engageEnemy, getEffectiveAggroDist } from '../enemyRoles.js';
import { resolveTerrainMove } from '../terrainRules.js';
import { tickZoneCombat } from './zoneBehaviors.js';

/** Entidades enemigas 3D — BaseEnemy, Spawner, MobileEnemy */
class BaseEnemy extends THREE.Group {
    constructor(manager, type, name, hp, speed) {
        super();
        this.manager = manager;
        this.userData = {
            isEnemy: true,
            type: type,
            name: name,
            hp: hp,
            maxHp: hp,
            velocity: new THREE.Vector3(0, 0, 0),
            maxSpeed: speed,
            hoverHeight: 40,
            hoverOffset: Math.random() * Math.PI * 2,
            baseHeight: 35,
            lastShot: 0,
            wanderAngle: Math.random() * Math.PI * 2,
            orbitDirection: Math.random() > 0.5 ? 1 : -1,
            orbitDistance: 300 + Math.random() * 400
        };
        this.visualGroup = new THREE.Group();
        this.add(this.visualGroup);
    }

    setupVisuals(template, ringSize, boxSize, variantOpts = null) {
        if (template) {
            const modelClone = SkeletonUtils.clone(template);
            modelClone.userData = { ...template.userData };
            cloneMeshMaterials(modelClone);
            modelClone.traverse((child) => {
                if (!child.isMesh) return;
                child.frustumCulled = false;
                child.visible = true;
                child.castShadow = false;
                child.receiveShadow = false;
                if (this.userData.isEventUnit && child.material?.emissive) {
                    this.userData.eventEmissiveMeshes = this.userData.eventEmissiveMeshes || [];
                    this.userData.eventEmissiveMeshes.push(child);
                }
            });
            stripPoliceLightMeshes(modelClone);
            if (variantOpts) applyVisualVariant(modelClone, variantOpts);
            this.userData._uniqueMaterials = true;
            this.visualGroup.add(modelClone);
        }

        const ringGeo = new THREE.RingGeometry(ringSize * 0.8, ringSize, 32);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xff3333, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = this.userData.type.includes('Spawner') ? -10 : -2;
        ring.visible = false;
        this.add(ring);
        this.userData.selectionRing = ring;

        const hitboxGeo = new THREE.BoxGeometry(boxSize, boxSize*0.5, boxSize);
        const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
        const hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
        this.add(hitbox);
    }

    createMinimapDot(container, typeClass, text = '') {
        if (container) {
            const dot = document.createElement('div');
            dot.className = `minimap-enemy ${typeClass}`;
            if (text) {
                const label = document.createElement('span');
                label.innerText = text;
                label.style.position = 'absolute';
                label.style.top = '-12px';
                label.style.left = '50%';
                label.style.transform = 'translateX(-50%)';
                label.style.fontSize = '8px';
                label.style.color = NAME_TAG_COLOR;
                label.style.fontWeight = 'bold';
                label.style.textShadow = '1px 1px 0px #000, -1px -1px 0px #000, 1px -1px 0px #000, -1px 1px 0px #000';
                label.style.pointerEvents = 'none';
                dot.appendChild(label);
            }
            container.appendChild(dot);
            this.userData.minimapDot = dot;
        }
    }

    updateBasePhysics(delta, environment, time) {
        if (environment) {
            const nextX = this.position.x + this.userData.velocity.x * delta;
            const nextZ = this.position.z + this.userData.velocity.z * delta;
            const moved = resolveTerrainMove(
                environment,
                this.position.x,
                this.position.z,
                nextX,
                nextZ,
                this.position.y
            );
            this.position.x = moved.x;
            this.position.z = moved.z;

            this.userData._cachedTerrainH = environment.getHeightAt(this.position.x, this.position.z);
        } else {
            this.position.addScaledVector(this.userData.velocity, delta);
            this.userData._cachedTerrainH = 0;
        }

        const terrainHeight = this.userData._cachedTerrainH ?? 0;
        const profile = getMovementProfile(this.userData.type);
        const hoverDistance = this.userData.hoverHeight ?? profile.hover ?? 40;
        const targetY = Math.max(hoverDistance, terrainHeight + hoverDistance);
        this.userData.baseHeight = targetY;

        const oscilation = Math.sin(time * 2 + this.userData.hoverOffset) * 2.5;
        const currentTargetY = this.userData.baseHeight + oscilation;

        this.position.y += (currentTargetY - this.position.y) * 8 * delta;

        if (this.userData.minimapDot) {
            // Evita escribir estilos en cada frame para todos los enemigos (muy costoso en DOM).
            if (!this.userData._nextMinimapDotAt || time >= this.userData._nextMinimapDotAt) {
                this.userData._nextMinimapDotAt = time + 0.08; // ~12.5 updates/s
                const mapPos = this.manager.worldToMinimap(this.position.x, this.position.z);
                const pX = mapPos.x;
                const pZ = mapPos.z;
                this.userData.minimapDot.style.left = `${pX}px`;
                this.userData.minimapDot.style.top = `${pZ}px`;
            }
        }
    }

    update(delta, environment, player, time) {
        this.updateBasePhysics(delta, environment, time);
    }
}

class Spawner extends BaseEnemy {
    constructor(manager, type, name, hp, spawnType, maxUnits, spawnRate) {
        super(manager, type, name, hp, 0);
        this.spawnType = spawnType;
        this.maxUnits = maxUnits;
        this.spawnRate = spawnRate;
        this.lastSpawnTime = Date.now() * 0.001;
        this.spawnedUnits = [];
    }

    update(delta, environment, player, time) {
        this.spawnedUnits = this.spawnedUnits.filter(u => u.userData.hp > 0);
        
        if (this.userData.maxSpeed > 0) {
            // === LÃ“GICA DE BASE MÃ“VIL ===
            // Deambula por el mapa libremente. Cambia de direcciÃ³n aleatoriamente 0.5% de las veces
            // o si choca contra una montaÃ±a (la velocidad baja a casi 0)
            if (Math.random() < 0.005 || this.userData.velocity.lengthSq() < 0.1) {
                const angle = Math.random() * Math.PI * 2;
                this.userData.velocity.set(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(this.userData.maxSpeed);
            }
            this.updateBasePhysics(delta, environment, time);
            
            // Fuerza a que la base se mantenga mÃ¡s alta que el terreno para sobrevolarlo
            if (environment && this.userData._cachedTerrainH !== undefined) {
                this.position.y = Math.max(this.position.y, this.userData._cachedTerrainH + 80);
            }
            
            // Rota la base para que mire hacia donde se mueve
            if (this.userData.velocity.lengthSq() > 0.1) {
                const lookTarget = this.position.clone().add(this.userData.velocity);
                lookTarget.y = this.position.y;
                const currentQuat = this.quaternion.clone();
                this.lookAt(lookTarget);
                const targetQuat = this.quaternion.clone();
                this.quaternion.copy(currentQuat).slerp(targetQuat, 2 * delta);
            }
        } else {
            // === LÃ“GICA DE BASE ESTÃTICA ===
            // Ajustar altura de la colmena al terreno para que no quede enterrada
            if (environment) {
                const h = environment.getHeightAt(this.position.x, this.position.z);
                this.position.y = Math.max(0, h) + 35;
            }
        }
        
        if (this.spawnedUnits.length < this.maxUnits && time - this.lastSpawnTime > this.spawnRate) {
            if (this.manager._mpMode !== 'guest') {
                this.manager.spawnUnitFromSpawner(this);
            }
            this.lastSpawnTime = time;
        }
    }
}

class MobileEnemy extends BaseEnemy {
    update(delta, environment, player, time, enemiesList) {
        if (this.userData.isEventUnit) this._updateEventVisuals(time, delta);
        if (this.userData.isMiniBoss) this._updateMiniBossAttack(player, time, delta);

        const profile = getMovementProfile(this.userData.type);
        this.userData.hoverHeight = profile.hover;

        const cPos = this.manager.getCombatTarget(this.position, player);
        const distToPlayer = this.position.distanceTo(cPos);
        const ud = this.userData;
        const typeKey = ud.type.toUpperCase();
        const roleConfig = getRoleConfig(ud.patrolRole);
        const attackDist = (CONFIG.COMBAT[`${typeKey}_ATTACK_DIST`] || 300) * (ud.attackDistMult ?? 1);
        const roleFireMult = (roleConfig?.fireRateMult ?? 1) * (ud.isSquadMember ? 1.4 : 1);
        const fireRate = CONFIG.COMBAT[`${typeKey}_FIRE_RATE`] * roleFireMult;
        const playerInSafe = isPlayerInHubSafeZone(player);
        const enemyInSafe = isInHubSafeZone(this.position.x, this.position.z);

        // â”€â”€ Ambush state machine â”€â”€
        if (roleConfig?.ability === 'ambush') {
            if (!ud.ambushState) ud.ambushState = 'hidden';
            if (ud.ambushState === 'hidden') {
                if (!playerInSafe && distToPlayer < (roleConfig.ambushTriggerDist ?? 520)) {
                    ud.ambushState = 'burst';
                    ud.ambushUntil = time + (roleConfig.ambushDuration ?? 4.2);
                    ud._ambushPulse = time + 0.6;
                    this.manager.logCombatAbility(this, roleConfig.burstLog || 'Â¡Emboscada activada!');
                }
            } else if (ud.ambushState === 'burst' && time > ud.ambushUntil) {
                ud.ambushState = 'normal';
            }
        }

        let inCombat = isEnemyEngaged(this, player, CONFIG, time);

        if (playerInSafe || enemyInSafe) {
            inCombat = false;
        }

        const homeX = ud.homeX ?? ud.spawner?.position?.x;
        const homeZ = ud.homeZ ?? ud.spawner?.position?.z;
        const leash = ud.leashRadius;
        let homeDist = Infinity;
        if (homeX !== undefined && homeZ !== undefined) {
            const hdx = this.position.x - homeX;
            const hdz = this.position.z - homeZ;
            homeDist = Math.sqrt(hdx * hdx + hdz * hdz);
            const engaged = ud.forcedAggroUntil && time < ud.forcedAggroUntil;
            if (inCombat && leash && homeDist > leash * 1.18 && !ud.isSquadMember && !engaged) {
                inCombat = false;
            }
        }

        // â”€â”€ Border watch: alert allies on first contact â”€â”€
        if (inCombat && roleConfig?.ability === 'border_watch' && !ud._borderAlerted) {
            ud._borderAlerted = true;
            this.manager.alertNearbyAllies(this, roleConfig.alertRadius ?? 950, time, roleConfig.alertDuration ?? 14);
            this.manager.logCombatAbility(this, roleConfig.abilityDesc);
        }

        // â”€â”€ Role ability announce (once) â”€â”€
        if (inCombat && roleConfig?.abilityDesc && !ud._abilityAnnounced && roleConfig.ability !== 'border_watch' && roleConfig.ability !== 'ambush') {
            ud._abilityAnnounced = true;
            this.manager.logCombatAbility(this, roleConfig.abilityDesc);
        }

        const hpPct = ud.maxHp > 0 ? ud.hp / ud.maxHp : 1;
        const retreating = roleConfig?.ability === 'hit_and_run' && inCombat && hpPct < (roleConfig.retreatHpPct ?? 0.38);

        if (inCombat && roleConfig?.extraAbilities?.includes('energy_shield')
            && !ud.enemyShieldUsed && hpPct <= (roleConfig.shieldTriggerPct ?? 0.55)) {
            this.manager.activateEnemyShield(this);
        }

        const zoneCombat = tickZoneCombat(this, { time, distToPlayer, inCombat, manager: this.manager });

        let damageMult = ud.damageMult ?? 1;
        let speedMult = zoneCombat.speedMult;
        if (ud.forcedAggroUntil && time < ud.forcedAggroUntil) {
            speedMult = 1.28;
        }
        if (ud.ambushState === 'burst') {
            speedMult = roleConfig?.ambushSpeedMult ?? 1.9;
            damageMult *= roleConfig?.ambushDamageMult ?? 1.55;
        }
        ud._currentDamageMult = damageMult;

        // Ambush visual pulse
        if (ud._ambushPulse && time < ud._ambushPulse) {
            const t = (ud._ambushPulse - time) / 0.6;
            this.visualGroup.scale.setScalar(1 + t * 0.12);
        } else if (ud.ambushState !== 'burst') {
            this.visualGroup.scale.setScalar(1);
        }

        let desiredDir = new THREE.Vector3(0, 0, 1);

        const squadManaged = !inCombat && (ud.squadFollow || (ud.isSquadLeader && ud.squadRouteActive));

        if (squadManaged) {
            desiredDir.set(0, 0, 0);
        } else if (inCombat) {
            const toPlayer = new THREE.Vector3().subVectors(cPos, this.position);
            toPlayer.y = 0;
            const flatDist = toPlayer.length();
            const orbitR = attackDist * profile.orbitMul;

            if (zoneCombat.charging && zoneCombat.skipOrbit) {
                if (flatDist > 0.01) desiredDir.copy(toPlayer).normalize();
                if (this.visualGroup) {
                    const pitch = -0.22;
                    this.visualGroup.rotation.x += (pitch - this.visualGroup.rotation.x) * 0.12;
                }
                if (time - this.userData.lastShot > fireRate * 1.35 && flatDist < attackDist * 1.15) {
                    const aim = new THREE.Vector3().subVectors(cPos, this.position);
                    aim.y = 0;
                    if (aim.lengthSq() > 0.01) {
                        aim.normalize();
                        this.manager.enemyShoot(this, aim);
                        this.userData.lastShot = time;
                        engageEnemy(this, time);
                    }
                }
            } else if (retreating) {
                if (flatDist > 0.01) {
                    desiredDir.copy(toPlayer).normalize().multiplyScalar(-1);
                }
            } else {
                if (this.userData.orbitDir === undefined) this.userData.orbitDir = 1;
                if (!this.userData.nextOrbitFlip) {
                    this.userData.nextOrbitFlip = time + (ud.isSquadMember ? 14 : 8);
                }
                if (time > this.userData.nextOrbitFlip) {
                    this.userData.orbitDir *= -1;
                    this.userData.nextOrbitFlip = time + (ud.isSquadMember ? 14 : 9) + Math.random() * 4;
                }

                if (flatDist > orbitR) {
                    desiredDir.copy(toPlayer).normalize();
                } else if (flatDist > 0.01) {
                    const tangent = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).normalize().multiplyScalar(this.userData.orbitDir);
                    const closeFactor = (orbitR - flatDist) / orbitR;
                    desiredDir.copy(tangent).lerp(toPlayer.clone().normalize(), closeFactor * 0.35).normalize();
                }

                if (time - this.userData.lastShot > fireRate && flatDist < attackDist * 1.2) {
                    const aim = new THREE.Vector3().subVectors(cPos, this.position);
                    aim.y = 0;
                    const aimYaw = Math.atan2(aim.x, aim.z);
                    smoothYawRotation(this, aimYaw, delta, ud.isSquadMember ? 4.5 : 2.8);
                    const aligned = yawDelta(aimYaw, this.rotation.y) < (ud.isSquadMember ? 0.78 : 0.42);
                    if (aligned) {
                        aim.normalize();
                        this.manager.enemyShoot(this, aim);
                        this.userData.lastShot = time;
                        engageEnemy(this, time);
                    }
                }

                const canMissile = ud.missileCooldown
                    && ud.zoneBehavior?.abilities?.includes('missile');
                if (canMissile && time > (ud.nextMissileAt || 0)) {
                    const mRange = ud.missileRange ?? 2600;
                    if (flatDist > attackDist * 0.7 && flatDist < mRange) {
                        this.manager.enemyFireMissile(this, cPos);
                        ud.nextMissileAt = time + ud.missileCooldown;
                    }
                }
            }
        } else if (this.userData.isPatrol && this.userData.patrolAnchor) {
            const ax = this.userData.patrolAnchor.x;
            const az = this.userData.patrolAnchor.z;
            const toAnchor = new THREE.Vector3(ax - this.position.x, 0, az - this.position.z);
            const ad = toAnchor.length();
            if (ad > 320) {
                desiredDir.copy(toAnchor).normalize();
            } else {
                this.userData.patrolAngle = (this.userData.patrolAngle ?? Math.random() * Math.PI * 2) + delta * 0.35;
                desiredDir.set(Math.cos(this.userData.patrolAngle), 0, Math.sin(this.userData.patrolAngle));
            }
        } else {
            this.userData.wanderAngle = (this.userData.wanderAngle ?? Math.random() * Math.PI * 2) + delta * 0.2;
            desiredDir.set(Math.cos(this.userData.wanderAngle), 0, Math.sin(this.userData.wanderAngle));
        }

        if (leash && homeX !== undefined && !inCombat && homeDist > leash * 0.8) {
            desiredDir.set(homeX - this.position.x, 0, homeZ - this.position.z).normalize();
        }

        if (environment && desiredDir.lengthSq() > 0.001) {
            this.userData._feelerTick = (this.userData._feelerTick || 0) + 1;
            const feelerEvery = this.manager.combatLoadLevel === 'heavy' ? 24
                : this.manager.combatLoadLevel === 'medium' ? 18 : 12;
            if (this.userData._feelerTick >= feelerEvery) {
                this.userData._feelerTick = 0;
                const feelerDist = 70;
                const forward = desiredDir.clone().normalize();
                const right = new THREE.Vector3(-forward.z, 0, forward.x);
                const leftF = new THREE.Vector3().addVectors(forward, right.clone().multiplyScalar(-0.7)).normalize().multiplyScalar(feelerDist);
                const rightF = new THREE.Vector3().addVectors(forward, right.clone().multiplyScalar(0.7)).normalize().multiplyScalar(feelerDist);
                const hLeft = environment.getHeightAt(this.position.x + leftF.x, this.position.z + leftF.z);
                const hRight = environment.getHeightAt(this.position.x + rightF.x, this.position.z + rightF.z);
                const avoid = new THREE.Vector3(0, 0, 0);
                if (hLeft > 40) avoid.add(right.clone().multiplyScalar(1.2));
                if (hRight > 40) avoid.add(right.clone().multiplyScalar(-1.2));
                this.userData._cachedAvoid = avoid;
            }
            if (this.userData._cachedAvoid?.lengthSq() > 0) {
                desiredDir.add(this.userData._cachedAvoid).normalize();
            }
        }

        if (enemiesList && desiredDir.lengthSq() > 0.001) {
            let sep = new THREE.Vector3();
            let count = 0;
            for (const other of enemiesList) {
                if (other === this || other.userData.hp <= 0) continue;
                const dSq = this.position.distanceToSquared(other.position);
                if (dSq > 0.01 && dSq < 14400) {
                    const d = Math.sqrt(dSq);
                    const push = new THREE.Vector3().subVectors(this.position, other.position);
                    push.y = 0;
                    sep.add(push.normalize().divideScalar(d));
                    count++;
                }
            }
            if (count > 0) {
                desiredDir.add(sep.divideScalar(count).multiplyScalar(1.8)).normalize();
            }
        }

        const maxSpd = squadManaged
            ? 0
            : inCombat
            ? this.userData.maxSpeed * speedMult
            : this.userData.maxSpeed * profile.patrolSpeed;
        this.userData.velocity = squadManaged
            ? this.userData.velocity.lerp(new THREE.Vector3(0, 0, 0), Math.min(1, 0.25 * (delta * 60)))
            : steerVelocity(this.userData.velocity, desiredDir, maxSpd, profile.accel, delta);

        if (this.userData.velocity.lengthSq() > 4 || (inCombat && distToPlayer < attackDist * 1.5)) {
            let targetYaw;
            if (inCombat && distToPlayer < attackDist * 1.5) {
                targetYaw = yawToTarget(this.position, cPos);
            } else {
                targetYaw = Math.atan2(this.userData.velocity.x, this.userData.velocity.z);
            }
            const turnRate = inCombat ? profile.turnRate * 0.55 : profile.turnRate * 0.85;
            smoothYawRotation(this, targetYaw, delta, turnRate);

            if (this.visualGroup) {
                if (inCombat && distToPlayer < attackDist * 1.2) {
                    const toP = cPos.clone().sub(this.position);
                    const horiz = Math.sqrt(toP.x * toP.x + toP.z * toP.z);
                    const pitchTarget = -Math.atan2(toP.y - this.position.y, horiz) * 0.12;
                    this.visualGroup.rotation.x += (pitchTarget - this.visualGroup.rotation.x) * 0.05;
                } else {
                    this.visualGroup.rotation.x += (0 - this.visualGroup.rotation.x) * 0.04;
                }

                const fwd = new THREE.Vector3(Math.sin(this.rotation.y), 0, Math.cos(this.rotation.y));
                const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
                const lateral = this.userData.velocity.dot(right);
                const targetRoll = lateral * profile.bank;
                this.visualGroup.rotation.z += (targetRoll - this.visualGroup.rotation.z) * 0.06;
            }
        }

        const speed = this.userData.velocity.length();
        const maxSpdRef = this.userData.maxSpeed;
        const isIdle = speed < 8;
        const flicker = 0.85 + Math.random() * 0.3;

        this.children.forEach(child => {
            if (child.userData.isFlame) {
                const s = child.userData.baseScale;
                if (isIdle) {
                    child.scale.lerp(new THREE.Vector3(s * 0.12 * flicker, s * 0.12 * flicker, s * 0.12), 0.15);
                } else {
                    const stretch = 0.25 + (speed / maxSpdRef) * 0.65;
                    child.scale.lerp(new THREE.Vector3(s * 0.14 * flicker, s * 0.14 * flicker, s * stretch * flicker), 0.2);
                }
            }
        });

        if (this.userData.engineAnchors && this.manager.particleGeo) {
            const distForTrails = this.position.distanceTo(player.position);
            const canEmitTrails = distForTrails < (this.userData.isMiniBoss ? 2400 : 1600);
            if (canEmitTrails) {
                this.userData.particleTick = (this.userData.particleTick || 0) + 1;
                const trailEvery = this.manager._engineTrailEvery ?? 5;
                if (this.userData.particleTick % trailEvery === 0) {
                    this.userData.engineAnchors.forEach((anchorData) => {
                        const anchor = anchorData.dummy;
                        const size = anchorData.size;
                        const worldPos = new THREE.Vector3();
                        anchor.getWorldPosition(worldPos);
                        let p;
                        if (this.manager.particlePool.length > 0) {
                            p = this.manager.particlePool.pop();
                            p.visible = true;
                        } else {
                            const mat = this.manager.getParticleMaterial(this.userData.dangerColor);
                            p = new THREE.Mesh(this.manager.particleGeo, mat);
                            this.manager.scene.add(p);
                        }
                        p.position.copy(worldPos);
                        p.material = this.manager.getParticleMaterial(this.userData.dangerColor);
                        p.userData.life = isIdle ? 0.2 : 0.35 + (speed / maxSpdRef) * 0.25;
                        p.userData.baseThickness = size * 0.06;
                        p.scale.setScalar(p.userData.baseThickness * (isIdle ? 0.45 : 0.75));
                        this.manager.trailParticles.push(p);
                    });
                }
            }
        }

        const onSquadRoute = ud.isSquadMember && !inCombat
            && (ud.squadFollow || (ud.isSquadLeader && ud.squadRouteActive));
        if (onSquadRoute) {
            return;
        }

        if (!this.userData.syncGhost && isInHubSafeZone(this.position.x, this.position.z)) {
            const out = pushOutOfSafeZone(this.position.x, this.position.z);
            this.position.x = out.x;
            this.position.z = out.z;
        }

        this.updateBasePhysics(delta, environment, time);
    }

    _updateEventVisuals(time, delta) {
        const pulse = 0.5 + Math.sin(time * 3.2 + this.id * 0.71) * 0.5;
        this.visualGroup.rotation.y += delta * 0.35;
        const eventScale = this.userData.isMiniBoss ? 1.01 + pulse * 0.03 : 1.0 + pulse * 0.012;
        this.visualGroup.scale.setScalar(eventScale);
        if (this.userData.eventEmissiveMeshes) {
            const baseIntensity = this.userData.isMiniBoss ? 1.5 : 1.05;
            const bonus = this.userData.isMiniBoss ? 0.55 : 0.28;
            const telegraphBoost = this.userData.miniBossTelegraph ? 0.45 : 0.0;
            const intensity = baseIntensity + pulse * bonus + telegraphBoost;
            this.userData.eventEmissiveMeshes.forEach((mesh) => {
                if (mesh.material && typeof mesh.material.emissiveIntensity === 'number') {
                    mesh.material.emissiveIntensity = intensity;
                }
            });
        }
    }

    _updateMiniBossAttack(player, time, delta) {
        if (!player) return;
        if (this.userData.nextBossPulseAt === undefined) {
            this.userData.nextBossPulseAt = time + 3.8;
            this.userData.miniBossTelegraph = false;
            this.userData.bossTelegraphLevel = 0;
        }

        if (!this.userData.miniBossTelegraph && time >= this.userData.nextBossPulseAt) {
            this.userData.miniBossTelegraph = true;
            this.userData.bossTelegraphEndsAt = time + 1.25;
            this.userData.bossAttackSignalTime = time;
            if (this.userData.bossTelegraphRing) {
                this.userData.bossTelegraphRing.visible = true;
                this.userData.bossTelegraphRing.scale.setScalar(0.5);
                this.userData.bossTelegraphRing.material.opacity = 0.7;
            }
        }

        if (this.userData.miniBossTelegraph) {
            const total = 1.25;
            const remaining = Math.max(0.0, this.userData.bossTelegraphEndsAt - time);
            const progress = 1 - Math.min(1, remaining / total);
            this.userData.bossTelegraphLevel = progress;
            this.userData.velocity.multiplyScalar(0.97);

            if (this.userData.bossTelegraphRing) {
                const ring = this.userData.bossTelegraphRing;
                ring.scale.setScalar(0.5 + progress * 1.9);
                ring.material.opacity = 0.65 - progress * 0.5;
                ring.rotation.z += delta * 2.2;
            }

            if (time >= this.userData.bossTelegraphEndsAt) {
                this.userData.miniBossTelegraph = false;
                this.userData.bossTelegraphLevel = 0;
                if (this.userData.bossTelegraphRing) this.userData.bossTelegraphRing.visible = false;
                this.userData.nextBossPulseAt = time + 4.6 + Math.random() * 2.2;
                engageEnemy(this, time);
                this.manager.triggerBossShockwave(this, 480, 32);
            }
        } else if (this.userData.bossTelegraphRing) {
            this.userData.bossTelegraphRing.visible = false;
        }
    }
}

export { BaseEnemy, Spawner, MobileEnemy };
