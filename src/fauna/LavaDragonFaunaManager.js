import * as THREE from 'three';
import { TerrainBuilder } from '../planet/TerrainBuilder.js';
import { LavaDragon } from './LavaDragon.js';
import { LavaBreathVFX, BREATH_DURATION } from './LavaBreathVFX.js';

const STATES = {
  WANDER: 'wander',
  IDLE: 'idle',
  NOTICE: 'notice',
  APPROACH: 'approach',
  FLEE: 'flee',
  THREAT: 'threat',
  SEEK_LAVA: 'seek_lava',
  DIVE: 'dive',
  SUBMERGED: 'submerged',
  EMERGE: 'emerge'
};

const SPLASH_COUNT = 56;
const AIM_DOT = 0.55;
const AIM_DOT_SPIT = 0.42;
const SPLASH_GRAVITY = 980;
const PLAYER_SURFACE_ALT = 720;
const MAX_SLOPE = 0.95;
const ATTACK_HIT_AT = 0.48;
const ATTACK_TELEGRAPH_AT = 0.28;
const SPIT_FIRE_AT = 0.28;
const SPIT_MIN_RANGE = 3200;
const WORM_MAX_HP = 100;

/**
 * Dragón de lava en Mercurio: peso, magma, Attack/Spit con rango real.
 */
export class PlanetLavaDragon {
  /**
   * @param {THREE.Group} planetGroup
   * @param {number} planetRadius
   * @param {string} biome
   * @param {{ seed?: number, targetLength?: number }} [opts]
   */
  constructor(planetGroup, planetRadius, biome, opts = {}) {
    this.planetGroup = planetGroup;
    this.planetRadius = planetRadius;
    this.biome = biome || 'Lava';
    this.seed = opts.seed ?? Math.random() * 1000;
    this.targetLength = opts.targetLength ?? 1400;

    this.dragon = new LavaDragon({ targetLength: this.targetLength });
    this.root = this.dragon.getObject3D();
    this.root.frustumCulled = false;
    planetGroup.add(this.root);

    const L = this.targetLength;
    // Mordisco solo a alcance real del hocico; spit desde ~3000 m
    this._attackRange = L * 0.48;
    this._biteReach = L * 0.44;
    this._spitRange = Math.max(SPIT_MIN_RANGE, L * 2.05);
    this._awareNear = Math.max(2200, L * 1.4);
    this._awareMid = Math.max(3600, L * 2.5);
    this._awareFar = Math.max(5200, L * 3.6);
    this._patrolMin = 700;
    this._patrolMax = 2600;

    this.baseSpeed = 150;
    this.heading = this.seed * 1.3;
    this.active = true;
    this._placed = false;
    this._visible = true;

    this._state = STATES.WANDER;
    this._stateT = 3 + (this.seed % 4);
    this._mood = this.seed * 0.17;
    this._interest = 0;
    this._speedMul = 0.55;
    this._turnBias = 0;
    this._lavaBlockedTime = 0;
    this._stuckTime = 0;
    this._lastPos = new THREE.Vector3();
    this._diveCooldown = 8 + Math.random() * 6;

    // Vida / necesidades (cura en magma, se gasta combatiendo)
    this.maxHp = WORM_MAX_HP;
    this.hp = this.maxHp;
    this._needHeat = 0;     // ganas de lava 0..1
    this._huntUrge = 0;     // ganas de cazar
    this._restUrge = 0.2;   // merodear / idle
    this._caution = 0;      // retirarse a curar
    this._whim = this.seed * 0.31; // ruido orgánico de personalidad
    this._soakT = 0;        // tiempo remojándose en superficie lava

    this._vert = 0;
    this._vertVel = 0;
    this._grounded = true;
    this._subT = 0;
    this._diveProgress = 0;
    this._emergeProgress = 0;
    this._emergeDir = new THREE.Vector3(0, 1, 0);
    this._lavaTarget = new THREE.Vector3(0, 1, 0);
    this._weightBob = 0;
    this._threatCool = 0;
    this._threatFired = false;
    this._pendingSpit = false;
    this._pendingAttack = false;
    this._attackLunged = false;
    this._attackTelegraph = false;
    this._spitFired = false;
    this._aimRight = new THREE.Vector3();
    this._aimUp = new THREE.Vector3();
    this._emergeSplashed = false;
    this._diveSplashed = false;
    this._lairDir = new THREE.Vector3(0, 1, 0);
    this._patrolGoal = new THREE.Vector3(0, 1, 0);
    this._hasPatrolGoal = false;
    this._projTrailDummy = new THREE.Object3D();

    this._up = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._toCam = new THREE.Vector3();
    this._mat = new THREE.Matrix4();
    this._targetQ = new THREE.Quaternion();
    this._moved = new THREE.Vector3();
    this._axis = new THREE.Vector3();
    this._headDir = new THREE.Vector3(0, 1, 0);
    this._goalDir = new THREE.Vector3();
    this._headPos = new THREE.Vector3();
    this._yAxis = new THREE.Vector3(0, 1, 0);

    this._clearance = 6;
    this._prevHeading = this.heading;
    this._turnRate = 0;
    this._headingTrail = [];
    this._TRAIL_MAX = 48;

    this._splash = this._makeSplash();
    planetGroup.add(this._splash);
    // Mismo VFX que spit_preview.html
    this._breath = new LavaBreathVFX(planetGroup, {
      logDepth: true,
      baseSize: 64,
      up: new THREE.Vector3(0, 1, 0)
    });
    this._breathTarget = new THREE.Vector3();
    this._breathWasEmitting = false;
    this.onPlayerHit = null; // (amount, kind) => void

    this.dragon.whenReady().then(() => {
      this._clearance = this.dragon.bellyClearance;
      if (this._placed) this._snapToSurface(this._headDir);
    });
  }

  _notifyHit(amount, kind = 'bite') {
    if (typeof this.onPlayerHit === 'function') this.onPlayerHit(amount, kind);
  }

  /** Calor del suelo bajo una dirección (0..1). */
  _lavaHeat(dir) {
    return TerrainBuilder.getLavaIntensity(dir, this.planetRadius, this.biome);
  }

  _wound(amount) {
    this.hp = Math.max(0, this.hp - amount);
  }

  /**
   * Regeneración en magma. rateMul: 1 sumergido, ~0.35 caminando por charco.
   */
  _healInLava(dt, rateMul = 1) {
    if (this.hp >= this.maxHp) return;
    const heat = this._lavaHeat(this._headDir);
    if (heat < 0.08) return;
    const pps = (10 + heat * 28) * rateMul; // ~10–38 HP/s sumergido
    this.hp = Math.min(this.maxHp, this.hp + pps * dt);
  }

  /** Impulsos actuales según entorno + estado del cuerpo. */
  _updateDrives(dt, dist, onSurface) {
    this._whim += dt * (0.35 + 0.25 * Math.sin(this._mood * 0.27 + this.seed));
    const hurt = 1 - this.hp / this.maxHp;
    const near = onSurface && dist < this._awareFar;
    const close = onSurface && dist < this._awareNear;

    // Siempre le gusta el magma un poco; herido lo necesita
    const baskWhim = 0.08 + 0.12 * (0.5 + 0.5 * Math.sin(this._whim));
    this._needHeat = THREE.MathUtils.damp(
      this._needHeat,
      Math.min(1, hurt * 1.15 + baskWhim * (1 - this._interest * 0.5)),
      1.2,
      dt
    );

    const huntTarget = near
      ? THREE.MathUtils.clamp(this._interest * (0.35 + 0.65 * (this.hp / this.maxHp)), 0, 1)
      : 0.05 * Math.max(0, Math.sin(this._whim * 0.7));
    this._huntUrge = THREE.MathUtils.damp(this._huntUrge, huntTarget, 1.5, dt);

    this._caution = THREE.MathUtils.damp(
      this._caution,
      close && hurt > 0.4 ? hurt * this._interest : hurt * 0.25,
      1.8,
      dt
    );

    const restTarget = (1 - this._interest) * (0.25 + 0.35 * (0.5 + 0.5 * Math.sin(this._mood * 0.4)))
      + (hurt < 0.15 ? 0.15 : 0);
    this._restUrge = THREE.MathUtils.damp(this._restUrge, restTarget, 1.1, dt);
  }

