import * as THREE from 'three';
import squadData from '../../data/patrol_squads.json';
import { getFormationOffset, getTrailFollowDistance } from './squadRoles.js';
import { engageEnemy, isEnemyInCombat, isEnemyEngaged } from '../enemyRoles.js';
import { clampSquadWaypoints, pushOutOfSafeZone, isInHubSafeZone } from '../hubSafe.js';
import { CONFIG } from '../../config.js';
import { getMovementProfile } from '../enemyVisuals.js';
import { snapToNavPoint, clampPointToDisc, isPlayerReachablePoint, WORLD_MAP } from '../worldNav.js';
import { resolveEnemyMove } from '../terrainRules.js';

const _goal = new THREE.Vector3();
const _toGoal = new THREE.Vector3();
const _right = new THREE.Vector3();
const _push = new THREE.Vector3();
const _moveDir = new THREE.Vector3();

function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
}

function sampleTrailPoint(trail, distance) {
    if (!trail?.length) return null;
    if (distance <= 0) return trail[0];
    let acc = 0;
    for (let i = 0; i < trail.length - 1; i++) {
        const a = trail[i];
        const b = trail[i + 1];
        const seg = Math.hypot(a.x - b.x, a.z - b.z);
        if (seg < 0.01) continue;
        if (acc + seg >= distance) {
            const t = (distance - acc) / seg;
            return {
                x: a.x + (b.x - a.x) * t,
                z: a.z + (b.z - a.z) * t,
                y: a.y + (b.y - a.y) * t,
                yaw: lerpAngle(a.yaw, b.yaw, t),
            };
        }
        acc += seg;
    }
    const tail = trail[trail.length - 1];
    return { x: tail.x, z: tail.z, y: tail.y, yaw: tail.yaw };
}

/**
 * Patrullas en fila india — E3 líder + E2 centro + E1 cola (misiles).
 * Rutas estratégicas cerca del hub y corredores de zona.
 */
export class PatrolSquadManager {
    constructor(enemyManager) {
        this.em = enemyManager;
        /** @type {Array<object>} */
        this.squads = [];
        this._spawned = false;
    }

    trySpawn(environment = null) {
        if (this.em._gameRef && !this.em._gameRef._sessionActive) return;
        if (this._spawned && this.squads.length > 0) return;
        if (!this.em._allPatrolModelsReady?.()) return;
        const n = this.spawnAll(environment);
        this._spawned = n > 0;
    }

    despawnAll() {
        for (const squad of this.squads) {
            for (const member of squad.members || []) {
                if (member?.userData?.hp > 0) this.em.forceDespawnEnemy(member, true);
            }
        }
        this.squads = [];
        this._spawned = false;
    }

    spawnAll(environment = null) {
        this.squads = [];
        for (const def of squadData.squads || []) {
            const squad = this._spawnSquad(def, environment);
            if (squad) this.squads.push(squad);
        }
        if (this.squads.length) {
            const n = this.squads.reduce((a, s) => a + (s.members?.length ?? 0), 0);
            console.log(`[PatrolSquad] ${this.squads.length} tren(es) · ${n} bots en ruta`);
        } else {
            console.warn('[PatrolSquad] Ningún tren spawneado — reintentará al cargar modelos');
        }
        return this.squads.length;
    }

