import * as THREE from 'three';

/**
 * Minimapa orbital: cubo 3D con ejes fijos, planeta y flecha de rumbo.
 * El jugador está siempre en el centro; el cubo muestra la orientación del espacio.
 */
export class OrbitalMinimap3D {
    constructor(container) {
        this.container = container;
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'minimap-cube3d-canvas';
        container.appendChild(this.canvas);

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            alpha: true,
            antialias: true,
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 0);

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 50);
        this.camera.position.set(2.35, 1.65, 2.35);
        this.camera.lookAt(0, 0, 0);

        const amb = new THREE.AmbientLight(0x8899aa, 0.85);
        this.scene.add(amb);
        const dir = new THREE.DirectionalLight(0xffffff, 1.1);
        dir.position.set(2, 3, 2);
        this.scene.add(dir);

        // Cubo wireframe (referencia espacial, no rota con la nave)
        const cubeGeo = new THREE.BoxGeometry(2, 2, 2);
        const cubeEdges = new THREE.EdgesGeometry(cubeGeo);
        this._cube = new THREE.LineSegments(
            cubeEdges,
            new THREE.LineBasicMaterial({ color: 0x5a8aaa, transparent: true, opacity: 0.55 }),
        );
        this.scene.add(this._cube);

        // Ejes X/Y/Z dentro del cubo
        this._axes = new THREE.Group();
        this._addAxis(0xff5566, new THREE.Vector3(1, 0, 0), 'X');
        this._addAxis(0x66dd88, new THREE.Vector3(0, 1, 0), 'Y');
        this._addAxis(0x6699ff, new THREE.Vector3(0, 0, 1), 'Z');
        this.scene.add(this._axes);

        // Flecha de rumbo (gira con la nave)
        this._heading = new THREE.Group();
        const shaftGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.72, 8);
        const shaftMat = new THREE.MeshBasicMaterial({ color: 0x7fe4ff });
        const shaft = new THREE.Mesh(shaftGeo, shaftMat);
        shaft.rotation.x = Math.PI / 2;
        shaft.position.z = -0.36;
        const tipGeo = new THREE.ConeGeometry(0.09, 0.22, 8);
        const tip = new THREE.Mesh(tipGeo, shaftMat);
        tip.rotation.x = Math.PI / 2;
        tip.position.z = -0.83;
        this._heading.add(shaft, tip);
        this.scene.add(this._heading);

        // Punto central = tú
        const youGeo = new THREE.SphereGeometry(0.07, 10, 10);
        const youMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this._you = new THREE.Mesh(youGeo, youMat);
        this.scene.add(this._you);

        this._planetGroup = new THREE.Group();
        this.scene.add(this._planetGroup);

        this._planetMeshes = [];
        this._planetGlowMeshes = [];
        this._homeMat = new THREE.MeshStandardMaterial({
            color: 0x3a9a58,
            emissive: 0x2a7040,
            emissiveIntensity: 0.55,
            roughness: 0.55,
        });
        this._otherMat = new THREE.MeshStandardMaterial({
            color: 0x4a9a68,
            emissive: 0x1a5540,
            emissiveIntensity: 0.45,
            roughness: 0.6,
        });
        this._twinMat = new THREE.MeshStandardMaterial({
            color: 0x5ab888,
            emissive: 0x2a8060,
            emissiveIntensity: 0.5,
            roughness: 0.55,
        });
        this._homeGlowMat = new THREE.MeshBasicMaterial({
            color: 0x88ddff,
            transparent: true,
            opacity: 0.38,
        });
        this._twinGlowMat = new THREE.MeshBasicMaterial({
            color: 0x66eecc,
            transparent: true,
            opacity: 0.32,
        });
        this._otherGlowMat = new THREE.MeshBasicMaterial({
            color: 0x8899aa,
            transparent: true,
            opacity: 0.18,
        });
        this._selectedMat = new THREE.MeshStandardMaterial({
            color: 0xffee88,
            emissive: 0xffaa44,
            emissiveIntensity: 0.85,
            roughness: 0.45,
        });
        this._selectedGlowMat = new THREE.MeshBasicMaterial({
            color: 0xffcc66,
            transparent: true,
            opacity: 0.55,
        });

        this._visible = false;
        this._pickData = [];
        this._onPick = null;
        this._pickBound = false;
        this._tmpQuat = new THREE.Quaternion();
        this._tmpVec = new THREE.Vector3();
        this._resize();
    }

    _addAxis(color, dir, _label) {
        const pts = [new THREE.Vector3(0, 0, 0), dir.clone().multiplyScalar(0.92)];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
        this._axes.add(line);
    }

    _resize() {
        if (!this.container) return;
        const w = this.container.clientWidth || 200;
        const h = this.container.clientHeight || 200;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / Math.max(h, 1);
        this.camera.updateProjectionMatrix();
    }

    setVisible(on) {
        this._visible = !!on;
        this.container.style.display = on ? 'block' : 'none';
        if (on) this._resize();
    }

    setPickHandler(fn) {
        this._onPick = typeof fn === 'function' ? fn : null;
        if (!this._pickBound && this.canvas) {
            this._pickBound = true;
            this.canvas.style.cursor = 'pointer';
            this.canvas.addEventListener('click', (e) => this._handlePick(e));
        }
    }

    _handlePick(e) {
        if (!this._onPick || !this._pickData.length) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        let best = null;
        let bestD = Infinity;
        for (const p of this._pickData) {
            const d = Math.hypot(x - p.sx, y - p.sy);
            if (d <= p.r + 14 && d < bestD) {
                best = p;
                bestD = d;
            }
        }
        if (best?.id) this._onPick(best.id);
    }

    _ensurePlanetSlot(i) {
        while (this._planetMeshes.length <= i) {
            const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), this._otherMat);
            const glow = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), this._otherGlowMat);
            this._planetGroup.add(sphere, glow);
            this._planetMeshes.push(sphere);
            this._planetGlowMeshes.push(glow);
        }
    }

    /**
     * @param {{ forward: THREE.Vector3, up: THREE.Vector3, planets: Array<{ name: string, center: THREE.Vector3, radius: number, isHome?: boolean }> }} data
     * @param {THREE.Vector3} playerPos
     */
    update(data, playerPos) {
        if (!this._visible || !data) return;
        this._resize();

        let maxR = 8000;
        for (const p of data.planets) {
            maxR = Math.max(maxR, playerPos.distanceTo(p.center));
        }
        const inv = 1 / (maxR * 1.05);
        const w = this.canvas.clientWidth || 200;
        const h = this.canvas.clientHeight || 200;
        this._pickData = [];

        for (let i = 0; i < data.planets.length; i++) {
            const p = data.planets[i];
            this._ensurePlanetSlot(i);
            const sphere = this._planetMeshes[i];
            const glow = this._planetGlowMeshes[i];

            const rel = p.center.clone().sub(playerPos).multiplyScalar(inv);
            rel.clampScalar(-0.9, 0.9);

            const r = THREE.MathUtils.clamp(p.radius * inv, 0.07, p.isHome ? 0.42 : (p.isTwin ? 0.22 : 0.28));
            sphere.geometry.dispose();
            sphere.geometry = new THREE.SphereGeometry(r, 14, 10);
            if (p.selected) {
                sphere.material = this._selectedMat;
                glow.material = this._selectedGlowMat;
            } else {
                sphere.material = p.isHome ? this._homeMat : (p.isTwin ? this._twinMat : this._otherMat);
                glow.material = p.isHome ? this._homeGlowMat : (p.isTwin ? this._twinGlowMat : this._otherGlowMat);
            }
            sphere.position.copy(rel);
            sphere.visible = true;

            glow.geometry.dispose();
            glow.geometry = new THREE.SphereGeometry(r * 1.22, 10, 8);
            glow.position.copy(rel);
            glow.visible = true;

            const ndc = rel.clone().project(this.camera);
            const sx = (ndc.x * 0.5 + 0.5) * w;
            const sy = (-ndc.y * 0.5 + 0.5) * h;
            const screenR = Math.max(8, r * Math.min(w, h) * 0.42);
            if (p.id) {
                this._pickData.push({ id: p.id, sx, sy, r: screenR });
            }
        }

        for (let i = data.planets.length; i < this._planetMeshes.length; i++) {
            this._planetMeshes[i].visible = false;
            this._planetGlowMeshes[i].visible = false;
        }

        const fwd = data.forward;
        if (fwd.lengthSq() > 0.001) {
            this._tmpVec.set(0, 0, -1);
            this._tmpQuat.setFromUnitVectors(this._tmpVec, fwd.clone().normalize());
            this._heading.quaternion.copy(this._tmpQuat);
        }

        this.renderer.render(this.scene, this.camera);
    }

    dispose() {
        this.renderer.dispose();
        this.canvas.remove();
    }
}
