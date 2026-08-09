import * as THREE from 'three';

/**
 * Chorro de lava compartido: preview y planeta usan EXACTAMENTE el mismo VFX.
 * Capas: core (boca) → flame → ember → haze.
 */
export const BREATH_DURATION = 1.65;
export const BREATH_CAPACITY = 720;

function makeTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,230,1)');
  g.addColorStop(0.15, 'rgba(255,200,80,0.95)');
  g.addColorStop(0.4, 'rgba(255,100,20,0.7)');
  g.addColorStop(0.7, 'rgba(180,40,8,0.3)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function makeMaterial(tex, baseSize, { logDepth = false } = {}) {
  const uniforms = {
    map: { value: tex },
    uSize: { value: baseSize },
    uOpacity: { value: 1 },
    uTime: { value: 0 }
  };
  if (logDepth) {
    uniforms.logDepthBufFC = { value: 2.0 / (Math.log(1e8 + 1.0) / Math.LN2) };
  }

  const vertLog = logDepth
    ? `#include <common>\n#include <logdepthbuf_pars_vertex>\n`
    : '';
  const vertLogEnd = logDepth ? `\n#include <logdepthbuf_vertex>` : '';
  const fragLog = logDepth
    ? `#include <common>\n#include <logdepthbuf_pars_fragment>\n`
    : '';
  const fragLogEnd = logDepth ? `\n#include <logdepthbuf_fragment>` : '';

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      ${vertLog}
      attribute float aLife;
      attribute float aSeed;
      uniform float uSize;
      uniform float uTime;
      varying float vLife;
      varying float vSeed;
      void main() {
        vLife = clamp(aLife, 0.0, 1.0);
        vSeed = aSeed;
        float birth = smoothstep(0.0, 0.08, vLife);
        float death = 1.0 - smoothstep(0.5, 1.0, vLife);
        float role = aSeed;
        float grow;
        if (role < 0.3)
          grow = mix(0.55, 0.85, role / 0.3) * (0.7 + 0.4 * birth * death);
        else if (role < 0.65)
          grow = mix(0.9, 1.35, (role - 0.3) / 0.35) * (0.55 + 0.7 * birth * death) * (1.0 + vLife * 0.35);
        else if (role < 0.82)
          grow = mix(0.35, 0.55, (role - 0.65) / 0.17) * (0.6 + 0.5 * birth * death);
        else
          grow = mix(1.1, 1.7, (role - 0.82) / 0.18) * (0.4 + 0.6 * birth) * death * (1.0 + vLife * 0.9);
        float flicker = 0.92 + 0.08 * sin(uTime * 22.0 + aSeed * 50.0);
        float sz = aLife < 0.0 ? 0.0 : uSize * grow * flicker;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float atten = 900.0 / max(80.0, -mv.z);
        gl_PointSize = clamp(sz * atten, 5.0, 110.0);
        gl_Position = projectionMatrix * mv;${vertLogEnd}
      }
    `,
    fragmentShader: `
      ${fragLog}
      uniform sampler2D map;
      uniform float uOpacity;
      uniform float uTime;
      varying float vLife;
      varying float vSeed;
      void main() {
        if (vLife < 0.0) discard;
        vec2 uv = gl_PointCoord;
        uv.x += sin(uTime * 10.0 + vSeed * 25.0) * 0.025 * (1.0 - vLife);
        vec4 tex = texture2D(map, uv);
        float role = vSeed;
        vec3 col;
        float alphaMul;
        if (role < 0.3) {
          col = mix(vec3(1.0, 0.98, 0.75), vec3(1.0, 0.55, 0.12), smoothstep(0.0, 0.55, vLife));
          alphaMul = mix(0.95, 0.35, vLife);
        } else if (role < 0.65) {
          col = mix(vec3(1.0, 0.85, 0.35), vec3(1.0, 0.35, 0.05), smoothstep(0.0, 0.4, vLife));
          col = mix(col, vec3(0.55, 0.12, 0.02), smoothstep(0.35, 0.9, vLife));
          alphaMul = mix(0.75, 0.2, vLife);
        } else if (role < 0.82) {
          col = mix(vec3(1.0, 0.95, 0.6), vec3(1.0, 0.4, 0.05), vLife);
          alphaMul = mix(1.0, 0.0, smoothstep(0.4, 1.0, vLife));
        } else {
          col = mix(vec3(1.0, 0.55, 0.25), vec3(0.25, 0.1, 0.05), vLife);
          alphaMul = mix(0.28, 0.0, vLife);
        }
        float edge = smoothstep(0.52, 0.1, length(gl_PointCoord - 0.5));
        float a = tex.a * alphaMul * uOpacity * edge * (0.88 + 0.12 * sin(vSeed * 18.0 + uTime * 14.0));
        if (a < 0.025) discard;
        gl_FragColor = vec4(col * (0.85 + 0.9 * (1.0 - vLife)), a);${fragLogEnd}
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false
  });
}