  _makeSplash() {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(SPLASH_COUNT * 3);
    const sizes = new Float32Array(SPLASH_COUNT);
    for (let i = 0; i < SPLASH_COUNT; i++) sizes[i] = 12 + Math.random() * 28;
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,200,120,1)');
    g.addColorStop(0.25, 'rgba(255,100,40,0.75)');
    g.addColorStop(0.55, 'rgba(180,40,10,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);

    const mat = new THREE.PointsMaterial({
      map: tex,
      color: 0xff8844,
      size: 22,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });
    const pts = new THREE.Points(geo, mat);
    pts.visible = false;
    pts.frustumCulled = false;
    pts.userData = {
      life: 0,
      vel: Array.from({ length: SPLASH_COUNT }, () => new THREE.Vector3()),
      active: false
    };
    return pts;
  }

  /**
   * Rocío de magma en un punto de contacto (no en el centro del planeta).
   * @param {THREE.Vector3} dir radial / normal de superficie
   * @param {number} [power]
   * @param {THREE.Vector3} [atLocal] posición local opcional (hocico / cuerpo)
   */
  _triggerSplash(dir, power = 1, atLocal = null) {
    const n = this._tmp.copy(dir).normalize();
    const h = this._height(n);
    if (atLocal) {
      this._splash.position.copy(atLocal);
    } else {
      this._splash.position.copy(n).multiplyScalar(h + 6);
    }
    this._splash.quaternion.setFromUnitVectors(this._yAxis, n);

    const arr = this._splash.geometry.attributes.position.array;
    const ud = this._splash.userData;
    const p = THREE.MathUtils.clamp(power, 0.4, 1.6);

    for (let i = 0; i < ud.vel.length; i++) {
      const a = Math.random() * Math.PI * 2;
      const cone = 0.35 + Math.random() * 0.65;
      const r0 = (8 + Math.random() * 40) * p;
      arr[i * 3] = Math.cos(a) * r0 * 0.35;
      arr[i * 3 + 1] = 2 + Math.random() * 10;
      arr[i * 3 + 2] = Math.sin(a) * r0 * 0.35;

      const upSpeed = (160 + Math.random() * 320) * p;
      const side = (70 + Math.random() * 220) * p * cone;
      ud.vel[i].set(
        Math.cos(a) * side,
        upSpeed,
        Math.sin(a) * side
      );
    }

    this._splash.geometry.attributes.position.needsUpdate = true;
    this._splash.material.opacity = 0.95;
    this._splash.material.color.setHex(0xff6622);
    this._splash.material.size = 22 + 18 * p;
    ud.life = 0.7 + 0.35 * p;
    ud.active = true;
    this._splash.visible = true;
  }

  _updateSplash(dt) {
    const ud = this._splash.userData;
    if (!ud.active) return;
    ud.life -= dt;
    const arr = this._splash.geometry.attributes.position.array;
    for (let i = 0; i < ud.vel.length; i++) {
      ud.vel[i].y -= SPLASH_GRAVITY * dt;
      arr[i * 3] += ud.vel[i].x * dt;
      arr[i * 3 + 1] += ud.vel[i].y * dt;
      arr[i * 3 + 2] += ud.vel[i].z * dt;
    }
    this._splash.geometry.attributes.position.needsUpdate = true;
    const life01 = Math.max(0, ud.life);
    this._splash.material.opacity = Math.min(0.9, life01 * 1.4);
    this._splash.material.size = Math.max(8, this._splash.material.size * (1 - dt * 0.35));
    if (ud.life <= 0) {
      ud.active = false;
      this._splash.visible = false;
    }
  }

  /**
   * Boca = misma calibración que spit_preview (getMuzzleLocal + localStorage).
   * Sin empujones extra hacia el jugador (eso sacaba el fuego a un lado en el planeta).
   * @param {THREE.Vector3} [out]
   * @param {THREE.Vector3} [towardLocal]
   */
  _muzzlePlanetLocal(out = this._headPos, towardLocal = null) {
    this.root.updateWorldMatrix(true, false);

    if (this.dragon.ready) {
      this.dragon.getMuzzleLocal(this._tmp);
      this.root.localToWorld(this._tmp);
      this.planetGroup.worldToLocal(this._tmp);
      out.copy(this._tmp);
    } else {
      const ahead = towardLocal
        ? this._moved.copy(towardLocal).sub(this.root.position).normalize()
        : this._look;
      const ht = (this.dragon.height || this.targetLength * 0.35) * 0.28;
      out.copy(this.root.position)
        .addScaledVector(ahead, this.targetLength * 0.42)
        .addScaledVector(this._up, ht);
    }

    // Solo evita enterrar el spawn bajo el terreno
    const rad = out.length();
    if (rad > 1e-3) {
      this._tmp.copy(out).multiplyScalar(1 / rad);
      const minH = this._height(this._tmp) + 20;
      if (rad < minH) out.copy(this._tmp).multiplyScalar(minH);
    }
    return out;
  }

  /**
   * Chorro de magma boca→jugador (mismo LavaBreathVFX que spit_preview).
   * @param {THREE.Vector3} targetLocal
   */
  _spawnProjectile(targetLocal) {
    this.dragon._loadMuzzleCalib();
    this._breathTarget.copy(targetLocal);
    this._breath.setUp(this._up);
    this._breath.start();
    this._breathWasEmitting = true;
    const muzzle = this._muzzlePlanetLocal(this._headPos, this._breathTarget);
    this._triggerSplash(this._headDir, 0.32, muzzle);
  }

  _updateProjectiles(dt, camLocal = null) {
    const b = this._breath;
    if (!b) return;

    b.setUp(this._up);

    if (camLocal && (b.emitting || b.alive > 0 || this._spitFired)) {
      this._playerAimPoint(camLocal, this._breathTarget);
    }

    // Emitir antes de update: las partículas nuevas se mueven el mismo frame (como preview)
    if (b.emitting) {
      const muzzle = this._muzzlePlanetLocal(this._headPos, this._breathTarget);
      this._moved.copy(this._breathTarget).sub(muzzle);
      let dist = this._moved.length();
      if (dist < 80) {
        this._moved.copy(this._look);
        dist = Math.max(280, this._spitRange * 0.5);
      } else {
        this._moved.multiplyScalar(1 / dist);
      }
      const aim = this._moved;

      const u = b.breathT / Math.max(1e-4, b.breathDur);
      const intensity = u < 0.1
        ? u / 0.1
        : (u > 0.8 ? Math.max(0, 1 - (u - 0.8) / 0.2) : 1);

      b.emitFrame(muzzle, aim, dist, intensity);

      if ((b.breathT * 10 | 0) !== ((b.breathT - dt) * 10 | 0)) {
        this._triggerSplash(this._headDir, 0.2 + intensity * 0.12, muzzle);
      }
    }

    const wasEmitting = this._breathWasEmitting;
    b.update(dt, {
      target: this._breathTarget,
      killNear: 180,
      fadeNear: 450,
      hitRadius: 220,
      onHit: () => {
        this._notifyHit(12, 'lava');
        this._wound(4);
        this._triggerSplash(this._tmp2.copy(this._breathTarget).normalize(), 0.4, this._breathTarget);
      }
    });

    if (b.emitting) this._breathWasEmitting = true;
    else if (wasEmitting) {
      this.dragon.releaseSpit();
      this._breathWasEmitting = false;
    }
  }

