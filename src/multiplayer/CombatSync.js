import * as THREE from 'three';

/** Efectos de combate compartidos — láseres, impactos, explosiones. */
export class CombatSync {
    constructor(game) {
        this.game = game;
        this._mpLasers = [];
        this._remoteMissiles = [];
    }

    emit(kind, payload) {
        this.game.multiplayerClient?.sendEvent(kind, payload);
    }

    _resolveRemote(targetId) {
        const rp = this.game.remotePlayers;
        if (!rp || targetId == null) return null;
        const key = String(targetId);
        if (rp.remote.has(key)) return rp.remote.get(key);
        for (const [id, entry] of rp.remote) {
            if (String(id) === key) return entry;
        }
        return null;
    }

    _syncTargetHudForPlayer(targetId, hp, maxHp) {
        const player = this.game.player;
        if (!player?.target) return;
        let root = player.target;
        while (root.parent && !root.userData?.isRemotePlayer) root = root.parent;
        if (String(root.userData?.playerId) !== String(targetId)) return;
        root.userData.hp = hp;
        root.userData.maxHp = maxHp;
        player.updateTargetUI();
    }

    update(delta) {
        for (let i = this._remoteMissiles.length - 1; i >= 0; i--) {
            const m = this._remoteMissiles[i];
            m.life -= delta;
            if (m.target?.display && !m.target.isDead) {
                const to = m.target.display.clone().sub(m.mesh.position);
                if (to.lengthSq() > 1) {
                    to.normalize();
                    m.velocity.lerp(to.multiplyScalar(m.speed), 2.5 * delta);
                }
            }
            m.mesh.position.addScaledVector(m.velocity, delta);
            const look = m.mesh.position.clone().add(m.velocity);
            m.mesh.lookAt(look);

            const hitDist = m.target?.display
                ? m.mesh.position.distanceTo(m.target.display)
                : Infinity;
            if (m.life <= 0 || hitDist < 45) {
                if (this.game.enemyManager) {
                    this.game.enemyManager.createExplosion(m.mesh.position.clone(), hitDist < 45 ? 2.8 : 0.6);
                }
                this.game.scene.remove(m.mesh);
                m.mesh.geometry?.dispose?.();
                m.mesh.material?.dispose?.();
                this._remoteMissiles.splice(i, 1);
            }
        }

        // Láseres remotos viven en enemyManager.enemyLasers (visualOnly)
        for (let i = this._mpLasers.length - 1; i >= 0; i--) {
            const laser = this._mpLasers[i];
            laser.life -= delta;
            if (laser.life <= 0) {
                this.game.scene.remove(laser.mesh);
                laser.mesh.traverse((c) => {
                    if (c.geometry) c.geometry.dispose();
                    if (c.material) {
                        if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
                        else c.material.dispose();
                    }
                });
                this._mpLasers.splice(i, 1);
                continue;
            }
            laser.mesh.position.addScaledVector(laser.velocity, delta);
        }
    }

    handle(fromPlayerId, kind, payload) {
        if (kind === 'pvp_hit') {
            this.applyPvpHit(fromPlayerId, payload);
            return;
        }
        // player_shoot lo recibe game.js directamente (evita filtros)
        if (kind === 'player_shoot') return;

        if (fromPlayerId === this.game.multiplayerClient?.playerId) return;

        switch (kind) {
            case 'enemy_laser':
                this._spawnEnemyLaserVisual(payload);
                break;
            case 'enemy_missile':
                this.game.enemyManager?.spawnVisualMissileFromNetwork(payload);
                break;
            case 'player_hit':
                this._applyPlayerHit(payload);
                break;
            case 'explosion':
                this._explosion(payload);
                break;
            case 'enemy_dead':
                this.game.enemyManager?.removeSyncGhostById(payload?.id);
                break;
            case 'player_damage':
                this.applyPlayerDamage(fromPlayerId, payload);
                break;
            case 'player_died':
                this._applyPlayerDied(payload);
                break;
            case 'player_respawn':
                this._applyPlayerRespawn(payload);
                break;
            default:
                break;
        }
    }

