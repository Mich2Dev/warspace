import * as THREE from 'three';
import { TerrainBuilder } from './TerrainBuilder.js';

/**
 * Bruma / vapor suave sobre magma (partículas que suben y se expanden, no columnas).
 */
export class LavaVapor {
  constructor(planetGroup, radius, biome = 'Lava') {
    this.planetGroup = planetGroup;
    this.radius = radius;
    this.biome = biome;
    this.group = new THREE.Group();
    this.group.name = 'LavaVapor';
    planetGroup.add(this.group);

    this.count = 72;
    const geo = new THREE.PlaneGeometry(1, 1);

    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,220,190,0.55)');
    g.addColorStop(0.35, 'rgba(180,120,90,0.22)');
    g.addColorStop(0.7, 'rgba(60,40,35,0.06)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);

    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      color: 0xffc8a0,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, this.count);
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
    this.group.add(this.mesh);

    this._dummy = new THREE.Object3D();
    this._dir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._localCam = new THREE.Vector3();
    this._phase = new Float32Array(this.count);
    this._life = new Float32Array(this.count);
    this._speed = new Float32Array(this.count);
    this._size0 = new Float32Array(this.count);
    this._baseDir = [];
    for (let i = 0; i < this.count; i++) {
      this._phase[i] = Math.random();
      this._life[i] = Math.random();
      this._speed[i] = 0.12 + Math.random() * 0.22;
      this._size0[i] = 0.7 + Math.random() * 0.9;
      this._baseDir.push(new THREE.Vector3(0, 1, 0));
    }
    this._ready = false;
    this._accum = 99;
  }

  _pickLavaDirs(camLocalDir) {
    const axis = Math.abs(camLocalDir.y) > 0.85
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
    this._right.crossVectors(axis, camLocalDir).normalize();
    this._fwd.crossVectors(camLocalDir, this._right).normalize();
    let placed = 0;
    for (let attempt = 0; attempt < this.count * 10 && placed < this.count; attempt++) {
      const ang = attempt * 1.618 + placed;
      const arc = 0.004 + (attempt % 13) * 0.0048;
      this._dir.copy(camLocalDir)
        .addScaledVector(this._fwd, Math.cos(ang) * arc)
        .addScaledVector(this._right, Math.sin(ang) * arc)
        .normalize();
      const h = TerrainBuilder.getHeight(this._dir, this.radius, this.biome, false);
      if (h - this.radius < -35) {
        this._baseDir[placed].copy(this._dir);
        placed++;
      }
    }
    if (placed === 0) {
      for (let i = 0; i < this.count; i++) this._baseDir[i].copy(camLocalDir);
    } else {
      for (let i = placed; i < this.count; i++) {
        this._baseDir[i].copy(this._baseDir[i % placed]);
      }
    }
    this._ready = true;
  }

  update(cameraWorldPos, delta = 0.016) {
    this._localCam.copy(cameraWorldPos);
    this.planetGroup.worldToLocal(this._localCam);
    const alt = this._localCam.length() - this.radius;
    if (alt > this.radius * 0.07 || alt < -200) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;

    this._accum += delta;
    if (!this._ready || this._accum > 2.8) {
      this._accum = 0;
      this._pickLavaDirs(this._localCam.clone().normalize());
    }

    const baseS = this.radius * 0.0022;

    for (let i = 0; i < this.count; i++) {
      this._life[i] += delta * this._speed[i];
      if (this._life[i] > 1) {
        this._life[i] = 0;
        this._phase[i] = Math.random();
        this._speed[i] = 0.1 + Math.random() * 0.25;
        this._size0[i] = 0.65 + Math.random() * 1.1;
      }

      const t = this._life[i];
      // Ease: nace cerca del suelo, sube poco, se ensancha y se desvanece
      const rise = t * t * (180 + this._phase[i] * 90);
      const fade = t < 0.15 ? t / 0.15 : t > 0.55 ? 1 - (t - 0.55) / 0.45 : 1;
      const grow = 0.55 + t * 1.35;

      const dir = this._baseDir[i];
      const h = TerrainBuilder.getHeight(dir, this.radius, this.biome, false);
      const wobble = Math.sin(this._phase[i] * 40 + t * 6) * 18 * t;
      const wobble2 = Math.cos(this._phase[i] * 25 + t * 5) * 14 * t;

      // Tangentes locales al radial
      const axis = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      this._right.crossVectors(axis, dir).normalize();
      this._fwd.crossVectors(dir, this._right).normalize();

      this._dummy.position.copy(dir).multiplyScalar(h + 8 + rise)
        .addScaledVector(this._right, wobble)
        .addScaledVector(this._fwd, wobble2);

      // Billboard suave (puff redondo, no columna)
      this._dummy.up.copy(dir);
      this._dummy.lookAt(this._localCam);

      const s = baseS * this._size0[i] * grow * Math.max(0.05, fade);
      // Ancho ≈ alto: nube, no cono
      this._dummy.scale.set(s * 1.35, s * 1.15, s);
      this._dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this._dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.material.opacity = THREE.MathUtils.clamp(
      0.42 - alt / (this.radius * 0.12),
      0.08,
      0.38
    );
  }

  setVisible(v) {
    if (!v) this.group.visible = false;
  }
}
