import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { getItemById } from './itemCatalog.js';
import { resolveFullMove } from './terrainRules.js';
import { clampPointToDisc, WORLD_MAP } from './worldNav.js';
import {
    getStarterEquipment,
    applyEquipmentToPlayer,
    effectiveSpreadDeg,
    computeMissileHitChance,
    missileDamage,
    homingStrength,
    nitroSpeed,
    PARTS,
} from './balance.js';
import { getRecipeById, buildEquipmentFromRecipe } from './craft.js';
import { registerPlayerGltf } from './multiplayer/playerShipTemplate.js';
import { scheduleWalletSave } from './profile.js';
import { getControlState } from './controlSettings.js';
import { buildEnemyIntel } from './enemyIntel.js';
import { bindPlayerSystems } from './player/bindPlayerSystems.js';
import { syncPlayerAbilityVisuals } from './player/syncPlayerAbilityVisuals.js';
import { getHubSpawnPoint, isPlayerInHubSafeZone } from './hubSafe.js';
import { getShipGlb, DEFAULT_SHIP_ID, getShipById, syncShipActionBar } from './ships/playerShipCatalog.js';
import {
    getPlayerShipTargetLength,
    getPlayerShipShieldScale,
    getPlayerShipRotationY,
    getPlayerShipFallbackScale,
} from './ships/playerShipVisuals.js';
import { resolveModelUrl } from './ships/resolveModelUrl.js';
import {
    fitPlayerShipModel,
    boostPlayerShipMaterials,
    PLAYER_SHIP_ROTATION_Y,
} from './ships/fitPlayerShipModel.js';

export class Player {
    constructor(scene, camera, gltfLoader) {
        this.scene = scene;
        this.camera = camera;
        this.gltfLoader = gltfLoader;
        const hubSpawn = getHubSpawnPoint(50);
        this.position = new THREE.Vector3(hubSpawn.x, hubSpawn.y, hubSpawn.z);
        this.velocity = new THREE.Vector3();
        this._terrainHintCooldown = 0;
        // Equipamiento e Inventario (7 slots — balance estándar Lvl1)
        this.equipment = getStarterEquipment();
        this.parts = {};
        this.planetId = 'planet_01';
        this.activeShipId = DEFAULT_SHIP_ID;
        this._loadedShipId = null;
        this._shipLoadGen = 0;
        this._usingFallbackHull = false;
        this.shipLevel = 1;

        // RPG Stats derivados del equipamiento
        this.level = 1;
        this.xp = 0;
        this.xpToNextLevel = 100;
        
        this.maxHp = this.equipment.hull.stats.maxHp;
        this.hp = this.maxHp;
        this.maxEnergy = this.equipment.hull.stats.maxEnergy;
        this.energy = this.maxEnergy;

        applyEquipmentToPlayer(this);
        this._slowMult = 1;
        this._slowUntil = 0;

        // ── Economy & Progression ──
        this.credits = 0;
        this.missileJamPenalty = 0;
        this.inventory = [];
        this.killStreak = 0;
        this.lastKillTime = -999;
        this.streakMultiplier = 1;
        this.creditMultiplierBonus = 0;
        this.energyRegenRate = 8; // base per second

        // Upgrade tiers (0 = not bought, max defined per upgrade)
        this.upgrades = {
            damage:      0,   // max 3 — +30% per tier
            fireRate:    0,   // max 3 — -20% cooldown per tier
            speed:       0,   // max 3 — +20% per tier
            maxHp:       0,   // max 3 — +75 HP per tier
            energyRegen: 0,   // max 3 — +30% regen per tier
            missiles:    0,   // max 2 — -25% cooldown per tier
            earnings:    0,   // max 2 — +20% credit drops per tier
        };

        // Upgrade costs per tier [tier0cost, tier1cost, tier2cost]
        this.UPGRADE_COSTS = {
            damage:      [300, 550, 900],
            fireRate:    [250, 450, 750],
            speed:       [200, 400, 650],
            maxHp:       [200, 350, 600],
            energyRegen: [150, 300, 500],
            missiles:    [350, 650],
            earnings:    [500, 950],
        };
        
        // Shield state
        this.shieldActive = false;
        this.shieldHp = 0;
        this.shieldTimer = 0;
        this.lastShieldTime = 0;
        
        this.keys = {
            w: false, a: false, s: false, d: false, " ": false, tab: false,
            '1': false, '2': false, '3': false, '4': false, e: false, shift: false,
            i: false, k: false, f: false, arrowup: false, arrowdown: false,
            rightClick: false,
        };
        this._repairKeyPulse = 0;
        this._shieldKeyPulse = 0;
        this._repairChannelUntil = 0;
        this._repairChannelRate = 0;
        this._repairChannelAccum = 0;
        this.mobileInput = { x: 0, z: 0 };
        this._mobileFire = false;
        this._mobileCameraDrag = false;
        this._cameraManualIdle = 0;
        this._cameraRecenterT = 1;
        this._cameraRecenterDuration = 0.55;
        this._cameraRecenterFrom = null;
        this._cameraRecenterGoal = null;

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

        // Misil — geometría compartida, material básico (sin bloom pesado)
        this.missileGeo = new THREE.CylinderGeometry(1.2, 1.6, 9, 4);
        this.missileGeo.rotateX(Math.PI / 2);
        this.missileMat = new THREE.MeshBasicMaterial({ color: 0xffaa44 });
        this._msToTarget = new THREE.Vector3();
        this._msLook = new THREE.Vector3();

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

        bindPlayerSystems(this);

        this.bootstrapInventory();

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

        this.visualGroup = new THREE.Group();
        this.mesh.add(this.visualGroup);

        this._buildShieldBubble();
        this._buildRepairGlow();
    }

