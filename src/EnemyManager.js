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

    createMinimapDot(container, typeClass, text = '', textColor = 'white') {
        if (container) {
            const dot = document.createElement('div');
            dot.className = `minimap-enemy ${typeClass}`;
            if (text) {
                const label = document.createElement('span');
                label.innerText = text;
                label.style.position = 'absolute';
                label.style.top = '-12px';
                label.style.left = '50%';
                label.style.transform = 'translateX(-50%)';
                label.style.fontSize = '8px';
                label.style.color = textColor;
                label.style.fontWeight = 'bold';
                label.style.textShadow = '1px 1px 0px #000, -1px -1px 0px #000, 1px -1px 0px #000, -1px 1px 0px #000'; // Borde negro grueso
                label.style.pointerEvents = 'none';
                dot.appendChild(label);
            }
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
            
            let hNextX = environment.getHeightAt(nextX, this.position.z);
            let hNextZ = environment.getHeightAt(this.position.x, nextZ);

            if (hNextX > wallHeight) {
                this.userData.velocity.x = 0;
                nextX = this.position.x;
            }
            if (hNextZ > wallHeight) {
                this.userData.velocity.z = 0;
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
    update(delta, environment, player, time, enemiesList) {
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
            } else {
                if (moveDir.lengthSq() > 0.001) moveDir.normalize(); else moveDir.set(1,0,0);
                
                // === LÓGICA DE ÓRBITA DINÁMICA (Menos genérica) ===
                // Cambiar de dirección de órbita aleatoriamente de vez en cuando (ZigZag)
                if (Math.random() < 0.005) {
                    this.userData.orbitDirection = (this.userData.orbitDirection || 1) * -1;
                }
                
                // Fluctuación en la distancia de órbita para que entren y salgan como si esquivaran
                const dynamicOrbitDist = orbitDistance + Math.sin(time * 2.0 + this.id) * (orbitDistance * 0.3);
                
                const perp = new THREE.Vector3(-moveDir.z, 0, moveDir.x).multiplyScalar(this.userData.orbitDirection || 1);
                const distanceCorrection = (distToPlayer - dynamicOrbitDist) * 1.5; // Corrección más agresiva
                
                // Añadir un ligero cabeceo vertical (bobbing)
                const verticalBobbing = Math.cos(time * 3.0 + this.id * 1.5) * (this.userData.maxSpeed * 0.4);
                
                const orbitDir = new THREE.Vector3().addVectors(
                    perp.multiplyScalar(this.userData.maxSpeed), 
                    moveDir.multiplyScalar(distanceCorrection)
                );
                
                // Inyectamos el movimiento vertical falso al vector de movimiento
                orbitDir.y = verticalBobbing; 
                
                moveDir.copy(orbitDir).normalize();
            }

            // === Obstacle Avoidance Steering ===
            if (environment) {
                this.userData._feelerTick = (this.userData._feelerTick || Math.floor(Math.random() * 10)) + 1;
                
                if (this.userData._feelerTick >= 10 || !this.userData._cachedAvoid) {
                    this.userData._feelerTick = 0;
                    
                    const feelerDist = 80;
                    let forward = moveDir.clone();
                    if (forward.lengthSq() < 0.001) forward.set(1,0,0);
                    forward.normalize();
                    const right = new THREE.Vector3(-forward.z, 0, forward.x);
                    
                    // Proyectar antenas a la izquierda y derecha
                    const leftF = new THREE.Vector3().addVectors(forward, right.clone().multiplyScalar(-0.8)).normalize().multiplyScalar(feelerDist);
                    const rightF = new THREE.Vector3().addVectors(forward, right.clone().multiplyScalar(0.8)).normalize().multiplyScalar(feelerDist);
                    
                    const hLeft = environment.getHeightAt(this.position.x + leftF.x, this.position.z + leftF.z);
                    const hRight = environment.getHeightAt(this.position.x + rightF.x, this.position.z + rightF.z);
                    
                    const wallH = 40;
                    let avoidForce = new THREE.Vector3(0,0,0);
                    
                    // Si hay muro a la izquierda, empujar a la derecha, y viceversa
                    if (hLeft > wallH) avoidForce.add(right.clone().multiplyScalar(2.0));
                    if (hRight > wallH) avoidForce.add(right.clone().multiplyScalar(-2.0));
                    
                    this.userData._cachedAvoid = avoidForce;
                }
                
                if (this.userData._cachedAvoid && this.userData._cachedAvoid.lengthSq() > 0) {
                    moveDir.add(this.userData._cachedAvoid).normalize();
                }
                // === Boids Separation (Repulsión entre bots) ===
                // Optimización: Usamos distanceToSquared en lugar de distanceTo para evitar cientos de Math.sqrt() por frame
                if (enemiesList) {
                    let sepForce = new THREE.Vector3();
                    let count = 0;
                    for (let other of enemiesList) {
                        if (other !== this && other.userData.hp > 0) {
                            const dSq = this.position.distanceToSquared(other.position);
                            if (dSq > 0.01 && dSq < 32400) { // 180 * 180 = 32400
                                const d = Math.sqrt(dSq); // Solo hacemos raíz cuadrada si están muy cerca
                                const push = new THREE.Vector3().subVectors(this.position, other.position);
                                push.y = 0;
                                push.normalize().divideScalar(d);
                                sepForce.add(push);
                                count++;
                            }
                        }
                    }
                    if (count > 0) {
                        sepForce.divideScalar(count).multiplyScalar(2.5); // Fuerte repulsión
                        moveDir.add(sepForce).normalize();
                    }
                }
            }

            // Aplicar velocidad final
            const lerpSpeed = distToPlayer > attackDist ? 0.02 : 0.05;
            const finalSpeed = distToPlayer > attackDist ? this.userData.maxSpeed : this.userData.maxSpeed * 0.8;
            this.userData.velocity.lerp(moveDir.multiplyScalar(finalSpeed), lerpSpeed);

            const fireRate = CONFIG.COMBAT[this.userData.type.toUpperCase() + '_FIRE_RATE'];
            
            if (time - this.userData.lastShot > fireRate && distToPlayer < attackDist) {
                const trueAimDir = new THREE.Vector3().subVectors(player.position, this.position).normalize();
                this.manager.enemyShoot(this, trueAimDir);
                this.userData.lastShot = time;
            }

            // Actualizar el resplandor del motor visualmente
            if (this.userData.thrusterGlow) {
                const speed = this.userData.velocity.length();
                const scale = 0.5 + (speed / this.userData.maxSpeed);
                this.userData.thrusterGlow.scale.set(scale, scale, scale);
            }
        } else {
            // PATRULLA LIBRE DESVINCULADA (Free Roam)
            const patrolSpeed = this.userData.maxSpeed * 0.45; 
            
            // Ruido orgánico para deambular. Evita líneas rectas eternas.
            const noiseAngle = time * 0.2 + this.id * 12.34;
            const wanderForce = new THREE.Vector3(Math.cos(noiseAngle), 0, Math.sin(noiseAngle)).normalize().multiplyScalar(patrolSpeed);
            
            // Evitar que salgan de los límites del mapa (24000x24000)
            if (this.position.x > 11000) wanderForce.x = -patrolSpeed;
            if (this.position.x < -11000) wanderForce.x = patrolSpeed;
            if (this.position.z > 11000) wanderForce.z = -patrolSpeed;
            if (this.position.z < -11000) wanderForce.z = patrolSpeed;
            
            const desiredVel = wanderForce;
            if (desiredVel.lengthSq() > 0.001) desiredVel.normalize();
            
            // Movimiento suave y orgánico hacia la nueva dirección
            this.userData.velocity.lerp(desiredVel.multiplyScalar(patrolSpeed), 0.015);
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
        this.userData.velocity.add(separation.multiplyScalar(delta));
        
        // Suavizar el movimiento vertical del bobbing para que no sea estático, pero empujarlo al nivel del jugador
        const heightDifference = player.position.y - this.position.y;
        this.userData.velocity.y += heightDifference * 0.5; // Gravedad suave hacia el nivel del jugador
        
        // Limitar la velocidad vertical máxima para que no salgan volando
        if (this.userData.velocity.y > this.userData.maxSpeed * 0.5) this.userData.velocity.y = this.userData.maxSpeed * 0.5;
        if (this.userData.velocity.y < -this.userData.maxSpeed * 0.5) this.userData.velocity.y = -this.userData.maxSpeed * 0.5;

        if (this.userData.velocity.lengthSq() > 0.1) {
            // Eliminar el cálculo predictivo del terreno para el "lookTarget".
            // Ahora la nave siempre mirará de frente (nivelada horizontalmente)
            let lookTarget;
            const currentAttackDist = CONFIG.COMBAT[this.userData.type.toUpperCase() + '_ATTACK_DIST'] || 300;
            
            if (distToPlayer < currentAttackDist * 1.5) {
                // Modo Combate: Siempre apuntar el morro (nariz) hacia el jugador para disparar de frente (Strafing)
                lookTarget = player.position.clone();
                lookTarget.y = this.position.y; // Nivelado
            } else {
                // Modo Vuelo Libre: Apuntar hacia la dirección de movimiento
                const lookDir = this.userData.velocity.clone().normalize().multiplyScalar(50);
                lookTarget = this.position.clone().add(lookDir);
                lookTarget.y = this.position.y; 
            }
            
            const currentQuat = this.quaternion.clone();
            this.lookAt(lookTarget);
            const targetQuat = this.quaternion.clone();
            this.quaternion.copy(currentQuat).slerp(targetQuat, 4 * delta);
            
            // Orientación Natural (Banking/Roll): La nave se inclina visualmente al girar
            const localVelocity = this.userData.velocity.clone().applyQuaternion(this.quaternion.clone().invert());
            const targetRoll = localVelocity.x * 0.005; 
            this.visualGroup.rotation.z += (targetRoll - this.visualGroup.rotation.z) * 0.1;
        }

        // --- ANIMACIÓN DEL FUEGO DE MOTOR (Como el Player) ---
        const speed = this.userData.velocity.length();
        const maxSpd = this.userData.maxSpeed;
        const isIdle = speed < 10;
        const flicker = 0.8 + Math.random() * 0.4; // Vibración del fuego

        this.children.forEach(child => {
            if (child.userData.isFlame) {
                const s = child.userData.baseScale;
                if (isIdle) {
                    // Ralentí: Bolita de fuego pequeña en la tobera
                    child.scale.lerp(new THREE.Vector3(s * 0.1 * flicker, s * 0.1 * flicker, s * 0.1), 0.2);
                } else {
                    // Vuelo: El cono se estira según la velocidad real
                    const stretch = 0.2 + (speed / maxSpd) * 0.8; 
                    child.scale.lerp(new THREE.Vector3(s * 0.15 * flicker, s * 0.15 * flicker, s * stretch * flicker), 0.3);
                }
            }
        });

        // --- SISTEMA DE PARTÍCULAS DEL MOTOR EN ESPACIO GLOBAL ---
        if (this.userData.engineAnchors && this.manager.particleGeo) {
            const isIdle = this.userData.velocity.lengthSq() < 10;
            const maxSpd = this.userData.maxSpeed;
            const speed = this.userData.velocity.length();
            
            // Control de frecuencia de spawn (emitir 1 de cada 3 frames para no saturar)
            this.userData.particleTick = (this.userData.particleTick || 0) + 1;
            const shouldSpawn = this.userData.particleTick % 3 === 0;
            
            if (shouldSpawn) {
                this.userData.engineAnchors.forEach((anchorData) => {
                    const anchor = anchorData.dummy;
                    const size = anchorData.size;
                    
                    const worldPos = new THREE.Vector3();
                    anchor.getWorldPosition(worldPos);
                    
                    let p;
                    if (this.manager.particlePool.length > 0) {
                        p = this.manager.particlePool.pop();
                        p.visible = true;
                    } else {
                        // Usar el material pre-coloreado del manager para evitar fugas de memoria
                        const mat = this.manager.getParticleMaterial(this.userData.dangerColor);
                        p = new THREE.Mesh(this.manager.particleGeo, mat);
                        this.manager.scene.add(p);
                    }
                    
                    p.position.copy(worldPos);
                    p.material = this.manager.getParticleMaterial(this.userData.dangerColor); // Asegurar el color
                    
                    // Vida de la partícula balanceada para un rastro visible pero no excesivo
                    p.userData.life = isIdle ? 0.2 : 0.35 + (speed / maxSpd) * 0.25;
                    // Tamaño más modesto
                    p.userData.baseThickness = size * 0.12;
                    
                    p.scale.setScalar(p.userData.baseThickness * (isIdle ? 0.6 : 1.0));
                    
                    this.manager.trailParticles.push(p);
                });
            }
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
        
        // --- SISTEMA DE PARTÍCULAS OPTIMIZADO PARA ENEMIGOS ---
        this.trailParticles = [];
        this.particlePool = [];
        this.particleGeo = new THREE.PlaneGeometry(3.0, 3.0); // Tamaño base un poco más pequeño
        this.particleMats = {}; // Caché de materiales por color para evitar Memory Leaks

        this.raycasterDown = new THREE.Raycaster();
        this.raycasterDown.ray.direction.set(0, -1, 0);

        this.initBaseModels();
        
        // Solo las bases que tienen fallback geométrico se spawean de inmediato
        this.initStandardSpawners();

        if (this.gltfLoader) {
            this.loadGLTFModels();
        }
    }

    initBaseModels() {
        this.zona1Group = new THREE.Group();
        const z1Mat = new THREE.MeshStandardMaterial({ color: 0x00ff00, metalness: 0.8, roughness: 0.5 });
        const z1Core = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), z1Mat);
        this.zona1Group.add(z1Core);
        
        this.zona2Group = new THREE.Group();
        const z2Mat = new THREE.MeshStandardMaterial({ color: 0x00aaff, metalness: 0.8, roughness: 0.5 });
        const z2Core = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), z2Mat);
        this.zona2Group.add(z2Core);

        this.zona3Group = new THREE.Group();
        this.zona3Group.add(new THREE.Mesh(new THREE.BoxGeometry(4,4,4), new THREE.MeshStandardMaterial({ color: 0xff00ff })));
    }

    buildColmenaModel() {
        const group = new THREE.Group();
        
        // Base Hexagonal
        const baseGeo = new THREE.CylinderGeometry(40, 50, 20, 6);
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x221133, roughness: 0.9, metalness: 0.2 });
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.y = 10;
        group.add(base);
        
        // Núcleo Púrpura Brillante
        const coreGeo = new THREE.SphereGeometry(20, 16, 16);
        const coreMat = new THREE.MeshBasicMaterial({ color: 0xaa00ff, wireframe: true, transparent: true, opacity: 0.8 });
        const core = new THREE.Mesh(coreGeo, coreMat);
        core.position.y = 35;
        group.add(core);

        // Anillos flotantes metálicos
        const ringGeo = new THREE.TorusGeometry(30, 2, 8, 24);
        const ringMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.1 });
        const ring1 = new THREE.Mesh(ringGeo, ringMat);
        ring1.position.y = 35;
        ring1.rotation.x = Math.PI / 2;
        group.add(ring1);
        
        const ring2 = new THREE.Mesh(ringGeo, ringMat);
        ring2.position.y = 35;
        ring2.rotation.x = Math.PI / 3;
        ring2.rotation.y = Math.PI / 4;
        group.add(ring2);

        return group;
    }

    buildScavengerNest() {
        const group = new THREE.Group();
        
        // Base plate (Gran plataforma oscura hexagonal tipo Landing Pad)
        const baseGeo = new THREE.CylinderGeometry(80, 90, 15, 6);
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.2 });
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.y = 7.5;
        group.add(base);
        
        // Núcleo central de Plasma Naranja
        const coreGeo = new THREE.SphereGeometry(25, 32, 32);
        const coreMat = new THREE.MeshStandardMaterial({ 
            color: 0xff4400, emissive: 0xff4400, emissiveIntensity: 2.5, 
            transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending 
        });
        const core = new THREE.Mesh(coreGeo, coreMat);
        core.position.y = 25;
        group.add(core);

        // Pilares de confinamiento (3 pilares inclinados de metal)
        const pillarGeo = new THREE.BoxGeometry(10, 60, 15);
        const pillarMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.8, roughness: 0.4 });
        for(let i=0; i<3; i++) {
            const pillar = new THREE.Mesh(pillarGeo, pillarMat);
            const angle = (i / 3) * Math.PI * 2;
            const radius = 45;
            pillar.position.set(Math.cos(angle) * radius, 30, Math.sin(angle) * radius);
            pillar.lookAt(0, 30, 0); // Miran al núcleo
            pillar.rotation.x -= 0.4; // Inclinados como garras sobre el núcleo
            group.add(pillar);
        }

        // Anillos magnéticos flotantes alrededor del plasma
        const ringGeo = new THREE.TorusGeometry(35, 1.5, 16, 64);
        const ringMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 1.0 });
        const ring1 = new THREE.Mesh(ringGeo, ringMat);
        ring1.position.y = 25;
        ring1.rotation.x = Math.PI / 2;
        ring1.rotation.x = Math.PI / 2;
        group.add(ring1);
        
        const ring2 = new THREE.Mesh(ringGeo, ringMat);
        ring2.position.y = 25;
        ring2.rotation.x = Math.PI / 2;
        ring2.scale.set(1.4, 1.4, 1.4);
        group.add(ring2);

        return group;
    }

    buildFortressModel() {
        const group = new THREE.Group();
        // Base de la Fortaleza Cuadrada
        const base = new THREE.Mesh(
            new THREE.BoxGeometry(120, 20, 120),
            new THREE.MeshStandardMaterial({ color: 0x111122, metalness: 0.8, roughness: 0.5 })
        );
        base.position.y = 10;
        group.add(base);

        // Torre de mando alta
        const tower = new THREE.Mesh(
            new THREE.CylinderGeometry(20, 30, 100, 4),
            new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 0.9 })
        );
        tower.position.y = 60;
        group.add(tower);

        // Ojo de radar púrpura
        const radar = new THREE.Mesh(
            new THREE.SphereGeometry(15, 16, 16),
            new THREE.MeshStandardMaterial({ color: 0xaa00ff, emissive: 0xaa00ff, emissiveIntensity: 2.0 })
        );
        radar.position.y = 110;
        group.add(radar);

        return group;
    }

    initStandardSpawners() {
        const minimapContainer = document.getElementById('minimap-enemies');
        if (minimapContainer) minimapContainer.innerHTML = '';

        // Eliminar spawners antiguos (Scout Drone y Legion Cruiser) para limpiar el mapa
        // y depender 100% de la convención de Zonas E1, E2, E3.

        // Zonas
        const minimap = document.getElementById('minimap-enemies');
        const z1Spawner = new Spawner(this, 'Zona1Spawner', 'ZONA 1 BASE', 1500, 'Zona1', 8, 6.0);
        z1Spawner.setupVisuals(this.buildColmenaModel(), CONFIG.VISUALS.ZONA1_SPAWNER_RING, CONFIG.VISUALS.ZONA1_SPAWNER_BOX);
        z1Spawner.position.set(CONFIG.ZONES.ZONA1.x, 35, CONFIG.ZONES.ZONA1.z); // Set position FIRST
        z1Spawner.createMinimapDot(minimap, 'minimap-boss', 'BASE 1', '#ff0000');
        this.scene.add(z1Spawner);
        this.enemies.push(z1Spawner);
        this.zona1Spawner = z1Spawner;

        const z2Spawner = new Spawner(this, 'Zona2Spawner', 'SCAVENGER NEST', 1200, 'Zona2', 8, 5.0);
        z2Spawner.setupVisuals(this.buildScavengerNest(), CONFIG.VISUALS.ZONA2_SPAWNER_RING, CONFIG.VISUALS.ZONA2_SPAWNER_BOX);
        z2Spawner.position.set(CONFIG.ZONES.ZONA2.x, 0, CONFIG.ZONES.ZONA2.z); // Altura corregida al piso
        z2Spawner.createMinimapDot(minimap, 'minimap-boss', 'BASE 2', '#00aaff');
        this.scene.add(z2Spawner);
        this.enemies.push(z2Spawner);
        this.zona2Spawner = z2Spawner;
        
        // ZONA 3: Base de Patrulla (Ahora completamente estática)
        const z3Spawner = new Spawner(this, 'Zona3Spawner', 'COMMAND FORTRESS', 2500, 'Zona3', 6, 6.0);
        z3Spawner.setupVisuals(this.buildFortressModel(), CONFIG.VISUALS.ZONA3_SPAWNER_RING, CONFIG.VISUALS.ZONA3_SPAWNER_BOX);
        z3Spawner.position.set(CONFIG.ZONES.ZONA3.x, 0, CONFIG.ZONES.ZONA3.z); // Altura corregida al piso
        z3Spawner.createMinimapDot(minimap, 'minimap-boss', 'BASE 3', '#aa00ff');
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
        // Nota: ya no pintamos spawner point individual aquí, porque lo hacemos manualmente arriba con colores específicos
        this.scene.add(spawner);
        this.enemies.push(spawner);

        // Pre-spawneamos a todo el enjambre de inmediato
        for (let i = 0; i < maxUnits; i++) {
            this.spawnUnitFromSpawner(spawner);
        }
        return spawner;
    }

    spawnUnitFromSpawner(spawner) {
        let spawnType = spawner.spawnType;
        let hp, speed, name, template, ringSize, boxSize, minimapClass, minimapText = '', textColor = 'white';

        if (spawnType === 'Zona1') {
            hp = CONFIG.COMBAT.ZONA1_HP; speed = CONFIG.COMBAT.ZONA1_SPEED; name = 'ASSAULT MANTIS';
            template = this.zona1Group; minimapClass = 'minimap-e1';
            minimapText = 'E1'; textColor = '#ff0000';
        } else if (spawnType === 'Zona2') {
            hp = CONFIG.COMBAT.ZONA2_HP; speed = CONFIG.COMBAT.ZONA2_SPEED; name = 'SCAVENGER ELITE';
            template = this.zona2Group; minimapClass = 'minimap-e2';
            minimapText = 'E2'; textColor = '#00aaff';
        } else if (spawnType === 'Zona3') {
            hp = CONFIG.COMBAT.ZONA3_HP; speed = CONFIG.COMBAT.ZONA3_SPEED; name = 'HEAVY COMMANDER';
            template = this.zona3Group; minimapClass = 'minimap-e3';
            minimapText = 'E3'; textColor = '#aa00ff';
        }

        ringSize = CONFIG.VISUALS[spawnType.toUpperCase() + '_RING_SIZE'];
        boxSize = CONFIG.VISUALS[spawnType.toUpperCase() + '_BOX_SIZE'];

        // Sistema de Colores basado en la facción de origen (El Spawner Madre)
        let dangerColor = 0x00ffcc; // Default Cian
        if (spawnType === 'Zona1') dangerColor = 0xff0000; // Nivel 1 (Mantis): Rojo
        else if (spawnType === 'Zona2') dangerColor = 0x00aaff; // Nivel 2 (Scavenger): Azul
        else if (spawnType === 'Zona3') dangerColor = 0xaa00ff; // Nivel 3 (Commander): Púrpura

        const enemy = new MobileEnemy(this, spawnType, name, hp, speed);
        enemy.userData.spawner = spawner; // Guardamos su colmena madre para que no se pierdan
        enemy.userData.dangerColor = dangerColor; // Guardar para teñir las partículas
        
        // Setup Visuals
        enemy.setupVisuals(template, ringSize, boxSize);
        enemy.createMinimapDot(document.getElementById('minimap-enemies'), minimapClass, minimapText, textColor);
        
        // Crear Name Tag flotante 3D
        const nameTag = document.createElement('div');
        nameTag.className = 'enemy-name-tag';
        nameTag.innerText = name;
        nameTag.style.position = 'absolute';
        nameTag.style.color = '#00ffcc';
        nameTag.style.fontSize = '12px';
        nameTag.style.fontWeight = 'bold';
        nameTag.style.textShadow = '0 0 4px #000';
        nameTag.style.pointerEvents = 'none';
        nameTag.style.transform = 'translate(-50%, -100%)';
        nameTag.style.display = 'none';
        nameTag.style.zIndex = '5';
        const uiContainer = document.getElementById('ui');
        if (uiContainer) uiContainer.appendChild(nameTag);
        enemy.userData.nameTag = nameTag;

        this.scene.add(enemy);

        const angle = Math.random() * Math.PI * 2;
        const dist = 200 + Math.random() * 400; // Dispersos de 200m a 600m alrededor de la base
        enemy.position.set(
            spawner.position.x + Math.cos(angle) * dist,
            35,
            spawner.position.z + Math.sin(angle) * dist
        );

        // Colocar "Anclajes" de motor invisibles
        const bZ = boxSize * 0.45; // Parte trasera de la nave
        enemy.userData.engineAnchors = [];

        if (spawnType === 'Zona1') {
            const positions = [
                new THREE.Vector3(0, boxSize*0.05, bZ),
                new THREE.Vector3(boxSize*0.25, boxSize*0.2, bZ),
                new THREE.Vector3(-boxSize*0.25, boxSize*0.2, bZ),
                new THREE.Vector3(boxSize*0.6, 0, bZ * 0.9),
                new THREE.Vector3(-boxSize*0.6, 0, bZ * 0.9)
            ];
            const sizes = [boxSize*0.4, boxSize*0.3, boxSize*0.3, boxSize*0.5, boxSize*0.5];
            positions.forEach((pos, i) => {
                this.createEngineAnchor(enemy, pos, sizes[i]);
            });
        } else if (spawnType === 'Drone' || spawnType === 'Zona2') {
            const p1 = new THREE.Vector3(boxSize*0.3, 0, bZ);
            const p2 = new THREE.Vector3(-boxSize*0.3, 0, bZ);
            this.createEngineAnchor(enemy, p1, boxSize*0.6);
            this.createEngineAnchor(enemy, p2, boxSize*0.6);
        } else {
            this.createEngineAnchor(enemy, new THREE.Vector3(0, 0, bZ), boxSize*1.0);
        }

        this.enemies.push(enemy);
        spawner.spawnedUnits.push(enemy);
    }
    
    // Crea un punto invisible en la nave donde nacerán las partículas de fuego
    createEngineAnchor(enemy, pos, size) {
        const dummy = new THREE.Object3D();
        dummy.position.copy(pos);
        enemy.add(dummy);
        enemy.userData.engineAnchors.push({ dummy: dummy, size: size });
    }

    // --- Helper Functions for Thruster Glows ---
    getParticleMaterial(colorHex) {
        if (!this.particleMats[colorHex]) {
            this.particleMats[colorHex] = new THREE.MeshBasicMaterial({
                color: colorHex,
                map: this.getThrusterTexture(),
                transparent: true,
                opacity: 0.6, // Reducir la opacidad base para que no ciegue la pantalla
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
        }
        return this.particleMats[colorHex];
    }

    getThrusterTexture() {
        if (this._thrusterTex) return this._thrusterTex;
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        // Rebajar la agresividad del blanco puro
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.8)'); // Núcleo
        grad.addColorStop(0.2, 'rgba(255, 255, 255, 0.5)'); // Anillo intenso
        grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)'); // Cola
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)'); // Desvanecimiento
        ctx.fillStyle = grad;
        ctx.fillRect(0,0,64,64);
        this._thrusterTex = new THREE.CanvasTexture(canvas);
        return this._thrusterTex;
    }

    createThrusterFlare(colorHex, size) {
        if (!this.enemyFlameGeo) {
            this.enemyFlameGeo = new THREE.ConeGeometry(1, 10, 8);
            this.enemyFlameGeo.rotateX(Math.PI / 2); // Apuntar hacia Z negativo
            this.enemyFlameGeo.translate(0, 0, -5); // Pivote en la base
        }

        const mat = new THREE.MeshBasicMaterial({
            map: this.getThrusterTexture(),
            color: colorHex,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        
        // Ya no es un Sprite (que siempre mira a la cámara como un bombillo), 
        // ahora es un Cono 3D que deja un rastro físico hacia atrás.
        const mesh = new THREE.Mesh(this.enemyFlameGeo, mat);
        mesh.userData.isFlame = true; // Marcador para animarlo en el update loop
        mesh.userData.baseScale = size;
        
        // Ajustamos la escala inicial
        mesh.scale.set(size * 0.15, size * 0.15, size * 0.6);
        return mesh;
    }

    loadGLTFModels() {
        // ---------------------------------------------------------
        // SINGLE SOURCE OF TRUTH: Master Template (enemi2.glb)
        // ---------------------------------------------------------        // Cargar Scavenger Elite de la Zona 2
        this.gltfLoader.load('/models/zona2/E2.glb?v=' + Date.now(), (gltf) => {
            const masterModel = gltf.scene;
            
            // 1. Preparación de la base maestra
            masterModel.updateMatrixWorld(true);

            masterModel.traverse(c => { 
                if(c.isMesh) { 
                    c.castShadow = true; 
                    c.receiveShadow = true; 
                    c.frustumCulled = false; 
                    if (c.material) c.material = c.material.clone();
                }
            });
            
            // ---------------------------------------------------------
            // VARIANTE A: Roaming Bot (Peón Universal)
            // ---------------------------------------------------------
            this.comunBotTemplate = SkeletonUtils.clone(masterModel);
            this.comunBotTemplate.scale.set(0.8, 0.8, 0.8);
            
            // Actualizar minions retroactivamente
            this.enemies.forEach(e => {
                if (e.userData.type === 'Drone' && !(e instanceof Spawner) && e.userData.name === 'ROAMING BOT') {
                    e.visualGroup.clear();
                    e.visualGroup.add(SkeletonUtils.clone(this.comunBotTemplate));
                    this.tintComunBot(e.visualGroup, e.userData.dangerColor);
                }
            });

            // ---------------------------------------------------------
            // VARIANTE B: Scavenger Elite (Zona 2)
            // ---------------------------------------------------------
            this.zona2Group = SkeletonUtils.clone(masterModel);
            this.zona2Group.scale.set(CONFIG.VISUALS.ZONA2_SCALE, CONFIG.VISUALS.ZONA2_SCALE, CONFIG.VISUALS.ZONA2_SCALE);
            this.zona2Group.traverse(c => {
                if(c.isMesh && c.material) {
                    if (c.material.emissive && (c.material.emissive.r > 0 || c.material.emissive.g > 0 || c.material.emissive.b > 0)) {
                        c.material.emissiveIntensity = 8.0;
                    } else if (c.material.name === 'Verre' || (c.material.name && c.material.name.includes('Window'))) {
                        c.material.emissive.setHex(0xffaa00);
                        c.material.emissiveIntensity = 3.0; 
                    }
                }
            });
            
            if (this.zona2Spawner) {
                for (let i = 0; i < this.zona2Spawner.maxUnits; i++) {
                    this.spawnUnitFromSpawner(this.zona2Spawner);
                }
            }

            // ---------------------------------------------------------
            // VARIANTE C: Scout Drone (Colmena)
            // ---------------------------------------------------------
            this.droneGroup = SkeletonUtils.clone(masterModel);
            this.droneGroup.scale.set(CONFIG.VISUALS.DRONE_SCALE || 5.0, CONFIG.VISUALS.DRONE_SCALE || 5.0, CONFIG.VISUALS.DRONE_SCALE || 5.0);
            this.droneGroup.traverse(c => {
                if(c.isMesh && c.material) {
                    if (c.material.emissive && (c.material.emissive.r > 0 || c.material.emissive.g > 0 || c.material.emissive.b > 0)) {
                        c.material.emissiveIntensity = 8.0;
                    } else if (c.material.name === 'Verre' || (c.material.name && c.material.name.includes('Window'))) {
                        c.material.emissive.setHex(0x00ffcc); // Cian para los Scout Drones
                        c.material.emissiveIntensity = 3.0; 
                    }
                }
            });

            // Actualizar Scout Drones retroactivamente
            this.enemies.forEach(e => {
                if (e.userData.type === 'Drone' && !(e instanceof Spawner) && e.userData.name === 'SCOUT DRONE') {
                    e.visualGroup.clear();
                    e.visualGroup.add(SkeletonUtils.clone(this.droneGroup));
                }
            });
            
            // Instanciar el enjambre inicial de la colmena (reemplaza los cubos temporales si los hubiera)
            if (this.droneSpawner && this.enemies.filter(e => e.userData.type === 'Drone' && !(e instanceof Spawner)).length === 0) {
                for (let i = 0; i < this.droneSpawner.maxUnits; i++) {
                    this.spawnUnitFromSpawner(this.droneSpawner);
                }
            }
        });

        this.gltfLoader.load('/models/zona1/base1.glb?v=' + Date.now(), (gltf) => {
            const model = gltf.scene;
            
            model.updateMatrixWorld(true);
            
            model.scale.set(CONFIG.VISUALS.ZONA1_BASE_SCALE, CONFIG.VISUALS.ZONA1_BASE_SCALE, CONFIG.VISUALS.ZONA1_BASE_SCALE);
            model.traverse(c => { 
                if(c.isMesh) { 
                    c.castShadow=false; c.receiveShadow=false; c.frustumCulled=false; 
                    if (c.material) {
                        if (c.material.emissive && (c.material.emissive.r > 0 || c.material.emissive.g > 0 || c.material.emissive.b > 0)) {
                            c.material = c.material.clone();
                            c.material.emissive.setHex(0xff0000); // Zona 1 es ROJO
                            c.material.emissiveIntensity = 8.0; 
                        } else if (c.material.name === 'Verre' || (c.material.name && c.material.name.includes('Window'))) {
                            c.material = c.material.clone();
                            c.material.emissive.setHex(0xff0000); 
                            c.material.emissiveIntensity = 3.0; 
                        }
                    }
                }
            });
            if (this.zona1Spawner) {
                this.zona1Spawner.visualGroup.clear();
                this.zona1Spawner.visualGroup.add(model.clone());
            }
            if (this.droneSpawner) {
                this.droneSpawner.visualGroup.clear();
                this.droneSpawner.visualGroup.add(model.clone());
            }
        });

        this.gltfLoader.load('/models/zona1/E1.glb?v=' + Date.now(), (gltf) => {
            const enemiModel = gltf.scene;
            enemiModel.scale.set(CONFIG.VISUALS.ZONA1_SCALE, CONFIG.VISUALS.ZONA1_SCALE, CONFIG.VISUALS.ZONA1_SCALE);
            enemiModel.rotation.y = Math.PI; // Rotar 180 grados para que miren hacia adelante
            enemiModel.traverse(c => { 
                if(c.isMesh) { 
                    c.castShadow=false; 
                    c.receiveShadow=false; 
                    c.frustumCulled=false;
                    
                    // MAGIA: Respetar y potenciar el diseño ORIGINAL del GLB
                    if (c.material) {
                        // Si el artista le puso luz propia al diseño original (emisividad > 0)
                        if (c.material.emissive && (c.material.emissive.r > 0 || c.material.emissive.g > 0 || c.material.emissive.b > 0)) {
                            c.material = c.material.clone();
                            c.material.emissive.setHex(0xff0000); // Zona 1 es ROJO
                            c.material.emissiveIntensity = 8.0; // Multiplicador brutal para activar el Bloom de Three.js
                        } else if (c.material.name === 'Verre' || (c.material.name && c.material.name.includes('Window'))) {
                            c.material = c.material.clone();
                            c.material.emissive.setHex(0xff0000); 
                            c.material.emissiveIntensity = 3.0; 
                        }
                    }
                }
            });
            this.zona1Group = enemiModel;
            // Ahora que el modelo existe, spawneamos los bots
            if (this.zona1Spawner) {
                for (let i = 0; i < this.zona1Spawner.maxUnits; i++) {
                    this.spawnUnitFromSpawner(this.zona1Spawner);
                }
            }
        });

        // Modelos de la Zona 3 (Base Móvil y Escoltas)
        this.gltfLoader.load('/models/zona3/base3.glb?v=' + Date.now(), (gltf) => {
            const model = gltf.scene;
            model.scale.set(CONFIG.VISUALS.ZONA3_BASE_SCALE, CONFIG.VISUALS.ZONA3_BASE_SCALE, CONFIG.VISUALS.ZONA3_BASE_SCALE);
            model.traverse(c => { if(c.isMesh) { c.castShadow=false; c.receiveShadow=false; c.frustumCulled=false; }});
            if (this.zona3Spawner) {
                this.zona3Spawner.visualGroup.clear();
                this.zona3Spawner.visualGroup.add(model.clone());
            }
        });

        this.gltfLoader.load('/models/zona3/E3.glb', (gltf) => {
            const model = gltf.scene;
            model.scale.set(CONFIG.VISUALS.ZONA3_SCALE, CONFIG.VISUALS.ZONA3_SCALE, CONFIG.VISUALS.ZONA3_SCALE);
            // model.rotation.y = Math.PI; // ELIMINADO: El modelo original estaba bien, la luz estaba mal puesta.
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
                enemy.update(delta, environment, this.player, time, this.enemies);
                
                // Actualizar Name Tag flotante 3D
                if (enemy.userData.nameTag) {
                    if (dist < 2000 && enemy.userData.hp > 0) { // Mostrar si está a menos de 2000m
                        const vector = enemy.position.clone();
                        // Ajustar la altura del nombre dependiendo del tamaño del modelo
                        let nameOffset = 60;
                        if (enemy.userData.type === 'Zona1') nameOffset = 120; // Mantis es gigante
                        if (enemy.userData.type === 'Boss' || enemy.spawnType) nameOffset = 180;
                        vector.y += nameOffset;
                        
                        vector.project(this.player.camera);
                        
                        if (vector.z < 1) { // Delante de la cámara
                            const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
                            const y = (-(vector.y * 0.5) + 0.5) * window.innerHeight;
                            enemy.userData.nameTag.style.left = `${x}px`;
                            enemy.userData.nameTag.style.top = `${y}px`;
                            enemy.userData.nameTag.style.display = 'block';
                            
                            // Color rojo si está siendo atacado o targeteado
                            if (this.player.target === enemy) {
                                enemy.userData.nameTag.style.color = '#ff0000';
                                enemy.userData.nameTag.style.fontSize = '14px';
                            } else {
                                enemy.userData.nameTag.style.color = '#00ffcc';
                                enemy.userData.nameTag.style.fontSize = '12px';
                            }
                        } else {
                            enemy.userData.nameTag.style.display = 'none';
                        }
                    } else {
                        enemy.userData.nameTag.style.display = 'none';
                    }
                }
            } else {
                if (enemy.userData.nameTag) enemy.userData.nameTag.style.display = 'none';
            }
        }

        this.updateEnemyLasers(delta, environment);
        this.updateExplosions(delta);
    }

    takeDamageArea(center, radius, damage) {
        // Encontrar todos los enemigos dentro del radio
        const enemiesInArea = this.enemies.filter(e => e.position.distanceTo(center) <= radius);
        
        // Iterar sobre la lista copiada para aplicar el daño de área
        enemiesInArea.forEach(enemy => {
            if (enemy && enemy.userData.hp > 0) {
                this.takeDamage(enemy, damage);
            }
        });
        
        return enemiesInArea.length;
    }

    takeDamage(enemy, amount) {
        enemy.userData.hp -= amount;
        
        // FCT: Mostrar texto de daño flotante
        this.createFloatingText(enemy.position, amount, amount >= 50);

        if (enemy.userData.hp > 0) {
            // Impacto visual (chispa para láser, explosión mediana para misil)
            this.createExplosion(enemy.position, amount >= 50 ? 1.5 : 0.2);
            
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
            // Reward XP to player
            const type = enemy.userData.type ? enemy.userData.type.toUpperCase() : 'DRONE';
            const xpDrop = CONFIG.COMBAT[`${type}_XP_DROP`] || 10;
            if (this.player && typeof this.player.gainXP === 'function') {
                this.player.gainXP(xpDrop);
            }

            // Notificar al sistema de misiones (usar el nombre para mayor claridad)
            if (this.onEnemyKilled) {
                this.onEnemyKilled(enemy.userData.type || 'Drone', enemy.userData.name || '');
            }
            
            if (enemy.userData.nameTag) {
                enemy.userData.nameTag.remove();
                enemy.userData.nameTag = null;
            }

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

    createFloatingText(position, damage, isCrit) {
        if (!this.player || !this.player.camera) return;

        const vector = position.clone();
        vector.x += (Math.random() - 0.5) * 15;
        vector.y += Math.random() * 10 + 5;
        vector.z += (Math.random() - 0.5) * 15;
        
        vector.project(this.player.camera);

        if (vector.z > 1) return;

        const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
        const y = -(vector.y * 0.5 - 0.5) * window.innerHeight;

        const div = document.createElement('div');
        div.innerText = `-${damage}`;
        div.style.position = 'absolute';
        div.style.left = `${x}px`;
        div.style.top = `${y}px`;
        div.style.color = isCrit ? '#ffaa00' : '#ffffff';
        div.style.fontSize = isCrit ? '26px' : '16px';
        div.style.fontWeight = 'bold';
        div.style.pointerEvents = 'none';
        div.style.textShadow = '1px 1px 3px black, 0 0 5px ' + (isCrit ? '#ff0000' : '#00ffff');
        div.style.transition = 'top 1s ease-out, opacity 1s ease-in';
        div.style.zIndex = '1000';
        // Center the text
        div.style.transform = 'translate(-50%, -50%)';
        document.body.appendChild(div);

        // Trigger reflow
        div.getBoundingClientRect();
        
        // Animación CSS
        div.style.top = `${y - 100}px`;
        div.style.opacity = '0';

        setTimeout(() => {
            if (div.parentNode) div.parentNode.removeChild(div);
        }, 1000);
    }

    enemyShoot(enemy, direction) {
        let color = 0xff0000;
        let thickness = 2.0;
        let spawnOffset = 10;
        let lateralOffset = 5; // Separación lateral de los cañones

        if (enemy.userData.type === 'Drone') { color = 0x00ffcc; thickness = 3.0; spawnOffset = 5; lateralOffset = 3; }
        else if (enemy.userData.type === 'Fighter') { color = 0xff3300; thickness = 4.0; spawnOffset = 20; lateralOffset = 8; }
        else if (enemy.userData.type === 'Zona1') { color = 0xffff00; thickness = 3.5; spawnOffset = 25; lateralOffset = 12; }
        else if (enemy.userData.type === 'Zona2') { color = 0xff8800; thickness = 3.5; spawnOffset = 15; lateralOffset = 10; }
        else if (enemy.userData.type === 'Zona3') { color = 0xaa00ff; thickness = 5.0; spawnOffset = 30; lateralOffset = 15; }
        else if (enemy.userData.type === 'Boss') { color = 0xff0000; thickness = 8.0; spawnOffset = 100; lateralOffset = 30; }

        // Shader Plasma / Láser Óptico
        // 1. Núcleo Blanco super brillante
        const coreGeo = new THREE.CylinderGeometry(thickness * 0.2, thickness * 0.2, 90, 8);
        coreGeo.rotateX(Math.PI / 2);
        const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        
        // 2. Halo Glow del color del enemigo (Aditivo)
        const glowGeo = new THREE.CylinderGeometry(thickness, thickness * 1.5, 120, 8);
        glowGeo.rotateX(Math.PI / 2);
        const glowMat = new THREE.MeshBasicMaterial({ 
            color: color, 
            transparent: true, 
            opacity: 0.7, 
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        
        // Calcular vector lateral relativo a la dirección de disparo
        // Asumiendo que direction está en plano XZ, el vector perpendicular a direction es (-direction.z, 0, direction.x)
        const perp = new THREE.Vector3(-direction.z, 0, direction.x).normalize();

        const spawnSingleLaser = (offsetMultiplier) => {
            const laser = new THREE.Group(); // Agrupamos Core + Glow
            const core = new THREE.Mesh(coreGeo, coreMat);
            const glow = new THREE.Mesh(glowGeo, glowMat);
            laser.add(core);
            laser.add(glow);
            
            // Avanzar hacia adelante (spawnOffset) y luego a los lados (lateralOffset * offsetMultiplier)
            const pos = enemy.position.clone()
                .addScaledVector(direction, spawnOffset)
                .addScaledVector(perp, lateralOffset * offsetMultiplier);
            
            laser.position.copy(pos);
            const targetPos = laser.position.clone().add(direction);
            laser.lookAt(targetPos);
            
            laser.userData = {
                velocity: direction.clone().multiplyScalar(2000), 
                life: 3.0,
                damage: CONFIG.COMBAT[enemy.userData.type.toUpperCase() + '_DAMAGE'] || 10
            };

            this.scene.add(laser);
            this.enemyLasers.push(laser);
        };

        // Disparar dos láseres desde los cañones laterales
        spawnSingleLaser(1);
        spawnSingleLaser(-1);
    }

    updateEnemyLasers(delta, environment) {
        // Procesar partículas de motores de enemigos en el mundo global
        for (let i = this.trailParticles.length - 1; i >= 0; i--) {
            const p = this.trailParticles[i];
            // Decaimiento balanceado
            p.userData.life -= delta * 4.0;
            if (p.userData.life <= 0) {
                p.visible = false;
                this.trailParticles.splice(i, 1);
                this.particlePool.push(p);
            }
        }
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

    getParticleTexture() {
        if (!this.particleTexture) {
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');
            const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');     // Centro blanco
            gradient.addColorStop(0.2, 'rgba(255, 200, 50, 1)');    // Anillo amarillo brillante
            gradient.addColorStop(0.5, 'rgba(255, 50, 0, 0.6)');    // Borde de fuego naranja/rojo
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');           // Desvanecimiento transparente
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 64, 64);
            this.particleTexture = new THREE.CanvasTexture(canvas);
        }
        return this.particleTexture;
    }

    createExplosion(position, scale = 1.0) {
        const particleCount = Math.floor(50 * scale); // Más partículas
        const particles = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = [];

        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = position.x;
            positions[i * 3 + 1] = position.y;
            positions[i * 3 + 2] = position.z;

            // Explosión omnidireccional muy violenta al inicio
            const v = new THREE.Vector3(
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2
            ).normalize().multiplyScalar((Math.random() * 250 + 50) * scale); 
            velocities.push(v);
        }

        particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        if (!this.explosionMats) this.explosionMats = {};
        if (!this.explosionMats[scale]) {
            this.explosionMats[scale] = new THREE.PointsMaterial({
                color: 0xffffff, // La textura provee el color del fuego
                size: 15 * scale, // Partículas más grandes y suaves
                map: this.getParticleTexture(),
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
        }
        const mat = this.explosionMats[scale];

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
                // exp.mesh.material.dispose(); // NO HACER DISPOSE PORQUE ESTÁ EN CACHÉ
                this.explosions.splice(i, 1);
                continue;
            }

            const positions = exp.mesh.geometry.attributes.position.array;
            for (let j = 0; j < exp.velocities.length; j++) {
                positions[j * 3] += exp.velocities[j].x * delta;
                positions[j * 3 + 1] += exp.velocities[j].y * delta;
                positions[j * 3 + 2] += exp.velocities[j].z * delta;
                
                // Fricción atmosférica severa: las partículas frenan en seco luego del estallido inicial
                exp.velocities[j].multiplyScalar(Math.max(0, 1.0 - (5.0 * delta)));
                
                // Gravedad ligera para que las chispas caigan un poco al final
                exp.velocities[j].y -= 15 * delta;
            }
            exp.mesh.geometry.attributes.position.needsUpdate = true;
            exp.mesh.material.opacity = exp.life;
        }
    }
}
