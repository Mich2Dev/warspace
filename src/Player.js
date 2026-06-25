import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class Player {
    constructor(scene, camera, gltfLoader) {
        this.scene = scene;
        this.camera = camera;
        this.gltfLoader = gltfLoader;
        this.position = new THREE.Vector3(0, 50, 0); // Centro del mapa
        this.velocity = new THREE.Vector3();
        // Equipamiento e Inventario
        this.equipment = {
            weapon: {
                id: 'w_01', name: 'Cañón Láser de Iones', type: 'weapon', level: 1, manufacturer: 'Industrias Terran',
                description: 'Un arma de energía estándar y confiable usada por las fuerzas de patrulla fronteriza.',
                stats: { damage: 5, energyCost: 5 }
            },
            missile: {
                id: 'm_01', name: 'Lanzador de Ojivas Pesadas', type: 'missile', level: 1, manufacturer: 'Vulcan Corp',
                description: 'Ojivas de detonación por proximidad diseñadas para control de masas y demolición de enjambres.',
                stats: { areaDamageMultiplier: 30, cooldown: 2.0 }
            },
            engine: {
                id: 'e_01', name: 'Propulsores Térmicos Mark I', type: 'engine', level: 1, manufacturer: 'AeroSpace Dynamics',
                description: 'Propulsores de inyección de plasma. Robustos pero consumen mucha energía al usar el Nitro.',
                stats: { speed: 250, nitroMultiplier: 2.5 }
            },
            hull: {
                id: 'h_01', name: 'Blindaje de Titanio', type: 'hull', level: 1, manufacturer: 'Industrias Terran',
                description: 'Aleación estándar que ofrece protección moderada contra impactos balísticos y láseres de baja intensidad.',
                stats: { maxHp: 100, maxEnergy: 100 }
            },
            shield: {
                id: 's_01', name: 'Generador de Escudo de Iones', type: 'shield', level: 1, manufacturer: 'Aegis Dynamics',
                description: 'Proyecta una burbuja de energía de alta densidad alrededor de la nave capaz de absorber daño temporalmente.',
                stats: { shieldHp: 300, duration: 15.0, cooldown: 30.0 }
            }
        };

        // RPG Stats derivados del equipamiento
        this.level = 1;
        this.xp = 0;
        this.xpToNextLevel = 100;
        
        this.maxHp = this.equipment.hull.stats.maxHp;
        this.hp = this.maxHp;
        this.maxEnergy = this.equipment.hull.stats.maxEnergy;
        this.energy = this.maxEnergy;
        
        this.baseDamage = this.equipment.weapon.stats.damage;
        this.speed = this.equipment.engine.stats.speed;
        this.missileCooldown = this.equipment.missile.stats.cooldown;
        
        // Shield state
        this.shieldActive = false;
        this.shieldHp = 0;
        this.shieldTimer = 0;
        this.lastShieldTime = 0;
        
        this.keys = {
            w: false, a: false, s: false, d: false, " ": false, tab: false, '1': false, '2': false, '3': false, i: false, rightClick: false
        };

        this.autoPilot = false;
        this.autoPilotTarget = null;
        this.isDead = false;
        this.target = null;
        this.navTarget = null;
        this.damageShake = 0;

        this.lasers = [];
        this.missiles = [];

        // Caché de Geometrías y Materiales para proyectiles (Evita Stuttering/Lag al disparar)
        this.laserGeo = new THREE.CylinderGeometry(0.8, 0.8, 120, 8); // Más fino y largo
        this.laserGeo.rotateX(Math.PI / 2);
        this.laserMat = new THREE.MeshStandardMaterial({ 
            color: 0x00ffff, 
            emissive: 0x00ffff,
            emissiveIntensity: 2.5, // Brillo reducido para que no se vea tan gordo con el Bloom
            transparent: true, 
            opacity: 0.9, 
            blending: THREE.AdditiveBlending 
        });

        // Misil (Torpedo de Plasma)
        this.missileGeo = new THREE.CylinderGeometry(2, 2, 40, 8); // Más estilizado
        this.missileGeo.rotateX(Math.PI / 2);
        this.missileMat = new THREE.MeshStandardMaterial({ 
            color: 0xff3300, 
            emissive: 0xff3300,
            emissiveIntensity: 4.0,
            transparent: true,
            blending: THREE.AdditiveBlending
        });

        // Caché de luces de explosión (Añadir/quitar luces fuerza recompilación de shaders)
        this.explosionLights = [];
        for(let i=0; i<3; i++) {
            const light = new THREE.PointLight(0xffaa00, 0, 800);
            this.scene.add(light);
            this.explosionLights.push(light);
        }
        this.currentLightIndex = 0;

        // Caché para el efecto de Level Up
        this.levelUpLight = new THREE.PointLight(0xffaa00, 0, 400);
        this.scene.add(this.levelUpLight);
        this.lvlRingGeo1 = new THREE.RingGeometry(10, 15, 32);
        this.lvlRingGeo2 = new THREE.RingGeometry(18, 20, 32);
        this.lvlRingMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 1.0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
        this.lvlPMat = new THREE.PointsMaterial({ color: 0xffffff, size: 3, blending: THREE.AdditiveBlending, transparent: true });
        this.lvlCanvas = document.createElement('canvas');
        this.lvlCanvas.width = 512;
        this.lvlCanvas.height = 256;
        this.lvlCtx = this.lvlCanvas.getContext('2d');
        this.lvlCtx.fillRect(0,0,1,1); // Inicializar
        this.lvlTex = new THREE.CanvasTexture(this.lvlCanvas);
        this.lvlSpriteMat = new THREE.SpriteMaterial({ map: this.lvlTex, transparent: true, blending: THREE.AdditiveBlending });

        this.lastMissileTime = 0;
        this.lastShotTime = 0;
        this.lastDamageTime = 0; // Para el auto-reparador

        this.initModel();
        this.initControls();
        this.initInventoryUI();
        
        this.time = 0;
        this.updateUI();

        // Downward raycaster
        this.raycasterDown = new THREE.Raycaster();
        this.raycasterDown.ray.direction.set(0, -1, 0);

        // Set initial camera position relative to player
        this.camera.position.copy(this.position).add(new THREE.Vector3(0, 150, 400)); 

        // Crear textura de Plasma Fuego Real (gradiente multicolor)
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)'); // Núcleo blanco hirviendo
        grad.addColorStop(0.15, 'rgba(0, 255, 255, 0.9)'); // Borde interior Cyan intenso
        grad.addColorStop(0.4, 'rgba(0, 100, 255, 0.5)'); // Cola azul oscuro
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)'); // Desvanecimiento suave
        ctx.fillStyle = grad;
        ctx.fillRect(0,0,64,64);
        this.flareTexture = new THREE.CanvasTexture(canvas);

        this.trailParticles = [];
        this.particleGeo = new THREE.PlaneGeometry(4.0, 4.0); // Tamaño balanceado para optimización
        this.particleMat = new THREE.MeshBasicMaterial({ 
            color: 0xffffff, // Blanco puro para que la textura pinte los colores reales
            map: this.flareTexture,
            transparent: true, 
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        
        this.flares = []; // Guardar referencia a los flares para animarlos
    }

    initModel() {
        this.mesh = new THREE.Group();
        this.scene.add(this.mesh);
        this.mesh.position.copy(this.position);

        // Visuals
        this.visualGroup = new THREE.Group();
        this.mesh.add(this.visualGroup);

        // Cargamos el modelo del jugador desde la carpeta public/models/player
        this.gltfLoader.load(
            '/models/player/shock_lvl1.glb',
            (gltf) => {
                const model = gltf.scene;
                
                // Usamos la escala configurada en config.js
                model.scale.set(CONFIG.VISUALS.PLAYER_SCALE, CONFIG.VISUALS.PLAYER_SCALE, CONFIG.VISUALS.PLAYER_SCALE);
                
                model.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        // MAGIA GLB: Potenciar luces nativas del jugador también
                        if (child.material && child.material.emissive && (child.material.emissive.r > 0 || child.material.emissive.g > 0 || child.material.emissive.b > 0)) {
                            child.material = Array.isArray(child.material) ? child.material.map(m => m.clone()) : child.material.clone();
                            child.material.emissiveIntensity = 8.0;
                        }
                    }
                });

                // Forzamos la rotación usando un grupo intermedio inmutable
                const rotationGroup = new THREE.Group();
                rotationGroup.rotation.y = 0; // Si Pi es atrás, 0 es el frente exacto
                rotationGroup.add(model);

                // FORZAR ACTUALIZACIÓN DE MATRIZ
                // Esto es CRÍTICO: Si no se actualiza, el Bounding Box se calcula con la escala 1x
                // en lugar de la escala masiva PLAYER_SCALE, dejando todas las luces metidas en el centro.
                model.updateMatrixWorld(true);

                // Calcular el Bounding Box absoluto para ignorar el pivote (origen) del artista 3D
                // LOGICA ROBUSTA DE GEOMETRÍA:
                const box = new THREE.Box3().setFromObject(model);
                const size = new THREE.Vector3();
                const center = new THREE.Vector3();
                box.getSize(size);
                box.getCenter(center);
                
                // Asumiendo que la nave vuela hacia -Z, la cola siempre será el máximo absoluto en Z (box.max.z)
                const tailZ = box.max.z;

                // AJUSTE FINO (Fine-tuning): 
                // En lugar de guardar Vectores crudos, creamos "Anclajes" (Dummies 3D) invisibles
                // y los atamos al rotationGroup. Así heredan TODAS las rotaciones (Roll, Pitch, Yaw)
                // y las estelas nunca se salen de lado cuando la nave gira.
                const offsetData = [
                    // Medios Superiores (Ligeramente separados y un tilín más abajo)
                    new THREE.Vector3(center.x - (size.x * 0.04), center.y + (size.y * 0.03), tailZ - (size.z * 0.12)),
                    new THREE.Vector3(center.x + (size.x * 0.04), center.y + (size.y * 0.03), tailZ - (size.z * 0.12)),
                    // Medio Inferior
                    new THREE.Vector3(center.x, center.y - (size.y * 0.06), tailZ - (size.z * 0.12)), 
                    // Alas 
                    new THREE.Vector3(center.x - (size.x * 0.18), center.y - (size.y * 0.13), tailZ - (size.z * 0.15)),
                    new THREE.Vector3(center.x + (size.x * 0.18), center.y - (size.y * 0.13), tailZ - (size.z * 0.15))
                ];

                this.engineAnchors = [];
                offsetData.forEach(pos => {
                    const dummy = new THREE.Object3D();
                    dummy.position.copy(pos);
                    rotationGroup.add(dummy); // Anclado físicamente a la rotación de la malla
                    this.engineAnchors.push(dummy);
                });

                // Ya NO creamos Sprites artificiales (Flares)
                this.flares = [];

                this.visualGroup.add(rotationGroup);
                console.log("Shock Lvl1 Model Loaded Successfully! Anchors:", this.engineAnchors.length);
            }, undefined, (error) => {
                console.warn('Could not load shock_lvl1.glb. Falling back to code model.');
                this.buildFallbackModel();
            });

        // Shield Bubble Visual (Radio 30 para cubrir toda la nave)
        const shieldGeo = new THREE.SphereGeometry(30, 32, 32);
        const shieldMat = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.3,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        this.shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
        this.shieldMesh.visible = false;
        this.mesh.add(this.shieldMesh);
    }

    upgradeShipToLevel5() {
        if (this.shipLevel === 5) return; // Ya está mejorada
        this.shipLevel = 5;

        // Upgrade Stats
        this.maxHp = 400;
        this.hp = 400;
        this.baseDamage = 15;
        this.speed = 200;
        this.equipment.hull.stats.maxHp = 400;
        this.equipment.weapon.stats.damage = 15;
        this.equipment.engine.stats.speed = 200;

        // Visual Effect
        this.levelUpLight.position.copy(this.mesh.position);
        this.levelUpLight.intensity = 5;
        setTimeout(() => { this.levelUpLight.intensity = 0; }, 1000);
        
        // Tratar de acceder a MissionManager a través del DOM o evento (evitar acoplamiento circular)
        const uiPanel = document.getElementById('transmission-panel');
        if (uiPanel) {
            const textEl = document.getElementById('transmission-text');
            const nameEl = document.getElementById('transmission-name');
            nameEl.innerText = 'Aegis Command';
            nameEl.style.color = '#ffaa00';
            textEl.textContent = 'NUEVA NAVE DESBLOQUEADA: HEAVY JUGGERNAUT. Sistemas ofensivos en línea.';
            uiPanel.style.display = 'flex';
        }

        // Swap Model
        this.gltfLoader.load('/models/naves_player/lvl5/navelvl10.glb', (gltf) => {
            const newModel = gltf.scene;
            newModel.scale.set(CONFIG.VISUALS.PLAYER_SCALE, CONFIG.VISUALS.PLAYER_SCALE, CONFIG.VISUALS.PLAYER_SCALE);
            // Ajustar rotación: la nave mira al +Z por defecto, así que usamos PI para invertirla
            newModel.rotation.y = Math.PI;  // Probar 0, Math.PI/2, -Math.PI/2 si sigue de lado
            
            newModel.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = false; // Sombras desactivadas para evitar glitch y lag
                    child.receiveShadow = true;
                    // Mejorar materiales: activar metalness/roughness y toneMapping
                    if (child.material) {
                        child.material.metalness = child.material.metalness ?? 0.5;
                        child.material.roughness = child.material.roughness ?? 0.4;
                        child.material.needsUpdate = true;
                    }
                }
            });

            // Reemplazar el modelo antiguo dentro del visualGroup
            this.visualGroup.clear();

            // Forzamos la rotación usando un grupo intermedio inmutable
            const rotationGroup = new THREE.Group();
            rotationGroup.rotation.y = Math.PI; // navelvl10 mira al revés
            rotationGroup.add(newModel);

            // Actualizar Matrices para calcular Bounding Box
            newModel.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(newModel);
            const size = new THREE.Vector3();
            const center = new THREE.Vector3();
            box.getSize(size);
            box.getCenter(center);
            
            const tailZ = box.max.z;

            // Recalcular Anclajes de Motores para la nueva nave (3 propulsores)
            const offsetData = [
                new THREE.Vector3(center.x, center.y + (size.y * 0.1), tailZ - (size.z * 0.1)),
                new THREE.Vector3(center.x - (size.x * 0.2), center.y, tailZ - (size.z * 0.15)),
                new THREE.Vector3(center.x + (size.x * 0.2), center.y, tailZ - (size.z * 0.15))
            ];

            this.engineAnchors = [];
            offsetData.forEach(pos => {
                const dummy = new THREE.Object3D();
                dummy.position.copy(pos);
                rotationGroup.add(dummy);
                this.engineAnchors.push(dummy);
            });

            this.visualGroup.add(rotationGroup);
            
            // Move shield if exists
            if (this.shieldMesh) {
                this.mesh.add(this.shieldMesh);
            }
        });
        
        this.updateUI();
    }

    buildFallbackModel() {
        // Fuselaje principal (Largo y aerodinámico)
        const fuselageGeo = new THREE.CylinderGeometry(0.5, 1.5, 12, 16);
        fuselageGeo.rotateX(Math.PI / 2);
        const fuselageMat = new THREE.MeshStandardMaterial({ color: 0x555566, metalness: 0.8, roughness: 0.2 });
        const fuselage = new THREE.Mesh(fuselageGeo, fuselageMat);
        fuselage.castShadow = true;
        this.mesh.add(fuselage);

        // Morro/Nariz (Puntiaguda)
        const noseGeo = new THREE.ConeGeometry(0.5, 4, 16);
        noseGeo.rotateX(Math.PI / 2);
        const nose = new THREE.Mesh(noseGeo, fuselageMat);
        nose.position.set(0, 0, -8);
        nose.castShadow = true;
        this.mesh.add(nose);

        // Cabina (Cristal Oscuro Tintado)
        const cockpitGeo = new THREE.CapsuleGeometry(0.6, 2, 8, 16);
        cockpitGeo.rotateX(Math.PI / 2);
        const glassMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.0, transparent: true, opacity: 0.8 });
        const cockpit = new THREE.Mesh(cockpitGeo, glassMat);
        cockpit.position.set(0, 0.8, -3);
        cockpit.rotation.x = -0.1;
        this.mesh.add(cockpit);

        // Alas principales (En flecha)
        const wingGeo = new THREE.BoxGeometry(10, 0.2, 5);
        const wingMat = new THREE.MeshStandardMaterial({ color: 0x442266, metalness: 0.7, roughness: 0.3 }); // Toque púrpura militar
        const wing = new THREE.Mesh(wingGeo, wingMat);
        wing.position.set(0, 0, 1);
        wing.rotation.x = -0.05;
        wing.castShadow = true;
        this.mesh.add(wing);

        // Aleta de cola vertical
        const tailGeo = new THREE.BoxGeometry(0.2, 2.5, 3);
        const tail = new THREE.Mesh(tailGeo, wingMat);
        tail.position.set(0, 1.5, 4.5);
        tail.rotation.x = -0.2;
        this.mesh.add(tail);

        // Estabilizadores traseros horizontales
        const stabGeo = new THREE.BoxGeometry(4, 0.2, 2);
        const stab = new THREE.Mesh(stabGeo, fuselageMat);
        stab.position.set(0, 0.2, 5);
        this.mesh.add(stab);

        // Misiles bajo las alas
        const missileGeo = new THREE.CylinderGeometry(0.2, 0.2, 3, 8);
        missileGeo.rotateX(Math.PI / 2);
        const missileMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.5 });
        
        const m1 = new THREE.Mesh(missileGeo, missileMat);
        m1.position.set(-3.5, -0.3, 1);
        this.mesh.add(m1);
        
        const m2 = new THREE.Mesh(missileGeo, missileMat);
        m2.position.set(3.5, -0.3, 1);
        this.mesh.add(m2);

        // Motor central brillante
        const engineMat = new THREE.MeshBasicMaterial({ color: 0xff00ff }); // Púrpura/Rosa
        const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.0, 0.5, 16), engineMat);
        engine.rotateX(Math.PI / 2);
        engine.position.set(0, 0, 6.2);
        this.mesh.add(engine);
    }

    initControls() {
        document.addEventListener('keydown', (e) => {
            const k = e.key.toLowerCase();
            if (k === 'tab') {
                e.preventDefault();
                this.keys.tab = true;
                return;
            }
            if (e.key === 'Shift') {
                this.keys.shift = true;
                return;
            }
            if(this.keys.hasOwnProperty(k)) this.keys[k] = true;
            if(e.key === ' ') this.keys[' '] = true;
            if(k === 'e') this.keys['e'] = true;
            if(k === '1') this.keys['1'] = true;
            if(k === '2') this.keys['2'] = true;
            if(k === '3') this.keys['3'] = true;
            if(k === 'i') {
                this.toggleInventory();
                return;
            }
            
            // --- TELEPORT CHEATS PARA TESTEO ---
            if(k === '7') {
                this.position.set(CONFIG.ZONES.ZONA1.x, 200, CONFIG.ZONES.ZONA1.z);
                this.velocity.set(0,0,0);
            }
            if(k === '8') {
                this.position.set(CONFIG.ZONES.ZONA2.x, 200, CONFIG.ZONES.ZONA2.z);
                this.velocity.set(0,0,0);
            }
            if(k === '9') {
                this.position.set(CONFIG.ZONES.ZONA3.x, 200, CONFIG.ZONES.ZONA3.z);
                this.velocity.set(0,0,0);
            }
            if(k === '0') {
                this.position.set(0, 200, 0); // Centro
                this.velocity.set(0,0,0);
            }
            // -----------------------------------
            
            if (['w', 'a', 's', 'd'].includes(k)) {
                this.autoPilot = false; // Cancel autopilot on manual move
            }
        });
        document.addEventListener('keyup', (e) => {
            const k = e.key.toLowerCase();
            if (e.key === 'Shift') {
                this.keys.shift = false;
                return;
            }
            if(this.keys.hasOwnProperty(k)) this.keys[k] = false;
            if(e.key === ' ') this.keys[' '] = false;
            if(k === 'e') this.keys['e'] = false;
            if(k === '1') this.keys['1'] = false;
            if(k === '2') this.keys['2'] = false;
            if(k === '3') this.keys['3'] = false;
        });

        window.addEventListener('mousedown', (e) => {
            if (e.button === 2) this.keys['rightClick'] = true;
        });
        window.addEventListener('mouseup', (e) => {
            if (e.button === 2) this.keys['rightClick'] = false;
        });
    }

    activateAutoPilot(targetOrManager) {
        if (targetOrManager instanceof THREE.Vector3) {
            // Autopilot a coordenada (del minimapa)
            this.navTarget = targetOrManager;
            this.setTarget(null);
            this.autoPilot = true;
            this.autoAttack = false;
            return;
        }

        // Buscar al enemigo más cercano si pulsamos TAB
        const enemyManager = targetOrManager;
        if (!enemyManager || enemyManager.enemies.length === 0) return;

        let closest = null;
        let minDist = Infinity;
        for (let enemy of enemyManager.enemies) {
            const dist = this.position.distanceTo(enemy.position);
            if (dist < minDist) {
                minDist = dist;
                closest = enemy;
            }
        }
        if (closest) {
            this.setTarget(closest);
            this.navTarget = null;
            this.autoPilot = true;
        }
    }

    setTarget(enemy) {
        if(this.target === enemy) return;
        if(this.target && this.target.userData.selectionRing) this.target.userData.selectionRing.visible = false;
        
        this.target = enemy;
        const targetStatus = document.getElementById('target-status');
        if (this.target) {
            if (this.target.userData.selectionRing) this.target.userData.selectionRing.visible = true;
            targetStatus.style.display = 'block';
            
            const nameEl = document.getElementById('target-name');
            const targetType = this.target.userData.type ? this.target.userData.type.toUpperCase() : 'UNKNOWN';
            const targetLevel = CONFIG.COMBAT[`${targetType}_LEVEL`] || 1;
            
            nameEl.innerText = this.target.userData.name || 'Enemy Vessel';
            document.getElementById('target-level').innerText = `[Lvl ${targetLevel}]`;
            
            if(this.target.userData.type === 'Boss') {
                nameEl.style.color = '#ffaa00';
                nameEl.style.fontSize = '18px';
            } else {
                nameEl.style.color = '#00ffff';
                nameEl.style.fontSize = '16px';
            }
            
            this.updateTargetUI();
        } else {
            targetStatus.style.display = 'none';
        }
    }

    updateUI() {
        const hpBar = document.getElementById('hp-bar');
        const hpText = document.getElementById('hp-text');
        const energyBar = document.getElementById('energy-bar');
        const energyText = document.getElementById('energy-text');
        const xpBar = document.getElementById('xp-bar');
        const xpText = document.getElementById('xp-text');
        const levelText = document.getElementById('player-level');
        
        if (hpBar) hpBar.style.width = `${(this.hp / this.maxHp) * 100}%`;
        if (hpText) hpText.innerText = `${Math.floor(this.hp)} / ${this.maxHp} HP`;
        if (energyBar && energyText) {
            const energyPercent = (this.energy / this.maxEnergy) * 100;
            energyBar.style.width = `${energyPercent}%`;
            energyText.innerText = `${Math.ceil(this.energy)} / ${this.maxEnergy} EN`;
        }

        const shieldBarContainer = document.getElementById('shield-bar-container');
        const shieldBar = document.getElementById('shield-bar');
        const shieldText = document.getElementById('shield-text');
        
        if (shieldBarContainer && shieldBar && shieldText) {
            if (this.shieldActive) {
                shieldBarContainer.style.display = 'block';
                const maxShieldHp = this.equipment.shield.stats.shieldHp;
                const shieldPercent = (this.shieldHp / maxShieldHp) * 100;
                shieldBar.style.width = `${shieldPercent}%`;
                shieldText.innerText = `${Math.ceil(this.shieldHp)} / ${maxShieldHp} SHIELD`;
            } else {
                shieldBarContainer.style.display = 'none';
            }
        }

        if (xpBar) xpBar.style.width = `${(this.xp / this.xpToNextLevel) * 100}%`;
        if (xpText) xpText.innerText = `${Math.floor(this.xp)} / ${this.xpToNextLevel} XP`;
        if (levelText) levelText.innerText = `(Lvl ${this.level})`;
    }

    gainXP(amount) {
        this.xp += amount;
        this.accumulatedXpToLog = (this.accumulatedXpToLog || 0) + amount;
        let leveledUp = false;
        
        while (this.xp >= this.xpToNextLevel) {
            this.level++;
            this.xp -= this.xpToNextLevel;
            this.xpToNextLevel = Math.floor(this.xpToNextLevel * 1.5);
            
            this.maxHp += 100;
            this.hp = this.maxHp;
            this.energy = this.maxEnergy;
            
            leveledUp = true;
        }
        
        if (leveledUp) {
            this.triggerLevelUpEffect();
        }

        this.updateUI();

        if (this.xpLogTimeout) clearTimeout(this.xpLogTimeout);
        this.xpLogTimeout = setTimeout(() => {
            const log = document.getElementById('combat-log');
            if (log) {
                if (leveledUp) {
                    log.innerHTML = `<span style="color:#aa00ff; font-weight:bold;">LEVEL UP! Reached Level ${this.level}! HP Restored.</span>`;
                } else {
                    log.innerText = `Gained ${this.accumulatedXpToLog} XP.`;
                }
            }
            this.accumulatedXpToLog = 0;
        }, 50);
    }

    triggerLevelUpEffect() {
        // Efecto mágico de "Ascenso" (Dorado y complejo - Pre-cacheado)
        const ringMat = this.lvlRingMat.clone();
        ringMat.opacity = 1.0;
        
        const ring1 = new THREE.Mesh(this.lvlRingGeo1, ringMat);
        ring1.rotation.x = Math.PI / 2;
        ring1.position.copy(this.mesh.position);
        this.scene.add(ring1);

        const ringMat2 = ringMat.clone();
        const ring2 = new THREE.Mesh(this.lvlRingGeo2, ringMat2);
        ring2.rotation.x = Math.PI / 2;
        ring2.position.copy(this.mesh.position);
        this.scene.add(ring2);

        // Luz divina dorada (Reutilizada de caché)
        const light = this.levelUpLight;
        light.position.copy(this.mesh.position);
        light.position.y += 10;
        light.intensity = 15;

        // Partículas flotantes doradas (chispas mágicas)
        const particleCount = 40;
        const pGeo = new THREE.BufferGeometry();
        const pPos = new Float32Array(particleCount * 3);
        const pVel = [];
        for(let i=0; i<particleCount; i++) {
            pPos[i*3] = this.mesh.position.x + (Math.random()-0.5)*40;
            pPos[i*3+1] = this.mesh.position.y + Math.random()*10;
            pPos[i*3+2] = this.mesh.position.z + (Math.random()-0.5)*40;
            pVel.push(new THREE.Vector3(0, Math.random()*2 + 1, 0));
        }
        pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
        const pMat = this.lvlPMat.clone();
        pMat.opacity = 1.0;
        const particles = new THREE.Points(pGeo, pMat);
        this.scene.add(particles);

        // Texto flotante 3D del Nivel (Canvas reutilizado)
        this.lvlCtx.clearRect(0, 0, 512, 256);
        this.lvlCtx.font = 'bold 80px "Arial Black", Arial';
        this.lvlCtx.textAlign = 'center';
        this.lvlCtx.textBaseline = 'middle';
        this.lvlCtx.fillStyle = '#ffffff'; 
        this.lvlCtx.shadowColor = '#ffaa00'; 
        this.lvlCtx.shadowBlur = 25;
        this.lvlCtx.fillText('LVL ' + this.level, 256, 128);
        this.lvlCtx.fillText('LVL ' + this.level, 256, 128);
        this.lvlCtx.fillText('LVL ' + this.level, 256, 128);
        this.lvlTex.needsUpdate = true;
        
        const spriteMat = this.lvlSpriteMat.clone();
        spriteMat.opacity = 1.0;
        const levelText = new THREE.Sprite(spriteMat);
        levelText.scale.set(60, 30, 1); 
        levelText.position.copy(this.mesh.position);
        levelText.position.y += 20; 
        this.scene.add(levelText);

        let progress = 0;
        const animateLevelUp = () => {
            progress += 1;
            
            // Los anillos suben, rotan y se expanden (Mucho más lento)
            ring1.position.y += 0.5;
            ring2.position.y += 0.3;
            ring1.rotation.z += 0.03;
            ring2.rotation.z -= 0.03;
            
            const scale1 = 1 + (progress * 0.015);
            ring1.scale.set(scale1, scale1, 1);
            ring2.scale.set(scale1*0.8, scale1*0.8, 1);
            
            ringMat.opacity = Math.max(0, ringMat.opacity - 0.005);
            ringMat2.opacity = Math.max(0, ringMat2.opacity - 0.005);
            pMat.opacity = Math.max(0, pMat.opacity - 0.005);
            spriteMat.opacity = Math.max(0, spriteMat.opacity - 0.003);
            light.intensity = Math.max(0, light.intensity - 0.05);

            // Mover el texto hacia arriba (Más suave)
            levelText.position.y += 0.15;

            // Mover partículas (Más lento)
            const positions = particles.geometry.attributes.position.array;
            for(let i=0; i<particleCount; i++) {
                positions[i*3+1] += pVel[i].y * 0.3;
            }
            particles.geometry.attributes.position.needsUpdate = true;

            if (ringMat.opacity > 0 || light.intensity > 0) {
                requestAnimationFrame(animateLevelUp);
            } else {
                this.scene.remove(ring1);
                this.scene.remove(ring2);
                this.scene.remove(particles);
                this.scene.remove(levelText);
                ringMat.dispose();
                ringMat2.dispose();
                pGeo.dispose();
                pMat.dispose();
                spriteMat.dispose();
            }
        };
        animateLevelUp();
    }

    // (Duplicate takeDamage removed)
    updateTargetUI() {
        if(this.target) {
            const hpBar = document.getElementById('target-hp-bar');
            const hpText = document.getElementById('target-hp-text');
            if (hpBar) hpBar.style.width = Math.max(0, (this.target.userData.hp / this.target.userData.maxHp) * 100) + '%';
            if (hpText) hpText.innerText = `${Math.max(0, Math.floor(this.target.userData.hp))} / ${this.target.userData.maxHp} HP`;
        }
    }

    shoot() {
        if (!this.target || this.energy < 5) return;
        const now = Date.now();
        if (now - this.lastShotTime < 200) return; 
        
        this.lastShotTime = now;
        this.energy -= 5;
        this.updateUI();

        const spawnLaser = (offsetX) => {
            const laser = new THREE.Group();
            
            const outerLaser = new THREE.Mesh(this.laserGeo, this.laserMat);
            const innerGeo = new THREE.CylinderGeometry(0.3, 0.3, 130, 8);
            innerGeo.rotateX(Math.PI / 2);
            const innerMat = new THREE.MeshStandardMaterial({ 
                color: 0xffffff, 
                emissive: 0xffffff, 
                emissiveIntensity: 10.0 
            });
            const innerLaser = new THREE.Mesh(innerGeo, innerMat);
            
            laser.add(outerLaser);
            laser.add(innerLaser);
            
            // Calcular offset lateral usando el cuaternión de la nave
            const offset = new THREE.Vector3(offsetX, 0, 0);
            offset.applyQuaternion(this.mesh.quaternion);
            
            laser.position.copy(this.mesh.position).add(offset);
            laser.position.y += 2; 
            
            // Variación muy leve para realismo, pero apuntando al objetivo
            const targetPos = this.target.position.clone();
            targetPos.x += (Math.random()-0.5)*2;
            targetPos.y += (Math.random()-0.5)*2;
            laser.lookAt(targetPos);
            
            this.scene.add(laser);
            this.lasers.push({ mesh: laser, target: this.target, speed: 3000 });
        };
        
        // Spawnear doble láser (cañones laterales)
        spawnLaser(12);
        spawnLaser(-12);
    }

    shootMissile() {
        if (!this.target || this.target.userData.hp <= 0) return;
        const now = this.time || 0;
        if (now - this.lastMissileTime < this.missileCooldown) return;
        this.lastMissileTime = now;

        const missile = new THREE.Mesh(this.missileGeo, this.missileMat);
        
        missile.position.copy(this.mesh.position);
        missile.position.y += 2; 
        
        missile.lookAt(this.target.position);
        this.scene.add(missile);
        
        const initialDir = new THREE.Vector3().subVectors(this.target.position, this.mesh.position).normalize();
        
        // Usar un vector de velocidad explícito para evitar problemas de ejes coordenados
        this.missiles.push({ 
            mesh: missile, 
            target: this.target, 
            speed: 800, 
            velocity: initialDir.multiplyScalar(800) 
        });
    }

    updateLasers(delta, enemyManager, environment) {
        for(let i = this.lasers.length - 1; i >= 0; i--) {
            const laser = this.lasers[i];
            
            const dir = new THREE.Vector3();
            laser.mesh.getWorldDirection(dir);
            laser.mesh.position.addScaledVector(dir, laser.speed * delta);

            // Hit radius mucho más permisivo (Aim Assist) para no fallar tantos tiros
            let hitRadius = 40; // Antes 15
            if (laser.target && laser.target.userData.type === 'Drone') hitRadius = 25; // Antes 8

            if (laser.target && laser.mesh.position.distanceTo(laser.target.position) < hitRadius) {
                enemyManager.takeDamage(laser.target, this.baseDamage);
                this.updateTargetUI();
                this.scene.remove(laser.mesh);
                this.lasers.splice(i, 1);
            } else if (laser.mesh.position.distanceTo(this.mesh.position) > CONFIG.COMBAT.PLAYER_ATTACK_DIST) {
                // Desaparecer si recorre la distancia máxima definida
                this.scene.remove(laser.mesh);
                this.lasers.splice(i, 1);
            }
        }
    }

    updateMissiles(delta, enemyManager) {
        for(let i = this.missiles.length - 1; i >= 0; i--) {
            const missile = this.missiles[i];
            
            // Seguimiento (Homing) con vector de velocidad
            if (missile.target && missile.target.userData.hp > 0) {
                const toTarget = new THREE.Vector3().subVectors(missile.target.position, missile.mesh.position).normalize();
                
                // Rotar gradualmente el vector de velocidad hacia el objetivo
                missile.velocity.lerp(toTarget.multiplyScalar(missile.speed), 5.0 * delta);
            }

            // Avanzar usando el vector de velocidad
            missile.mesh.position.addScaledVector(missile.velocity, delta);
            
            // Alinear visualmente el misil con su dirección de movimiento
            const lookPos = new THREE.Vector3().copy(missile.mesh.position).add(missile.velocity);
            missile.mesh.lookAt(lookPos);

            // Hit radius ajustado para impacto realista
            let hitRadius = 40;
            if (missile.target && missile.target.userData.type === 'Drone') hitRadius = 30;

            if (missile.target && missile.mesh.position.distanceTo(missile.target.position) < hitRadius) {
                // Daño de Área Balanceado (Área reducida de 400 a 150, Daño de 30x a 15x)
                const hitCount = enemyManager.takeDamageArea(missile.mesh.position, 150, this.baseDamage * 15);
                this.updateTargetUI();
                
                // Efecto visual: Gran explosión de partículas 3D (Reemplaza al feo anillo 2D)
                if (typeof enemyManager.createExplosion === 'function') {
                    enemyManager.createExplosion(missile.mesh.position, 3.5); 
                }

                // Efecto visual: Destello de luz (Flash pre-cacheado para no recompilar shaders)
                const flash = this.explosionLights[this.currentLightIndex];
                this.currentLightIndex = (this.currentLightIndex + 1) % this.explosionLights.length;
                flash.position.copy(missile.mesh.position);
                flash.intensity = 20;

                // Apagar luz suavemente
                const animateFlash = () => {
                    flash.intensity -= 1.5; 
                    if (flash.intensity > 0) requestAnimationFrame(animateFlash);
                };
                animateFlash();

                this.scene.remove(missile.mesh);
                this.missiles.splice(i, 1);
            } else if (missile.mesh.position.distanceTo(this.mesh.position) > 6000) {
                this.scene.remove(missile.mesh);
                this.missiles.splice(i, 1);
            }
        }
    }

    updateActionBar() {
        const slotCannon = document.getElementById('slot-cannon');
        const slotMissile = document.getElementById('slot-missile');
        const slotShield = document.getElementById('slot-shield');
        const slotNitro = document.getElementById('slot-nitro');
        
        const cdMissile = document.getElementById('cd-missile');
        const cdShield = document.getElementById('cd-shield');

        if (slotCannon) {
            if (this.keys['1'] || this.keys[' ']) slotCannon.classList.add('active');
            else slotCannon.classList.remove('active');
        }

        if (slotNitro) {
            if (this.keys.shift && this.energy > 0) slotNitro.classList.add('active');
            else slotNitro.classList.remove('active');
        }

        if (slotMissile && cdMissile) {
            if (this.keys['2'] || this.keys['e']) slotMissile.classList.add('active');
            else slotMissile.classList.remove('active');

            const now = this.time || 0;
            const timeSinceMissile = now - this.lastMissileTime;
            if (timeSinceMissile < this.missileCooldown) {
                const percent = Math.floor(100 - (timeSinceMissile / this.missileCooldown) * 100);
                if (cdMissile.dataset.percent !== String(percent)) {
                    cdMissile.style.height = percent + '%';
                    cdMissile.dataset.percent = percent;
                }
            } else {
                if (cdMissile.dataset.percent !== '0') {
                    cdMissile.style.height = '0%';
                    cdMissile.dataset.percent = '0';
                }
            }
        }
        
        if (slotShield && cdShield) {
            if (this.keys['3']) slotShield.classList.add('active');
            else slotShield.classList.remove('active');

            const now = this.time || 0;
            const cooldown = this.equipment.shield.stats.cooldown;
            const timeSinceShield = now - this.lastShieldTime;
            if (timeSinceShield < cooldown) {
                const percent = Math.floor(100 - (timeSinceShield / cooldown) * 100);
                if (cdShield.dataset.percent !== String(percent)) {
                    cdShield.style.height = percent + '%';
                    cdShield.dataset.percent = percent;
                }
            } else {
                if (cdShield.dataset.percent !== '0') {
                    cdShield.style.height = '0%';
                    cdShield.dataset.percent = '0';
                }
            }
        }
    }

    initInventoryUI() {
        const invModal = document.getElementById('inventory-modal');
        const btnClose = document.getElementById('close-inv');
        
        if(btnClose) {
            btnClose.addEventListener('click', () => this.toggleInventory());
        }

        const slots = document.querySelectorAll('.inv-slot');
        slots.forEach(slot => {
            slot.addEventListener('click', (e) => {
                // Remove active from all
                slots.forEach(s => s.classList.remove('active'));
                // Add to current
                const currentSlot = e.currentTarget;
                currentSlot.classList.add('active');
                
                // Render details
                const type = currentSlot.dataset.slot;
                this.renderInventoryDetails(type);
            });
        });

        // Initialize slot names
        if (document.getElementById('slot-weapon-name')) document.getElementById('slot-weapon-name').innerText = this.equipment.weapon.name;
        if (document.getElementById('slot-missile-name')) document.getElementById('slot-missile-name').innerText = this.equipment.missile.name;
        if (document.getElementById('slot-shield-name')) document.getElementById('slot-shield-name').innerText = this.equipment.shield.name;
        if (document.getElementById('slot-engine-name')) document.getElementById('slot-engine-name').innerText = this.equipment.engine.name;
        if (document.getElementById('slot-hull-name')) document.getElementById('slot-hull-name').innerText = this.equipment.hull.name;
    }

    toggleInventory() {
        const invModal = document.getElementById('inventory-modal');
        if (!invModal) return;
        
        if (invModal.style.display === 'none') {
            invModal.style.display = 'flex';
            // Auto select weapon on open if nothing is active
            if (!document.querySelector('.inv-slot.active')) {
                const weaponSlot = document.querySelector('.inv-slot[data-slot="weapon"]');
                if(weaponSlot) weaponSlot.click();
            }
        } else {
            invModal.style.display = 'none';
        }
    }

    renderInventoryDetails(type) {
        const item = this.equipment[type];
        if (!item) return;

        document.getElementById('inv-item-name').innerText = item.name + ` [Lvl ${item.level}]`;
        document.getElementById('inv-item-mfg').innerText = `Manufacturer: ${item.manufacturer}`;
        document.getElementById('inv-item-lore').innerText = `"${item.description}"`;

        const statsContainer = document.getElementById('inv-item-stats');
        statsContainer.innerHTML = ''; // clear

        for (const [key, value] of Object.entries(item.stats)) {
            // Format key
            const formattedKey = key.replace(/([A-Z])/g, ' $1').trim().toUpperCase();
            
            const row = document.createElement('div');
            row.className = 'stat-row';
            
            const label = document.createElement('div');
            label.className = 'stat-label';
            label.innerText = formattedKey;
            
            const val = document.createElement('div');
            val.className = 'stat-value';
            val.innerText = value;

            row.appendChild(label);
            row.appendChild(val);
            statsContainer.appendChild(row);
        }
    }

    activateShield() {
        const now = this.time || 0;
        const cooldown = this.equipment.shield.stats.cooldown;
        
        // Evitar que el cooldown bloquee el primer uso si now < cooldown
        if (this.lastShieldTime > 0 && now - this.lastShieldTime < cooldown) return;
        
        this.lastShieldTime = now;
        this.shieldActive = true;
        this.shieldHp = this.equipment.shield.stats.shieldHp;
        this.shieldTimer = this.equipment.shield.stats.duration;
        this.updateUI();
        
        if (this.shieldMesh) {
            this.shieldMesh.visible = true;
            this.shieldMesh.scale.set(0.1, 0.1, 0.1);
            // Animación de expansión
            const expand = () => {
                if (!this.shieldActive) return;
                this.shieldMesh.scale.lerp(new THREE.Vector3(1, 1, 1), 0.2);
                if (this.shieldMesh.scale.x < 0.99) {
                    requestAnimationFrame(expand);
                }
            };
            expand();
        }
    }

    updateShieldLogic(delta) {
        if (!this.shieldActive) return;
        
        this.shieldTimer -= delta;
        if (this.shieldTimer <= 0 || this.shieldHp <= 0) {
            this.shieldActive = false;
            if (this.shieldMesh) this.shieldMesh.visible = false;
            this.updateUI();
        } else {
            // Efecto visual pulsante
            if (this.shieldMesh) {
                this.shieldMesh.material.opacity = 0.2 + 0.1 * Math.sin(this.time * 5);
            }
        }
    }

    takeDamage(amount) {
        if(this.isInvulnerable || this.isDead) return;
        this.lastDamageTime = Date.now();
        if (this.shieldActive) {
            this.shieldHp -= amount;
            // Destello intenso al recibir daño el escudo
            if (this.shieldMesh) this.shieldMesh.material.opacity = 0.8;
            if (this.shieldHp < 0) {
                // El daño sobrante pasa al HP real
                this.hp += this.shieldHp;
                this.shieldActive = false;
                if (this.shieldMesh) this.shieldMesh.visible = false;
            }
        } else {
            this.hp -= amount;
            this.damageShake = 1.0;
        }
        
        if (this.hp <= 0 && !this.isDead) {
            this.hp = 0;
            this.isDead = true;
            this.die();
        }
        this.updateUI();
    }

    die() {
        console.log("Player Died!");
        const log = document.getElementById('combat-log');
        if (log) log.innerHTML = "<span style='color:red; font-size: 18px; font-weight:bold;'>CRITICAL FAILURE: SHIP DESTROYED. RESPAWNING...</span>";
        
        // Explosión GIGANTE en la posición actual
        if (this.enemyManager) {
            this.enemyManager.createExplosion(this.position.clone(), 5.0);
            setTimeout(() => this.enemyManager.createExplosion(this.position.clone().add(new THREE.Vector3(15, 5, 15)), 3.0), 200);
            setTimeout(() => this.enemyManager.createExplosion(this.position.clone().add(new THREE.Vector3(-15, -5, -15)), 3.0), 400);
            setTimeout(() => this.enemyManager.createExplosion(this.position.clone().add(new THREE.Vector3(0, 10, 0)), 4.0), 600);
        }
        
        // Ocultar la nave y apagar escudos
        this.mesh.visible = false;
        this.shieldActive = false;
        if (this.shieldMesh) this.shieldMesh.visible = false;
        
        // Set initial position to center of map
        this.position.set(0, 50, 0);
        this.velocity = new THREE.Vector3();
        this.setTarget(null);
        
        // Pantallazo rojo estático
        const ui = document.getElementById('ui');
        if (ui) {
            ui.style.transition = 'box-shadow 0.1s';
            ui.style.boxShadow = 'inset 0 0 300px rgba(255,0,0,1)';
        }

        // Esperar 3 segundos viendo la explosión antes de reaparecer
        setTimeout(() => {
            // Restaurar stats
            this.hp = this.maxHp;
            this.energy = this.maxEnergy;
            
            // Teletransportar al inicio
            this.position.set(0, 50, 0); 
            this.camera.position.copy(this.position).add(new THREE.Vector3(0, 150, 400));
            this.camera.lookAt(this.position);
            
            // Quitar pantallazo rojo
            if (ui) {
                ui.style.transition = 'box-shadow 2.0s';
                ui.style.boxShadow = 'none'; 
                setTimeout(() => { ui.style.transition = 'none'; }, 2000);
            }

            // Animación de caída desde el cielo (Warp-in)
            this.mesh.visible = true;
            this.mesh.position.set(0, 2000, 0); // Nace muy alto
            
            const drop = setInterval(() => {
                this.mesh.position.y -= 100; // Caída hiper-rápida
                if (this.mesh.position.y <= this.position.y) {
                    this.mesh.position.y = this.position.y;
                    this.isDead = false; // Devuelve el control y la cámara
                    this.updateUI();
                    clearInterval(drop);
                    
                    // Efecto de anillo expansivo al tocar el suelo
                    this.triggerLevelUpEffect();
                }
            }, 16);

        }, 3000);
    }

    update(delta, enemyManager, environment, controls) {
        if(this.isDead) return;

        // Auto-reparación pasiva
        if (this.hp < this.maxHp && Date.now() - this.lastDamageTime > 5000) {
            this.hp += 15 * delta; // 15 HP por segundo
            if (this.hp > this.maxHp) this.hp = this.maxHp;
            this.updateUI();
        }
        
        this.enemyManager = enemyManager; // Guardar referencia para las explosiones
        if (this.isDead) return; // Congelar lógica y cámara mientras está muerto

        this.time += delta;

        // Lógica de Nitro restaurada
        let isUsingNitro = false;
        let currentSpeed = this.speed;

        if (this.keys.shift && this.energy > 0) {
            isUsingNitro = true;
            currentSpeed = this.speed * CONFIG.COMBAT.NITRO_SPEED_MULTIPLIER;
            this.energy -= CONFIG.COMBAT.NITRO_ENERGY_COST * delta;
            if (this.energy < 0) this.energy = 0;
            this.updateUI();
        } else {
            // Regenerar energía si no usamos nitro
            if (this.energy < this.maxEnergy) {
                this.energy += 10 * delta;
                if (this.energy > this.maxEnergy) this.energy = this.maxEnergy;
                this.updateUI();
            }
        }

        // Ya no animamos los flares artificiales, dejamos el glow nativo del GLB.
        // Crear rastro de partículas cuando nos movemos rápido
        if (isUsingNitro || ((this.keys['w'] || this.keys['W']) && Math.random() > 0.5)) {
            // (La logica real del rastro de motor está abajo en update(), esto es solo condicional para otras cosas)
        }

        if (this.keys['tab']) {
            this.keys['tab'] = false;
            this.activateAutoPilot(enemyManager);
        }

        if (this.keys[' ']) this.shoot();
        if (this.keys['1']) this.shoot();
        if (this.keys['e'] || this.keys['2']) this.shootMissile();
        if (this.keys['3']) this.activateShield();

        this.updateLasers(delta, enemyManager, environment);
        this.updateMissiles(delta, enemyManager);
        this.updateShieldLogic(delta);
        this.updateActionBar();

        // Movimiento relativo a la cámara o Autopilot
        const direction = new THREE.Vector3(0, 0, 0);

        if (this.autoPilot) {
            let toTarget = null;
            let isNavTarget = false;

            if (this.navTarget) {
                toTarget = new THREE.Vector3().subVectors(this.navTarget, this.position);
                toTarget.y = 0;
                isNavTarget = true;
            } else if (this.target && this.target.userData.hp > 0) {
                toTarget = new THREE.Vector3().subVectors(this.target.position, this.position);
                toTarget.y = 0;
            }

            if (toTarget) {
                const dist = toTarget.length();
                if (isNavTarget) {
                    if (dist > 100) {
                        toTarget.normalize();
                        this.velocity.lerp(toTarget.multiplyScalar(currentSpeed), 0.05);
                    } else {
                        // Llegamos al destino
                        this.autoPilot = false;
                        this.navTarget = null;
                        this.velocity.lerp(new THREE.Vector3(0,0,0), 0.1);
                    }
                } else {
                    if (dist > 800) {
                        toTarget.normalize();
                        this.velocity.lerp(toTarget.multiplyScalar(this.speed), 0.05);
                    } else {
                        toTarget.normalize();
                        const perp = new THREE.Vector3(-toTarget.z, 0, toTarget.x); 
                        const distanceCorrection = (dist - 600) * 1.5;
                        const orbitDir = new THREE.Vector3().addVectors(
                            perp.multiplyScalar(this.speed), 
                            toTarget.multiplyScalar(distanceCorrection)
                        );
                        if (orbitDir.lengthSq() > 0.001) orbitDir.normalize();
                        this.velocity.lerp(orbitDir.multiplyScalar(this.speed * 0.9), 0.05);
                    }
                }
            } else {
                this.autoPilot = false;
            }
        } else {
            // Control Manual
            if (this.keys.w) direction.z -= 1;
            if (this.keys.s) direction.z += 1;
            if (this.keys.a) direction.x -= 1;
            if (this.keys.d) direction.x += 1;

            if (direction.lengthSq() > 0) {
                direction.normalize();
                
                const camDir = new THREE.Vector3();
                this.camera.getWorldDirection(camDir);
                camDir.y = 0;
                if (camDir.lengthSq() < 0.001) {
                    camDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
                    camDir.y = 0;
                }
                camDir.normalize();
                
                const camRight = new THREE.Vector3().crossVectors(camDir, new THREE.Vector3(0, 1, 0)).normalize();
                
                const moveVec = new THREE.Vector3()
                    .addScaledVector(camRight, direction.x)
                    .addScaledVector(camDir, -direction.z);
                
                this.velocity.lerp(moveVec.multiplyScalar(currentSpeed), 0.1);
            } else {
                this.velocity.lerp(new THREE.Vector3(0,0,0), 0.05); // Frenar suavemente
            }
        }

        const oldPos = this.position.clone();

        // Colisión con paredes de montañas (Muro invisible natural)
        if (environment) {
            const wallHeight = 10000; // Aumentado al infinito para permitir al jugador VOLAR SOBRE las montañas libremente;
            let nextX = this.position.x + this.velocity.x * delta;
            let nextZ = this.position.z + this.velocity.z * delta;
            
            let hNextX = environment.getHeightAt(nextX, this.position.z);
            let hNextZ = environment.getHeightAt(this.position.x, nextZ);

            // Montañas >120 bloquean el avance. Los corredores del terreno garantizan paso libre a las Zonas.
            const wallLimit = 120;
            if (hNextX > wallLimit) { this.velocity.x = 0; nextX = this.position.x; }
            if (hNextZ > wallLimit) { this.velocity.z = 0; nextZ = this.position.z; }

            this.position.set(nextX, this.position.y, nextZ);

            this.currentTerrainHeight = environment.getHeightAt(this.position.x, this.position.z);
            const targetHover = Math.max(0, this.currentTerrainHeight) + 35; // Flotar a 35 unidades 
            this.position.y += (targetHover - this.position.y) * 0.1; // Suavizado
        } else {
            this.position.addScaledVector(this.velocity, delta);
        }

        // Rotar la nave principal visualmente
        let faceTarget = null;
        if (this.target && this.target.userData.hp > 0) {
            // Vector hacia el enemigo
            const toEnemy = new THREE.Vector3().subVectors(this.target.position, this.position);
            toEnemy.y = 0;
            if (toEnemy.lengthSq() > 0.001) toEnemy.normalize();

            if (this.velocity.lengthSq() > 10) {
                // Si nos estamos moviendo, el peso principal debe ser hacia dónde vamos para no volar de espaldas
                // 85% hacia donde nos movemos, 15% apuntando al enemigo para el efecto relativo
                const moveDir = this.velocity.clone();
                moveDir.y = 0;
                if (moveDir.lengthSq() > 0.001) moveDir.normalize();

                const blendDir = new THREE.Vector3().addVectors(
                    toEnemy.multiplyScalar(0.15), 
                    moveDir.multiplyScalar(0.85)
                );
                
                if (blendDir.lengthSq() > 0.001) {
                    blendDir.normalize();
                    faceTarget = this.position.clone().add(blendDir);
                } else {
                    faceTarget = this.position.clone().add(toEnemy);
                }
            } else {
                faceTarget = this.position.clone().add(toEnemy);
            }
        } else if (this.velocity.lengthSq() > 1) {
            // Si no hay objetivo, mirar completamente hacia donde nos movemos
            faceTarget = this.position.clone().add(this.velocity);
            faceTarget.y = this.position.y;
        }

        if (faceTarget) {
            const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(
                new THREE.Matrix4().lookAt(this.position, faceTarget, new THREE.Vector3(0, 1, 0))
            );
            this.mesh.quaternion.slerp(targetQuaternion, 0.1);
        }

        // Inclinación visual (Roll y Pitch) aplicada al grupo interno para NO corromper el quaternion de movimiento
        const localVelocity = this.velocity.clone().applyQuaternion(this.mesh.quaternion.clone().invert());
        
        const targetRoll = localVelocity.x * 0.001;
        this.visualGroup.rotation.z += (targetRoll - this.visualGroup.rotation.z) * 0.1;

        const targetPitch = localVelocity.z * 0.0002;
        this.visualGroup.rotation.x += (targetPitch - this.visualGroup.rotation.x) * 0.1;

        // Hover suave extra
        const hoverOffset = Math.sin(this.time * 3) * 0.5;
        this.mesh.position.copy(this.position);
        this.mesh.position.y += hoverOffset;

        // Estelas de Motor (Trails Físicos Dinámicos)
        if (this.engineAnchors) {
            if (!this.particlePool) this.particlePool = []; 
            
            const isIdle = this.velocity.lengthSq() < 50;

            this.engineAnchors.forEach((anchor, index) => {
                // Obtener posición absoluta 3D del anclaje
                const worldPos = new THREE.Vector3();
                anchor.getWorldPosition(worldPos);
                
                let p;
                if (this.particlePool.length > 0) {
                    p = this.particlePool.pop();
                    p.visible = true;
                } else {
                    p = new THREE.Mesh(this.particleGeo, this.particleMat);
                    this.scene.add(p);
                }
                
                p.position.copy(worldPos);
                
                // La longitud física del rastro es natural por la velocidad de la nave.
                let baseLife = (index >= 3) ? 1.0 : 1.5; 
                
                if (isIdle) {
                    p.userData.life = baseLife * 0.5; // Bolita de fuego en ralentí
                } else {
                    p.userData.life = baseLife * 0.8; // Vida normal y optimizada
                }
                
                // Grosor base
                p.userData.baseThickness = (index >= 3) ? 2.5 : 1.0; 
                
                if (isUsingNitro) p.scale.setScalar(2.0 * p.userData.baseThickness);
                else if (isIdle) p.scale.setScalar(0.6 * p.userData.baseThickness);
                else p.scale.setScalar(1.0 * p.userData.baseThickness);
                
                this.trailParticles.push(p);
            });
        }

        for(let i = this.trailParticles.length - 1; i >= 0; i--) {
            const p = this.trailParticles[i];
            // Consumir el fuego rápido (Rastro ajustado y cero lag)
            p.userData.life -= delta * 4.0; 
            if(p.userData.life <= 0) {
                p.visible = false; 
                this.trailParticles.splice(i, 1);
                this.particlePool.push(p); // Devolver al Pool
            } else {
                p.scale.setScalar(p.userData.life * p.userData.baseThickness);
                p.lookAt(this.camera.position); 
            }
        }

        // Desplazar la cámara junto con la nave (OrbitControls usa target)
        const movementDelta = this.position.clone().sub(oldPos);
        if (movementDelta.lengthSq() > 0) {
            this.camera.position.add(movementDelta);
        }

        // Alineación automática de cámara en Combate (Pirate Galaxy Style)
        if (this.target && this.target.userData.hp > 0 && !this.keys['rightClick']) {
            // Calcular vector desde el objetivo hasta el jugador
            const toPlayer = new THREE.Vector3().subVectors(this.position, this.target.position).normalize();
            toPlayer.y = 0; // Plano XZ
            
            // Obtener la distancia actual de la cámara para respetar el zoom (scroll) del usuario
            const currentOffset = new THREE.Vector3().subVectors(this.camera.position, this.position);
            const currentY = Math.max(30, currentOffset.y); // Mantener la altura actual (mínimo 30)
            currentOffset.y = 0;
            const currentDist = Math.max(80, currentOffset.length()); // Mantener la distancia actual (mínimo 80)
            
            // Posición ideal plana
            const idealCamPos = this.position.clone().add(toPlayer.multiplyScalar(currentDist)).add(new THREE.Vector3(0, currentY, 0));
            this.camera.position.lerp(idealCamPos, 0.05);

            // IMPORTANTE: Al hacer lerp lineal entre dos puntos de un círculo, la cámara "corta camino" acercándose al centro (la nave).
            // Reajustamos la distancia y altura forzadamente en cada frame para mantener una órbita esférica perfecta.
            const newOffset = new THREE.Vector3().subVectors(this.camera.position, this.position);
            newOffset.y = 0;
            if (newOffset.lengthSq() > 0.001) newOffset.normalize();
            
            this.camera.position.set(
                this.position.x + newOffset.x * currentDist,
                this.position.y + currentY,
                this.position.z + newOffset.z * currentDist
            );
        }

        // Colisión de Cámara: Evita que la cámara se meta dentro de una montaña
        if (environment) {
            let camTerrainHeight = environment.getHeightAt(this.camera.position.x, this.camera.position.z);
            if (this.camera.position.y < camTerrainHeight + 15) {
                // Si la cámara está dentro o muy cerca de la montaña, la subimos por encima
                this.camera.position.y += (camTerrainHeight + 15 - this.camera.position.y) * 0.2;
                
                // Y la empujamos un poco hacia el jugador para sacarla de la geometría
                let toPlayer = this.position.clone().sub(this.camera.position);
                toPlayer.y = 0; 
                this.camera.position.add(toPlayer.multiplyScalar(0.05));
            }
        }
        if (controls) {
            controls.target.copy(this.position);
            controls.update();
        }
    }
}