    _buildRepairGlow() {
        const baseR = 40;
        this._repairGlowBaseRadius = baseR;
        const mat = new THREE.MeshBasicMaterial({
            color: 0x33cc66,
            transparent: true,
            opacity: 0.24,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.BackSide,
        });
        this.repairGlow = new THREE.Mesh(new THREE.SphereGeometry(baseR, 12, 8), mat);
        this.repairGlow.visible = false;
        this.repairGlow.frustumCulled = false;
        this.repairGlow.renderOrder = 1;
        this.visualGroup.add(this.repairGlow);
    }

    /** Cambia el casco visual (GLB) y aplica perfil de la nave. */
    equipShipHull(shipId, opts = {}) {
        const ship = getShipById(shipId);
        if (!ship || !this.gltfLoader) return;

        if (!opts.force && this._loadedShipId === shipId && !this._usingFallbackHull) return;

        this._shipLoadGen += 1;
        const gen = this._shipLoadGen;
        const url = resolveModelUrl(ship.glb);

        this.activeShipId = shipId;
        applyEquipmentToPlayer(this);
        if (typeof ship.applyStats === 'function') ship.applyStats(this);
        
        this.updateAbilityUI(ship);

        this.gltfLoader.load(
            url,
            (gltf) => {
                if (gen !== this._shipLoadGen || this.activeShipId !== shipId) return;
                this._mountShipScene(gltf, ship);
                this._loadedShipId = shipId;
                this._usingFallbackHull = false;
                registerPlayerGltf(gltf);
                console.log('[Player] Nave GLB cargada:', url);
                if (!opts.silent) {
                    const log = document.getElementById('log-text');
                    if (log) log.textContent = `Nave equipada: ${ship.name}`;
                }
            },
            undefined,
            (error) => {
                if (gen !== this._shipLoadGen || this.activeShipId !== shipId) return;
                console.warn('[Player] Error cargando nave', url, error);
                if (opts.retry !== false) {
                    setTimeout(() => {
                        if (gen === this._shipLoadGen) {
                            this.equipShipHull(shipId, { ...opts, retry: false, force: true, silent: true });
                        }
                    }, 400);
                    return;
                }
                this.buildFallbackModel();
                this._usingFallbackHull = true;
            },
        );
    }

