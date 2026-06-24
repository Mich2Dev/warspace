import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CONFIG } from '../config.js';

// ---- ENTITIES (OOP Architecture) ----

class BaseEnemy extends THREE.Group {
    constructor(manager, type, name, hp, speed) {
        super();
        this.manager = manager;
        this.userData = {
            isEnemy: true,
            type: type,
            name: name,
            hp: hp,
            maxHp: hp,
            velocity: new THREE.Vector3((Math.random()-0.5)*speed, 0, (Math.random()-0.5)*speed),
            maxSpeed: speed,
            hoverOffset: Math.random() * Math.PI * 2,
            baseHeight: 35,
            lastShot: 0,
            wanderAngle: Math.random() * Math.PI * 2,
            orbitDirection: Math.random() > 0.5 ? 1 : -1,
            orbitDistance: 300 + Math.random() * 400
        };
        this.visualGroup = new THREE.Group();
        this.add(this.visualGroup);
    }

    setupVisuals(template, ringSize, boxSize) {
        if (template) {
            const modelClone = template.clone();
            // Solo desactivar frustumCulled en meshes directos, no en todo el arbol
            modelClone.traverse(child => {
                if (child.isMesh) {
                    child.frustumCulled = false; // Necesario para GLTF clones con bounding box roto
                    child.visible = true;
                    child.castShadow = false; // Sin sombras en enemigos = gran ganancia de FPS
                    child.receiveShadow = false;
                }
            });
            this.visualGroup.add(modelClone);
        }

        const ringGeo = new THREE.RingGeometry(ringSize * 0.8, ringSize, 32);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xff3333, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = this.userData.type.includes('Boss') || this.userData.type.includes('Spawner') ? -10 : -2;
        ring.visible = false;
        this.add(ring);
        this.userData.selectionRing = ring;

        const hitboxGeo = new THREE.BoxGeometry(boxSize, boxSize*0.5, boxSize);
        const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
        const hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
        this.add(hitbox);
    }

    createMinimapDot(container, typeClass) {
        if (container) {
            const dot = document.createElement('div');
            dot.className = `minimap-enemy ${typeClass}`;
            container.appendChild(dot);
            this.userData.minimapDot = dot;
        }
    }

    updateBasePhysics(delta, environment, time) {
        // Colision con paredes del cañón
        if (environment) {
            let nextX = this.position.x + this.userData.velocity.x * delta;
            let nextZ = this.position.z + this.userData.velocity.z * delta;
            const wallHeight = 50;

            // Throttle: solo comprobar terreno cada 10 frames para ahorrar CPU
            this.userData._terrainTick = (this.userData._terrainTick || 0) + 1;
            if (this.userData._terrainTick >= 10) {
                this.userData._terrainTick = 0;
                this.userData._cachedTerrainH = environment.getHeightAt(nextX, nextZ);
            }
            const terrainH = this.userData._cachedTerrainH || 0;

            if (terrainH > wallHeight) {
                this.userData.velocity.x *= -0.8;
                this.userData.velocity.z *= -0.8;
                nextX = this.position.x;
                nextZ = this.position.z;
            }
            this.position.set(nextX, this.position.y, nextZ);
        } else {
            this.position.addScaledVector(this.userData.velocity, delta);
        }

        let terrainHeight = 0;
        if (environment && this.userData._cachedTerrainH !== undefined) {
            terrainHeight = this.userData._cachedTerrainH;
        }
        
        let hoverDistance = 60; // Altura base sobre el suelo (aumentado para que no arrastren)
        let targetY = Math.max(hoverDistance, terrainHeight + hoverDistance);
        this.userData.baseHeight = targetY;

        let oscilation = Math.sin(time * 3 + this.userData.hoverOffset) * 5;
        let currentTargetY = this.userData.baseHeight + oscilation;
        
        // Reacción ultra rápida al terreno (15 * delta en vez de 2) para no atravesar montañas
        this.position.y += (currentTargetY - this.position.y) * 15 * delta;

        if (this.userData.minimapDot) {
            const pX = (this.position.x + 12000) / 24000 * 200;
            const pZ = (this.position.z + 12000) / 24000 * 200;
            this.userData.minimapDot.style.left = `${pX}px`;
            this.userData.minimapDot.style.top = `${pZ}px`;
        }
    }

    update(delta, environment, player, time) {
        this.updateBasePhysics(delta, environment, time);
    }
}

class Spawner extends BaseEnemy {
    constructor(manager, type, name, hp, spawnType, maxUnits, spawnRate) {
        super(manager, type, name, hp, 0);
        this.spawnType = spawnType;
        this.maxUnits = maxUnits;
        this.spawnRate = spawnRate;
        this.lastSpawnTime = Date.now() * 0.001;
        this.spawnedUnits = [];
    }

