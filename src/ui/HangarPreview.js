import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { fitPlayerShipModel, boostPlayerShipMaterials, PLAYER_SHIP_ROTATION_Y } from '../ships/fitPlayerShipModel.js';
import { getPlayerShipTargetLength, getPlayerShipRotationY } from '../ships/playerShipVisuals.js';
import { getShipById } from '../ships/playerShipCatalog.js';
import { resolveModelUrl } from '../ships/resolveModelUrl.js';

/** Visor 3D de naves dentro del modal de hangar. */
export class HangarPreview {
    constructor(canvas) {
        this.canvas = canvas;
        
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
        
        this._loader = new GLTFLoader();
        this._loader.setDRACOLoader(dracoLoader);
        
        this._shipId = null;
        this._running = false;
        this._raf = 0;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a1420);

        this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 500);
        this.camera.position.set(0, 28, 95);

        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: false,
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        
        // --- STUDIO LIGHTING PARA PBR (Naves Metálicas) ---
        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        pmremGenerator.compileEquirectangularShader();
        const envScene = new THREE.Scene();
        envScene.background = new THREE.Color(0x0a1420);
        const light1 = new THREE.DirectionalLight(0xffffee, 8);
        light1.position.set(100, 200, 150);
        const light2 = new THREE.DirectionalLight(0x44aaff, 5);
        light2.position.set(-100, -50, -100);
        const light3 = new THREE.PointLight(0xffffff, 4, 1000);
        light3.position.set(0, -100, 100);
        envScene.add(light1, light2, light3);
        this.scene.environment = pmremGenerator.fromScene(envScene).texture;
        // ----------------------------------------------------

        const amb = new THREE.AmbientLight(0xffffff, 1.2);
        const key = new THREE.DirectionalLight(0xffffff, 1.5);
        key.position.set(40, 60, 50);
        const rim = new THREE.DirectionalLight(0x44ccff, 1.0);
        rim.position.set(-30, 20, -40);
        this.scene.add(amb, key, rim);

        this._pivot = new THREE.Group();
        this.scene.add(this._pivot);
    }

    resize() {
        if (!this.canvas?.parentElement) return;
        const w = this.canvas.parentElement.clientWidth || 320;
        const h = this.canvas.parentElement.clientHeight || 220;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    showShip(shipId) {
        if (!shipId || shipId === this._shipId) return;
        this._shipId = shipId;
        const def = getShipById(shipId);

        this._pivot.clear();
        const url = resolveModelUrl(def.glb);
        this._loader.load(
            url,
            (gltf) => {
                if (this._shipId !== shipId) return;
                const model = gltf.scene.clone(true);
                boostPlayerShipMaterials(model);
                fitPlayerShipModel(model, getPlayerShipTargetLength(def));
                const rot = new THREE.Group();
                rot.rotation.y = getPlayerShipRotationY(def);
                rot.add(model);
                this._pivot.add(rot);
            },
            undefined,
            (err) => {
                console.warn('[HangarPreview] GLB no cargado:', url, err);
                const geo = new THREE.BoxGeometry(12, 4, 28);
                const mesh = new THREE.Mesh(
                    geo,
                    new THREE.MeshStandardMaterial({ color: 0x334455, metalness: 0.7, roughness: 0.35 }),
                );
                this._pivot.add(mesh);
            },
        );
    }

    start() {
        if (this._running) return;
        this._running = true;
        this.resize();
        const tick = () => {
            if (!this._running) return;
            this._raf = requestAnimationFrame(tick);
            this._pivot.rotation.y += 0.006;
            this.renderer.render(this.scene, this.camera);
        };
        tick();
    }

    stop() {
        this._running = false;
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = 0;
    }

    dispose() {
        this.stop();
        this._pivot.clear();
        this.renderer.dispose();
    }
}