export class LavaBreathVFX {
  /**
   * @param {THREE.Object3D} parent
   * @param {{ logDepth?: boolean, baseSize?: number, capacity?: number, up?: THREE.Vector3 }} [opts]
   */
  constructor(parent, opts = {}) {
    this.parent = parent;
    this.capacity = opts.capacity ?? BREATH_CAPACITY;
    this.baseSize = opts.baseSize ?? 64;
    this.up = (opts.up || new THREE.Vector3(0, 1, 0)).clone();
    this.logDepth = !!opts.logDepth;

    this._tex = makeTexture();
    this._mat = makeMaterial(this._tex, this.baseSize, { logDepth: this.logDepth });

    const N = this.capacity;
    this.positions = new Float32Array(N * 3);
    this.aLife = new Float32Array(N);
    this.aSeed = new Float32Array(N);
    for (let i = 0; i < N; i++) this.aLife[i] = -1;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.aLife, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(this.aSeed, 1));

    this.mesh = new THREE.Points(geo, this._mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    parent.add(this.mesh);

    this.pVel = Array.from({ length: N }, () => new THREE.Vector3());
    this.pAge = new Float32Array(N);
    this.pMax = new Float32Array(N);
    this.cursor = 0;
    this.emitting = false;
    this.breathT = 0;
    this.breathDur = BREATH_DURATION;
    this.hitPlayer = false;
    this.alive = 0;

    this._right = new THREE.Vector3();
    this._aimUp = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
  }

  setUp(up) {
    this.up.copy(up).normalize();
  }

  _alloc() {
    const N = this.capacity;
    for (let k = 0; k < N; k++) {
      const i = (this.cursor + k) % N;
      if (this.aLife[i] < 0) {
        this.cursor = (i + 1) % N;
        return i;
      }
    }
    const i = this.cursor % N;
    this.cursor = (i + 1) % N;
    return i;
  }

  _basis(aim) {
    this._right.crossVectors(aim, this.up);
    if (this._right.lengthSq() < 1e-6) this._right.set(1, 0, 0).cross(aim);
    this._right.normalize();
    this._aimUp.crossVectors(this._right, aim).normalize();
  }

  start() {
    this.emitting = true;
    this.breathT = 0;
    this.hitPlayer = false;
  }

  stop() {
    this.emitting = false;
  }

  get isEmitting() {
    return this.emitting;
  }

  /**
   * Emitir un frame de soplo.
   * @param {THREE.Vector3} muzzle
   * @param {THREE.Vector3} aim unit
   * @param {number} dist
   * @param {number} intensity 0..1
   */
  emitFrame(muzzle, aim, dist, intensity) {
    const surge = 0.75 + 0.35 * Math.sin(this.breathT * 9.0);
    const dens = 1;

    const coreN = Math.floor((5 + intensity * 9) * dens * surge);
    for (let i = 0; i < coreN; i++) this._emitCore(muzzle, aim, intensity);

    const flameN = Math.floor((4 + intensity * 8) * dens * surge);
    for (let i = 0; i < flameN; i++) this._emitFlame(muzzle, aim, dist, intensity);

    const emberN = Math.floor(2 + intensity * 3);
    for (let i = 0; i < emberN; i++) this._emitEmber(muzzle, aim, dist);

    const hazeN = Math.floor(2 + intensity * 4);
    for (let i = 0; i < hazeN; i++) {
      this._emitHaze(muzzle, aim, dist, 0.4 + Math.random() * 0.48, intensity);
    }
  }