    update(delta, environment, player, time) {
        this.spawnedUnits = this.spawnedUnits.filter(u => u.userData.hp > 0);
        
        if (this.userData.maxSpeed > 0) {
            // === LÓGICA DE BASE MÓVIL ===
            // Deambula por el mapa libremente. Cambia de dirección aleatoriamente 0.5% de las veces
            // o si choca contra una montaña (la velocidad baja a casi 0)
            if (Math.random() < 0.005 || this.userData.velocity.lengthSq() < 0.1) {
                const angle = Math.random() * Math.PI * 2;
                this.userData.velocity.set(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(this.userData.maxSpeed);
            }
            this.updateBasePhysics(delta, environment, time);
            
            // Fuerza a que la base se mantenga más alta que el terreno para sobrevolarlo
            if (environment && this.userData._cachedTerrainH !== undefined) {
                this.position.y = Math.max(this.position.y, this.userData._cachedTerrainH + 80);
            }
            
            // Rota la base para que mire hacia donde se mueve
            if (this.userData.velocity.lengthSq() > 0.1) {
                const lookTarget = this.position.clone().add(this.userData.velocity);
                lookTarget.y = this.position.y;
                const currentQuat = this.quaternion.clone();
                this.lookAt(lookTarget);
                const targetQuat = this.quaternion.clone();
                this.quaternion.copy(currentQuat).slerp(targetQuat, 2 * delta);
            }
        } else {
            // === LÓGICA DE BASE ESTÁTICA ===
            // Ajustar altura de la colmena al terreno para que no quede enterrada
            if (environment) {
                const h = environment.getHeightAt(this.position.x, this.position.z);
                this.position.y = Math.max(0, h) + 35;
            }
        }
        
        if (this.spawnedUnits.length < this.maxUnits && time - this.lastSpawnTime > this.spawnRate) {
            this.manager.spawnUnitFromSpawner(this);
            this.lastSpawnTime = time;
        }
    }
}

class MobileEnemy extends BaseEnemy {
    update(delta, environment, player, time) {
        super.update(delta, environment, player, time);

        // Sin animacion de nacimiento - escala real desde el inicio
        // (la animacion de nacimiento causaba invisibilidad permanente)

        const distToPlayer = this.position.distanceTo(player.position);
        const aggroDist = CONFIG.COMBAT[this.userData.type.toUpperCase() + '_AGGRO_DIST'];

        if (distToPlayer < aggroDist) {
            const attackDist = CONFIG.COMBAT[this.userData.type.toUpperCase() + '_ATTACK_DIST'] || 300;
            const orbitDistance = attackDist * 0.8;
            
            const toPlayer = new THREE.Vector3().subVectors(player.position, this.position);
            toPlayer.y = 0; 
            const moveDir = toPlayer.clone();
            
            if (distToPlayer > attackDist) {
                if (moveDir.lengthSq() > 0.001) moveDir.normalize();
                this.userData.velocity.lerp(moveDir.multiplyScalar(this.userData.maxSpeed), 0.02);
            } else {
                if (moveDir.lengthSq() > 0.001) moveDir.normalize(); else moveDir.set(1,0,0);
                const perp = new THREE.Vector3(-moveDir.z, 0, moveDir.x).multiplyScalar(this.userData.orbitDirection || 1);
                const distanceCorrection = (distToPlayer - orbitDistance) * 0.5;
                const orbitDir = new THREE.Vector3().addVectors(
                    perp.multiplyScalar(this.userData.maxSpeed), 
                    moveDir.multiplyScalar(distanceCorrection)
                );
                orbitDir.normalize();
                this.userData.velocity.lerp(orbitDir.multiplyScalar(this.userData.maxSpeed * 0.8), 0.05);
            }

            const fireRate = CONFIG.COMBAT[this.userData.type.toUpperCase() + '_FIRE_RATE'];
            
            if (time - this.userData.lastShot > fireRate && distToPlayer < attackDist) {
                const trueAimDir = new THREE.Vector3().subVectors(player.position, this.position).normalize();
                this.manager.enemyShoot(this, trueAimDir);
                this.userData.lastShot = time;
            }
        } else {
            // Lógica de patrullaje anclada a la base (Spawner)
            let wanderTarget = new THREE.Vector3(0,0,0);
            if (this.userData.spawner) {
                wanderTarget.copy(this.userData.spawner.position);
            }
            
            // PATRULLA CIRCULAR ALREDEDOR DE LA BASE (sin perturbación)
            if (this.userData.spawner) {
                const toBase = new THREE.Vector3().subVectors(wanderTarget, this.position);
                toBase.y = 0;
                const distToBase = toBase.length();
                
                // Órbitas cerradas en forma de enjambre (swarm)
                let orbitRadius = 250;
                if (this.userData.type === 'Drone') orbitRadius = 100;
                if (this.userData.type === 'Zona1') orbitRadius = 150;
                if (this.userData.type === 'Zona2') orbitRadius = 200;
                const patrolSpeed = this.userData.maxSpeed * 0.4; // Patrullan tranquilamente

                if (toBase.lengthSq() > 0.001) toBase.normalize(); else toBase.set(1,0,0);
                
                // Vector tangente para rotar alrededor de la base (sentido horario o antihorario)
                const orbitDirFlag = this.userData.orbitDirection || 1;
                const tangent = new THREE.Vector3(-toBase.z, 0, toBase.x).multiplyScalar(orbitDirFlag);
                
                // Si están muy lejos o muy cerca, ajustan su distancia al anillo de patrulla
                const correction = (distToBase - orbitRadius) * 0.05;
                const desiredVel = new THREE.Vector3().addVectors(
                    tangent.multiplyScalar(patrolSpeed),
                    toBase.multiplyScalar(correction * patrolSpeed)
                );
                
                if (desiredVel.lengthSq() > 0.001) desiredVel.normalize();
                this.userData.velocity.lerp(desiredVel.multiplyScalar(patrolSpeed), 0.05);
            } else {
                // LÓGICA DE DEAMBULAR LIBRE (Boss solitario que navega el mundo)
                if (Math.random() < 0.01 || this.userData.velocity.lengthSq() < 0.1) {
                    const angle = Math.random() * Math.PI * 2;
                    this.userData.velocity.set(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(this.userData.maxSpeed * 0.4);
                }
            }
        }

        let separation = new THREE.Vector3(0,0,0);
        for (const other of this.manager.enemies) {
            if (other !== this && other instanceof MobileEnemy) {
                const distSq = this.position.distanceToSquared(other.position);
                let minRad = this.userData.type === 'Boss' ? 400 : 120;
                let minDistSq = minRad * minRad;
                if (distSq < minDistSq && distSq > 0.1) {
                    const repelDir = new THREE.Vector3().subVectors(this.position, other.position);
                    repelDir.y = 0; // Solo repulsión horizontal
                    repelDir.normalize();
                    const force = (minDistSq - distSq) / minDistSq; 
                    separation.addScaledVector(repelDir, force * 250);
                }
            }
        }
        this.userData.velocity.add(separation.multiplyScalar(delta));
        this.userData.velocity.y = 0; // Prevenir cualquier velocidad vertical acumulada

        if (this.userData.velocity.lengthSq() > 0.1) {
            // Proyectar el punto de mirada 50 metros adelante para suavizar la rotación vertical
            const lookDir = this.userData.velocity.clone().normalize().multiplyScalar(50);
            const lookTarget = this.position.clone().add(lookDir);
            
            if (environment) {
                const forwardTerrain = environment.getHeightAt(lookTarget.x, lookTarget.z);
                let hoverDist = 35; 
                if (this.userData.type && this.userData.type.includes('Boss')) hoverDist = 150;
                if (this.userData.type && this.userData.type.includes('Zona3')) hoverDist = 100;
                lookTarget.y = Math.max(hoverDist, forwardTerrain + hoverDist);
            }
            
            const currentQuat = this.quaternion.clone();
            this.lookAt(lookTarget);
            const targetQuat = this.quaternion.clone();
            this.quaternion.copy(currentQuat).slerp(targetQuat, 4 * delta);
        }
    }
}

// ---- ENEMY MANAGER ----

export class EnemyManager {
    constructor(scene, player, gltfLoader) {
        this.scene = scene;
        this.player = player;
        this.gltfLoader = gltfLoader;
        this.enemies = [];
        this.enemyLasers = [];
        this.explosions = [];

        this.raycasterDown = new THREE.Raycaster();
        this.raycasterDown.ray.direction.set(0, -1, 0);

        this.createFallbackTemplates();
        
        // Solo las bases que tienen fallback geométrico se spawean de inmediato
        this.initStandardSpawners();

        if (this.gltfLoader) {
            this.loadGLTFModels();
        }
    }

