import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  WEAPON_DEFS,
  getWeaponDef,
  getWeaponBySlot,
  listWeapons
} from './WeaponCatalog.js';

const CALIB_KEY = 'weaponCalib.v3';
const EQUIP_KEY = 'weaponEquipped.v1';

/**
 * Sistema profesional de armas a pie:
 * - inventario completo desbloqueado (modo prueba)
 * - equip / swap por id o slot
 * - carga GLB + normaliza cañón a -Z del personaje
 * - calib (mount/muzzle) persistente por arma
 * - notifica listeners (HUD)
 */
export class WeaponSystem {
  constructor(opts = {}) {
    this.charHeight = opts.charHeight ?? 150;
    this.loader = new GLTFLoader();
    /** @type {Map<string, THREE.Group>} */
    this._cache = new Map();
    /** @type {string|null} */
    this.equippedId = null;
    /** @type {THREE.Group|null} */
    this.weaponRoot = null;
    /** @type {THREE.Object3D|null} */
    this.muzzle = null;
    /** @type {THREE.Mesh|null} */
    this.muzzleFlash = null;
    /** @type {number} */
    this._loadGen = 0;
    this._listeners = new Set();
    this._calib = this._readCalib();

    // Todas desbloqueadas para probar / ajustar
    this.unlocked = new Set(WEAPON_DEFS.map((w) => w.id));
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    const payload = {
      equippedId: this.equippedId,
      def: this.getEquippedDef(),
      unlocked: [...this.unlocked]
    };
    for (const fn of this._listeners) {
      try { fn(payload); } catch (e) { console.warn('[WeaponSystem] listener', e); }
    }
  }

  list() {
    return listWeapons().map((w) => ({
      ...w,
      unlocked: this.unlocked.has(w.id),
      calib: this._calib[w.id] || null
    }));
  }

  getEquippedDef() {
    if (!this.equippedId) return null;
    return this._mergeCalib(getWeaponDef(this.equippedId));
  }

  /** Mount efectivo = pistol-grip en espacio personaje (−Z adelante) */
  getMount() {
    const def = this.getEquippedDef();
    return def?.hold?.mount || def?.mount || { x: 12, y: this.charHeight * 0.58, z: -50, rx: 0, ry: 0, rz: 0 };
  }

  getAdsMount() {
    const def = this.getEquippedDef();
    return def?.hold?.adsMount || def?.adsMount || { x: 4, y: this.charHeight * 0.78, z: -40, rx: 0, ry: 0, rz: 0 };
  }

  getHold() {
    return this.getEquippedDef()?.hold || null;
  }

  getGrip() {
    return this.getEquippedDef()?.grip || null;
  }

  getAdsGrip() {
    return this.getEquippedDef()?.adsGrip || this.getGrip();
  }