  _isBreathing() {
    return !!(this._breath && this._breath.isEmitting);
  }



  _height(dir) {
    return TerrainBuilder.getHeight(dir, this.planetRadius, this.biome, false);
  }

  _isRock(dir) {
    return this._height(dir) - this.planetRadius > -40;
  }

  _isLava(dir) {
    return this._lavaHeat(dir) >= 0.35 || this._height(dir) - this.planetRadius <= -40;
  }

  /** Roca caminable: no lava y pendiente razonable desde `from`. */
  _isWalkable(dir, from = null) {
    if (!this._isRock(dir)) return false;
    if (!from) return true;
    const horiz = from.angleTo(dir) * this.planetRadius;
    if (horiz < 2) return true;
    const slope = Math.abs(this._height(dir) - this._height(from)) / horiz;
    return slope <= MAX_SLOPE;
  }

  /**
   * Info del jugador relativa a la serpiente.
   * Evita combate si está en órbita / muy alto aunque el arco horizontal sea corto.
   */
  _playerSense(camLocal) {
    if (!camLocal) {
      return { dist: Infinity, alt: Infinity, onSurface: false };
    }
    this._toCam.copy(camLocal).sub(this.root.position);
    this._toCam.addScaledVector(this._up, -this._toCam.dot(this._up));
    const dist = this._toCam.length();
    const pdir = camLocal.clone().normalize();
    const alt = camLocal.length() - this._height(pdir);
    const onSurface = alt < PLAYER_SURFACE_ALT && alt > -120;
    return { dist, alt, onSurface };
  }

  /** Elige un punto de merodeo en roca alrededor de la guarida. */
  _pickPatrolGoal() {
    const home = this._lairDir.lengthSq() > 0.5 ? this._lairDir : this._headDir;
    this._up.copy(home).normalize();
    this._buildTangent();
    const R = this.planetRadius;
    for (let i = 0; i < 28; i++) {
      const ang = this.seed * 0.7 + i * 1.9 + this._mood * 0.15;
      const dist = this._patrolMin + Math.random() * (this._patrolMax - this._patrolMin);
      const arc = dist / R;
      const dir = home.clone().normalize()
        .addScaledVector(this._fwd, Math.cos(ang) * arc)
        .addScaledVector(this._right, Math.sin(ang) * arc)
        .normalize();
      if (this._isWalkable(dir, home)) {
        this._patrolGoal.copy(dir);
        this._hasPatrolGoal = true;
        return true;
      }
    }
    const rock = this._findRockNear(this._headDir, 40);
    if (rock) {
      this._patrolGoal.copy(rock);
      this._hasPatrolGoal = true;
      return true;
    }
    this._hasPatrolGoal = false;
    return false;
  }

  /** Mejor paso hacia delante evitando lava y acantilados. */
  _bestStep(look, stepArc) {
    const offsets = [0, 0.28, -0.28, 0.55, -0.55, 0.9, -0.9, 1.3, -1.3];
    for (const o of offsets) {
      const ang = this.heading + o;
      const hx = Math.sin(ang);
      const hz = Math.cos(ang);
      const tryLook = this._tmp.copy(this._fwd).multiplyScalar(hz).addScaledVector(this._right, hx).normalize();
      // Mirar 1 paso y medio paso
      for (const mul of [1, 0.55, 1.45]) {
        const probe = this._moved
          .copy(this._headDir)
          .addScaledVector(tryLook, stepArc * mul)
          .normalize();
        if (this._isWalkable(probe, this._headDir)) {
          return { probe: probe.clone(), look: tryLook.clone(), heading: ang };
        }
      }
    }
    return null;
  }

  /**
   * @param {THREE.Vector3} localDir
   * @returns {boolean}
   */
  placeOnSurface(localDir) {
    const dir = localDir.clone().normalize();
    if (!this._isRock(dir)) return false;
    this._headDir.copy(dir);
    this._goalDir.copy(dir);
    this._lairDir.copy(dir);
    this._placed = true;
    this._vert = 0;
    this._vertVel = 0;
    this._grounded = true;
    this._up.copy(dir);
    this._buildTangent();
    this._orientRoot(this._fwd, 0);
    this._snapToSurface(dir);
    this._lastPos.copy(this.root.position);
    this._seedNearbyLair();
    this._pickPatrolGoal();
    this._enter(STATES.WANDER, 6 + Math.random() * 6);
    return true;
  }

  _seedNearbyLair() {
    this._lairDir.copy(this._headDir);
    const lava = this._findLavaNear(this._headDir, 36, 0.008, 0.05);
    if (lava) {
      this._lavaTarget.copy(lava);
      const out = this._findLavaNear(lava, 40, 0.02, 0.08) || lava;
      this._emergeDir.copy(out);
    }
  }

  _snapToSurface(dir) {
    const h = this._height(dir);
    this.root.position.copy(dir).multiplyScalar(h + this._clearance + this._vert);
  }

  _buildTangent() {
    const axis = Math.abs(this._up.y) > 0.85
      ? this._axis.set(1, 0, 0)
      : this._axis.set(0, 1, 0);
    this._right.crossVectors(axis, this._up).normalize();
    this._fwd.crossVectors(this._up, this._right).normalize();
  }

  _orientRoot(lookDir, dt = 0) {
    this._look.copy(lookDir).normalize();
    this._right.crossVectors(this._up, this._look);
    if (this._right.lengthSq() < 1e-8) {
      this._right.set(1, 0, 0).cross(this._up).normalize();
    } else {
      this._right.normalize();
    }
    this._fwd.copy(this._look);
    this._mat.makeBasis(this._right, this._up, this._look);
    this._targetQ.setFromRotationMatrix(this._mat);
    if (dt > 0) {
      this.root.quaternion.slerp(this._targetQ, 1 - Math.exp(-1.35 * dt));
    } else {
      this.root.quaternion.copy(this._targetQ);
    }
  }

