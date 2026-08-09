import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODEL_URL = '/models/fauna/LavaDragon_animated.glb';
const MUZZLE_STORAGE_KEY = 'lavaDragon.muzzleCalib';

/**
 * Dragón de lava skinned. Clips: Move, Idle, Attack, SpitLava, JumpArc, Burrow, Emerge.
 */
export class LavaDragon {
  /**
   * @param {{ targetLength?: number }} [opts]
   */
  constructor(opts = {}) {
    this.targetLength = opts.targetLength ?? 1400;
    this.root = new THREE.Group();
    this.root.name = 'LavaDragon';
    this.root.frustumCulled = false;

    this.ready = false;
    this.length = this.targetLength;
    this.height = this.targetLength * 0.35;
    /** Distancia del pivote al vientre (para pegarlo al suelo). */
    this.bellyClearance = 8;
    this._phase = 0;
    this._mixer = null;
    this._actions = {};
    this._current = null;
    this._currentName = null;
    this._intent = 'idle';
    this._intentLock = 0;
    this._model = null;
    this._spine = [];
    this._headBone = null;
    this._curve = 0;
    this._finished = null; // clip name that just finished (once)

    /** Calibración boca: lateral / arriba / adelante (espacio del hocico, escala con length). */
    this.muzzleOffset = new THREE.Vector3(0, 0, 0);
    /** Empuje extra por delante del cráneo (fracción de length). */
    this.muzzleSnout = 0.075;
    this._loadMuzzleCalib();

    this._loadPromise = this._load();
  }

  _loadMuzzleCalib() {
    try {
      const raw = localStorage.getItem(MUZZLE_STORAGE_KEY);
      if (!raw) return;
      const o = JSON.parse(raw);
      if (Number.isFinite(o.x)) this.muzzleOffset.x = o.x;
      if (Number.isFinite(o.y)) this.muzzleOffset.y = o.y;
      if (Number.isFinite(o.z)) this.muzzleOffset.z = o.z;
      if (Number.isFinite(o.snout)) this.muzzleSnout = o.snout;
    } catch (_) { /* ignore */ }
  }

  /** Guarda calibración (preview → planeta usan la misma key). */
  saveMuzzleCalib() {
    const payload = {
      x: this.muzzleOffset.x,
      y: this.muzzleOffset.y,
      z: this.muzzleOffset.z,
      snout: this.muzzleSnout
    };
    try {
      localStorage.setItem(MUZZLE_STORAGE_KEY, JSON.stringify(payload));
    } catch (_) { /* ignore */ }
    return payload;
  }

  setMuzzleCalib({ x, y, z, snout } = {}) {
    if (Number.isFinite(x)) this.muzzleOffset.x = x;
    if (Number.isFinite(y)) this.muzzleOffset.y = y;
    if (Number.isFinite(z)) this.muzzleOffset.z = z;
    if (Number.isFinite(snout)) this.muzzleSnout = snout;
  }

  getObject3D() {
    return this.root;
  }

  whenReady() {
    return this._loadPromise;
  }