  _readCalib() {
    try {
      return JSON.parse(localStorage.getItem(CALIB_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  saveCalib(weaponId, partial) {
    this._calib[weaponId] = { ...(this._calib[weaponId] || {}), ...partial };
    localStorage.setItem(CALIB_KEY, JSON.stringify(this._calib));
    this._emit();
  }

  _mergeCalib(def) {
    if (!def) return null;
    const c = this._calib[def.id];
    const hold = def.hold
      ? {
          ...def.hold,
          mount: { ...def.hold.mount, ...(c?.mount || {}) },
          adsMount: { ...def.hold.adsMount, ...(c?.adsMount || {}) },
          gripR: { ...def.hold.gripR, ...(c?.gripR || {}) },
          gripL: { ...def.hold.gripL, ...(c?.gripL || {}) }
        }
      : null;
    const base = {
      ...def,
      hold,
      mount: hold?.mount || { ...def.mount, ...(c?.mount || {}) },
      adsMount: hold?.adsMount || { ...(def.adsMount || def.mount), ...(c?.adsMount || {}) },
      muzzle: { ...def.muzzle, ...(c?.muzzle || {}) },
      lengthFrac: c?.lengthFrac ?? def.lengthFrac,
      heightCapFrac: c?.heightCapFrac ?? def.heightCapFrac,
      grip: c?.grip || def.grip,
      adsGrip: c?.adsGrip || def.adsGrip
    };
    return base;
  }

  /**
   * Equipa por id. parent = weaponMount del SurfaceWalker.
   * @returns {Promise<boolean>}
   */
  async equip(id, parent) {
    const def = getWeaponDef(id);
    if (!def || !this.unlocked.has(id)) return false;
    if (!parent) return false;

    const gen = ++this._loadGen;
    const built = await this._getOrLoad(def);
    if (gen !== this._loadGen) return false;

    // Quitar arma anterior del mount (mantener cache)
    while (parent.children.length) parent.remove(parent.children[0]);

    parent.add(built.root);
    this.weaponRoot = built.root;
    this.muzzle = built.muzzle;
    this.muzzleFlash = built.flash;
    this.equippedId = id;
    localStorage.setItem(EQUIP_KEY, id);
    this._emit();
    return true;
  }

  async equipSlot(slot, parent) {
    const def = getWeaponBySlot(slot);
    if (!def) return false;
    return this.equip(def.id, parent);
  }

  /** Restaura última arma o slot 1 */
  async equipDefault(parent) {
    const saved = localStorage.getItem(EQUIP_KEY);
    const id = (saved && getWeaponDef(saved)) ? saved : WEAPON_DEFS[0].id;
    return this.equip(id, parent);
  }

  cycle(dir, parent) {
    const list = WEAPON_DEFS.filter((w) => this.unlocked.has(w.id));
    if (!list.length) return Promise.resolve(false);
    let idx = list.findIndex((w) => w.id === this.equippedId);
    if (idx < 0) idx = 0;
    idx = (idx + dir + list.length * 10) % list.length;
    return this.equip(list[idx].id, parent);
  }

  /**
   * Styloo en Three: Y=arriba, X=largo, Z=fino.
   * Solo rota para cañón → Z; voltea para boca en −Z.
   */
  _orientBarrelUp(model) {
    model.rotation.order = 'XYZ';
    model.rotation.set(0, 0, 0);
    model.updateMatrixWorld(true);

    const sizeOf = () => {
      model.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    };

    let size = sizeOf();
    if (size.x >= size.y && size.x >= size.z) {
      // +X → +Z (culata atrás); −X → −Z (boca)
      model.rotation.y = -Math.PI / 2;
    } else if (size.y >= size.x && size.y >= size.z) {
      model.rotation.x = Math.PI / 2;
    } else if (size.z < size.x || size.z < size.y) {
      // ya casi en Z pero por si acaso
      model.rotation.y = -Math.PI / 2;
    }

    model.updateMatrixWorld(true);
    size = sizeOf();
    // Si quedó de canto (X > Y), corregir roll
    if (size.x > size.y * 1.15) {
      model.rotation.z = -Math.PI / 2;
      model.updateMatrixWorld(true);
    }

    const box = new THREE.Box3().setFromObject(model);
    const zMin = box.min.z;
    const zMax = box.max.z;
    const L = Math.max(zMax - zMin, 1e-6);
    const avgY = (a, b) => {
      let sum = 0;
      let n = 0;
      const v = new THREE.Vector3();
      model.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        const pos = o.geometry.attributes?.position;
        if (!pos) return;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          if (v.z < a || v.z > b) continue;
          sum += v.y;
          n++;
        }
      });
      return n ? sum / n : 0;
    };
    const tipY = avgY(zMin, zMin + L * 0.2);
    const buttY = avgY(zMax - L * 0.2, zMax);
    // Mag/grip cuelgan → underside más bajo. Eso debe quedar hacia la culata (+Z), no la boca.
    // Preferir meshes con nombre de culata (Styloo: akderriere) en +Z
    let stockZ = null;
    model.traverse((o) => {
      if (!o.isMesh) return;
      const n = (o.name || '').toLowerCase();
      if (!/(derriere|stock|butt|culata)/.test(n)) return;
      const b = new THREE.Box3().setFromObject(o);
      stockZ = 0.5 * (b.min.z + b.max.z);
    });
    if (stockZ != null) {
      if (stockZ < 0) {
        model.rotation.y += Math.PI;
        model.updateMatrixWorld(true);
      }
    } else if (tipY < buttY) {
      model.rotation.y += Math.PI;
      model.updateMatrixWorld(true);
    }
  }

  /**
   * Grips por along del hold + altura real del mesh en esa estación.
   */
  _detectGripPoints(model, box, hold) {
    const zMin = box.min.z;
    const zMax = box.max.z;
    const L = Math.max(zMax - zMin, 1e-3);
    const halfW = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), L * 0.05);
    const alongR = THREE.MathUtils.clamp(hold?.gripR?.along ?? 0.82, 0.55, 0.95);
    let alongL = THREE.MathUtils.clamp(hold?.gripL?.along ?? 0.4, 0.15, 0.6);
    alongL = Math.min(alongL, alongR - 0.28);