  _enter(state, duration) {
    this._state = state;
    this._stateT = duration;

    if (state === STATES.IDLE) {
      this.dragon.setIntent('idle');
      this._speedMul = 0;
      this._grounded = true;
    } else if (state === STATES.NOTICE) {
      this.dragon.setIntent('idle');
      this._speedMul = 0.05;
    } else if (state === STATES.THREAT) {
      this.dragon.setIntent('idle');
      this._speedMul = 0;
      this._threatCool = 0.55;
      this._threatFired = false;
      this._pendingSpit = false;
      this._pendingAttack = false;
      this._attackLunged = false;
      this._attackTelegraph = false;
      this._spitFired = false;
    } else if (state === STATES.FLEE) {
      this.dragon.setIntent('move');
      this._speedMul = 1.25;
    } else if (state === STATES.APPROACH) {
      this.dragon.setIntent('move');
      this._speedMul = 0.7;
    } else if (state === STATES.SEEK_LAVA) {
      this.dragon.setIntent('move');
      this._speedMul = 0.85;
      if (!this._findAndSetLavaTarget()) {
        this._enter(STATES.WANDER, 4);
      }
    } else if (state === STATES.DIVE) {
      this.dragon.setIntent('burrow');
      this._speedMul = 0.2;
      this._vertVel = 0;
      this._vert = 0;
      this._diveProgress = 0;
      this._diveSplashed = false;
      this._grounded = false;
    } else if (state === STATES.SUBMERGED) {
      this.dragon.setIntent('burrow');
      this._speedMul = 0;
      // Se queda bajo el magma hasta curarse (o un capricho de salir)
      const hurt = 1 - this.hp / this.maxHp;
      this._subT = 1.4 + hurt * 3.8 + Math.random() * 0.8;
      this.root.visible = false;
      this._vert = -this.dragon.height * 0.8;
      const out = this._findHottestLavaNear(this._lavaTarget, 50, 0.02, 0.1)
        || this._findHottestLavaNear(this._headDir, 50, 0.015, 0.08)
        || this._lavaTarget.clone();
      this._emergeDir.copy(out);
    } else if (state === STATES.EMERGE) {
      const shore = this._findShoreNear(this._emergeDir) || this._findShoreNear(this._lavaTarget);
      if (shore) this._emergeDir.copy(shore);
      else {
        const rock = this._findRockNear(this._headDir, 40);
        if (rock) this._emergeDir.copy(rock);
      }

      this.root.visible = this._visible;
      this._headDir.copy(this._emergeDir);
      this._emergeProgress = 0;
      this._vert = -Math.max(80, this.dragon.height * 0.45);
      this._vertVel = 0;
      this._grounded = false;
      this.dragon.setIntent('emerge');
      this._speedMul = 0.05;
      this._up.copy(this._headDir);
      this._buildTangent();
      this._orientRoot(this._fwd, 0);
      this._snapToSurface(this._headDir);
      this._emergeSplashed = false;
      // Herido vuelve antes al magma; sano se toma su tiempo
      const hurt = 1 - this.hp / this.maxHp;
      this._diveCooldown = (10 + Math.random() * 8) * (1 - hurt * 0.65);
    } else {
      this.dragon.setIntent('move');
      this._speedMul = 0.5 + Math.random() * 0.35;
      if (!this._hasPatrolGoal) this._pickPatrolGoal();
    }
  }

  _findAndSetLavaTarget() {
    const lava = this._findHottestLavaNear(this._headDir, 56, 0.005, 0.075);
    if (!lava) return false;
    this._lavaTarget.copy(lava);
    return true;
  }

  _findLavaNear(from, tries, minArc, maxArc) {
    return this._findHottestLavaNear(from, tries, minArc, maxArc, 0.08);
  }

  /** Busca el charco más caliente cerca (consciente del entorno). */
  _findHottestLavaNear(from, tries, minArc, maxArc, minHeat = 0.12) {
    this._up.copy(from).normalize();
    this._buildTangent();
    let best = null;
    let bestHeat = minHeat;
    for (let i = 0; i < tries; i++) {
      const ang = this.seed + i * 1.7 + i * i * 0.05 + this._whim * 0.3;
      const arc = minArc + (maxArc - minArc) * ((i % 7) / 6);
      const dir = from.clone().normalize()
        .addScaledVector(this._fwd, Math.cos(ang) * arc)
        .addScaledVector(this._right, Math.sin(ang) * arc)
        .normalize();
      const heat = this._lavaHeat(dir);
      if (heat > bestHeat) {
        bestHeat = heat;
        best = dir;
      }
    }
    return best;
  }

  _findShoreNear(lavaDir) {
    this._up.copy(lavaDir);
    this._buildTangent();
    for (let i = 0; i < 36; i++) {
      const ang = i * 0.4;
      const arc = 0.003 + (i % 6) * 0.0018;
      const dir = lavaDir.clone()
        .addScaledVector(this._fwd, Math.cos(ang) * arc)
        .addScaledVector(this._right, Math.sin(ang) * arc)
        .normalize();
      if (this._isRock(dir)) return dir;
    }
    return null;
  }

  _findRockNear(from, tries = 30) {
    this._up.copy(from).normalize();
    this._buildTangent();
    for (let i = 0; i < tries; i++) {
      const ang = this.seed + i * 1.1;
      const arc = 0.004 + (i % 8) * 0.003;
      const dir = from.clone().normalize()
        .addScaledVector(this._fwd, Math.cos(ang) * arc)
        .addScaledVector(this._right, Math.sin(ang) * arc)
        .normalize();
      if (this._isRock(dir)) return dir;
    }
    return from.clone().normalize();
  }

