import * as THREE from 'three';

/**
 * Local weather near the camera: rain streaks + intensity for audio/wind hooks.
 */
export class WeatherSystem {
  constructor(scene) {
    this.scene = scene;
    this.intensity = 0;
    this.targetIntensity = 0;
    this.count = 1400;

    const positions = new Float32Array(this.count * 3);
    for (let i = 0; i < this.count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 900;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 500;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 900;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.material = new THREE.PointsMaterial({
      color: 0xaaccff,
      size: 4.5,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);

    this._phase = 0;
  }

  /**
   * @param {{ inAtmo: boolean, altitude: number, biome: string, nearSurface: boolean }} ctx
   */
  update(delta, camera, ctx = {}) {
    const { inAtmo, altitude = 0, biome = 'Terran', nearSurface = false } = ctx;

    // Lluvia solo en franja alta / nubes — NUNCA al caminar (parecía “sucio” girando)
    let want = 0;
    if (inAtmo && biome === 'Terran' && nearSurface && !ctx.onFoot) {
      if (altitude > 4000 && altitude < 18000) {
        want = THREE.MathUtils.smoothstep(altitude, 4000, 7000) * 0.45;
        want += THREE.MathUtils.smoothstep(altitude, 9000, 14000) * 0.4;
      }
    } else if (inAtmo && biome === 'Toxic' && !ctx.onFoot) {
      want = nearSurface && altitude > 2000 ? 0.35 : 0.1;
    }

    this.targetIntensity = want;
    this.intensity += (this.targetIntensity - this.intensity) * Math.min(1, delta * 1.2);

    if (this.intensity < 0.02) {
      this.points.visible = false;
      this.material.opacity = 0;
      return;
    }

    this.points.visible = true;
    this.material.opacity = Math.min(0.85, this.intensity * 0.9);
    this.material.color.setHex(biome === 'Toxic' ? 0x88ff44 : 0xaaccff);

    // Follow camera
    this.points.position.copy(camera.position);
    this.points.quaternion.copy(camera.quaternion);

    const pos = this.points.geometry.attributes.position;
    const arr = pos.array;
    const fall = 420 * delta * (0.6 + this.intensity);
    this._phase += delta;

    for (let i = 0; i < this.count; i++) {
      arr[i * 3 + 1] -= fall * (0.7 + (i % 5) * 0.08);
      if (arr[i * 3 + 1] < -250) {
        arr[i * 3] = (Math.random() - 0.5) * 900;
        arr[i * 3 + 1] = 200 + Math.random() * 280;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 900;
      }
    }
    pos.needsUpdate = true;
  }
}
