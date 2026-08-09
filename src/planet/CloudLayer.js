import * as THREE from 'three';

/**
 * Soft cloud shell around a planet — billowy flattened spheres that drift slowly.
 */
export class CloudLayer {
  constructor(planetGroup, radius, biome = 'Terran') {
    this.group = new THREE.Group();
    this.group.name = 'CloudLayer';
    planetGroup.add(this.group);

    const count = biome === 'Terran' ? 120
      : biome === 'GasGiant' ? 160
      : biome === 'Lava' ? 90
      : 60;
    const shellMin = biome === 'Lava' ? radius * 1.02 : radius * 1.035;
    const shellMax = biome === 'Lava' ? radius * 1.065 : radius * 1.09;

    const geo = new THREE.SphereGeometry(1, 8, 6);
    geo.scale(1.8, 0.45, 1.4);

    const mat = new THREE.MeshBasicMaterial({
      color: biome === 'Toxic' ? 0xaaff66
        : biome === 'Ice' ? 0xddeeff
        : biome === 'Lava' ? 0x3a2218
        : 0xffffff,
      transparent: true,
      opacity: biome === 'GasGiant' ? 0.35 : biome === 'Lava' ? 0.22 : 0.42,
      depthWrite: false,
      side: THREE.FrontSide
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = true;
    this.mesh.raycast = () => {};
    this.group.add(this.mesh);

    const dummy = new THREE.Object3D();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1
      ).normalize();
      const r = shellMin + Math.random() * (shellMax - shellMin);
      dummy.position.copy(dir).multiplyScalar(r);
      dummy.quaternion.setFromUnitVectors(up, dir);
      dummy.rotateY(Math.random() * Math.PI * 2);
      const s = radius * (biome === 'Lava'
        ? (0.02 + Math.random() * 0.045)
        : (0.012 + Math.random() * 0.028));
      dummy.scale.set(s, s * (0.55 + Math.random() * 0.55), s);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.drift = 0.00008 + Math.random() * 0.00006;
  }

  update(delta) {
    this.group.rotation.y += this.drift * delta * 60;
  }

  setVisible(v) {
    this.group.visible = v;
  }
}