  update(dt, camLocal = null) {
    if (!this.active || !this._placed) return;

    this._updateSplash(dt);
    this._diveCooldown = Math.max(0, this._diveCooldown - dt);
    this._threatCool = Math.max(0, this._threatCool - dt);

    // Failsafe: never stay underground outside dive sequence
    if (this._vert < -this.dragon.height * 0.9
      && this._state !== STATES.DIVE
      && this._state !== STATES.SUBMERGED
      && this._state !== STATES.EMERGE) {
      this._enter(STATES.EMERGE, 4);
    }

    if (this._state === STATES.SUBMERGED) {
      this._healInLava(dt, 1.15);
      this._subT -= dt;
      // Deriva lenta hacia magma más caliente (nadando bajo tierra)
      if (Math.random() < 0.04) {
        const hotter = this._findHottestLavaNear(this._headDir, 18, 0.004, 0.03, 0.2);
        if (hotter) this._headDir.lerp(hotter, 0.35).normalize();
      } else {
        this._headDir.addScaledVector(this._lavaTarget, 0.002).normalize();
      }
      this.dragon.update(dt, 0.2, 0, { lockLocomotion: true });
      this._updateProjectiles(dt, camLocal);
      const finished = this.dragon.consumeFinished();
      const healedEnough = this.hp >= this.maxHp * 0.92 && this._subT < 1.2;
      const whimLeave = this.hp > this.maxHp * 0.7 && Math.sin(this._whim * 2.1) > 0.85 && this._subT < 0.8;
      if (this._subT <= 0 || healedEnough || whimLeave || finished === 'Burrow' || finished === 'JumpArc') {
        this._enter(STATES.EMERGE, 4);
      }
      return;
    }

    if (!this._visible && this._state !== STATES.EMERGE) {
      if (this.dragon.ready) this.dragon.update(dt, 0);
      this._updateProjectiles(dt, camLocal);
      return;
    }

    this._mood += dt;
    this._stateT -= dt;

    this._up.copy(this._headDir);
    this._buildTangent();

    let dist = Infinity;
    let onSurface = false;
    if (camLocal) {
      const sense = this._playerSense(camLocal);
      dist = sense.dist;
      onSurface = sense.onSurface;
    }

    this._updateDrives(dt, dist, onSurface);

    // Remojarse / curar si ya pisa magma (busca charco o cruza costa)
    const footHeat = this._lavaHeat(this._headDir);
    if (footHeat > 0.12 && this._state !== STATES.DIVE && this._state !== STATES.EMERGE) {
      this._healInLava(dt, 0.4 + footHeat * 0.35);
      this._soakT += dt;
    } else {
      this._soakT = Math.max(0, this._soakT - dt * 0.5);
    }

    // Combate gasta al gusano (por eso busca lava después)
    if (this._state === STATES.THREAT || this._pendingSpit || this._pendingAttack) {
      this._wound((1.8 + this._interest * 1.2) * dt);
    }

    if (this._state === STATES.DIVE) {
      this._updateDive(dt);
      this._updateProjectiles(dt, camLocal);
      return;
    }
    if (this._state === STATES.EMERGE) {
      this._updateEmerge(dt);
      this._updateProjectiles(dt, camLocal);
      return;
    }

    this._think(dt, dist, camLocal, onSurface);
    this._pickLook(dt, dist, camLocal, onSurface);
    this._updateThreatCombat(dt, dist, camLocal, onSurface);

    let dHeading = this.heading - this._prevHeading;
    dHeading = Math.atan2(Math.sin(dHeading), Math.cos(dHeading));
    const instantTurn = dt > 1e-6 ? dHeading / dt : 0;
    this._turnRate = THREE.MathUtils.damp(this._turnRate, instantTurn, 5, dt);
    this._prevHeading = this.heading;
    this._headingTrail.push(this.heading);
    if (this._headingTrail.length > this._TRAIL_MAX) this._headingTrail.shift();

    let trailCurve = THREE.MathUtils.clamp(this._turnRate * 0.35, -0.55, 0.55);
    if (this._headingTrail.length > 10) {
      const headH = this._headingTrail[this._headingTrail.length - 1];
      const midH = this._headingTrail[Math.floor(this._headingTrail.length * 0.45)];
      let dh = headH - midH;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      trailCurve = THREE.MathUtils.clamp(dh, -0.65, 0.65);
    }

    const surge = THREE.MathUtils.clamp(this._speedMul, 0, 1.4);
    this._weightBob = Math.sin(this._mood * (2.2 + surge)) * surge * 7;
    if (this._grounded) {
      this._vert = THREE.MathUtils.damp(this._vert, -2 + this._weightBob * 0.15, 8, dt);
    }

    const wantSpeed = this.baseSpeed * this._speedMul;
    const step = wantSpeed * dt;
    const allowLava = this._state === STATES.SEEK_LAVA;

    if (step > 0.5) {
      const stepArc = step / this.planetRadius;
      const best = allowLava ? null : this._bestStep(this._look, stepArc);

      if (!allowLava && !best) {
        // Sin salida caminable: reorientar / posible zambullida
        this._lavaBlockedTime += dt;
        this._stuckTime += dt;
        this.heading += (1.6 + this._lavaBlockedTime) * dt * this._orbitSignFromSeed();
        if (this._diveCooldown <= 0 && this._lavaBlockedTime > 1.2 && Math.random() < 0.04) {
          if (this._findAndSetLavaTarget()) {
            this._enter(STATES.SEEK_LAVA, 8);
            return;
          }
        }
        if (this._stuckTime > 2.5) this._pickPatrolGoal();
        this._trySidestep(dt);
        this.dragon.update(dt, 0.15, trailCurve);
        this._orientRoot(this._look, dt);
        this._snapToSurface(this._headDir);
        this._updateProjectiles(dt, camLocal);
        return;
      }

      let moved;
      let lookUsed = this._look;
      if (best) {
        moved = best.probe;
        lookUsed = best.look;
        this.heading = best.heading;
        this._look.copy(lookUsed);
      } else {
        moved = this._moved
          .copy(this._headDir)
          .addScaledVector(this._look, stepArc)
          .normalize();
      }

      if (allowLava && this._isLava(moved)) {
        this._lavaTarget.copy(moved);
        this._enter(STATES.DIVE, 4);
        return;
      }

      if (!allowLava && !this._isWalkable(moved, this._headDir)) {
        this._lavaBlockedTime += dt;
        this._trySidestep(dt);
        this.dragon.update(dt, 0.2, trailCurve);
        this._orientRoot(this._look, dt);
        this._snapToSurface(this._headDir);
        this._updateProjectiles(dt, camLocal);
        return;
      }

      this._lavaBlockedTime = 0;

      const movedWorld = this._tmp.copy(moved).multiplyScalar(this._height(moved) + this._clearance);
      if (movedWorld.distanceTo(this._lastPos) < wantSpeed * dt * 0.12) {
        this._stuckTime += dt;
        this.heading += 1.5 * dt;
        if (this._stuckTime > 1.8) this._pickPatrolGoal();
      } else {
        this._stuckTime = 0;
        this._lastPos.copy(movedWorld);
      }

      this._headDir.copy(moved);
      this._up.copy(moved);
      this._snapToSurface(moved);
    } else {
      this._stuckTime = 0;
      this._snapToSurface(this._headDir);
    }

    this._orientRoot(this._look, dt);
    this.dragon.update(dt, surge, trailCurve);
    // Fuego DESPUÉS de orientar / animar (hocico y aim correctos)
    this._updateProjectiles(dt, camLocal);
  }

  _playerAimPoint(camLocal, out = this._tmp2) {
    // Pecho del jugador, no los pies
    return out.copy(camLocal).addScaledVector(this._up, 110);
  }

  /**
   * Threat: mira al jugador; spit desde lejos (~3000), mordisco solo si el hocico alcanza.
   */
  _updateThreatCombat(dt, dist, camLocal, onSurface) {
    if (this._state !== STATES.THREAT) return;

    if (!camLocal || !onSurface || dist > this._spitRange * 1.35) {
      this._pendingSpit = false;
      this._pendingAttack = false;
      this._spitFired = false;
      this._breath?.stop();
      this.dragon.releaseSpit();
      this._enter(STATES.WANDER, 5 + Math.random() * 3);
      return;
    }

    const breathing = this._isBreathing();
    const bodyR = this.targetLength * 0.32;
    // Embestida controlada hacia el jugador durante el Attack (para que el hocico llegue)
    if (this._pendingAttack && !this._attackLunged) {
      this._speedMul = dist > this._biteReach * 0.7 ? 1.6 : 0.15;
      if (dist > this._biteReach * 0.55) {
        const close = Math.min(320 * dt, dist * 0.55);
        this._headDir.addScaledVector(this._look, close / this.planetRadius).normalize();
        this._snapToSurface(this._headDir);
      }
    } else if (dist < bodyR && !this._pendingAttack) {
      this._speedMul = 0.4;
    } else if (breathing || this._pendingSpit) {
      this._speedMul = 0;
    } else if (dist > this._attackRange) {
      this._speedMul = dist > this._spitRange * 0.55 ? 0.55 : 0.22;
    } else {
      this._speedMul = 0;
    }

    const clip = this.dragon.getCurrentClipName();
    const prog = this.dragon.getClipProgress();
    const finished = this.dragon.consumeFinished();
    const jaw = this.dragon.getJawOpen01();
    const aimPt = this._playerAimPoint(camLocal);

    if (this._pendingSpit && !this._spitFired) {
      const ready = (clip === 'SpitLava' && (prog >= SPIT_FIRE_AT || jaw > 0.55))
        || finished === 'SpitLava';
      if (ready) {
        this._spawnProjectile(aimPt);
        this.dragon.holdSpit(0.12);
        this._spitFired = true;
        this._pendingSpit = false;
        this._threatCool = BREATH_DURATION + 0.45;
        this._stateT = Math.max(this._stateT, BREATH_DURATION + 0.8);
      } else if (clip && clip !== 'SpitLava' && finished) {
        this._pendingSpit = false;
      }
    }
    if (this._spitFired && !breathing) {
      this.dragon.releaseSpit();
      this._spitFired = false;
    }

    if (this._pendingAttack) {
      if (!this._attackTelegraph && clip === 'Attack' && prog >= ATTACK_TELEGRAPH_AT) {
        this._attackTelegraph = true;
        this._triggerSplash(this._headDir, 0.45, this._muzzlePlanetLocal(this._headPos, aimPt));
      }
      if (!this._attackLunged && clip === 'Attack' && (prog >= ATTACK_HIT_AT || jaw > 0.72)) {
        this._attackLunged = true;
        const muzzle = this._muzzlePlanetLocal(this._headPos, aimPt);
        const reach = muzzle.distanceTo(aimPt);
        if (reach <= this._biteReach) {
          this._triggerSplash(this._headDir, 1.4, aimPt);
          this._notifyHit(22, 'bite');
          this._wound(6);
        } else {
          this._triggerSplash(this._headDir, 0.65, muzzle);
          this._wound(2);
        }
      }
      if (finished === 'Attack' || (clip !== 'Attack' && this._attackLunged)) {
        this._pendingAttack = false;
        this._attackLunged = false;
        this._attackTelegraph = false;
        this._threatCool = 1.2;
      }
    }

    this._toCam.copy(camLocal).sub(this.root.position);
    this._toCam.addScaledVector(this._up, -this._toCam.dot(this._up));
    if (this._toCam.lengthSq() < 1e-6) return;
    const toPlayer = this._toCam.normalize();
    const aim = this._look.dot(toPlayer);

    if (this._pendingSpit || this._pendingAttack || breathing || this._threatCool > 0) return;

    const muzzleNow = this._muzzlePlanetLocal(this._headPos, aimPt);
    const muzzleDist = muzzleNow.distanceTo(aimPt);
    const canBite = muzzleDist <= this._biteReach * 0.98 && dist <= this._attackRange;

    // Lejos: spit (desde ~3000). Cerca: mordisco.
    if (!canBite && dist <= this._spitRange) {
      if (aim < AIM_DOT_SPIT) return;
      this.dragon.setIntent('spit');
      this._pendingSpit = true;
      this._spitFired = false;
      this._threatCool = 0.15;
      this._threatFired = true;
      this._stateT = Math.max(this._stateT, 2.4);
    } else if (canBite) {
      if (aim < AIM_DOT) return;
      this.dragon.setIntent('attack');
      this._pendingAttack = true;
      this._attackLunged = false;
      this._attackTelegraph = false;
      this._threatCool = 0.12;
      this._threatFired = true;
      this._stateT = Math.max(this._stateT, 2.2);
    }
  }