    _mountShipScene(gltf, shipDef = null) {
        const ship = shipDef || getShipById(this.activeShipId);
        const toRemove = [];
        this.visualGroup.children.forEach((c) => {
            if (c !== this.shieldGroup) toRemove.push(c);
        });
        toRemove.forEach((c) => this.visualGroup.remove(c));

        const model = gltf.scene;
        boostPlayerShipMaterials(model);
        const targetLength = getPlayerShipTargetLength(ship);
        const { box } = fitPlayerShipModel(model, targetLength);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        const rotationGroup = new THREE.Group();
        rotationGroup.rotation.y = getPlayerShipRotationY(ship);
        rotationGroup.add(model);

        const tailZ = box.max.z;
        const offsetData = [
            new THREE.Vector3(center.x - (size.x * 0.04), center.y + (size.y * 0.03), tailZ - (size.z * 0.12)),
            new THREE.Vector3(center.x + (size.x * 0.04), center.y + (size.y * 0.03), tailZ - (size.z * 0.12)),
            new THREE.Vector3(center.x, center.y - (size.y * 0.06), tailZ - (size.z * 0.12)),
            new THREE.Vector3(center.x - (size.x * 0.18), center.y - (size.y * 0.13), tailZ - (size.z * 0.15)),
            new THREE.Vector3(center.x + (size.x * 0.18), center.y - (size.y * 0.13), tailZ - (size.z * 0.15)),
        ];

        this.engineAnchors = [];
        offsetData.forEach((pos) => {
            const dummy = new THREE.Object3D();
            dummy.position.copy(pos);
            rotationGroup.add(dummy);
            this.engineAnchors.push(dummy);
        });

        this.flares = [];
        this.visualGroup.add(rotationGroup);
        this._fitShieldScale?.();
    }

    _buildShieldBubble() {
        const baseR = 45;
        this._shieldBaseRadius = baseR;
        this._shieldTargetScale = getPlayerShipShieldScale(getShipById(this.activeShipId));

        const group = new THREE.Group();
        group.visible = false;
        group.frustumCulled = false;

        const shellMat = new THREE.MeshBasicMaterial({
            color: 0x44ddff,
            transparent: true,
            opacity: 0.38,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            wireframe: true,
        });
        this.shieldShell = new THREE.Mesh(new THREE.IcosahedronGeometry(baseR, 1), shellMat);
        this.shieldCore = null;
        this.shieldRing = null;

        group.add(this.shieldShell);
        this.shieldGroup = group;
        this.shieldMesh = group;
        this.visualGroup.add(group);
    }

    _fitShieldScale() {
        if (!this.shieldMesh) return;
        const ship = getShipById(this.activeShipId);
        const targetScale = getPlayerShipShieldScale(ship);
        this.shieldMesh.scale.set(targetScale, targetScale, targetScale);
    }

