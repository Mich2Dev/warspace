import { CONFIG } from '../../config.js';
import { countCombatPressure, getCombatLoadCaps, getCombatLoadLevel } from '../combatLoad.js';
import { NAME_TAG_COLOR, NAME_TAG_COLOR_HOSTILE, isEnemyHostileToPlayer } from '../enemyNames.js';
import { isEnemyEngaged } from '../enemyRoles.js';
import { projectWorldToScreen } from '../worldHud.js';
import { getEnemyHudYOffset } from '../EnemyManager.js';

/** @typedef {import('../EnemyManager.js').EnemyManager} EnemyManager */

export const enemyManagerUpdateMethods = {
    update(delta, environment) {
        if (this._mpMode === 'guest') {
            this._retryPendingSyncGhosts();
            this._refreshBrokenSyncGhosts();
            if (this._mpGuestClearPending) {
                for (const enemy of this.enemies) {
                    if (enemy.spawnType !== undefined || enemy.userData.syncGhost) continue;
                    enemy.visible = true;
                }
            }
        }

        this._processRespawnQueue();
        this._tickWorldRepop(delta);
        this._updateEnemyMissiles(delta, environment);

        const pressure = countCombatPressure(this);
        const loadLevel = getCombatLoadLevel(pressure);
        const caps = getCombatLoadCaps(loadLevel);
        this.combatPressure = pressure;
        this.combatLoadLevel = loadLevel;
        this._maxTrailParticles = caps.maxTrailParticles;
        this._maxEnemyLasers = caps.maxEnemyLasers;
        this._maxEnemyMissiles = caps.maxEnemyMissiles ?? 2;
        this._maxLiveExplosions = caps.maxLiveExplosions;
        this._engineTrailEvery = caps.engineTrailEvery;
        this._combatCaps = caps;
        window.__game?.vfx?.setCombatLoad?.(loadLevel, caps);

        const time = Date.now() * 0.001;
        this._hudTick = (this._hudTick ?? 0) + 1;
        const refreshNameTags = this._hudTick % 3 === 0;
        const SLEEP_DIST = 3600;
        const WAKE_DIST = 3000;
        const NAME_TAG_DIST = 2600; // evitar desapariciÃ³n temprana del tag
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];

            if (this._mpMode === 'guest' && !enemy.userData.syncGhost && enemy.spawnType === undefined) {
                enemy.visible = false;
                continue;
            }

            if (enemy.userData.syncGhost) {
                if ((enemy.userData.hp ?? 0) <= 0) {
                    this._removeSyncGhost(enemy.userData.syncId, enemy);
                    continue;
                }
                this._updateSyncGhost(enemy, delta);
                enemy.visible = true;

                const dist = enemy.position.distanceTo(this.player.position);
                this._updateEnemyMinimapDot(enemy, dist, time);
                if (enemy.userData.nameTag) {
                    const isTarget = this._isPlayerTarget(enemy);
                    if (refreshNameTags || isTarget) {
                        const screen = projectWorldToScreen(
                            this.player.camera,
                            enemy.position,
                            getEnemyHudYOffset(enemy),
                        );
                        if (screen && dist < NAME_TAG_DIST) {
                            const tag = enemy.userData.nameTag;
                            tag.style.left = `${screen.x}px`;
                            tag.style.top = `${screen.y}px`;
                            tag.style.display = 'block';
                            if (isTarget) {
                                tag.style.color = '#ff4444';
                                tag.style.fontSize = '14px';
                            } else {
                                tag.style.color = NAME_TAG_COLOR;
                                tag.style.fontSize = '12px';
                            }
                        } else {
                            enemy.userData.nameTag.style.display = 'none';
                        }
                    }
                }
                continue;
            }

            const dist = enemy.position.distanceTo(this.player.position);
            const wasSleeping = enemy.userData.sleeping === true;
            const sleeping = wasSleeping ? dist > WAKE_DIST : dist > SLEEP_DIST;
            enemy.userData.sleeping = sleeping;

            enemy.visible = !sleeping;

            // El minimapa muestra bases siempre; unidades móviles y patrullas en casi todo el mapa
            this._updateEnemyMinimapDot(enemy, dist, time);

            if (!sleeping) {
                enemy.update(delta, environment, this.player, time, this.enemies);

                if (enemy.userData.nameTag) {
                    const mobile = document.body.classList.contains('layout-mobile');
                    const isTarget = this._isPlayerTarget(enemy);
                    if (mobile) {
                        enemy.userData.nameTag.style.display = 'none';
                    } else if (dist < NAME_TAG_DIST && enemy.userData.hp > 0 && (refreshNameTags || isTarget)) {
                        const screen = projectWorldToScreen(
                            this.player.camera,
                            enemy.position,
                            getEnemyHudYOffset(enemy),
                        );

                        if (screen) {
                            const tag = enemy.userData.nameTag;
                            tag.style.left = `${screen.x}px`;
                            tag.style.top = `${screen.y}px`;
                            tag.style.display = 'block';
                            if (isTarget) {
                                tag.style.color = '#ff4444';
                                tag.style.fontSize = '14px';
                            } else {
                                const hostile = isEnemyHostileToPlayer(enemy, this.player, CONFIG);
                                tag.style.color = hostile ? NAME_TAG_COLOR_HOSTILE : NAME_TAG_COLOR;
                                tag.style.fontSize = '12px';
                            }
                        } else {
                            enemy.userData.nameTag.style.display = 'none';
                        }
                    } else if (dist >= NAME_TAG_DIST || enemy.userData.hp <= 0) {
                        enemy.userData.nameTag.style.display = 'none';
                    }
                }
            } else if (enemy.spawnType !== undefined) {
                const spawnerActive = dist < 5200
                    || (enemy.spawnedUnits?.some((u) => {
                        if ((u.userData?.hp ?? 0) <= 0) return false;
                        return u.position.distanceTo(this.player.position) < 4200;
                    }));
                if (spawnerActive) {
                    enemy.update(delta, environment, this.player, time);
                }
            } else if (enemy.userData.nameTag) {
                enemy.userData.nameTag.style.display = 'none';
            }
        }

        this._updateAggressorHighlights(time);
        this.updateEnemyLasers(delta, environment);
        this.updateExplosions(delta);
        this._updateDisruptorJam(time);

        this._patrolTick = (this._patrolTick ?? 0) + 1;
        const skipPatrol = this.combatLoadLevel === 'heavy' && this._patrolTick % 2 === 0;
        if (!skipPatrol) this.patrolSquads.update(delta, this.player);
    },

    /** Repone colmenas y trenes si el mapa queda vacío — evita mundo muerto. */
    _tickWorldRepop(delta) {
        if (this._mpMode === 'guest') return;
        if (this.combatLoadLevel !== 'light' || (this.combatPressure ?? 0) > 4) return;

        this._repopTimer = (this._repopTimer ?? 0) + delta;
        if (this._repopTimer < 25) return;
        this._repopTimer = 0;

        const player = this.player;
        const time = Date.now() * 0.001;
        const playerInFight = player && this.enemies.some((e) => {
            if ((e.userData?.hp ?? 0) <= 0) return false;
            if (e.spawnType !== undefined) return false;
            return isEnemyEngaged(e, player, CONFIG, time);
        });
        if (playerInFight) return;

        this._bootstrapHostEnemies?.();
        this._checkAndSpawnWorldBoss?.();

        const patrolMgr = this.patrolSquads;
        if (!patrolMgr) return;

        const trainAlive = (patrolMgr.squads || []).reduce((sum, s) => (
            sum + (s.members?.filter((m) => (m?.userData?.hp ?? 0) > 0).length ?? 0)
        ), 0);

        const roaming = this.enemies.filter(
            (e) => e.spawnType === undefined
                && !e.userData?.isSquadMember
                && !e.userData?.syncGhost
                && (e.userData?.hp ?? 0) > 0,
        ).length;

        const totalMobile = trainAlive + roaming;
        const wasSparse = this._worldWasSparse === true;
        const isSparse = totalMobile < 8;
        this._worldWasSparse = isSparse;

        let repopAction = null;

        if (trainAlive === 0 && !playerInFight) {
            patrolMgr.despawnAll?.();
            patrolMgr.trySpawn(this.environment);
            repopAction = 'trains';
        }


        if (totalMobile < 8 && !playerInFight) {
            this._gameRef?.worldDirector?.spawnPatrols(this.environment);
        }

        this._worldPressureLog(isSparse, wasSparse, repopAction, trainAlive);
    },

    _worldPressureLog(isSparse, wasSparse, repopAction, trainAlive) {
        const log = document.getElementById('log-text');
        if (!log) return;

        if (isSparse && !wasSparse) {
            log.innerHTML = '<span style="color:#8899aa;">Fronteras en calma — las facciones envían refuerzos…</span>';
            return;
        }

        if (!isSparse && wasSparse) {
            log.innerHTML = '<span style="color:#ffaa66;">Actividad hostil detectada — patrullas y colmenas activas.</span>';
            return;
        }

        if (repopAction && trainAlive > 0) {
            const n = this.patrolSquads?.squads?.length ?? 3;
            log.innerHTML = `<span style="color:#ff9966;">📡 Tren de patrulla reconstituido — ${n} corredor${n > 1 ? 'es' : ''} en ruta</span>`;
        }
    },
};