  _updateDive(dt) {
    this._up.copy(this._headDir);
    this._buildTangent();

    const toLava = this._tmp.copy(this._lavaTarget).sub(this._headDir);
    toLava.addScaledVector(this._up, -toLava.dot(this._up));
    if (toLava.lengthSq() > 1e-8) {
      this._look.lerp(toLava.normalize(), 1 - Math.exp(-2.2 * dt)).normalize();
      this.heading = Math.atan2(this._look.dot(this._right), this._look.dot(this._fwd));
      this._headDir.addScaledVector(this._look, (140 * dt) / this.planetRadius).normalize();
    }

    // Hundirse al ritmo del clip Burrow (Head Y baja en el GLB)
    const clip = this.dragon.getCurrentClipName();
    const prog = clip === 'Burrow' ? this.dragon.getClipProgress() : -1;
    if (prog >= 0) {
      this._diveProgress = Math.max(this._diveProgress, prog);
    } else {
      this._diveProgress = Math.min(1, this._diveProgress + dt / 1.8);
    }
    const sink = this._diveProgress * this._diveProgress;
    this._vert = -Math.max(60, this.dragon.height * 0.7) * sink;

    if (!this._diveSplashed && this._diveProgress > 0.28) {
      this._diveSplashed = true;
      this._triggerSplash(this._headDir, 0.95, this.root.position);
    }
    this._healInLava(dt, 0.55 + this._diveProgress * 0.5);

    this._up.copy(this._headDir);
    this._snapToSurface(this._headDir);
    this._orientRoot(this._look, dt);
    this.dragon.update(dt, 0.55, 0, { lockLocomotion: true });
    this._stateT -= dt;

    const finished = this.dragon.consumeFinished();
    if (this._diveProgress >= 0.92 || finished === 'Burrow' || this._stateT <= 0) {
      this._enter(STATES.SUBMERGED, 4);
    }
  }

  _updateEmerge(dt) {
    const clip = this.dragon.getCurrentClipName();
    const prog = clip === 'Emerge' ? this.dragon.getClipProgress() : -1;
    if (prog >= 0) {
      this._emergeProgress = Math.max(this._emergeProgress, prog);
    } else {
      this._emergeProgress = Math.min(1, this._emergeProgress + dt / 1.73);
    }
    const t = this._emergeProgress;
    // Emerge del GLB: Head baja desde alto (sale) — ease-out
    const ease = 1 - Math.pow(1 - t, 2.4);
    const startVert = -Math.max(80, this.dragon.height * 0.45);
    this._vert = startVert * (1 - ease);

    if (!this._emergeSplashed && t > 0.28) {
      this._emergeSplashed = true;
      this._triggerSplash(this._headDir, 1.05, this.root.position);
    }

    if (this._isLava(this._headDir)) {
      const shore = this._findShoreNear(this._headDir);
      if (shore) this._headDir.copy(shore);
    }

    this._up.copy(this._headDir);
    this._snapToSurface(this._headDir);
    this._buildTangent();
    this._orientRoot(this._fwd, dt);
    this.dragon.update(dt, 0.4, 0, { lockLocomotion: true });
    this._stateT -= dt;

    const finished = this.dragon.consumeFinished();
    if (t >= 0.95 || this._vert >= -2 || finished === 'Emerge' || this._stateT <= 0) {
      this._vert = 0;
      this._vertVel = 0;
      this._grounded = true;
      if (!this._isRock(this._headDir)) {
        const rock = this._findRockNear(this._headDir, 40);
        if (rock) {
          this._headDir.copy(rock);
          this._snapToSurface(rock);
        }
      }
      this._enter(STATES.WANDER, 5 + Math.random() * 4);
    }
  }

  _orbitSignFromSeed() {
    return (Math.floor(this.seed) % 2 === 0) ? 1 : -1;
  }