    _spawnSquad(def, environment) {
        const rawWps = def.waypoints;
        if (!rawWps?.length) return null;
        const wps = clampSquadWaypoints(rawWps, 240).map((wp) => {
            const clamped = clampPointToDisc(wp.x, wp.z, WORLD_MAP.spawnClampScale);
            const snapped = snapToNavPoint(this.em.environment, clamped.x, clamped.z);
            if (!isPlayerReachablePoint(this.em.environment, snapped.x, snapped.z)) {
                console.warn(`[PatrolSquad] Waypoint inalcanzable en ${def.id}: (${wp.x}, ${wp.z})`);
            }
            return { x: snapped.x, z: snapped.z };
        });
        const formation = def.formation === 'v' ? 'v' : 'column';
        for (const slot of def.slots || []) {
            const unitType = slot.enemyType || def.enemyType || 'Zona2';
            if (!this.em._patrolSlotReady?.(slot.patrolDesign, unitType)) return null;
        }
        const start = wps[0];
        const members = [];
        let leader = null;
        const leaderType = (def.slots?.[0]?.enemyType || def.enemyType || 'Zona3').toUpperCase();
        const boxSize = CONFIG.VISUALS[`${leaderType}_BOX_SIZE`] ?? 64;

        for (const slot of def.slots || []) {
            const unitType = slot.enemyType || def.enemyType || 'Zona2';
            const form = getFormationOffset(slot.index, boxSize, formation);
            const x = start.x + form.x;
            const z = start.z + form.z;
            const unit = this.em.spawnSquadUnit(x, z, unitType, {
                role: slot.role,
                enemyType: unitType,
                patrolDesign: slot.patrolDesign,
                regionId: def.regionId || { Zona1: 'north_mantis', Zona2: 'east_scavenger', Zona3: 'west_command' }[unitType],
                squadId: def.id,
                squadSlot: slot.index,
                squadName: def.name,
                formationScale: boxSize,
                formation,
            });
            if (!unit) continue;
            unit.userData.squadId = def.id;
            unit.userData.squadSlot = slot.index;
            unit.userData.squadName = def.name;
            unit.userData.squadRole = slot.role;
            unit.userData.isSquadMember = true;
            unit.userData.squadSpeed = def.speed ?? 90;
            unit.userData._formationScale = boxSize;
            unit.userData._squadFormation = formation;
            unit.userData.squadVel = new THREE.Vector3();
            if (slot.index === 0) {
                unit.userData.isSquadLeader = true;
                leader = unit;
            }
            members.push(unit);
        }

        if (!leader || members.length < (def.slots?.length ?? 4)) {
            members.forEach((m) => this.em.forceDespawnEnemy(m, true));
            console.warn(`[PatrolSquad] Falló ${def.id} — unidades: ${members.length}/${def.slots?.length ?? 4}`);
            return null;
        }

        for (const m of members) {
            m.userData.squadRouteActive = true;
            if (m !== leader) m.userData.squadFollow = true;
        }

        const firstWp = wps[1] || wps[0];
        const initYaw = Math.atan2(firstWp.x - start.x, firstWp.z - start.z);
        leader.rotation.y = initYaw;
        leader.userData._leaderYaw = initYaw;

        return {
            id: def.id,
            name: def.name,
            enemyType: def.enemyType,
            regionId: def.regionId,
            waypoints: wps.map((w) => ({ x: w.x, z: w.z })),
            wpIndex: 1,
            loop: def.loop !== false,
            speed: def.speed ?? 90,
            reverse: false,
            leader,
            members,
            formation,
            _forward: new THREE.Vector3(Math.sin(initYaw), 0, Math.cos(initYaw)),
            _boxSize: boxSize,
            trail: [{
                x: leader.position.x,
                z: leader.position.z,
                y: leader.position.y,
                yaw: initYaw,
            }],
        };
    }

    _recordLeaderTrail(squad, leader) {
        if (!squad.trail) squad.trail = [];
        const tr = squad.trail;
        const head = tr[0];
        const lx = leader.position.x;
        const lz = leader.position.z;
        if (head && Math.hypot(lx - head.x, lz - head.z) < 5) return;
        tr.unshift({
            x: lx,
            z: lz,
            y: leader.position.y,
            yaw: leader.rotation.y,
        });
        if (tr.length > 96) tr.length = 96;
    }

    update(delta, player) {
        if (!this._spawned && this.em._allPatrolModelsReady?.()) {
            const n = this.spawnAll(this.em.environment);
            if (n > 0) {
                this._spawned = true;
                const log = document.getElementById('log-text');
                if (log && !log.textContent.includes('Patrullas')) {
                    log.textContent = `Patrullas en ruta — ${n} tren(es) activos`;
                }
            }
        }

        const time = Date.now() * 0.001;

        for (const squad of this.squads) {
            if (!squad.leader?.userData || squad.leader.userData.hp <= 0) {
                this._promoteLeader(squad);
                if (!squad.leader) continue;
            }

            const distToPlayer = player
                ? squad.leader.position.distanceTo(player.position)
                : Infinity;

            const squadFighting = player && squad.members.some(
                (m) => m?.userData?.hp > 0 && isEnemyEngaged(m, player, CONFIG, time),
            );

            let effDelta = delta;
            if (!squadFighting && distToPlayer > 5200) {
                squad._farSkip = (squad._farSkip ?? 0) + 1;
                if (squad._farSkip % 4 !== 0) continue;
                effDelta = delta * 4;
            } else {
                squad._farSkip = 0;
            }

            if (squadFighting) {
                for (const m of squad.members) {
                    if (m?.userData?.hp > 0) {
                        m.userData.squadFollow = false;
                        m.userData.squadRouteActive = false;
                    }
                }
                this._commanderParalyze(squad, player, time);
                continue;
            }

            this._resumeSquadRoute(squad, player, time);
            this._moveLeaderAlongRoute(squad, effDelta);
            this._updateFormation(squad, effDelta);
            this._commanderParalyze(squad, player, time);
        }
    }