  _emitCore(muzzle, aim, intensity) {
    const idx = this._alloc();
    this._basis(aim);
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * (3 + intensity * 5);
    this.positions[idx * 3] = muzzle.x + this._right.x * Math.cos(a) * r + this._aimUp.x * Math.sin(a) * r;
    this.positions[idx * 3 + 1] = muzzle.y + this._right.y * Math.cos(a) * r + this._aimUp.y * Math.sin(a) * r;
    this.positions[idx * 3 + 2] = muzzle.z + this._right.z * Math.cos(a) * r + this._aimUp.z * Math.sin(a) * r;
    const speed = 700 + Math.random() * 500;
    const cone = 0.02;
    this.pVel[idx]
      .copy(aim).multiplyScalar(speed)
      .addScaledVector(this._right, (Math.random() - 0.5) * speed * cone)
      .addScaledVector(this._aimUp, (Math.random() - 0.5) * speed * cone);
    this.pAge[idx] = 0;
    this.pMax[idx] = 0.2 + Math.random() * 0.15;
    this.aLife[idx] = 0;
    this.aSeed[idx] = Math.random() * 0.28;
  }

  _emitFlame(muzzle, aim, dist, intensity) {
    const idx = this._alloc();
    this._basis(aim);
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * (5 + intensity * 8);
    this.positions[idx * 3] = muzzle.x + this._right.x * Math.cos(a) * r + this._aimUp.x * Math.sin(a) * r;
    this.positions[idx * 3 + 1] = muzzle.y + this._right.y * Math.cos(a) * r + this._aimUp.y * Math.sin(a) * r;
    this.positions[idx * 3 + 2] = muzzle.z + this._right.z * Math.cos(a) * r + this._aimUp.z * Math.sin(a) * r;
    const travel = dist * 0.93;
    const flight = THREE.MathUtils.clamp(dist / 1600, 0.45, 1.2);
    const speed = travel / flight;
    const cone = 0.045;
    this.pVel[idx]
      .copy(aim).multiplyScalar(speed)
      .addScaledVector(this._right, (Math.random() - 0.5) * speed * cone)
      .addScaledVector(this.up, 15 + Math.random() * 30);
    this.pAge[idx] = 0;
    this.pMax[idx] = flight;
    this.aLife[idx] = 0;
    this.aSeed[idx] = 0.3 + Math.random() * 0.34;
  }

  _emitEmber(muzzle, aim, dist) {
    const idx = this._alloc();
    this._basis(aim);
    this.positions[idx * 3] = muzzle.x;
    this.positions[idx * 3 + 1] = muzzle.y;
    this.positions[idx * 3 + 2] = muzzle.z;
    const flight = THREE.MathUtils.clamp(dist / 1500, 0.4, 1.1);
    const speed = ((dist * 0.93) / flight) * 1.1;
    this.pVel[idx]
      .copy(aim).multiplyScalar(speed)
      .addScaledVector(this._right, (Math.random() - 0.5) * speed * 0.06)
      .addScaledVector(this.up, 30 + Math.random() * 70);
    this.pAge[idx] = 0;
    this.pMax[idx] = flight;
    this.aLife[idx] = 0;
    this.aSeed[idx] = 0.66 + Math.random() * 0.15;
  }