  _think(dt, dist, camLocal, onSurface) {
    const aware = !!(camLocal && onSurface && dist < this._awareFar);
    const busy = this._state === STATES.DIVE
      || this._state === STATES.SUBMERGED
      || this._state === STATES.EMERGE;

    if (aware) {
      const target = dist < this._awareNear ? 1
        : dist < this._awareMid ? 0.55
          : 0.2;
      this._interest = THREE.MathUtils.damp(this._interest, target, 1.4, dt);
    } else {
      this._interest = THREE.MathUtils.damp(this._interest, 0, 1.6, dt);
      if ((this._state === STATES.THREAT || this._state === STATES.APPROACH
        || this._state === STATES.NOTICE || this._state === STATES.FLEE)
        && this._interest < 0.15) {
        this._pendingSpit = false;
        this._enter(STATES.WANDER, 5 + Math.random() * 4);
        return;
      }
    }

    if (busy) return;

    const footHeat = this._lavaHeat(this._headDir);
    const wantBath = this._needHeat > 0.42 || this._caution > 0.55;
    const canDive = this._diveCooldown <= 0;

    // Ya está sobre magma caliente y lo necesita → sumergirse (no “timer random”)
    if (wantBath && footHeat > 0.45 && canDive
      && this._state !== STATES.SEEK_LAVA && this._state !== STATES.THREAT) {
      this._lavaTarget.copy(this._headDir);
      this._enter(STATES.DIVE, 4);
      return;
    }

    // Herido / con ganas de calor: ir al charco (incluso interrumpe amenaza si está mal)
    if (wantBath && canDive
      && this._state !== STATES.SEEK_LAVA) {
      const desperate = this.hp < this.maxHp * 0.45 || this._caution > 0.7;
      const casual = this._needHeat > 0.55 && this._huntUrge < 0.4
        && Math.sin(this._whim + this._mood * 0.2) > 0.15;
      if (desperate || (casual && this._stateT < 0.4)) {
        if (this._findAndSetLavaTarget()) {
          this._pendingSpit = false;
          this._pendingAttack = false;
          this._enter(STATES.SEEK_LAVA, 10);
          return;
        }
      }
    }

    // Buscando lava: si llega al charco, se tira
    if (this._state === STATES.SEEK_LAVA) {
      if (footHeat > 0.4 || this._isLava(this._headDir)) {
        this._enter(STATES.DIVE, 4);
        return;
      }
      if (this._stateT <= 0) {
        if (this._needHeat > 0.35 && this._findAndSetLavaTarget()) {
          this._stateT = 6;
        } else {
          this._enter(STATES.WANDER, 4 + Math.random() * 3);
        }
      }
      return;
    }

    // Cazar: spit / amenaza cuando puede y no está desesperado por curarse
    if (aware && dist <= this._spitRange
      && this._huntUrge > 0.38 && this._caution < 0.65
      && this._state !== STATES.FLEE && this._state !== STATES.THREAT
      && this._state !== STATES.SEEK_LAVA) {
      this._enter(STATES.THREAT, 3.2 + this._huntUrge * 2.2);
      return;
    }

    // Demasiado cerca y aún sano: a veces se retrae un poco (no huida robótica fija)
    if (aware && dist < this._awareNear * 0.4 && this._huntUrge < 0.35
      && this._state !== STATES.FLEE && this._state !== STATES.THREAT
      && this._stateT < 0.2 && Math.sin(this._whim * 1.3) > 0.7) {
      this._enter(STATES.FLEE, 1.6 + Math.random());
      return;
    }

    if (this._stateT > 0) return;

    // Merodeo orgánico según el impulso más fuerte
    const bath = this._needHeat * (0.85 + 0.15 * Math.sin(this._whim));
    const hunt = this._huntUrge * (0.9 + 0.1 * Math.sin(this._mood));
    const rest = this._restUrge;

    if (bath > hunt && bath > rest && bath > 0.38 && canDive) {
      if (this._findAndSetLavaTarget()) {
        this._enter(STATES.SEEK_LAVA, 9);
        return;
      }
    }

    if (aware && hunt > rest && dist <= this._spitRange && this._caution < 0.5) {
      this._enter(STATES.THREAT, 2.8 + Math.random() * 1.5);
      return;
    }

    if (aware && hunt > 0.3 && dist < this._awareMid) {
      if (Math.sin(this._whim * 0.9) > 0.25) {
        this._enter(STATES.APPROACH, 2.5 + Math.random() * 2);
      } else {
        this._enter(STATES.NOTICE, 1.8 + Math.random() * 1.5);
      }
      return;
    }

    if (rest > 0.45 || Math.sin(this._mood * 0.55 + this.seed) > 0.75) {
      this._enter(STATES.IDLE, 1.6 + Math.random() * 2.8);
    } else {
      this._pickPatrolGoal();
      this._enter(STATES.WANDER, 8 + Math.random() * 10);
      this._turnBias = (Math.random() - 0.5) * 0.22;
    }
  }

  _pickLook(dt, dist, camLocal, onSurface) {
    this._up.copy(this._headDir);
    this._buildTangent();

    let hx = Math.sin(this.heading);
    let hz = Math.cos(this.heading);
    this._look.copy(this._fwd).multiplyScalar(hz).addScaledVector(this._right, hx).normalize();

    if (this._state === STATES.SEEK_LAVA) {
      const to = this._tmp.copy(this._lavaTarget).sub(this._headDir);
      to.addScaledVector(this._up, -to.dot(this._up));
      if (to.lengthSq() > 1e-8) {
        this._look.lerp(to.normalize(), 1 - Math.exp(-2.4 * dt)).normalize();
        this.heading = Math.atan2(this._look.dot(this._right), this._look.dot(this._fwd));
      }
      return;
    }

    if (this._state === STATES.IDLE) {
      this.heading += Math.sin(this._mood * 0.7 + this.seed) * 0.35 * dt;
      hx = Math.sin(this.heading);
      hz = Math.cos(this.heading);
      this._look.copy(this._fwd).multiplyScalar(hz).addScaledVector(this._right, hx).normalize();
      return;
    }

    const canSeePlayer = !!(camLocal && onSurface && dist < this._awareFar);

    if (this._state === STATES.NOTICE && canSeePlayer) {
      this._toCam.copy(camLocal).sub(this.root.position);
      this._toCam.addScaledVector(this._up, -this._toCam.dot(this._up));
      if (this._toCam.lengthSq() > 1e-6) {
        this._look.lerp(this._toCam.normalize(), 1 - Math.exp(-2.5 * dt)).normalize();
        this.heading = Math.atan2(this._look.dot(this._right), this._look.dot(this._fwd));
      }
      return;
    }

    if (this._state === STATES.THREAT && canSeePlayer) {
      this._toCam.copy(camLocal).sub(this.root.position);
      this._toCam.addScaledVector(this._up, -this._toCam.dot(this._up));
      // Distancia casi 0 → no normalizar basura (evita spin de hélice)
      if (this._toCam.lengthSq() < 1e-2) return;
      const toward = this._toCam.normalize();
      const bodyR = this.targetLength * 0.32;
      // Durante embestida/mordisco: siempre de frente al jugador
      if (this._pendingAttack || this._pendingSpit || this._isBreathing()) {
        this._look.lerp(toward, 1 - Math.exp(-3.4 * dt)).normalize();
      } else if (dist < bodyR) {
        // Demasiado encima (sin atacar): empujar afuera
        this._look.lerp(toward.clone().negate(), 1 - Math.exp(-3.2 * dt)).normalize();
      } else {
        this._look.lerp(toward, 1 - Math.exp(-3.0 * dt)).normalize();
      }
      this.heading = Math.atan2(this._look.dot(this._right), this._look.dot(this._fwd));
      return;
    }

    if (this._state === STATES.FLEE && canSeePlayer) {
      this._toCam.copy(this.root.position).sub(camLocal);
      this._toCam.addScaledVector(this._up, -this._toCam.dot(this._up));
      if (this._toCam.lengthSq() > 1e-6) {
        const away = this._toCam.normalize();
        const side = this._tmp2.crossVectors(this._up, away).normalize()
          .multiplyScalar(0.35 * this._orbitSignFromSeed());
        away.add(side).normalize();
        this._look.lerp(away, 1 - Math.exp(-2.8 * dt)).normalize();
        this.heading = Math.atan2(this._look.dot(this._right), this._look.dot(this._fwd));
      }
      return;
    }

    if (this._state === STATES.APPROACH && canSeePlayer) {
      this._toCam.copy(camLocal).sub(this.root.position);
      this._toCam.addScaledVector(this._up, -this._toCam.dot(this._up));
      if (this._toCam.lengthSq() < 1e-2) return;
      const toward = this._toCam.normalize();
      // Acercarse de frente; sin círculo tipo hélice
      this._look.lerp(toward, 1 - Math.exp(-2.2 * dt)).normalize();
      this.heading = Math.atan2(this._look.dot(this._right), this._look.dot(this._fwd));
      return;
    }

    // Merodeo: ir al punto de patrulla en roca
    if (this._state === STATES.WANDER) {
      if (!this._hasPatrolGoal) this._pickPatrolGoal();
      if (this._hasPatrolGoal) {
        const to = this._tmp.copy(this._patrolGoal).sub(this._headDir);
        to.addScaledVector(this._up, -to.dot(this._up));
        const arcDist = this._headDir.angleTo(this._patrolGoal) * this.planetRadius;
        if (arcDist < 180) {
          this._pickPatrolGoal();
        } else if (to.lengthSq() > 1e-8) {
          // Giro suave tipo serpiente, no snaps
          this._look.lerp(to.normalize(), 1 - Math.exp(-1.15 * dt)).normalize();
          const wantH = Math.atan2(this._look.dot(this._right), this._look.dot(this._fwd));
          let dh = wantH - this.heading;
          dh = Math.atan2(Math.sin(dh), Math.cos(dh));
          this.heading += dh * (1 - Math.exp(-1.6 * dt));
          this.heading += this._turnBias * 0.1 * dt;
          return;
        }
      }
    }

    this.heading += (this._turnBias * 0.55 + Math.sin(this._mood * 0.23 + this.seed) * 0.12) * dt;
    if (this._stuckTime > 1.2) this.heading += 1.4 * dt;
    hx = Math.sin(this.heading);
    hz = Math.cos(this.heading);
    this._look.copy(this._fwd).multiplyScalar(hz).addScaledVector(this._right, hx).normalize();
  }