    /** Daño PvP autoritativo — servidor envía hp final; todos actualizan UI. */
    applyPvpHit(fromPlayerId, p) {
        if (p?.targetId == null) return;
        const targetId = String(p.targetId);
        const localId = String(this.game.multiplayerClient?.playerId ?? '');
        const amount = Math.max(1, Math.round(p.amount ?? 12));

        // —— Víctima (este cliente) ——
        if (targetId === localId) {
            const pl = this.game.player;
            if (pl && !pl.isDead) {
                const prevHp = pl.hp;
                const prevShield = pl.shieldHp ?? 0;
                const localShieldUp = pl._isShieldUp?.() ?? (
                    pl.shieldActive && (pl.shieldTimer ?? 0) > 0 && (pl.shieldHp ?? 0) > 0
                );
                if (typeof p.shieldHp === 'number') {
                    const nextHp = Math.max(0, p.shieldHp);
                    if (localShieldUp) {
                        if ((p.shieldHit || p.shieldActive) && nextHp < (pl.shieldHp ?? 0) - 0.01) {
                            pl.shieldHp = nextHp;
                        }
                    } else if (nextHp < (pl.shieldHp ?? 0) - 0.01) {
                        pl.shieldHp = nextHp;
                    }
                }
                if (p.shieldActive === true && !localShieldUp) {
                    pl.shieldActive = true;
                }
                pl._syncShieldVisual?.();
                if (typeof p.shieldMax === 'number') pl.shieldMax = p.shieldMax;
                if (typeof p.hp === 'number') {
                    pl.hp = Math.max(0, p.hp);
                } else {
                    pl.hp = Math.max(0, pl.hp - amount);
                }

                const hullLost = Math.max(0, prevHp - pl.hp);
                const shieldHit = p.shieldHit === true
                    || ((pl.shieldHp ?? 0) < prevShield && hullLost <= 0.01);
                pl._feedbackCombatHit?.({ shieldHit, hullLost, amount, hitFrom: p.hitFrom });
                pl.updateUI();

                if (pl.hp <= 0) {
                    pl.hp = 0;
                    if (!pl.isDead) {
                        pl.isDead = true;
                        pl.die({ fromNetwork: true });
                    }
                }
            }
            return;
        }

        // —— Vista del piloto remoto (atacante / espectadores) ——
        const remote = this._resolveRemote(targetId);
        if (!remote) return;
        if (remote.isDead && (p.hp ?? remote.hp) > 0) {
            this.game.remotePlayers.markRespawned(targetId, p);
        }
        if (remote.isDead && (p.hp ?? 0) <= 0) return;

        remote.hitFlash = 1;
        remote.hp = typeof p.hp === 'number' ? Math.max(0, p.hp) : Math.max(0, (remote.hp ?? 200) - amount);
        const maxHp = remote.maxHp ?? p.maxHp ?? 200;
        this.game.remotePlayers.applyCombatState(targetId, {
            hp: remote.hp,
            maxHp,
            shieldHp: typeof p.shieldHp === 'number' ? p.shieldHp : remote.shieldHp,
            shieldActive: typeof p.shieldActive === 'boolean' ? p.shieldActive : remote.shieldActive,
            shieldMax: typeof p.shieldMax === 'number' ? p.shieldMax : remote.shieldMax,
        });
        this._syncTargetHudForPlayer(targetId, remote.hp, maxHp);

        const pos = remote.display || remote.mesh?.position;
        if (pos) {
            window.__game?.vfx?.combatImpact(pos, p.shieldHit ? 'shield' : 'hull', {
                severity: Math.min(1, amount / 40),
                amount,
            });
        }

        if (remote.hp <= 0) {
            this.game.remotePlayers.markDead(targetId, pos);
            if (String(this.game.player?.target?.userData?.playerId) === targetId) {
                this.game.player.setTarget(null);
            }
        } else if (pos && this.game.enemyManager) {
            this.game.enemyManager.createExplosion(pos.clone(), 0.35);
        }
    }