    /** Al recibir daño, suelta la formación para que no teletransporte unidades. */
    breakCombatFormation(squadId, time) {
        const squad = this.squads.find((s) => s.id === squadId);
        if (!squad) return;
        for (const m of squad.members) {
            if (m?.userData?.hp > 0) {
                m.userData.squadFollow = false;
                m.userData.squadRouteActive = false;
                engageEnemy(m, time);
            }
        }
    }

    /** Tras combate o si el jugador se aleja, vuelven al tren. */
    _resumeSquadRoute(squad, player, time) {
        if (!player || !squad.leader) return;
        const playerFar = squad.leader.position.distanceTo(player.position) > 3600;
        for (const m of squad.members) {
            if (!m?.userData || m.userData.hp <= 0) continue;
            const fighting = isEnemyEngaged(m, player, CONFIG, time) && !playerFar;
            if (fighting) continue;
            m.userData.forcedAggroUntil = 0;
            if (m.userData.isSquadLeader) {
                m.userData.squadRouteActive = true;
                m.userData.squadFollow = false;
            } else {
                m.userData.squadFollow = true;
                m.userData.squadRouteActive = false;
            }
        }
    }

    _promoteLeader(squad) {
        const alive = squad.members.filter((m) => m?.userData?.hp > 0);
        squad.members = alive;
        if (!alive.length) return;
        alive.sort((a, b) => (a.userData.squadSlot ?? 99) - (b.userData.squadSlot ?? 99));
        for (const m of alive) m.userData.isSquadLeader = false;
        squad.leader = alive[0];
        squad.leader.userData.isSquadLeader = true;
        squad.leader.userData.squadSlot = 0;
        squad.leader.userData.squadFollow = false;
    }

    _moveLeaderAlongRoute(squad, delta) {
        const leader = squad.leader;
        const wps = squad.waypoints;
        if (!wps.length) return;

        const time = Date.now() * 0.001;
        const player = this.em.player;
        if (player && isEnemyEngaged(leader, player, CONFIG, time)) {
            leader.userData.squadRouteActive = false;
            leader.userData.squadFollow = false;
            return;
        }

        let targetIdx = squad.wpIndex;
        if (squad.reverse) targetIdx = Math.max(0, targetIdx - 1);
        const target = wps[targetIdx];
        if (!target) return;

        const dx = target.x - leader.position.x;
        const dz = target.z - leader.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < 180) {
            if (squad.reverse) {
                if (targetIdx <= 0) {
                    squad.reverse = false;
                    squad.wpIndex = 1;
                } else {
                    squad.wpIndex = targetIdx - 1;
                }
            } else if (targetIdx >= wps.length - 1) {
                if (squad.loop) {
                    squad.reverse = true;
                    squad.wpIndex = wps.length - 2;
                } else {
                    squad.wpIndex = 0;
                }
            } else {
                squad.wpIndex = targetIdx + 1;
            }
            return;
        }

        const speed = (squad.speed ?? 90) * (leader.userData.maxSpeed / 140);
        const step = Math.min(dist, speed * delta);
        const nx = dx / dist;
        const nz = dz / dist;

        const nextX = leader.position.x + nx * step;
        const nextZ = leader.position.z + nz * step;
        const env = this.em.environment;
        let moveX = nextX;
        let moveZ = nextZ;
        if (env) {
            const resolved = resolveEnemyMove(
                env,
                leader.position.x, leader.position.z,
                nextX, nextZ,
                leader.position.y,
            );
            moveX = resolved.x;
            moveZ = resolved.z;
        }
        const clamped = clampPointToDisc(moveX, moveZ, WORLD_MAP.spawnClampScale);
        leader.position.x = clamped.x;
        leader.position.z = clamped.z;

        const targetYaw = Math.atan2(nx, nz);
        const curYaw = leader.userData._leaderYaw ?? leader.rotation.y;
        leader.userData._leaderYaw = lerpAngle(curYaw, targetYaw, Math.min(1, 2.0 * delta));
        leader.rotation.y = leader.userData._leaderYaw;

