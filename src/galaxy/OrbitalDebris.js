import * as THREE from 'three';

/** Meteoritos / escombros en estratosfera — profundidad explorable al subir. */
export class OrbitalDebris {
    constructor(scene) {
        this.group = new THREE.Group();
        this.group.name = 'orbital_debris';
        this.group.frustumCulled = false;
        this.group.visible = false;
        scene.add(this.group);

        this._count = 64;
        this._intensity = 0;
        this._items = [];

        const rockGeo = new THREE.IcosahedronGeometry(1, 0);
        const rockMat = new THREE.MeshStandardMaterial({
            color: 0x6a5a4a,
            roughness: 0.92,
            metalness: 0.08,
            flatShading: true,
        });

        for (let i = 0; i < this._count; i++) {
            const mesh = new THREE.Mesh(rockGeo, rockMat.clone());
            mesh.material.color.setHSL(0.08 + Math.random() * 0.06, 0.2, 0.28 + Math.random() * 0.18);
            const scale = 8 + Math.random() * 42;
            mesh.scale.setScalar(scale);
            this._respawn(mesh, true);
            this.group.add(mesh);
            this._items.push({
                mesh,
                spin: new THREE.Vector3(
                    (Math.random() - 0.5) * 1.2,
                    (Math.random() - 0.5) * 1.2,
                    (Math.random() - 0.5) * 1.2,
                ),
                drift: 20 + Math.random() * 80,
            });
        }
    }

    _respawn(mesh, scatter) {
        const spread = scatter ? 28000 : 18000;
        mesh.position.set(
            (Math.random() - 0.5) * spread,
            (Math.random() - 0.5) * spread * 0.6,
            (Math.random() - 0.5) * spread - 4000 - Math.random() * 12000,
        );
    }

    setIntensity(t) {
        this._intensity = THREE.MathUtils.clamp(t, 0, 1);
        this.group.visible = this._intensity > 0.08;
    }

    update(camera, delta) {
        if (this._intensity <= 0.08 || !camera) return;

        this.group.position.copy(camera.position);
        this.group.quaternion.copy(camera.quaternion);

        const dt = Math.min(delta, 0.05);
        for (const item of this._items) {
            const m = item.mesh;
            m.position.z += item.drift * dt * (0.6 + this._intensity);
            m.rotation.x += item.spin.x * dt;
            m.rotation.y += item.spin.y * dt;
            m.rotation.z += item.spin.z * dt;
            if (m.position.z > 6000) this._respawn(m, false);
        }
    }

    dispose() {
        this.group.parent?.remove(this.group);
        for (const item of this._items) {
            item.mesh.geometry?.dispose();
            item.mesh.material?.dispose();
        }
    }
}
