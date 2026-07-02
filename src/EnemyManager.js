import * as THREE from 'three';
import { PatrolSquadManager } from './patrols/PatrolSquadManager.js';
import { bindEnemyManagerSystems } from './enemies/bindEnemyManagerSystems.js';
import { ZONE_META } from './enemies/zoneMeta.js';

export { ZONE_META } from './enemies/zoneMeta.js';

export function getEnemyHudYOffset(enemy) {
    if (!enemy) return 66;
    let nameOffset = ZONE_META[enemy.userData?.type]?.nameOffset ?? 60;
    if (enemy.spawnType) nameOffset = 180;
    return nameOffset + 6;
}

/**
 * Orquestador de enemigos — lógica en módulos bajo src/enemies/.
 * @see EnemySpawner, EnemyCombat, EnemyManagerMultiplayer, EnemyManagerModels, …
 */
export class EnemyManager {
    constructor(scene, player, gltfLoader) {
        this.scene = scene;
        this.player = player;
        this.gltfLoader = gltfLoader;
        this.enemies = [];
        this.enemyLasers = [];
        this.explosions = [];

        this.trailParticles = [];
        this.particlePool = [];
        this.particleGeo = new THREE.PlaneGeometry(3.0, 3.0);
        this.particleMats = {};

        this.raycasterDown = new THREE.Raycaster();
        this.raycasterDown.ray.direction.set(0, -1, 0);

        this._modelsReady = { e1: false, e2: false, e3: false, patrolCmd: false, patrolEscort: false, patrolDroid: false };
        this._patrolQueue = [];
        this._spawnedPatrolKeys = new Set();
        this.environment = null;
        this._mpMode = 'solo';
        this._remoteCombatTargets = [];
        this._syncGhosts = new Map();
        this._syncGhostMissCount = new Map();
        this._combatSync = null;
        this._nearestCombatPos = new THREE.Vector3();
        this._pendingSyncData = new Map();
        this._guestDamageAt = new Map();
        this._mpGuestClearPending = false;
        this._gameRef = null;
        this._vfx = null;
        this._respawnQueue = [];
        this._enemyMissiles = [];
        this._maxEnemyMissiles = 2;
        this._maxEnemyLasers = 24;
        this._maxTrailParticles = 28;
        this._missilePool = [];
        this._missilePoolMax = 6;
        this._combatLogUntil = 0;
        this._missileSteer = new THREE.Vector3();
        this._missileVelDir = new THREE.Vector3();
        this._missileBodyGeo = new THREE.CylinderGeometry(1.1, 1.6, 8, 4);
        this._missileBodyMat = new THREE.MeshBasicMaterial({ color: 0xff5533 });
        this._missileThreat = null;
        this._aggressorSet = new Set();
        this._hudTick = 0;
        this.combatPressure = 0;
        this.combatLoadLevel = 'light';
        this._combatCaps = null;
        this._engineTrailEvery = 5;
        this._laserQuatDir = new THREE.Vector3();
        this._floatTextActive = 0;

        this.patrolSquads = new PatrolSquadManager(this);
        bindEnemyManagerSystems(this);

        this.initBaseModels();
        this.initStandardSpawners();

        if (this.gltfLoader) {
            this.loadGLTFModels();
        }
    }

    setEnvironment(environment) {
        this.environment = environment;
        this._snapSpawnerHeights();
    }

    setGameRef(game) {
        this._gameRef = game;
    }

    setVfx(vfx) {
        this._vfx = vfx;
    }
}