    createFallbackTemplates() {
        this.fighterGroup = new THREE.Group();
        const metalMat = new THREE.MeshStandardMaterial({ color: 0xaa3333, metalness: 0.8, roughness: 0.4 });
        const bodyGeo = new THREE.BoxGeometry(3, 2, 8);
        const body = new THREE.Mesh(bodyGeo, metalMat);
        body.castShadow = true;
        this.fighterGroup.add(body);

        this.droneGroup = new THREE.Group();
        const ufoMat = new THREE.MeshStandardMaterial({ color: 0x8888aa, metalness: 0.9, roughness: 0.2 });
        const ufoGeo = new THREE.SphereGeometry(5, 16, 16);
        ufoGeo.scale(1, 0.4, 1);
        const ufo = new THREE.Mesh(ufoGeo, ufoMat);
        ufo.castShadow = true;
        this.droneGroup.add(ufo);

        this.bossGroup = new THREE.Group();
        const bossMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.5 });
        const bossCore = new THREE.Mesh(new THREE.BoxGeometry(15, 8, 30), bossMat);
        bossCore.castShadow = true;
        this.bossGroup.add(bossCore);
        
        this.zona1Group = new THREE.Group();
        const z1Mat = new THREE.MeshStandardMaterial({ color: 0x00ff00, metalness: 0.8, roughness: 0.5 });
        const z1Core = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), z1Mat);
        this.zona1Group.add(z1Core);
        
        this.zona3Group = new THREE.Group();
        this.zona3Group.add(new THREE.Mesh(new THREE.BoxGeometry(4,4,4), new THREE.MeshStandardMaterial({ color: 0xff00ff })));
    }

    initStandardSpawners() {
        const minimapContainer = document.getElementById('minimap-enemies');
        if (minimapContainer) minimapContainer.innerHTML = '';

        // Spawners con modelos geométricos        // Cantidades reducidas para mantener FPS alto
        this.createSpawner('DroneSpawner', 'HIVE NEST', 500, 'Drone', 8, 5.0, CONFIG.ZONES.DRONE, this.droneGroup, minimapContainer, 'minimap-boss');
        this.createSpawner('FighterSpawner', 'COMMAND BASE', 800, 'Fighter', 6, 6.0, CONFIG.ZONES.FIGHTER, this.fighterGroup, minimapContainer, 'minimap-boss');
        
        // El Boss ya no tiene Spawner, se instanciará como una unidad suelta cuando cargue su GLTF
        
        // Zona 1 y Zona 2: sus Spawners se crean aquí (sin bots), los BOTS se crean después del GLTF
        const minimap = document.getElementById('minimap-enemies');
        const z1Spawner = new Spawner(this, 'Zona1Spawner', 'ZONA 1 BASE', 1500, 'Zona1', 8, 6.0);
        z1Spawner.setupVisuals(null, CONFIG.VISUALS.ZONA1_SPAWNER_RING, CONFIG.VISUALS.ZONA1_SPAWNER_BOX);
        z1Spawner.position.set(CONFIG.ZONES.ZONA1.x, 35, CONFIG.ZONES.ZONA1.z); // Set position FIRST
        z1Spawner.createMinimapDot(minimap, 'minimap-boss');
        this.scene.add(z1Spawner);
        this.enemies.push(z1Spawner);
        this.zona1Spawner = z1Spawner;

        const z2Spawner = new Spawner(this, 'Zona2Spawner', 'SCAVENGER NEST', 1200, 'Zona2', 8, 5.0);
        z2Spawner.setupVisuals(null, CONFIG.VISUALS.ZONA2_SPAWNER_RING, CONFIG.VISUALS.ZONA2_SPAWNER_BOX);
        z2Spawner.position.set(CONFIG.ZONES.ZONA2.x, 35, CONFIG.ZONES.ZONA2.z); // Set position FIRST
        z2Spawner.createMinimapDot(minimap, 'minimap-boss');
        this.scene.add(z2Spawner);
        this.enemies.push(z2Spawner);
        this.zona2Spawner = z2Spawner;
        
        // ZONA 3: Base de Patrulla Móvil
        const z3Spawner = new Spawner(this, 'Zona3Spawner', 'MOBILE PATROL BASE', 2500, 'Zona3', 6, 6.0);
        z3Spawner.userData.maxSpeed = 50; 
        z3Spawner.userData.velocity = new THREE.Vector3(1, 0, 1).normalize().multiplyScalar(50);
        z3Spawner.setupVisuals(null, CONFIG.VISUALS.ZONA3_SPAWNER_RING, CONFIG.VISUALS.ZONA3_SPAWNER_BOX);
        z3Spawner.position.set(CONFIG.ZONES.ZONA3.x, 150, CONFIG.ZONES.ZONA3.z); // Set position FIRST
        z3Spawner.createMinimapDot(minimap, 'minimap-boss');
        this.scene.add(z3Spawner);
        this.enemies.push(z3Spawner);
        this.zona3Spawner = z3Spawner;
    }

    createSpawner(type, name, hp, spawnType, maxUnits, spawnRate, zone, template, minimapContainer, minimapClass) {
        const spawner = new Spawner(this, type, name, hp, spawnType, maxUnits, spawnRate);
        const ringSize = CONFIG.VISUALS[spawnType.toUpperCase() + '_SPAWNER_RING'];
        const boxSize = CONFIG.VISUALS[spawnType.toUpperCase() + '_SPAWNER_BOX'];
        spawner.setupVisuals(template, ringSize, boxSize);
        spawner.position.set(zone.x, 35, zone.z); // Set position FIRST
        spawner.createMinimapDot(minimapContainer, minimapClass);
        this.scene.add(spawner);
        this.enemies.push(spawner);

        // Pre-spawneamos a todo el enjambre de inmediato
        for (let i = 0; i < maxUnits; i++) {
            this.spawnUnitFromSpawner(spawner);
        }
    }

    spawnUnitFromSpawner(spawner) {
        const spawnType = spawner.spawnType;
        let hp, speed, name, template, ringSize, boxSize, minimapClass;

        if (spawnType === 'Drone') {
            hp = CONFIG.COMBAT.DRONE_HP; speed = CONFIG.COMBAT.DRONE_SPEED; name = 'SCOUT DRONE';
            template = this.droneGroup; minimapClass = 'minimap-drone';
        } else if (spawnType === 'Fighter') {
            hp = CONFIG.COMBAT.FIGHTER_HP; speed = CONFIG.COMBAT.FIGHTER_SPEED; name = 'BC-303 CRUISER';
            template = this.fighterGroup; minimapClass = 'minimap-fighter';
        } else if (spawnType === 'Zona1') {
            hp = CONFIG.COMBAT.ZONA1_HP; speed = CONFIG.COMBAT.ZONA1_SPEED; name = 'ZONA1 ENEMY';
            template = this.zona1Group; minimapClass = 'minimap-fighter';
        } else if (spawnType === 'Zona2') {
            hp = CONFIG.COMBAT.ZONA2_HP; speed = CONFIG.COMBAT.ZONA2_SPEED; name = 'SCAVENGER BOT';
            template = this.zona2Group; minimapClass = 'minimap-drone';
        } else if (spawnType === 'Zona3') {
            hp = CONFIG.COMBAT.ZONA3_HP; speed = CONFIG.COMBAT.ZONA3_SPEED; name = 'ZONA3 PATROL';
            template = this.zona3Group; minimapClass = 'minimap-fighter';
        } else {
            hp = CONFIG.COMBAT.BOSS_HP; speed = CONFIG.COMBAT.BOSS_SPEED; name = 'OLYMPIC CARRIER';
            template = this.bossGroup; minimapClass = 'minimap-boss';
        }

        ringSize = CONFIG.VISUALS[spawnType.toUpperCase() + '_RING_SIZE'];
        boxSize = CONFIG.VISUALS[spawnType.toUpperCase() + '_BOX_SIZE'];

        const unit = new MobileEnemy(this, spawnType, name, hp, speed);
        unit.userData.spawner = spawner; // Guardamos su colmena madre para que no se pierdan
        unit.setupVisuals(template, ringSize, boxSize);
        unit.createMinimapDot(document.getElementById('minimap-enemies'), minimapClass);

        const angle = Math.random() * Math.PI * 2;
        const dist = 200 + Math.random() * 400; // Dispersos de 200m a 600m alrededor de la base
        unit.position.set(spawner.position.x + Math.cos(angle)*dist, 80, spawner.position.z + Math.sin(angle)*dist);

        this.scene.add(unit);
        this.enemies.push(unit);
        spawner.spawnedUnits.push(unit);
    }

    loadGLTFModels() {
        // Cargar Colmena (Drone Spawner)
        this.gltfLoader.load('/models/drone/colmena.glb', (gltf) => {
            const model = gltf.scene;
            model.scale.set(CONFIG.VISUALS.COLMENA_SCALE, CONFIG.VISUALS.COLMENA_SCALE, CONFIG.VISUALS.COLMENA_SCALE); 
            model.traverse(c => { if(c.isMesh) { c.castShadow=true; c.receiveShadow=true; c.frustumCulled=false; }});
            
            this.enemies.forEach(e => {
                if (e instanceof Spawner && e.spawnType === 'Drone') {
                    e.visualGroup.clear();
                    e.visualGroup.add(SkeletonUtils.clone(model));
                }
            });
        }, undefined, (err) => console.log("Using fallback for Colmena."));

        // Cargar pequeños Drones
        this.gltfLoader.load('/models/drone/drone.glb', (gltf) => {
            const model = gltf.scene;
            model.scale.set(CONFIG.VISUALS.DRONE_SCALE, CONFIG.VISUALS.DRONE_SCALE, CONFIG.VISUALS.DRONE_SCALE); 
            model.traverse(c => { if(c.isMesh) { c.castShadow=true; c.receiveShadow=true; c.frustumCulled=false; }});
            
            this.droneGroup = model; // Actualizamos template
            this.enemies.forEach(e => {
                if (e.userData.type === 'Drone' && !(e instanceof Spawner)) {
                    e.visualGroup.clear();
                    e.visualGroup.add(SkeletonUtils.clone(model));
                }
            });
        }, undefined, (err) => console.log("Using fallback for Drones."));

        this.gltfLoader.load('/models/zona1/base1.glb', (gltf) => {
            const model = gltf.scene;
            model.scale.set(CONFIG.VISUALS.ZONA1_BASE_SCALE, CONFIG.VISUALS.ZONA1_BASE_SCALE, CONFIG.VISUALS.ZONA1_BASE_SCALE);
            model.traverse(c => { if(c.isMesh) { c.castShadow=true; c.receiveShadow=true; c.frustumCulled=false; }});
            if (this.zona1Spawner) {
                this.zona1Spawner.visualGroup.clear();
                this.zona1Spawner.visualGroup.add(model.clone());
            }
        });

        this.gltfLoader.load('/models/zona1/enemi1.glb', (gltf) => {
            const enemiModel = gltf.scene;
            enemiModel.scale.set(CONFIG.VISUALS.ZONA1_SCALE, CONFIG.VISUALS.ZONA1_SCALE, CONFIG.VISUALS.ZONA1_SCALE);
            enemiModel.rotation.y = Math.PI; // Rotar 180 grados para que miren hacia adelante
            enemiModel.traverse(c => { if(c.isMesh) { c.castShadow=true; c.receiveShadow=true; c.frustumCulled=false; }});
            this.zona1Group = enemiModel;
            // Ahora que el modelo existe, spawneamos los bots
            if (this.zona1Spawner) {
                for (let i = 0; i < this.zona1Spawner.maxUnits; i++) {
                    this.spawnUnitFromSpawner(this.zona1Spawner);
                }
            }
        });

        // Cargar Carroñeros (Zona 2)
        this.gltfLoader.load('/models/zona2/enemi2.glb', (gltf) => {
            const enemiModel = gltf.scene;
            enemiModel.scale.set(CONFIG.VISUALS.ZONA2_SCALE, CONFIG.VISUALS.ZONA2_SCALE, CONFIG.VISUALS.ZONA2_SCALE);
            enemiModel.traverse(c => { if(c.isMesh) { c.castShadow=true; c.receiveShadow=true; c.frustumCulled=false; }});
            this.zona2Group = enemiModel;
            if (this.zona2Spawner) {
                for (let i = 0; i < this.zona2Spawner.maxUnits; i++) {
                    this.spawnUnitFromSpawner(this.zona2Spawner);
                }
            }
        });

        // Modelos de la Zona 3 (Base Móvil y Escoltas)
        this.gltfLoader.load('/models/zona3/base3.glb', (gltf) => {
            const model = gltf.scene;
            model.scale.set(CONFIG.VISUALS.ZONA3_BASE_SCALE, CONFIG.VISUALS.ZONA3_BASE_SCALE, CONFIG.VISUALS.ZONA3_BASE_SCALE);
            model.traverse(c => { if(c.isMesh) { c.castShadow=true; c.receiveShadow=true; c.frustumCulled=false; }});
            if (this.zona3Spawner) {
                this.zona3Spawner.visualGroup.clear();
                this.zona3Spawner.visualGroup.add(model.clone());
            }
        });

        this.gltfLoader.load('/models/zona3/enemi3.glb', (gltf) => {
            const model = gltf.scene;
            model.scale.set(CONFIG.VISUALS.ZONA3_SCALE, CONFIG.VISUALS.ZONA3_SCALE, CONFIG.VISUALS.ZONA3_SCALE);
            model.traverse(c => { if(c.isMesh) { c.castShadow=true; c.receiveShadow=true; c.frustumCulled=false; }});
            this.zona3Group = model; // Actualizar template
            
            this.enemies.forEach(e => {
                if (e.userData.type === 'Zona3' && !(e instanceof Spawner)) {
                    e.visualGroup.clear();
                    e.visualGroup.add(SkeletonUtils.clone(model));
                }
            });
            // Hacemos el spawn del escuadrón completo de una vez cuando carga el modelo
            if (this.zona3Spawner) {
                for(let i=0; i < this.zona3Spawner.maxUnits; i++) {
                    this.spawnUnitFromSpawner(this.zona3Spawner);
                }
            }
        });

        // Cargar Base Cruiser (solo para el Spawner)
        this.gltfLoader.load('/models/evil/stargate__bc-303.glb', (gltf) => {
            const model = gltf.scene;
            const baseScale = CONFIG.VISUALS.FIGHTER_SCALE * CONFIG.VISUALS.SPAWNER_SCALE_MULTIPLIER;
            model.scale.set(baseScale, baseScale, baseScale); 
            model.rotation.y = 0; 
            model.traverse(c => { if(c.isMesh) { c.castShadow=true; c.receiveShadow=true; c.frustumCulled=false; }});
            
            this.enemies.forEach(e => {
                if (e instanceof Spawner && e.spawnType === 'Fighter') {
                    e.visualGroup.clear();
                    e.visualGroup.add(SkeletonUtils.clone(model));
                }
            });
        }, undefined, (err) => console.log("Using fallback for Cruiser Base."));

        // Cargar Droids (para las naves que spawnea el Cruiser)
        this.gltfLoader.load('/models/evil/droid.glb', (gltf) => {
            const model = gltf.scene;
            model.scale.set(CONFIG.VISUALS.DROID_SCALE, CONFIG.VISUALS.DROID_SCALE, CONFIG.VISUALS.DROID_SCALE); 
            model.traverse(c => { if(c.isMesh) { c.castShadow=true; c.receiveShadow=true; c.frustumCulled=false; }});
            
            this.fighterGroup = model; // Actualizar template
            this.enemies.forEach(e => {
                if (e.userData.type === 'Fighter' && !(e instanceof Spawner)) {
                    e.visualGroup.clear();
                    e.visualGroup.add(SkeletonUtils.clone(model));
                }
            });
        }, undefined, (err) => console.log("Using fallback for Droids."));

        // Cargar Boss (Loky solitario que patrulla sin base)
        this.gltfLoader.load('/models/enemis_map/loky.glb', (gltf) => {
            const model = gltf.scene;
            model.scale.set(CONFIG.VISUALS.BOSS_SCALE, CONFIG.VISUALS.BOSS_SCALE, CONFIG.VISUALS.BOSS_SCALE); 
            model.rotation.y = 0; 
            model.traverse(c => { if(c.isMesh) { c.castShadow=true; c.receiveShadow=true; c.frustumCulled=false; }});
            
            this.bossGroup = model; // Actualizar template
            
            // Instanciar un único Boss
            const boss = new MobileEnemy(this, 'Boss', 'LOKY', CONFIG.COMBAT.BOSS_HP, CONFIG.COMBAT.BOSS_SPEED);
            boss.setupVisuals(this.bossGroup, CONFIG.VISUALS.BOSS_RING_SIZE, CONFIG.VISUALS.BOSS_BOX_SIZE);
            boss.position.set(CONFIG.ZONES.BOSS.x, 150, CONFIG.ZONES.BOSS.z);
            boss.createMinimapDot(document.getElementById('minimap-enemies'), 'minimap-boss');
            
            this.scene.add(boss);
            this.enemies.push(boss);
        }, undefined, (err) => console.log("Using fallback for Boss."));
    }

    update(delta, environment) {
        const time = Date.now() * 0.001;
        const SLEEP_DIST = 4000;    // distancia para congelar la IA
        const MINIMAP_DIST = 20000; // los puntos del minimapa siempre visibles

        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];
            const dist = enemy.position.distanceTo(this.player.position);
            const sleeping = dist > SLEEP_DIST;

            // El modelo 3D se oculta si está lejos (FPS)
            enemy.visible = !sleeping;

            // El minimapa SIEMPRE muestra las bases, y muestra bots dentro de 6000m
            if (enemy.userData.minimapDot) {
                const isBase = enemy.spawnType !== undefined; // Spawner = base
                const showOnMap = isBase || dist < 6000;
                enemy.userData.minimapDot.style.display = showOnMap ? 'block' : 'none';
            }

            if (!sleeping) {
                enemy.update(delta, environment, this.player, time);
            }
        }

        this.updateEnemyLasers(delta, environment);
        this.updateExplosions(delta);
    }

    takeDamage(enemy, amount) {
        enemy.userData.hp -= amount;
        
        if (enemy.userData.hp > 0) {
            // Impacto visual (chispa)
            this.createExplosion(enemy.position, 0.2);
            
            // Flash rojo
            if (!enemy.userData.hasUniqueMaterial) {
                enemy.visualGroup.traverse(c => {
                    if (c.isMesh && c.material) {
                        c.material = c.material.clone();
                    }
                });
                enemy.userData.hasUniqueMaterial = true;
            }
            if (!enemy.userData.isBlinking) {
                enemy.userData.isBlinking = true;
                const prevEmissive = [];
                enemy.visualGroup.traverse(c => {
                    if (c.isMesh && c.material && c.material.emissive) {
                        prevEmissive.push({ mesh: c, color: c.material.emissive.getHex() });
                        c.material.emissive.setHex(0xff5555);
                    }
                });
                setTimeout(() => {
                    prevEmissive.forEach(item => {
                        if (item.mesh && item.mesh.material) {
                            item.mesh.material.emissive.setHex(item.color);
                        }
                    });
                    if (enemy.userData) enemy.userData.isBlinking = false;
                }, 100);
            }
        }

        if (enemy.userData.hp <= 0) {
            let explosionScale = 1.0;
            if (enemy.userData.type === 'Fighter') explosionScale = 2.5;
            if (enemy.userData.type === 'Boss' || enemy.userData.type.includes('Spawner')) explosionScale = 8.0;
            this.createExplosion(enemy.position, explosionScale);

            this.scene.remove(enemy);
            this.enemies = this.enemies.filter(e => e !== enemy);
            
            if (enemy.userData.minimapDot && enemy.userData.minimapDot.parentNode) {
                enemy.userData.minimapDot.parentNode.removeChild(enemy.userData.minimapDot);
            }

            if (this.player.target === enemy) {
                this.player.setTarget(null);
            }
        }
    }

    enemyShoot(enemy, direction) {
        let color = 0xff0000;
        let thickness = 0.5;
        let spawnOffset = 10;

        if (enemy.userData.type === 'Drone') { color = 0x00ff00; thickness = 0.5; spawnOffset = 5; }
        else if (enemy.userData.type === 'Fighter') { color = 0xffaa00; thickness = 0.8; spawnOffset = 20; }
        else if (enemy.userData.type === 'Boss') { color = 0xff0000; thickness = 3.0; spawnOffset = 100; }

        const laserGeo = new THREE.CylinderGeometry(thickness, thickness, 35, 8);
        laserGeo.rotateX(Math.PI / 2);
        const laserMat = new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 2.5, transparent: true, opacity: 0.9 });
        const laser = new THREE.Mesh(laserGeo, laserMat);

        laser.position.copy(enemy.position).addScaledVector(direction, spawnOffset);
        
        const targetPos = laser.position.clone().add(direction);
        laser.lookAt(targetPos);
        
        laser.userData = {
            velocity: direction.clone().multiplyScalar(2000), 
            life: 3.0,
            damage: CONFIG.COMBAT[enemy.userData.type.toUpperCase() + '_DAMAGE'] || 10
        };

        this.scene.add(laser);
        this.enemyLasers.push(laser);
    }

    updateEnemyLasers(delta, environment) {
        for (let i = this.enemyLasers.length - 1; i >= 0; i--) {
            const laser = this.enemyLasers[i];
            laser.userData.life -= delta;
            
            if (laser.userData.life <= 0) {
                this.scene.remove(laser);
                this.enemyLasers.splice(i, 1);
                continue;
            }

            laser.position.addScaledVector(laser.userData.velocity, delta);

            if (environment) {
                const terrainHeight = environment.getHeightAt(laser.position.x, laser.position.z);
                if (laser.position.y <= terrainHeight) {
                    this.scene.remove(laser);
                    this.enemyLasers.splice(i, 1);
                    continue; 
                }
            }

            const dist = laser.position.distanceTo(this.player.position);
            if (dist < 15) { 
                if (typeof this.player.takeDamage === 'function') {
                    this.player.takeDamage(laser.userData.damage);
                }
                this.createExplosion(laser.position, 0.5); // Impacto visual en el jugador
                this.scene.remove(laser);
                this.enemyLasers.splice(i, 1);
            }
        }
    }

    createExplosion(position, scale = 1.0) {
        const particleCount = Math.floor(30 * scale);
        const particles = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = [];

        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = position.x;
            positions[i * 3 + 1] = position.y;
            positions[i * 3 + 2] = position.z;

            const v = new THREE.Vector3(
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2
            ).normalize().multiplyScalar(Math.random() * 100 * scale);
            velocities.push(v);
        }

        particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        const mat = new THREE.PointsMaterial({
            color: 0xffaa00, 
            size: 8 * scale,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const pointCloud = new THREE.Points(particles, mat);
        this.scene.add(pointCloud);
        this.explosions.push({ mesh: pointCloud, velocities: velocities, life: 1.0 });
    }

    updateExplosions(delta) {
        for (let i = this.explosions.length - 1; i >= 0; i--) {
            const exp = this.explosions[i];
            exp.life -= delta * 1.5;

            if (exp.life <= 0) {
                this.scene.remove(exp.mesh);
                exp.mesh.geometry.dispose();
                exp.mesh.material.dispose();
                this.explosions.splice(i, 1);
                continue;
            }

            const positions = exp.mesh.geometry.attributes.position.array;
            for (let j = 0; j < exp.velocities.length; j++) {
                positions[j * 3] += exp.velocities[j].x * delta;
                positions[j * 3 + 1] += exp.velocities[j].y * delta;
                positions[j * 3 + 2] += exp.velocities[j].z * delta;
                exp.velocities[j].y -= 40 * delta;
            }
            exp.mesh.geometry.attributes.position.needsUpdate = true;
            exp.mesh.material.opacity = exp.life;
        }
    }
}