    const yAtAlong = (along) => {
      const z = zMin + along * L;
      const band = L * 0.05;
      let minY = Infinity;
      const v = new THREE.Vector3();
      model.updateMatrixWorld(true);
      model.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        const pos = o.geometry.attributes?.position;
        if (!pos) return;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          if (Math.abs(v.z - z) > band) continue;
          if (v.y < minY) minY = v.y;
        }
      });
      if (!Number.isFinite(minY)) return box.min.y + (box.max.y - box.min.y) * 0.15;
      return minY + (box.max.y - box.min.y) * 0.06;
    };

    return {
      gripR: new THREE.Vector3(halfW * (hold?.gripR?.x ?? 0.22), yAtAlong(alongR), zMin + alongR * L),
      gripL: new THREE.Vector3(halfW * (hold?.gripL?.x ?? -0.4), yAtAlong(alongL), zMin + alongL * L)
    };
  }

  async _getOrLoad(def) {
    const merged = this._mergeCalib(def);
    const cacheKey = `${def.id}@${merged.lengthFrac}@${merged.heightCapFrac ?? 0.16}@hold26`;
    if (this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }

    const gltf = await this.loader.loadAsync(def.modelUrl);
    const model = gltf.scene;
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      o.castShadow = false;
      o.receiveShadow = false;
      if (o.material) {
        o.material.metalness = Math.min(o.material.metalness ?? 0.35, 0.7);
        o.material.roughness = Math.min(Math.max(o.material.roughness ?? 0.45, 0.28), 0.72);
        o.material.envMapIntensity = 1.05;
        o.material.needsUpdate = true;
      }
    });

    const box0 = new THREE.Box3().setFromObject(model);
    const size0 = box0.getSize(new THREE.Vector3());
    const longest = Math.max(size0.x, size0.y, size0.z, 1e-4);
    const targetLen = this.charHeight * merged.lengthFrac;
    model.scale.setScalar(targetLen / longest);

    this._orientBarrelUp(model);

    // Cap altura: meshes cortos/gordos (PEW, MAC) no deben volverse pistolas-monstruo.
    model.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(model);
    const ht = Math.max(box.max.y - box.min.y, 1e-4);
    const maxHt = this.charHeight * (merged.heightCapFrac ?? 0.16);
    if (ht > maxHt) {
      model.scale.multiplyScalar(maxHt / ht);
      model.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(model);
    }

    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    model.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model);

    const root = new THREE.Group();
    root.name = `Weapon_${def.id}`;
    root.userData.weaponId = def.id;
    root.add(model);

    const zMin = box.min.z;
    const zMax = box.max.z;
    const L = Math.max(zMax - zMin, 1e-3);
    const hold = merged.hold || {
      twoHand: def.category !== 'pistol',
      gripR: { along: 0.82, x: 0.35, y: -0.55 },
      gripL: { along: 0.42, x: -0.55, y: -0.55 }
    };

    const auto = this._detectGripPoints(model, box, hold);
    const halfW = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), L * 0.08);
    const halfH = Math.max(0.5 * (box.max.y - box.min.y), L * 0.06);
    const yMid = 0.5 * (box.min.y + box.max.y);
    const alongToZ = (along) => THREE.MathUtils.lerp(zMin, zMax, THREE.MathUtils.clamp(along, 0, 1));

    const gripR = new THREE.Object3D();
    gripR.name = 'gripR';
    if (auto?.gripR && hold.autoGrip !== false) {
      gripR.position.copy(auto.gripR);
    } else {
      gripR.position.set(
        (hold.gripR?.x ?? 0.35) * halfW,
        yMid + (hold.gripR?.y ?? -0.55) * halfH,
        alongToZ(hold.gripR?.along ?? 0.82)
      );
    }
    root.add(gripR);

    const gripL = new THREE.Object3D();
    gripL.name = 'gripL';
    if (auto?.gripL && hold.autoGrip !== false) {
      gripL.position.copy(auto.gripL);
    } else {
      gripL.position.set(
        (hold.gripL?.x ?? -0.55) * halfW,
        yMid + (hold.gripL?.y ?? -0.55) * halfH,
        alongToZ(hold.gripL?.along ?? 0.42)
      );
    }
    root.add(gripL);

    const origin = gripR.position.clone();
    model.position.sub(origin);
    gripR.position.set(0, 0, 0);
    gripL.position.sub(origin);

    const muzzle = new THREE.Object3D();
    muzzle.name = 'muzzle';
    muzzle.position.set(0, Math.max(2, halfH * 0.15), zMin - origin.z);
    root.add(muzzle);

    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(5.5, 10, 10),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(3.2, 2.4, 0.9),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    flash.position.copy(muzzle.position);
    flash.visible = false;
    root.add(flash);

    const twoHand = hold.twoHand !== false && def.category !== 'pistol';
    const packed = { root, muzzle, flash, gripR, gripL, targetLen, defId: def.id, twoHand, hold };
    this._cache.set(cacheKey, packed);
    return packed;
  }

  /** Markers de agarre del arma equipada. */
  getGripMarkers() {
    const root = this.weaponRoot;
    if (!root) return null;
    const hold = this.getHold();
    return {
      gripR: root.getObjectByName('gripR'),
      gripL: root.getObjectByName('gripL'),
      twoHand: hold ? hold.twoHand !== false : this.getEquippedDef()?.category !== 'pistol'
    };
  }
}