    _remotePlayerShoot(fromPlayerId, p) {
        const localId = String(this.game.multiplayerClient?.playerId ?? '');
        if (!fromPlayerId || String(fromPlayerId) === localId) return;

        const scene = this.game.scene;
        if (!scene) return;

        const remote = this._resolveRemote(fromPlayerId);
        const origin = new THREE.Vector3();
        if (remote?.mesh) {
            remote.mesh.getWorldPosition(origin);
            origin.y += 2;
        } else {
            origin.set(p.ox ?? 0, p.oy ?? 52, p.oz ?? 0);
        }

        const targetId = p.targetId != null ? String(p.targetId) : null;
        let dir = null;

        if (targetId === localId && this.game.player?.position) {
            dir = new THREE.Vector3().subVectors(this.game.player.position, origin);
            dir.y += 1;
        } else if (targetId) {
            const tgt = this._resolveRemote(targetId);
            const tp = tgt?.display || tgt?.mesh?.position;
            if (tp) dir = new THREE.Vector3().subVectors(tp, origin);
        }

        if (!dir || dir.lengthSq() < 0.001) {
            if (typeof p.dx === 'number') {
                dir = new THREE.Vector3(p.dx, p.dy ?? 0, p.dz ?? 0);
            } else if (p.tx != null) {
                dir = new THREE.Vector3(
                    p.tx - origin.x,
                    (p.ty ?? origin.y) - origin.y,
                    p.tz - origin.z,
                );
            } else if (remote?.mesh) {
                dir = new THREE.Vector3(0, 0, -1).applyQuaternion(remote.mesh.quaternion);
            } else {
                dir = new THREE.Vector3(0, 0, -1);
            }
        }
        if (dir.lengthSq() < 0.001) return;
        dir.normalize();

        window.__game?.vfx?.muzzleFlash(origin, dir, 0xcc66ff);
        this._spawnRemotePlayerLaserPair(origin, dir, scene);
    }