        squad._forward.set(Math.sin(leader.rotation.y), 0, Math.cos(leader.rotation.y));
        leader.userData.squadVel.set(nx * speed, 0, nz * speed);

        if (this.em.environment) {
            const y = this.em._hoverYFor?.(leader, leader.position.x, leader.position.z);
            if (y != null) leader.position.y += (y - leader.position.y) * 4 * delta;
        }

        leader.userData.isPatrol = false;
        leader.userData.squadRouteActive = true;
        leader.userData.squadFollow = false;

        const profile = getMovementProfile(leader.userData.type);
        const bank = leader.userData.squadVel.x * profile.bank * 0.8;
        if (leader.visualGroup) {
            leader.visualGroup.rotation.z += (bank - leader.visualGroup.rotation.z) * 0.1;
        }

        this._recordLeaderTrail(squad, leader);
    }

    _updateFormation(squad, delta) {
        const leader = squad.leader;
        if (!leader) return;

        const time = Date.now() * 0.001;
        const player = this.em.player;

        const forward = squad._forward;
        _right.set(-forward.z, 0, forward.x);
        const boxSize = squad._boxSize ?? 56;
        const minSep = boxSize * (squad.formation === 'column' ? 1.35 : 2.1);
        const useTrail = (squad.formation ?? 'column') === 'column' && squad.trail?.length > 1;

        for (const member of squad.members) {
            if (member === leader || member.userData.hp <= 0) continue;

            if (player && isEnemyEngaged(member, player, CONFIG, time)) {
                member.userData.squadFollow = false;
                member.userData.squadRouteActive = false;
                continue;
            }

            const slot = member.userData.squadSlot ?? 1;
            let trailYaw = leader.rotation.y;

            if (useTrail) {
                const sample = sampleTrailPoint(
                    squad.trail,
                    getTrailFollowDistance(slot, boxSize),
                );
                if (sample) {
                    _goal.set(sample.x, sample.y ?? leader.position.y, sample.z);
                    trailYaw = sample.yaw;
                } else {
                    const form = getFormationOffset(slot, boxSize, 'column');
                    _goal.set(
                        leader.position.x + forward.x * form.z,
                        leader.position.y,
                        leader.position.z + forward.z * form.z,
                    );
                }
            } else {
                const form = getFormationOffset(
                    slot,
                    member.userData._formationScale ?? boxSize,
                    squad.formation ?? 'column',
                );
                _goal.set(
                    leader.position.x + _right.x * form.x + forward.x * form.z,
                    leader.position.y,
                    leader.position.z + _right.z * form.x + forward.z * form.z,
                );
            }

            _toGoal.subVectors(_goal, member.position);
            _toGoal.y = 0;
            const dist = _toGoal.length();

            const playerNear = player && member.position.distanceTo(player.position) < 2800;
            const inFight = player && isEnemyEngaged(member, player, CONFIG, time);

            if (dist > 3800 && !inFight && !playerNear) {
                const safe = clampPointToDisc(_goal.x, _goal.z, WORLD_MAP.spawnClampScale);
                member.position.x = safe.x;
                member.position.z = safe.z;
                member.position.y = _goal.y ?? leader.position.y;
                member.userData.squadVel.copy(leader.userData.squadVel || _moveDir.set(0, 0, 0));
                member.userData.squadFollow = true;
                member.userData.squadRouteActive = false;
                continue;
            }

            if (dist > 3800 && (inFight || playerNear)) {
                continue;
            }

            // Si están muy lejos, meten el hiperpropulsor en lugar de teletransportarse feo
            const catchUpMult = dist > 1100 ? 5.5 : dist > 420 ? 2.8 : dist > minSep * 0.35 ? 1.35 + (slot >= 2 ? 0.12 : 0) : 1.0;
            const maxSpd = (squad.speed ?? 90) * (member.userData.maxSpeed / 140) * catchUpMult;
            if (dist > 2) {
                _toGoal.normalize();
                const step = Math.min(dist, maxSpd * delta);
                let nextX = member.position.x + _toGoal.x * step;
                let nextZ = member.position.z + _toGoal.z * step;
                const env = this.em.environment;
                if (env) {
                    const resolved = resolveEnemyMove(
                        env,
                        member.position.x, member.position.z,
                        nextX, nextZ,
                        member.position.y,
                    );
                    nextX = resolved.x;
                    nextZ = resolved.z;
                }
                const safe = clampPointToDisc(nextX, nextZ, WORLD_MAP.spawnClampScale);
                member.position.x = safe.x;
                member.position.z = safe.z;
                member.userData.squadVel.copy(_toGoal).multiplyScalar(maxSpd);
            } else {
                member.userData.squadVel.lerp(leader.userData.squadVel || _moveDir.set(0, 0, 0), 0.15);
            }

            member.position.y += (leader.position.y - member.position.y) * Math.min(1, 5.5 * delta);

            member.rotation.y = lerpAngle(member.rotation.y, trailYaw, Math.min(1, useTrail ? 2.6 * delta : 2.0 * delta));

            member.userData.isPatrol = false;
            member.userData.squadFollow = true;
            member.userData.squadRouteActive = false;

            const profile = getMovementProfile(member.userData.type);
            const spd = member.userData.squadVel.length();
            const bank = (member.userData.squadVel.x / Math.max(spd, 1)) * profile.bank * spd * 0.015;
            if (member.visualGroup) {
                member.visualGroup.rotation.z += (bank - member.visualGroup.rotation.z) * 0.12;
            }
        }

        this._separateMembers(squad, delta, minSep);
    }

    /** Separación tipo bandada — evita superposición entre compañeros. */
    _separateMembers(squad, delta, minSep) {
        const members = squad.members.filter((m) => m?.userData?.hp > 0);
        for (let i = 0; i < members.length; i++) {
            for (let j = i + 1; j < members.length; j++) {
                const a = members[i];
                const b = members[j];
                _push.subVectors(a.position, b.position);
                _push.y = 0;
                const d = _push.length();
                if (d >= minSep || d < 0.01) continue;
                _push.normalize().multiplyScalar((minSep - d) * 0.22 * delta);
                if (a !== squad.leader) {
                    a.position.x += _push.x;
                    a.position.z += _push.z;
                }
                if (b !== squad.leader) {
                    b.position.x -= _push.x;
                    b.position.z -= _push.z;
                }
            }
        }
    }

    _commanderParalyze(squad, player, time) {
        const leader = squad.leader;
        if (!leader?.userData?.isSquadLeader) return;
        const role = leader.userData.roleConfig;
        if (role?.ability !== 'paralyze_pulse') return;

        const dist = leader.position.distanceTo(player.position);
        if (dist > (role.paralyzeRange ?? 680)) return;
        if (isInHubSafeZone(player.position.x, player.position.z)) return;

        if (!leader.userData._nextParalyze) leader.userData._nextParalyze = time + 2;
        if (time < leader.userData._nextParalyze) return;
        leader.userData._nextParalyze = time + (role.paralyzeCooldown ?? 7.5);

        player.applySlow?.(role.slowMult ?? 0.32, role.paralyzeDuration ?? 3.8);
        this.em.logCombatAbility(leader, 'Pulso paralizador — ¡velocidad reducida!');
        this.em._gameRef?.vfx?.ionPulse(player.position);
        if ((this.em.combatLoadLevel ?? 'light') === 'light') {
            this.em._gameRef?.vfx?.playerSlowField?.(player, role.paralyzeDuration ?? 3.8);
        }
        this.em._gameRef?.vfx?.addShake?.(0.28);
        engageEnemy(leader, time);
        for (const member of squad.members) {
            if (member?.userData?.hp > 0 && member.userData.squadRole === 'squad_missile') {
                engageEnemy(member, time);
            }
        }
    }

    respawnSquad(squadId, environment) {
        const def = (squadData.squads || []).find((s) => s.id === squadId);
        if (!def) return;
        this.squads = this.squads.filter((s) => s.id !== squadId);
        const squad = this._spawnSquad(def, environment);
        if (squad) this.squads.push(squad);
    }

    onMemberKilled(enemy) {
        const squadId = enemy.userData?.squadId;
        if (!squadId) return;
        const squad = this.squads.find((s) => s.id === squadId);
        if (!squad) return;
        squad.members = squad.members.filter((m) => m !== enemy && m.userData?.hp > 0);
        if (squad.leader === enemy) squad.leader = null;
        if (squad.members.length === 0) {
            setTimeout(() => {
                this.respawnSquad(squadId, this.em.environment);
            }, 45000);
        }
    }
}