  _emitHaze(muzzle, aim, dist, t01, intensity) {
    const t = THREE.MathUtils.clamp(t01, 0.35, 0.88);
    const idx = this._alloc();
    this._basis(aim);
    const a = Math.random() * Math.PI * 2;
    const flare = 8 + t * t * (35 + intensity * 30);
    const r = Math.random() * flare;
    const along = dist * t;
    this.positions[idx * 3] = muzzle.x + aim.x * along + this._right.x * Math.cos(a) * r;
    this.positions[idx * 3 + 1] = muzzle.y + aim.y * along + this._right.y * Math.cos(a) * r;
    this.positions[idx * 3 + 2] = muzzle.z + aim.z * along + this._right.z * Math.cos(a) * r;
    const drift = 100 + Math.random() * 180;
    this.pVel[idx]
      .copy(aim).multiplyScalar(drift)
      .addScaledVector(this.up, 25 + Math.random() * 40);
    this.pAge[idx] = 0;
    this.pMax[idx] = 0.22 + Math.random() * 0.2;
    this.aLife[idx] = 0;
    this.aSeed[idx] = 0.84 + Math.random() * 0.15;
  }

  /**
   * @param {number} dt
   * @param {{ target?: THREE.Vector3, killNear?: number, fadeNear?: number, onHit?: () => void }} [opts]
   */
  update(dt, opts = {}) {
    if (this.emitting) {
      this.breathT += dt;
      if (this.breathT >= this.breathDur) this.emitting = false;
    }

    const target = opts.target || null;
    const killNear = opts.killNear ?? 180;
    const fadeNear = opts.fadeNear ?? 450;
    const killR2 = killNear * killNear;
    const fadeR2 = fadeNear * fadeNear;
    const hitR = opts.hitRadius ?? 220;
    const hitR2 = hitR * hitR;

    let alive = 0;
    const N = this.capacity;
    for (let s = 0; s < N; s++) {
      if (this.aLife[s] < 0) continue;
      this.pAge[s] += dt;
      let lifeU = this.pAge[s] / Math.max(1e-4, this.pMax[s]);
      if (lifeU >= 1) {
        this.aLife[s] = -1;
        continue;
      }

      if (target) {
        const dx = this.positions[s * 3] - target.x;
        const dy = this.positions[s * 3 + 1] - target.y;
        const dz = this.positions[s * 3 + 2] - target.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < killR2) {
          this.aLife[s] = -1;
          continue;
        }
        if (d2 < fadeR2) {
          const d = Math.sqrt(d2);
          const nearFade = THREE.MathUtils.clamp((d - killNear) / (fadeNear - killNear), 0, 1);
          lifeU = Math.min(1, lifeU + (1 - nearFade) * 0.45);
          if (lifeU >= 1) {
            this.aLife[s] = -1;
            continue;
          }
        }
        if (!this.hitPlayer && this.aSeed[s] > 0.3 && this.aSeed[s] < 0.85 && d2 < hitR2) {
          this.hitPlayer = true;
          if (typeof opts.onHit === 'function') opts.onHit();
        }
      }

      alive++;
      this.aLife[s] = lifeU;
      const vx = this.pVel[s];
      const seed = this.aSeed[s];
      if (seed < 0.3) vx.addScaledVector(this.up, -8 * dt);
      else if (seed < 0.65) vx.addScaledVector(this.up, -20 * dt);
      else if (seed < 0.82) vx.addScaledVector(this.up, -35 * dt);
      else vx.addScaledVector(this.up, -12 * dt);

      this.positions[s * 3] += vx.x * dt;
      this.positions[s * 3 + 1] += vx.y * dt;
      this.positions[s * 3 + 2] += vx.z * dt;
    }
    this.alive = alive;

    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.aLife.needsUpdate = true;
    this.mesh.geometry.attributes.aSeed.needsUpdate = true;
    this._mat.uniforms.uTime.value += dt;
    this._mat.uniforms.uSize.value = this.baseSize;
    this._mat.uniforms.uOpacity.value = this.emitting
      ? 1
      : Math.max(0, Math.min(1, alive / 40));
  }

  clear() {
    for (let i = 0; i < this.capacity; i++) this.aLife[i] = -1;
    this.emitting = false;
    this.alive = 0;
  }

  dispose() {
    this.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this._mat.dispose();
    this._tex.dispose();
  }
}