    _remotePlayerMissile(fromPlayerId, p) {
        const localId = String(this.game.multiplayerClient?.playerId ?? '');
        if (!fromPlayerId || String(fromPlayerId) === localId) return;

        const scene = this.game.scene;
        if (!scene) return;

        const remote = this._resolveRemote(fromPlayerId);
        const origin = new THREE.Vector3();
        if (remote?.mesh) {
            remote.mesh.getWorldPosition(origin);
            origin.y += 2;
        } else {
            origin.set(p.ox ?? 0, p.oy ?? 52, p.oz ?? 0);
        }

        const targetId = p.targetId != null ? String(p.targetId) : null;
        let dir = null;
        if (targetId === localId && this.game.player?.position) {
            dir = new THREE.Vector3().subVectors(this.game.player.position, origin);
        } else if (targetId) {
            const tgt = this._resolveRemote(targetId);
            const tp = tgt?.display || tgt?.mesh?.position;
            if (tp) dir = new THREE.Vector3().subVectors(tp, origin);
        }
        if (!dir || dir.lengthSq() < 0.001) {
            dir = new THREE.Vector3(p.dx ?? 0, p.dy ?? 0, p.dz ?? 1);
            if (dir.lengthSq() < 0.001 && targetId) {
                const tgt = this._resolveRemote(targetId);
                if (tgt?.display) dir.subVectors(tgt.display, origin);
            }
        }
        if (dir.lengthSq() < 0.001) dir.set(0, 0, -1);
        dir.normalize();

        const geo = new THREE.CylinderGeometry(2, 2, 40, 8);
        geo.rotateX(Math.PI / 2);
        const mat = new THREE.MeshStandardMaterial({
            color: 0xffaa44,
            emissive: 0xff6600,
            emissiveIntensity: 2.2,
            metalness: 0.4,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(origin);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
        scene.add(mesh);

        const target = p.targetId ? this._resolveRemote(p.targetId) : null;
        this._remoteMissiles.push({
            mesh,
            velocity: dir.clone().multiplyScalar(p.speed ?? 800),
            speed: p.speed ?? 800,
            target,
            life: 4.5,
        });
    }

    /** Láseres de otros pilotos — escena principal + pool propio. */
    _spawnRemotePlayerLaserPair(origin, dir, scene) {
        const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
        const outerGeo = new THREE.CylinderGeometry(1.0, 1.0, 130, 8);
        outerGeo.rotateX(Math.PI / 2);
        const innerGeo = new THREE.CylinderGeometry(0.4, 0.4, 130, 8);
        innerGeo.rotateX(Math.PI / 2);

        for (const side of [-1, 1]) {
            const laser = new THREE.Group();
            laser.add(new THREE.Mesh(outerGeo.clone(), new THREE.MeshStandardMaterial({
                color: 0xcc66ff,
                emissive: 0xcc66ff,
                emissiveIntensity: 5.0,
                transparent: true,
                opacity: 0.98,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            })));
            laser.add(new THREE.Mesh(innerGeo.clone(), new THREE.MeshStandardMaterial({
                color: 0xffffff,
                emissive: 0xffffff,
                emissiveIntensity: 12.0,
            })));

            const pos = origin.clone().addScaledVector(perp, 14 * side);
            laser.position.copy(pos);
            laser.lookAt(pos.clone().add(dir));
            laser.frustumCulled = false;
            laser.renderOrder = 999;
            scene.add(laser);

            this._mpLasers.push({
                mesh: laser,
                velocity: dir.clone().multiplyScalar(3000),
                life: 2.8,
            });
        }
    }

    _spawnPlayerLaserPairLegacy(origin, dir) {
        const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();

        for (const side of [-1, 1]) {
            const pos = origin.clone().addScaledVector(perp, 14 * side);
            const coreGeo = new THREE.CylinderGeometry(1.6, 1.6, 100, 8);
            coreGeo.rotateX(Math.PI / 2);
            const glowGeo = new THREE.CylinderGeometry(3, 4, 110, 8);
            glowGeo.rotateX(Math.PI / 2);

            const laser = new THREE.Group();
            laser.add(new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xffffff })));
            laser.add(new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
                color: 0xcc66ff,
                transparent: true,
                opacity: 0.9,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            })));
            laser.position.copy(pos);
            laser.lookAt(pos.clone().add(dir));
            laser.frustumCulled = false;
            laser.renderOrder = 999;
            this.game.scene.add(laser);

            this._mpLasers.push({
                mesh: laser,
                velocity: dir.clone().multiplyScalar(3200),
                life: 2.5,
            });
        }
    }

    _spawnEnemyLaserVisual(p) {
        const em = this.game.enemyManager;
        if (!em) return;

        const dir = new THREE.Vector3(p.dx ?? 0, p.dy ?? 0, p.dz ?? 1).normalize();
        const origin = new THREE.Vector3(p.x ?? 0, p.y ?? 0, p.z ?? 0);
        const lateral = p.lateralOffset ?? 5;

        em._spawnHostileBolt(origin, dir, {
            color: p.color ?? 0xff4444,
            thickness: p.thickness ?? 2.2,
            spawnOffset: p.spawnOffset ?? 12,
            lateral,
            speed: p.speed ?? 860,
            visualOnly: true,
        });
        em._spawnHostileBolt(origin, dir, {
            color: p.color ?? 0xff4444,
            thickness: p.thickness ?? 2.2,
            spawnOffset: p.spawnOffset ?? 12,
            lateral: -lateral,
            speed: p.speed ?? 860,
            visualOnly: true,
        });

        window.__game?.vfx?.muzzleFlash(origin, dir, p.color ?? 0xff4444);
        if (p.aggressorName) {
            const log = document.getElementById('log-text');
            if (log) {
                log.innerHTML = `<span style="color:#ff9966;font-weight:bold;">⚠ ${p.aggressorName}: Disparando</span>`;
            }
        }
    }

    _applyPlayerHit(p) {
        const localId = this.game.multiplayerClient?.playerId;
        if (p.playerId === localId) return;
        this._remotePlayerHit(p);
    }

    /** Daño PvE autoritativo desde el servidor. */
    applyPlayerDamage(fromPlayerId, p) {
        if (!p?.playerId) return;
        const localId = String(this.game.multiplayerClient?.playerId ?? '');
        const pid = String(p.playerId);

        if (pid === localId) {
            this.game.player?.applyNetworkDamage(p);
            return;
        }

        const remote = this._resolveRemote(pid);
        if (!remote) return;
        remote.hitFlash = 1;
        if (typeof p.shieldHp === 'number') remote.shieldHp = p.shieldHp;
        if (typeof p.shieldActive === 'boolean') remote.shieldActive = p.shieldActive;
        if (typeof p.hp === 'number') {
            remote.hp = Math.max(0, p.hp);
            this.game.remotePlayers.applyCombatState(pid, {
                hp: remote.hp,
                maxHp: remote.maxHp ?? 200,
                shieldHp: remote.shieldHp,
                shieldActive: remote.shieldActive,
                shieldMax: remote.shieldMax,
            });
            this._syncTargetHudForPlayer(pid, remote.hp, remote.maxHp ?? 200);
        }
        const pos = remote.display || remote.mesh?.position;
        if (pos) {
            window.__game?.vfx?.combatImpact(pos, p.shieldHit ? 'shield' : 'hull', {
                severity: Math.min(1, (p.amount ?? 12) / 40),
                amount: p.amount ?? 12,
            });
        }
        if (pos && this.game.enemyManager) {
            this.game.enemyManager.createExplosion(pos.clone(), 0.35);
        }
    }

    _remotePlayerHit(p) {
        this.game.remotePlayers?.applyCombatState(p.playerId, p);

        const remote = this.game.remotePlayers?.remote.get(p.playerId);
        if (!remote) return;

        remote.hitFlash = 1;
        const pos = remote.display || remote.mesh?.position;
        if ((p.hp ?? remote.hp) <= 0) {
            this.game.remotePlayers?.markDead(p.playerId, pos);
        }

        if (pos && this.game.enemyManager) {
            this.game.enemyManager.createExplosion(pos.clone(), 0.45);
        }
        if (this.game.player?.target === remote.mesh) {
            this.game.player.updateTargetUI();
        }
    }

    _applyPlayerDied(p) {
        const localId = String(this.game.multiplayerClient?.playerId ?? '');
        const pid = String(p?.playerId ?? '');
        if (pid === localId) {
            const pl = this.game.player;
            if (pl && !pl.isDead) {
                pl.hp = 0;
                pl.isDead = true;
                pl.die({ fromNetwork: true });
            }
            return;
        }

        const pos = new THREE.Vector3(p.x ?? 0, p.y ?? 50, p.z ?? 0);
        this.game.remotePlayers?.markDead(p.playerId, pos);
        if (this.game.enemyManager) {
            this.game.enemyManager.createExplosion(pos, 2.8);
            setTimeout(() => {
                if (this.game.enemyManager) {
                    this.game.enemyManager.createExplosion(pos.clone(), 1.5);
                }
            }, 200);
        }
        if (this.game.player?.target?.userData?.playerId === p.playerId) {
            this.game.player.setTarget(null);
        }
    }

    _applyPlayerRespawn(p) {
        const localId = this.game.multiplayerClient?.playerId;
        if (p.playerId === localId) return;
        this.game.remotePlayers?.markRespawned(p.playerId, p);
    }

    _explosion(p) {
        if (!this.game.enemyManager) return;
        this.game.enemyManager.createExplosion(
            new THREE.Vector3(p.x ?? 0, p.y ?? 0, p.z ?? 0),
            p.scale ?? 1,
        );
    }
}
