import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Environment } from './Environment.js';
import { CONFIG } from '../config.js';
import { Player } from './Player.js';
import { EnemyManager } from './EnemyManager.js';
import { MissionManager } from './MissionManager.js';

window.onerror = function(msg, url, line, col, error) {
    const errorDiv = document.createElement('div');
    errorDiv.style.position = 'absolute';
    errorDiv.style.top = '10%';
    errorDiv.style.left = '10%';
    errorDiv.style.color = 'red';
    errorDiv.style.backgroundColor = 'rgba(0,0,0,0.8)';
    errorDiv.style.padding = '20px';
    errorDiv.style.zIndex = '9999';
    errorDiv.innerHTML = `<h2>CRASH:</h2><p>${msg}</p><p>Line: ${line}</p><p>${error ? error.stack : ''}</p>`;
    document.body.appendChild(errorDiv);
};

class Game {
    constructor() {
        this.init();
    }

    init() {
        this.loadingManager = new THREE.LoadingManager();
        this.loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
            const progress = (itemsLoaded / itemsTotal) * 100;
            const bar = document.getElementById('loading-bar');
            const text = document.getElementById('loading-text');
            if (bar) bar.style.width = progress + '%';
            if (text) text.innerText = `Loading Assets: ${Math.round(progress)}%`;
        };
        this.loadingManager.onLoad = () => {
            // Precompilar shaders para evitar tirones (stutter) al descubrir enemigos nuevos
            this.renderer.compile(this.scene, this.camera);

            const screen = document.getElementById('loading-screen');
            const ui = document.getElementById('ui');
            if (screen) screen.style.display = 'none';
            if (ui) ui.style.display = 'flex';
        };

        this.gltfLoader = new GLTFLoader(this.loadingManager);