  async _load() {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(MODEL_URL);
    const model = gltf.scene;
    this._model = model;

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    model.position.y += size.y * 0.5;

    box.setFromObject(model);
    box.getSize(size);
    const longest = Math.max(size.x, size.y, size.z, 1e-6);
    model.scale.setScalar(this.targetLength / longest);

    if (size.x >= size.z && size.x >= size.y) {
      model.rotation.y = -Math.PI * 0.5;
    } else if (size.y >= size.x && size.y >= size.z) {
      model.rotation.x = Math.PI * 0.5;
    }

    box.setFromObject(model);
    box.getSize(size);
    const c2 = box.getCenter(new THREE.Vector3());
    model.position.x -= c2.x;
    model.position.z -= c2.z;
    // Vientre justo en Y=0 (antes sobraba holgura y “levitaba”)
    model.position.y -= box.min.y;

    box.setFromObject(model);
    box.getSize(size);
    this.length = Math.max(size.z, size.x);
    this.height = size.y;
    this.bellyClearance = Math.max(4, this.height * 0.02);

    model.traverse((o) => {
      if (/mark|ico/i.test(o.name) && o.isMesh && o.name !== 'LavaDragon') {
        o.visible = false;
      }
      if (!o.isMesh) return;
      o.castShadow = false;
      o.receiveShadow = true;
      o.frustumCulled = false;
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m?.map) m.map.colorSpace = THREE.SRGBColorSpace;
          // Un poco más “pesado” / en contacto con lava
          if (m && 'emissiveIntensity' in m && m.emissiveIntensity < 0.15) {
            m.emissive = m.emissive || new THREE.Color(0x331100);
            m.emissiveIntensity = Math.max(m.emissiveIntensity || 0, 0.08);
          }
        }
      }
    });

    this.root.add(model);
    this._cacheSpine(model);

    if (gltf.animations?.length) {
      this._mixer = new THREE.AnimationMixer(model);
      this._mixer.addEventListener('finished', (e) => {
        this._finished = e.action?.getClip?.()?.name || this._currentName;
      });
      for (const clip of gltf.animations) {
        const action = this._mixer.clipAction(clip);
        action.clampWhenFinished = false;
        this._actions[clip.name] = action;
      }
      this.play('Idle', 0);
    }

    this.ready = true;
    return this;
  }

  _cacheSpine(model) {
    const byName = new Map();
    model.traverse((o) => {
      if (o.isBone) byName.set(o.name, o);
    });
    model.traverse((o) => {
      if (!o.isSkinnedMesh || !o.skeleton) return;
      for (const b of o.skeleton.bones) byName.set(b.name, b);
    });

    this._spine = [];
    for (let i = 1; i <= 24; i++) {
      const n = `Spine_${String(i).padStart(2, '0')}`;
      const bone = byName.get(n);
      if (bone) this._spine.push(bone);
    }
    this._headBone = byName.get('Head') || null;
    this._jawBone = byName.get('Jaw') || null;
  }

  /**
   * Punta del hocico en local del root.
   * @param {THREE.Vector3} out
   * @param {{ applyOffset?: boolean }} [opts] applyOffset=false → base sin calibración (para el gizmo)
   */
  getMuzzleLocal(out = new THREE.Vector3(), opts = {}) {
    const applyOffset = opts.applyOffset !== false;
    this.root.updateWorldMatrix(true, false);
    const mouth = this._tmpHead || (this._tmpHead = new THREE.Vector3());
    const body = this._tmpBody || (this._tmpBody = new THREE.Vector3());
    const dir = this._tmpMuzzleDir || (this._tmpMuzzleDir = new THREE.Vector3());
    const jawPos = this._tmpMuzzleDir2 || (this._tmpMuzzleDir2 = new THREE.Vector3());
    const right = this._tmpMuzzleRight || (this._tmpMuzzleRight = new THREE.Vector3());
    const up = this._tmpMuzzleUp || (this._tmpMuzzleUp = new THREE.Vector3());

    if (this._headBone) {
      this._headBone.updateWorldMatrix(true, false);
      this._headBone.getWorldPosition(mouth);
      this.root.worldToLocal(mouth);
    } else if (this._jawBone) {
      this._jawBone.updateWorldMatrix(true, false);
      this._jawBone.getWorldPosition(mouth);
      this.root.worldToLocal(mouth);
    } else {
      mouth.set(0, this.height * 0.22, this.length * 0.38);
    }

    if (this._headBone && this._jawBone) {
      this._jawBone.updateWorldMatrix(true, false);
      this._jawBone.getWorldPosition(jawPos);
      this.root.worldToLocal(jawPos);
      mouth.lerp(jawPos, 0.45);
    }

    dir.set(0, 0.08, 1);
    if (this._headBone && this._spine.length) {
      const sb = this._spine[Math.min(2, this._spine.length - 1)];
      sb.updateWorldMatrix(true, false);
      sb.getWorldPosition(body);
      this.root.worldToLocal(body);
      const along = this._tmpBody2 || (this._tmpBody2 = new THREE.Vector3());
      along.copy(mouth).sub(body);
      if (along.lengthSq() > 1e-6) {
        along.normalize();
        if (along.dot(dir) > 0.1) dir.copy(along);
      }
    }
    dir.normalize();

    const snout = Math.max(36, this.length * this.muzzleSnout);
    out.copy(mouth).addScaledVector(dir, snout);

    if (applyOffset) {
      right.set(0, 1, 0).cross(dir);
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0).cross(dir);
      right.normalize();
      up.crossVectors(dir, right).normalize();
      const s = this.length;
      out.addScaledVector(right, this.muzzleOffset.x * s);
      out.addScaledVector(up, this.muzzleOffset.y * s);
      out.addScaledVector(dir, this.muzzleOffset.z * s);
    }
    return out;
  }

  /** Dirección del hocico en local del root (hacia fuera de la boca). */
  getMuzzleDirLocal(out = new THREE.Vector3()) {
    this.root.updateWorldMatrix(true, false);
    const mouth = this._tmpHead || (this._tmpHead = new THREE.Vector3());
    const body = this._tmpBody || (this._tmpBody = new THREE.Vector3());
    out.set(0, 0.08, 1);
    if (this._headBone && this._spine.length) {
      this._headBone.updateWorldMatrix(true, false);
      this._headBone.getWorldPosition(mouth);
      this.root.worldToLocal(mouth);
      const sb = this._spine[Math.min(2, this._spine.length - 1)];
      sb.updateWorldMatrix(true, false);
      sb.getWorldPosition(body);
      this.root.worldToLocal(body);
      out.copy(mouth).sub(body);
      if (out.lengthSq() < 1e-6) return out.set(0, 0.08, 1).normalize();
      if (out.normalize().z < 0) out.negate();
      return out;
    }
    return out.normalize();
  }

  /**
   * A partir de una posición mundo del gizmo, escribe muzzleOffset.
   * @param {THREE.Vector3} worldPos
   */
  calibrateMuzzleFromWorld(worldPos) {
    this.root.updateWorldMatrix(true, false);
    const base = this._calibBase || (this._calibBase = new THREE.Vector3());
    const want = this._calibWant || (this._calibWant = new THREE.Vector3());
    this.getMuzzleLocal(base, { applyOffset: false });
    want.copy(worldPos);
    this.root.worldToLocal(want);
    want.sub(base);

    const dir = this.getMuzzleDirLocal(this._tmpMuzzleDir || (this._tmpMuzzleDir = new THREE.Vector3()));
    const right = this._tmpMuzzleRight || (this._tmpMuzzleRight = new THREE.Vector3());
    const up = this._tmpMuzzleUp || (this._tmpMuzzleUp = new THREE.Vector3());
    right.set(0, 1, 0).cross(dir);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0).cross(dir);
    right.normalize();
    up.crossVectors(dir, right).normalize();

    const s = Math.max(1e-4, this.length);
    this.muzzleOffset.set(
      want.dot(right) / s,
      want.dot(up) / s,
      want.dot(dir) / s
    );
    return this.muzzleOffset;
  }

  /** Progreso 0..1 del clip actual (útil para sync de VFX). */
  getClipProgress() {
    if (!this._current) return 0;
    const clip = this._current.getClip?.();
    const dur = clip?.duration || 0;
    if (dur <= 0) return 0;
    return THREE.MathUtils.clamp(this._current.time / dur, 0, 1);
  }

  getCurrentClipName() {
    return this._currentName;
  }

  consumeFinished() {
    const f = this._finished;
    this._finished = null;
    return f;
  }

  /**
   * @param {'idle'|'move'|'attack'|'spit'|'jump'|'burrow'|'emerge'} intent
   */
  setIntent(intent) {
    if (intent === this._intent && this._intentLock > 0) return;
    this._intent = intent;
    const table = {
      attack: ['Attack', 0.25],
      spit: ['SpitLava', 0.25],
      jump: ['JumpArc', 0.15],
      burrow: ['Burrow', 0.2],
      emerge: ['Emerge', 0.15],
      move: ['Move', 0.4],
      idle: ['Idle', 0.45]
    };
    const [clip, fade] = table[intent] || table.idle;
    this.play(clip, fade);
    const dur = this._clipDuration(clip);
    const once = ['attack', 'spit', 'jump', 'burrow', 'emerge'].includes(intent);
    this._intentLock = once ? (dur || 1.5) : 0.35;
  }

  _clipDuration(name) {
    return this._actions[name]?.getClip?.()?.duration ?? 0;
  }

  play(name, fade = 0.35, { loop = null } = {}) {
    const map = {
      Attack: ['Attack', 'SpitLava', 'Idle'],
      SpitLava: ['SpitLava', 'Attack', 'Idle'],
      JumpArc: ['JumpArc', 'Move', 'Idle'],
      Burrow: ['Burrow', 'Move', 'Idle'],
      Emerge: ['Emerge', 'Idle', 'Move'],
      Move: ['Move', 'Idle'],
      Idle: ['Idle', 'Move']
    };
    const candidates = map[name] || [name];
    let next = null;
    let resolved = name;
    for (const n of candidates) {
      if (this._actions[n]) {
        next = this._actions[n];
        resolved = n;
        break;
      }
    }
    if (!next) return;
    if (this._currentName === resolved && loop == null) return;

    if (this._current && this._current !== next) this._current.fadeOut(fade);
    const onceDefault = ['Attack', 'SpitLava', 'JumpArc', 'Burrow', 'Emerge'].includes(resolved);
    const once = loop === true ? false : loop === false ? true : onceDefault;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.setEffectiveWeight(1).fadeIn(fade).play();
    this._current = next;
    this._currentName = resolved;
    this._finished = null;
  }

  /** Mantener SpitLava en loop mientras dura el chorro. */
  holdSpit(fade = 0.15) {
    this._intent = 'spit';
    this.play('SpitLava', fade, { loop: true });
    this._intentLock = 99;
  }

  releaseSpit() {
    this._intentLock = 0;
    this._intent = 'idle';
    this.play('Idle', 0.35);
  }

  /**
   * Apertura de mandíbula 0..1 (Jaw del GLB).
   */
  getJawOpen01() {
    if (!this._jawBone) return 0;
    const y = Math.abs(this._jawBone.quaternion.y);
    return THREE.MathUtils.clamp((y - 0.17) / 0.30, 0, 1);
  }

  /**
   * @param {number} dt
   * @param {number} [surge]
   * @param {number} [turnRate]
   * @param {{ lockLocomotion?: boolean }} [opts]
   */
  update(dt, surge = 1, turnRate = 0, opts = {}) {
    this._phase += dt;
    this._intentLock = Math.max(0, this._intentLock - dt);

    if (this._mixer) {
      if (this._current && (this._currentName === 'Move' || this._currentName === 'Idle')) {
        const scale = this._currentName === 'Move'
          ? 0.7 + 0.45 * THREE.MathUtils.clamp(surge, 0, 1.2)
          : 0.85 + 0.12 * Math.sin(this._phase * 0.7);
        this._current.setEffectiveTimeScale(scale);
      } else if (this._current && this._currentName === 'Attack') {
        this._current.setEffectiveTimeScale(1.15);
      } else if (this._current && this._currentName === 'SpitLava') {
        this._current.setEffectiveTimeScale(1.05);
      }
      this._mixer.update(dt);
    }

    // Movimiento = clips del GLB. Sin ondulación procedural encima.
    void turnRate;
    void opts.lockLocomotion;

    if (this._intentLock <= 0 && !opts.lockLocomotion) {
      if (['attack', 'spit', 'jump', 'burrow', 'emerge'].includes(this._intent)) {
        this._intent = surge > 0.35 ? 'move' : 'idle';
      }
      if (surge > 0.4 && this._intent === 'move') this.play('Move', 0.35);
      else if (surge < 0.2 && this._intent === 'idle') this.play('Idle', 0.4);
    }
  }

  dispose() {
    if (this._mixer) {
      this._mixer.stopAllAction();
      this._mixer = null;
    }
    this.root.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
        else o.material.dispose?.();
      }
    });
    this.root.clear();
  }
}