  _trySidestep(dt) {
    const sign = this._orbitSignFromSeed();
    for (let i = 1; i <= 8; i++) {
      const ang = this.heading + sign * i * 0.4;
      const hx = Math.sin(ang);
      const hz = Math.cos(ang);
      const tryLook = this._tmp.copy(this._fwd).multiplyScalar(hz).addScaledVector(this._right, hx).normalize();
      const probe = this._moved
        .copy(this._headDir)
        .addScaledVector(tryLook, (this.baseSpeed * 0.45 * Math.max(dt, 0.05)) / this.planetRadius)
        .normalize();
      if (this._isWalkable(probe, this._headDir)) {
        this.heading = ang;
        this._look.copy(tryLook);
        this._headDir.copy(probe);
        this._up.copy(probe);
        this._snapToSurface(probe);
        this._lavaBlockedTime = 0;
        this._stuckTime = 0;
        return;
      }
    }
  }

  setVisible(v) {
    this._visible = v;
    if (this._state !== STATES.SUBMERGED) {
      this.root.visible = v;
    }
    if (!v) this._splash.visible = false;
    this.active = true;
  }

  dispose() {
    this._breath?.dispose();
    this._breath = null;
    this.planetGroup.remove(this.root);
    this.planetGroup.remove(this._splash);
    this._splash.geometry.dispose();
    this._splash.material.dispose();
    this.dragon.dispose();
  }
}

/**
 * Fauna de Mercurio: LavaDragon animado.
 */
export class LavaDragonFaunaManager {
  /**
   * @param {THREE.Group} planetGroup
   * @param {number} planetRadius
   * @param {string} biome
   * @param {number} [count]
   */
  constructor(planetGroup, planetRadius, biome = 'Lava', count = 1) {
    this.planetGroup = planetGroup;
    this.planetRadius = planetRadius;
    this.biome = biome;
    this.viewDist = 52000;
    this.hideDist = 56000;
    this.showDist = 48000;
    this._hidden = false;
    this.dragons = [];
    for (let i = 0; i < count; i++) {
      this.dragons.push(new PlanetLavaDragon(planetGroup, planetRadius, biome, {
        seed: 220 + i * 41.3,
        targetLength: count === 1 ? 1600 : 900 + i * 80
      }));
    }
    this.onPlayerHit = null;
    for (const d of this.dragons) {
      d.onPlayerHit = (amount, kind) => {
        if (typeof this.onPlayerHit === 'function') this.onPlayerHit(amount, kind);
      };
    }
    this._local = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._ready = false;
  }

  update(worldFocusPos, shipSpeed = 0, delta = 0.016) {
    this._local.copy(worldFocusPos);
    this.planetGroup.worldToLocal(this._local);

    const coarseAlt = this._local.length() - this.planetRadius;
    const tooFast = shipSpeed > 8000;

    if (tooFast || coarseAlt > this.hideDist) {
      this._hidden = true;
      for (const d of this.dragons) d.setVisible(false);
      return;
    }

    const camDir = this._camDir.copy(this._local).normalize();
    const surf = TerrainBuilder.getHeight(camDir, this.planetRadius, this.biome, false);
    const alt = this._local.length() - surf;

    if (alt > this.hideDist || alt < -800) {
      this._hidden = true;
      for (const d of this.dragons) d.setVisible(false);
      return;
    }

    if (this._hidden && alt < this.showDist && !tooFast) {
      this._hidden = false;
    }
    if (this._hidden) {
      for (const d of this.dragons) d.setVisible(false);
      return;
    }

    if (!this._ready) {
      this._spawnAround(camDir);
      this._ready = true;
    }

    for (const d of this.dragons) {
      d.setVisible(true);
      d.update(delta, this._local);
    }
  }

  _spawnAround(camDir) {
    const axis = Math.abs(camDir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(axis, camDir).normalize();
    const fwd = new THREE.Vector3().crossVectors(camDir, right).normalize();
    const R = this.planetRadius;

    for (let i = 0; i < this.dragons.length; i++) {
      const dragon = this.dragons[i];
      let placed = false;
      for (let tryN = 0; tryN < 24 && !placed; tryN++) {
        const ang = (i / Math.max(1, this.dragons.length)) * Math.PI * 2 + tryN * 0.7;
        // Spawn ring ~1.2–2.5 km from player
        const dist = 1200 + ((tryN * 97 + i * 180) % 1301);
        const arc = dist / R;
        const dir = camDir.clone()
          .addScaledVector(fwd, Math.cos(ang) * arc)
          .addScaledVector(right, Math.sin(ang) * arc)
          .normalize();
        placed = dragon.placeOnSurface(dir);
        if (placed) dragon.heading = ang + Math.PI * 0.35;
      }
      dragon.setVisible(placed);
    }
  }

  dispose() {
    for (const d of this.dragons) d.dispose();
    this.dragons.length = 0;
  }

  /**
   * Marcadores para el minimapa / guía.
   * Posiciones en espacio local del planeta.
   * @returns {{ local: THREE.Vector3, submerged: boolean, state: string }[]}
   */
  getRadarMarkers() {
    const out = [];
    if (!this._ready) return out;
    for (const d of this.dragons) {
      if (!d._placed || !d.active) continue;
      const submerged = d._state === 'submerged' || !d.root.visible;
      // Posición en superficie (si está bajo lava, usar el punto de cabeza radial)
      const local = submerged && d._headDir
        ? d._headDir.clone().multiplyScalar(
          TerrainBuilder.getHeight(d._headDir, this.planetRadius, this.biome, false)
        )
        : d.root.position.clone();
      out.push({
        local,
        submerged,
        state: d._state,
        hp: d.hp,
        maxHp: d.maxHp
      });
    }
    return out;
  }
}