        this.scene = new THREE.Scene();
        // Atmósfera de atardecer/crepúsculo natural
        this.scene.background = new THREE.Color(0x3377aa);
        this.scene.fog = new THREE.FogExp2(0x3377aa, 0.00025); // Niebla exponencial más suave

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 4000);

        this.mouse = new THREE.Vector2();
        this.raycaster = new THREE.Raycaster();

        this.renderer = new THREE.WebGLRenderer({ antialias: false }); // Desactivar AA base para el postprocesado
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        document.body.appendChild(this.renderer.domElement);

        // Post-Processing (Brillo/Resplandor Neón)
        const renderScene = new RenderPass(this.scene, this.camera);
        
        // Ajustamos el Bloom con los valores de config.js para reducir la ceguera del sol
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            CONFIG.GRAPHICS.BLOOM_INTENSITY, // strength (antes 1.5)
            0.4, // radius
            CONFIG.GRAPHICS.BLOOM_THRESHOLD // threshold (antes 0.85)
        );

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(renderScene);
        this.composer.addPass(this.bloomPass);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05; 
        this.controls.minDistance = 20;
        this.controls.maxDistance = 2500; // Restaurado para permitir alejar la cámara con la rueda del mouse
        
        // Pirate Galaxy style: Right click rotates camera, Left click targets
        this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.NONE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.ROTATE
        };
        // La cámara inicial es controlada por el Player, así que asignamos el target
        this.controls.target.set(0, 50, 4000);

        window.addEventListener('resize', this.onWindowResize.bind(this));
        window.addEventListener('pointerdown', this.onPointerDown.bind(this));
        
        // Evitar el menú contextual al hacer clic derecho para rotar cámara
        window.addEventListener('contextmenu', (e) => e.preventDefault());

        this.environment = new Environment(this.scene, this.loadingManager);
        this.player = new Player(this.scene, this.camera, this.gltfLoader);
        this.enemyManager = new EnemyManager(this.scene, this.player, this.gltfLoader);
        this.missionManager = new MissionManager(this.player, this.enemyManager);

        // Conectar el sistema de misiones con las muertes de enemigos
        this.enemyManager.onEnemyKilled = (enemyType, enemyName) => {
            this.missionManager.onEnemyKilled(enemyType, enemyName);
        };

        // Targeting System
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        window.addEventListener('pointerdown', this.onPointerDown.bind(this));

        // Minimap Navigation
        const minimap = document.getElementById('minimap');
        if (minimap) {
            minimap.addEventListener('click', (e) => {
                const rect = minimap.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                // Convert minimap px (0-200) to World coords (-6000 to 6000)
                const worldX = (x / 200) * 12000 - 6000;
                const worldZ = (y / 200) * 12000 - 6000;
                this.player.activateAutoPilot(new THREE.Vector3(worldX, 50, worldZ));
            });
        }

        // UI Modal Listeners
        window.addEventListener('keydown', (e) => {
            const k = e.key.toLowerCase();
            if (k === 'j') {
                const mb = document.getElementById('mission-board-modal');
                mb.style.display = mb.style.display === 'none' ? 'flex' : 'none';
            }
            if (k === 'h') {
                const hb = document.getElementById('hangar-modal');
                hb.style.display = hb.style.display === 'none' ? 'flex' : 'none';
            }
        });

        document.getElementById('close-mission-board').addEventListener('click', () => {
            document.getElementById('mission-board-modal').style.display = 'none';
        });
        document.getElementById('close-hangar').addEventListener('click', () => {
            document.getElementById('hangar-modal').style.display = 'none';
        });

        // Eventos del Hangar
        document.getElementById('btn-buy-ship-5').addEventListener('click', () => {
            if (this.player.level >= 5) {
                if (typeof this.player.upgradeShipToLevel5 === 'function') {
                    this.player.upgradeShipToLevel5();
                } else {
                    // Fallback inline si el método no está disponible
                    console.error('upgradeShipToLevel5 no encontrado en Player');
                }
                document.getElementById('hangar-modal').style.display = 'none';
            } else {
                const needed = 5 - this.player.level;
                alert(`Necesitas ${needed} nivel(es) más para comprar esta nave. (Nivel actual: ${this.player.level})`);
            }
        });

        this.clock = new THREE.Clock();
        this.animate();
    }

    onPointerDown(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);

        const intersects = this.raycaster.intersectObjects(this.enemyManager.enemies, true);

        if (intersects.length > 0) {
            let object = intersects[0].object;
            while(object.parent && !object.userData.isEnemy) {
                object = object.parent;
            }
            if (object.userData.isEnemy) {
                this.player.setTarget(object);
                return;
            }
        }
        
        // Si el usuario hace clic en el vacío con el botón derecho (para girar la cámara), NO deseleccionamos al bot
        if (event.button !== 2) {
            this.player.setTarget(null);
        }
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
    }

    animate() {
        requestAnimationFrame(this.animate.bind(this));

        let delta = this.clock.getDelta();

        // Evitar el "Tab Inactive Bug": Si cambias de pestaña, el navegador pausa el juego.
        // Al regresar, el delta puede ser altísimo (ej. 10 segundos).
        // Limitamos el delta a 0.1s para que el juego simplemente "pause" en vez de acelerar todo de golpe.
        if (delta > 0.1) delta = 0.1;

        this.player.update(delta, this.enemyManager, this.environment, this.controls);
        this.enemyManager.update(delta, this.environment);
        this.environment.update(this.player.position, this.player.velocity); // chunk streaming + sombras + estelas de agua

        // Actualizar Minimapa del Jugador
        const pDot = document.getElementById('minimap-player');
        if (pDot) {
            // El mapa es de 24000x24000 (desde -12000 a +12000)
            const pX = (this.player.position.x + 12000) / 24000 * 200;
            const pZ = (this.player.position.z + 12000) / 24000 * 200;
            
            // Calcular hacia dónde mira el jugador en base a su velocidad
            let angleDeg = 0;
            if (this.player.velocity && this.player.velocity.lengthSq() > 0.1) {
                // atan2(x, -z) nos da el ángulo correcto porque en la pantalla CSS arriba es -Y y en 3D adelante es -Z
                angleDeg = Math.atan2(this.player.velocity.x, -this.player.velocity.z) * (180 / Math.PI);
            }
            
            pDot.style.left = `${pX}px`;
            pDot.style.top = `${pZ}px`;
            pDot.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
        }

        this.composer.render();
    }
}

new Game();