    upgradeShipToLevel5() {
        if (this.shipLevel === 5) return; // Ya está mejorada
        this.shipLevel = 5;

        // Upgrade Stats
        this.maxHp = 400;
        this.hp = 400;
        this.baseDamage = 15;
        this.speed = 200;
        this._slowMult = 1;
        this._slowUntil = 0;
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
            
            // Escudo sigue al visualGroup (mismo espacio que el modelo)
            if (this.shieldGroup && !this.visualGroup.children.includes(this.shieldGroup)) {
                this.visualGroup.add(this.shieldGroup);
            }
            this._fitShieldScale();
        });
        
        this.updateUI();
    }

    buildFallbackModel() {
        const toRemove = [];
        this.visualGroup.children.forEach((c) => {
            if (c !== this.shieldGroup) toRemove.push(c);
        });
        toRemove.forEach((c) => this.visualGroup.remove(c));

        const hull = new THREE.Group();
        // Fuselaje principal (Largo y aerodinámico)
        const fuselageGeo = new THREE.CylinderGeometry(0.5, 1.5, 12, 16);
        fuselageGeo.rotateX(Math.PI / 2);
        const fuselageMat = new THREE.MeshStandardMaterial({ color: 0x555566, metalness: 0.8, roughness: 0.2 });
        const fuselage = new THREE.Mesh(fuselageGeo, fuselageMat);
        fuselage.castShadow = true;
        hull.add(fuselage);

        // Morro/Nariz (Puntiaguda)
        const noseGeo = new THREE.ConeGeometry(0.5, 4, 16);
        noseGeo.rotateX(Math.PI / 2);
        const nose = new THREE.Mesh(noseGeo, fuselageMat);
        nose.position.set(0, 0, -8);
        nose.castShadow = true;
        hull.add(nose);

        // Cabina (Cristal Oscuro Tintado)
        const cockpitGeo = new THREE.CapsuleGeometry(0.6, 2, 8, 16);
        cockpitGeo.rotateX(Math.PI / 2);
        const glassMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.0, transparent: true, opacity: 0.8 });
        const cockpit = new THREE.Mesh(cockpitGeo, glassMat);
        cockpit.position.set(0, 0.8, -3);
        cockpit.rotation.x = -0.1;
        hull.add(cockpit);

        // Alas principales (En flecha)
        const wingGeo = new THREE.BoxGeometry(10, 0.2, 5);
        const wingMat = new THREE.MeshStandardMaterial({ color: 0x442266, metalness: 0.7, roughness: 0.3 }); // Toque púrpura militar
        const wing = new THREE.Mesh(wingGeo, wingMat);
        wing.position.set(0, 0, 1);
        wing.rotation.x = -0.05;
        wing.castShadow = true;
        hull.add(wing);

        // Aleta de cola vertical
        const tailGeo = new THREE.BoxGeometry(0.2, 2.5, 3);
        const tail = new THREE.Mesh(tailGeo, wingMat);
        tail.position.set(0, 1.5, 4.5);
        tail.rotation.x = -0.2;
        hull.add(tail);

        // Estabilizadores traseros horizontales
        const stabGeo = new THREE.BoxGeometry(4, 0.2, 2);
        const stab = new THREE.Mesh(stabGeo, fuselageMat);
        stab.position.set(0, 0.2, 5);
        hull.add(stab);

        // Misiles bajo las alas
        const missileGeo = new THREE.CylinderGeometry(0.2, 0.2, 3, 8);
        missileGeo.rotateX(Math.PI / 2);
        const missileMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.5 });
        
        const m1 = new THREE.Mesh(missileGeo, missileMat);
        m1.position.set(-3.5, -0.3, 1);
        hull.add(m1);
        
        const m2 = new THREE.Mesh(missileGeo, missileMat);
        m2.position.set(3.5, -0.3, 1);
        hull.add(m2);

        // Motor central brillante
        const engineMat = new THREE.MeshBasicMaterial({ color: 0xff00ff }); // Púrpura/Rosa
        const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.0, 0.5, 16), engineMat);
        engine.rotateX(Math.PI / 2);
        engine.position.set(0, 0, 6.2);
        hull.add(engine);

        hull.scale.setScalar(getPlayerShipFallbackScale());
        this.visualGroup.add(hull);
        this._fitShieldScale?.();
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
            if (e.code === 'Numpad8') {
                if (!e.repeat) {
                    window.__game?.galaxy?.onAscendKey?.(window.__game?._pointerLock);
                }
                e.preventDefault();
                return;
            }
            if (e.code === 'ArrowUp') {
                this.keys.arrowup = true;
                e.preventDefault();
                return;
            }
            if (e.code === 'Numpad5' && !e.repeat) {
                window.__game?.galaxy?.onDescendKey?.(window.__game?._pointerLock);
                e.preventDefault();
                return;
            }
            if (e.code === 'ArrowDown' || e.code === 'Numpad2') {
                this.keys.arrowdown = true;
                e.preventDefault();
                return;
            }
            if(this.keys.hasOwnProperty(k)) this.keys[k] = true;
            if(e.key === ' ') this.keys[' '] = true;
            if(k === 'e') this.keys['e'] = true;
            if(k === '1') this.keys['1'] = true;
            if(k === '2') this.keys['2'] = true;
            if (k === '3') {
                this.keys['3'] = true;
                this._repairKeyPulse = 0.2;
                this.activateRepairBurst();
            }
            if (k === '4') {
                this.keys['4'] = true;
                this._shieldKeyPulse = 0.2;
                this.activateShield();
            }
            if (k === 'c') this.requestCameraRecenter();
            if (k === 'escape') {
                if (this.target) this.setTarget(null);
                else this.clearNavDestination();
            }
            // --- TELEPORT CHEATS PARA TESTEO ---
            if(k === '7') {
                this.position.set(CONFIG.ZONES.ZONA1.x, 200, CONFIG.ZONES.ZONA1.z);
                this.velocity.set(0,0,0);
            }
            if (k === '8' && !e.code.startsWith('Numpad')) {
                this.position.set(CONFIG.ZONES.ZONA2.x, 200, CONFIG.ZONES.ZONA2.z);
                this.velocity.set(0,0,0);
            }
            if (k === '9' && !e.code.startsWith('Numpad')) {
                this.position.set(CONFIG.ZONES.ZONA3.x, 200, CONFIG.ZONES.ZONA3.z);
                this.velocity.set(0,0,0);
            }
            if(k === '0') {
                this.position.set(0, 200, 0); // Centro
                this.velocity.set(0,0,0);
            }
            // -----------------------------------
            
            if (['w', 'a', 's', 'd'].includes(k)) {
                this.autoPilot = false;
                this.clearNavDestination();
            }
        });
        document.addEventListener('keyup', (e) => {
            const k = e.key.toLowerCase();
            if (e.key === 'Shift') {
                this.keys.shift = false;
                return;
            }
            if (e.code === 'ArrowUp') {
                this.keys.arrowup = false;
                return;
            }
            if (e.code === 'Numpad8') {
                return;
            }
            if (e.code === 'ArrowDown' || e.code === 'Numpad2') {
                this.keys.arrowdown = false;
                return;
            }
            if(this.keys.hasOwnProperty(k)) this.keys[k] = false;
            if(e.key === ' ') this.keys[' '] = false;
            if(k === 'e') this.keys['e'] = false;
            if(k === '1') this.keys['1'] = false;
            if(k === '2') this.keys['2'] = false;
            if(k === '3') this.keys['3'] = false;
            if(k === '4') this.keys['4'] = false;
        });

        window.addEventListener('mousedown', (e) => {
            if (e.button === 2) this.keys['rightClick'] = true;
            if (e.button === 1) {
                e.preventDefault();
                this.requestCameraRecenter();
            }
        });
        window.addEventListener('mouseup', (e) => {
            if (e.button === 2) this.keys['rightClick'] = false;
        });

        this._wireActionBarClicks();
    }

    _wireActionBarClicks() {
        const bind = (id, fn) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('click', (e) => {
                e.preventDefault();
                fn();
            });
        };
        bind('slot-cannon', () => this.shoot());
        bind('slot-missile', () => this.shootMissile());
        bind('slot-repair', () => this.activateRepairBurst());
        bind('slot-shield', () => this.activateShield());
    }

    /** ¿El jugador está moviendo con WASD o joystick (no solo autopilot)? */

    /** Dirección horizontal de la proa (velocidad o mesh). */

    /** Anima la cámara detrás de la nave (como al iniciar). */


    /** Pausa el seguimiento automático tras rotar la cámara a mano. */

    updateAbilityUI(ship) {
        syncShipActionBar(ship);
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
            if (this._isShieldUp()) {
                shieldBarContainer.style.display = 'block';
                const maxShieldHp = this.shieldMax || this._getShieldStats().shieldHp;
                const shieldPercent = Math.max(0, Math.min(100, (this.shieldHp / maxShieldHp) * 100));
                shieldBar.style.width = `${shieldPercent}%`;
                const secs = Math.ceil(this.shieldTimer ?? 0);
                shieldText.innerText = `${Math.ceil(this.shieldHp)} / ${maxShieldHp} ESCUDO · ${secs}s`;
            } else {
                shieldBarContainer.style.display = 'none';
            }
        }

        if (xpBar) xpBar.style.width = `${(this.xp / this.xpToNextLevel) * 100}%`;
        if (xpText) xpText.innerText = `${Math.floor(this.xp)} / ${this.xpToNextLevel} XP`;
        if (levelText) levelText.innerText = `NV ${this.level}`;
        const xpLabel = document.getElementById('xp-strip-label');
        if (xpLabel) xpLabel.textContent = `NV ${this.level}`;
    }

    // ══════════════════════════════════════════════
    //  CREDIT & KILL STREAK SYSTEM
    // ══════════════════════════════════════════════

    /** Punto en la cúpula del escudo hacia el origen del disparo. */

    /** VFX + HUD coherente — escudo cyan vs casco rojo. */

    // ══════════════════════════════════════════════
    //  UPGRADE SYSTEM
    // ══════════════════════════════════════════════

    // (Duplicate takeDamage removed)

    /** Pulso paralizador del comandante de patrulla — relentiza la nave unos segundos. */

    /** Aplica daño PvE confirmado por el servidor. */

    update(delta, enemyManager, environment, controls) {
        this.updateLevelUpFx?.(delta);
        if(this.isDead) return;
        if (this._terrainHintCooldown > 0) this._terrainHintCooldown -= delta;

        this.enemyManager = enemyManager;
        if (this.isDead) return; // Congelar lógica y cámara mientras está muerto

        if (this.damageShake > 0) {
            this.damageShake = Math.max(0, this.damageShake - delta * 2.8);
        }

        this.time += delta;

        // Lógica de Nitro restaurada
        let isUsingNitro = false;
        let currentSpeed = this.speed;
        if (this._slowUntil && this.time < this._slowUntil) {
            currentSpeed *= this._slowMult ?? 0.4;
        } else {
            if (this._slowUntil && this.time >= this._slowUntil) {
                window.__game?.vfx?._clearPlayerSlowField?.();
                const debuff = document.getElementById('debuff-slow');
                if (debuff) debuff.style.display = 'none';
            }
            this._slowUntil = 0;
            this._slowMult = 1;
        }

        if (this.keys.shift && this.energy > 0) {
            isUsingNitro = true;
            currentSpeed = nitroSpeed(this);
            this.energy -= CONFIG.COMBAT.NITRO_ENERGY_COST * delta;
            if (this.energy < 0) this.energy = 0;
            this._nitroFxTimer = (this._nitroFxTimer || 0) - delta;
            if (this._nitroFxTimer <= 0) {
                const mapBusy = (window.__game?.environment?.chunkQueue?.length ?? 0) > 8;
                if (!mapBusy) {
                    window.__game?.vfx?.hitSparks(this.mesh.position, {
                        color: 0xffaa33,
                        count: 5,
                        spread: 22,
                        size: 6,
                        duration: 0.18,
                    });
                }
                this._nitroFxTimer = mapBusy ? 0.22 : 0.07;
            }
            this.updateUI();
        } else {
            // Regenerar energía si no usamos nitro (usa energyRegenRate — mejora con upgrade)
            if (this.energy < this.maxEnergy) {
                this.energy += this.energyRegenRate * delta;
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
            const galaxy = window.__game?.galaxy;
            if (galaxy?.usesOrbitalMinimap?.()) {
                galaxy.onSpaceNavTabKey();
                return;
            }
            this.activateAutoPilot(enemyManager);
        }

        if (this._repairKeyPulse > 0) this._repairKeyPulse = Math.max(0, this._repairKeyPulse - delta);
        if (this._shieldKeyPulse > 0) this._shieldKeyPulse = Math.max(0, this._shieldKeyPulse - delta);

        if (this.keys[' '] || this.keys['1'] || this._mobileFire) this.shoot();
        if (this.keys['2']) this.shootMissile();

        this.updateLasers(delta, enemyManager, environment);
        this.updateMissiles(delta, enemyManager);
        this._tickRepairChannel(delta);
        this.updateShieldLogic(delta);
        syncPlayerAbilityVisuals(this, window.__game?.vfx, delta);
        this.updateActionBar();

        // Movimiento relativo a la cámara o Autopilot
        const direction = new THREE.Vector3(0, 0, 0);
        const galaxy = window.__game?.galaxy;
        const skipSurfaceMove = galaxy?.isFlightMode?.() || galaxy?.isTransition?.();
        const oldPos = this.position.clone();

        if (!skipSurfaceMove) {
        if (this.autoPilot) {
            let toTarget = null;
            let isNavTarget = false;

            if (this.navTarget) {
                toTarget = new THREE.Vector3().subVectors(this.navTarget, this.position);
                toTarget.y = 0;
                isNavTarget = true;
            } else if (this.target && this.target.userData.hp > 0) {
                const tpos = this._resolveTargetPos(this.target);
                toTarget = new THREE.Vector3().subVectors(tpos, this.position);
                toTarget.y = 0;
            }

            if (toTarget) {
                const dist = toTarget.length();
                if (isNavTarget) {
                    if (dist > 100) {
                        toTarget.normalize();
                        this.velocity.lerp(toTarget.multiplyScalar(currentSpeed), 0.05);
                    } else {
                        this.autoPilot = false;
                        this.navTarget = null;
                        if (this.navMarker) this.navMarker.clearDestination();
                        this._updateNavHud();
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
            const mi = this.mobileInput;
            const useMobile = mi && (Math.abs(mi.x) > 0.08 || Math.abs(mi.z) > 0.08);
            if (useMobile) {
                direction.x = mi.x;
                direction.z = mi.z;
            } else {
                if (this.keys.w) direction.z -= 1;
                if (this.keys.s) direction.z += 1;
                if (this.keys.a) direction.x -= 1;
                if (this.keys.d) direction.x += 1;
            }

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

        // Colisión: reglas estables en terrainRules.js (independientes del visual del mapa)
        if (environment) {
            const nextX = this.position.x + this.velocity.x * delta;
            const nextZ = this.position.z + this.velocity.z * delta;
            const hHere = environment.getHeightAt(this.position.x, this.position.z);

            const resolved = resolveFullMove(
                environment,
                this.position.x, this.position.z,
                nextX, nextZ,
                this.position.y
            );

            if (resolved.blocked) {
                if (resolved.boundary) this._showWorldBoundaryHint?.();
                else this._showTerrainBlockedHint();
                if (resolved.x === this.position.x) this.velocity.x = 0;
                if (resolved.z === this.position.z) this.velocity.z = 0;
            }

            this.position.set(resolved.x, this.position.y, resolved.z);

            const safe = clampPointToDisc(this.position.x, this.position.z, WORLD_MAP.playerClampScale);
            if (safe.clamped) {
                this.position.x = safe.x;
                this.position.z = safe.z;
                this.velocity.set(0, 0, 0);
            }

            this.currentTerrainHeight = hHere;
            const targetHover = Math.max(0, this.currentTerrainHeight) + (this.hoverHeight || 35);
            const flightPhase = window.__game?.galaxy?.phase;
            const takingOff = window.__game?.galaxy?.isFlightMode?.()
                || window.__game?.galaxy?.isTransition?.();
            const climbing = window.__game?.galaxy?.isAtmosphericMode?.();
            if (flightPhase === 'orbit' || takingOff || climbing) {
                // Y libre durante despegue / órbita
            } else if (flightPhase === 'climb' || flightPhase === 'atmosphere') {
                if (this.position.y < targetHover) {
                    this.position.y += (targetHover - this.position.y) * 0.06;
                }
            } else {
                this.position.y += (targetHover - this.position.y) * 0.1;
            }
        } else {
            this.position.addScaledVector(this.velocity, delta);
        }
        } // skipSurfaceMove

        // Rotar la nave principal visualmente
        const flightCtrl = window.__game?.galaxy?.usesFlightControls?.();
        let faceTarget = null;
        if (!flightCtrl) {
        if (this.target && this.target.userData.hp > 0) {
            // Vector hacia el enemigo
            const tpos = this._resolveTargetPos(this.target);
            const toEnemy = new THREE.Vector3().subVectors(tpos, this.position);
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
        }

        // Inclinación visual (Roll y Pitch) aplicada al grupo interno para NO corromper el quaternion de movimiento
        if (!flightCtrl) {
        const localVelocity = this.velocity.clone().applyQuaternion(this.mesh.quaternion.clone().invert());
        
        const targetRoll = localVelocity.x * 0.001;
        this.visualGroup.rotation.z += (targetRoll - this.visualGroup.rotation.z) * 0.1;

        const targetPitch = localVelocity.z * 0.0002;
        this.visualGroup.rotation.x += (targetPitch - this.visualGroup.rotation.x) * 0.1;
        } else {
            this.visualGroup.rotation.x *= 0.85;
            this.visualGroup.rotation.z *= 0.85;
        }

        // Hover suave extra
        const hoverOffset = Math.sin(this.time * 3) * 0.5;
        this.mesh.position.copy(this.position);
        this.mesh.position.y += hoverOffset;

        // Estelas de motor — throttled (antes: 1 mesh/anclaje/frame = lag severo)
        if (this.engineAnchors) {
            if (!this.particlePool) this.particlePool = [];
            this._trailEmitTick = (this._trailEmitTick ?? 0) + 1;

            const perf = window.__game?._perfTier ?? 'normal';
            const isIdle = this.velocity.lengthSq() < 50;
            const emitEvery = perf === 'critical' ? 10
                : perf === 'economy' ? 6
                    : isUsingNitro ? 2
                        : isIdle ? 8
                            : 4;
            const maxTrail = perf === 'critical' ? 10
                : perf === 'economy' ? 18
                    : 32;

            if (this._trailEmitTick % emitEvery === 0 && this.trailParticles.length < maxTrail) {
                const anchors = this.engineAnchors;
                const step = perf === 'normal' ? 1 : 2;
                for (let index = 0; index < anchors.length; index += step) {
                    if (this.trailParticles.length >= maxTrail) break;
                    const anchor = anchors[index];
                    const worldPos = this._trailWorldPos || (this._trailWorldPos = new THREE.Vector3());
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
                    const baseLife = (index >= 3) ? 1.0 : 1.5;
                    p.userData.life = isIdle ? baseLife * 0.5 : baseLife * 0.8;
                    p.userData.baseThickness = (index >= 3) ? 2.5 : 1.0;

                    if (isUsingNitro) p.scale.setScalar(2.0 * p.userData.baseThickness);
                    else if (isIdle) p.scale.setScalar(0.6 * p.userData.baseThickness);
                    else p.scale.setScalar(1.0 * p.userData.baseThickness);

                    this.trailParticles.push(p);
                }
            }
        }

        const camPos = this.camera.position;
        for (let i = this.trailParticles.length - 1; i >= 0; i--) {
            const p = this.trailParticles[i];
            p.userData.life -= delta * 4.0;
            if (p.userData.life <= 0) {
                p.visible = false;
                this.trailParticles.splice(i, 1);
                this.particlePool.push(p);
            } else {
                p.scale.setScalar(p.userData.life * p.userData.baseThickness);
                if ((this._frame ?? 0) % 2 === 0) p.lookAt(camPos);
            }
        }

        // Desplazar la cámara junto con la nave (OrbitControls usa target)
        const movementDelta = this.position.clone().sub(oldPos);
        if (movementDelta.lengthSq() > 0 && !window.__game?.galaxy?.handlesCamera?.()) {
            this.camera.position.add(movementDelta);
            if (this._cameraRecenterFrom) this._cameraRecenterFrom.add(movementDelta);
            if (this._cameraRecenterGoal) this._cameraRecenterGoal.add(movementDelta);
        }

        this._updateCameraRecenter(delta);
        this._updateCameraManualIdle(delta);
        if (!window.__game?.galaxy?.handlesCamera?.()) {
        this._updateChaseCamera(delta);
        }

        const cfg = getControlState();
        const recentering = this._cameraRecenterT < 1;
        const manualCamera = this._cameraManualIdle > 0;

        // Vista de combate opcional (orbita hacia el enemigo apuntado)
        if (
            !window.__game?.galaxy?.handlesCamera?.()
            && cfg.combatCameraFollow
            && this.target && this.target.userData.hp > 0
            && !this.keys['rightClick'] && !this._mobileCameraDrag
            && !manualCamera && !recentering
        ) {
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
        if (environment && !window.__game?.galaxy?.handlesCamera?.()) {
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
        if (controls && !window.__game?.galaxy?.handlesCamera?.()) {
            controls.target.copy(this.position);
            controls.update();
        }
    }
}
