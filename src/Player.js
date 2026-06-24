import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class Player {
    constructor(scene, camera, gltfLoader) {
        this.scene = scene;
        this.camera = camera;
        this.gltfLoader = gltfLoader;
        this.position = new THREE.Vector3(0, 50, 4000); // Zona Segura al Sur
        this.velocity = new THREE.Vector3();
        this.speed = CONFIG.COMBAT.PLAYER_SPEED;
        
        this.keys = {
            w: false, a: false, s: false, d: false, " ": false, tab: false, '1': false
        };

        this.autoPilot = false;
        this.autoAttack = false;

        this.hp = 100;
        this.maxHp = 100;
        this.energy = 100;
        this.maxEnergy = 100;
        this.target = null;
        this.navTarget = null; // Coordenada objetivo para el minimapa
        this.damageShake = 0;
        
        this.lasers = [];
        this.lastShotTime = 0;

        this.initModel();
        this.initControls();
        
        this.time = 0;
        this.updateUI();

        // Downward raycaster
        this.raycasterDown = new THREE.Raycaster();
        this.raycasterDown.ray.direction.set(0, -1, 0);

        // Set initial camera position relative to player
        this.camera.position.copy(this.position).add(new THREE.Vector3(0, 15, 40)); 

        this.trailParticles = [];
        this.particleGeo = new THREE.PlaneGeometry(1.5, 1.5);
        this.particleMat = new THREE.MeshBasicMaterial({ 
            color: 0xff00ff, // Rosado/Púrpura brillante
            transparent: true, 
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
    }

    initModel() {
        this.mesh = new THREE.Group();
        this.scene.add(this.mesh);
        this.mesh.position.copy(this.position);
        this.maxEnergy = 100;
        this.energy = this.maxEnergy;
        this.maxHp = CONFIG.COMBAT.PLAYER_MAX_HP;
        this.hp = this.maxHp;
        this.speed = CONFIG.COMBAT.PLAYER_SPEED;

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
                    }
                });

                // Forzamos la rotación usando un grupo intermedio inmutable
                const rotationGroup = new THREE.Group();
                rotationGroup.rotation.y = 0; // Si Pi es atrás, 0 es el frente exacto
                rotationGroup.add(model);

                this.visualGroup.add(rotationGroup);
                console.log("Shock Lvl1 Model Loaded Successfully!");
            }, undefined, (error) => {
                console.warn('Could not load shock_lvl1.glb. Falling back to code model.');
                this.buildFallbackModel();
            });
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
        window.addEventListener('keydown', (e) => {
            const k = e.key.toLowerCase();
            if (k === 'tab') {
                e.preventDefault();
                this.keys.tab = true;
                return;
            }
            if (k === '1') {
                this.keys['1'] = true;
                return;
            }
            if (e.key === 'Shift') {
                this.keys.shift = true;
            }
            if(this.keys.hasOwnProperty(k)) {
                this.keys[k] = true;
                if (['w', 'a', 's', 'd'].includes(k)) {
                    this.autoPilot = false; // Cancel autopilot on manual move
                }
            }
            if(e.key === ' ') this.keys[' '] = true;
        });
        window.addEventListener('keyup', (e) => {
            const k = e.key.toLowerCase();
            if (e.key === 'Shift') {
                this.keys.shift = false;
            }
            if(this.keys.hasOwnProperty(k)) this.keys[k] = false;
            if(e.key === ' ') this.keys[' '] = false;
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
            this.autoAttack = false; 
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
            nameEl.innerText = this.target.userData.name || 'Enemy Vessel';
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
        const energyBar = document.getElementById('energy-bar');
        
        if (hpBar) hpBar.style.width = `${(this.hp / this.maxHp) * 100}%`;
        if (energyBar) energyBar.style.width = `${(this.energy / this.maxEnergy) * 100}%`;
    }

    takeDamage(amount) {
        if (this.hp <= 0) return;
        this.hp -= amount;
        
        // Efecto visual de daño
        const ui = document.getElementById('ui');
        if (ui) {
            ui.style.boxShadow = 'inset 0 0 150px rgba(255,0,0,0.8)';
            setTimeout(() => { ui.style.boxShadow = 'none'; }, 200);
        }
        this.damageShake = 0.3; // Activar el camera shake por 0.3 segundos

        if (this.hp <= 0) {
            this.hp = 0;
            console.log("GAME OVER");
            const log = document.getElementById('combat-log');
            if (log) log.innerHTML = "<span style='color:red; font-size: 18px; font-weight:bold;'>CRITICAL FAILURE: SHIP DESTROYED.</span>";
        }
        this.updateUI();
    }

    updateTargetUI() {
        if(this.target) {
            document.getElementById('target-hp-bar').style.width = (this.target.userData.hp / this.target.userData.maxHp * 100) + '%';
        }
    }

    shoot() {
        if (!this.target || this.energy < 5) return;
        const now = Date.now();
        if (now - this.lastShotTime < 200) return; 
        
        this.lastShotTime = now;
        this.energy -= 5;
        this.updateUI();

        const laserGeo = new THREE.CylinderGeometry(0.3, 0.3, 25, 8);
        laserGeo.rotateX(Math.PI / 2);
        const laserMat = new THREE.MeshStandardMaterial({ 
            color: 0x00ffff, 
            emissive: 0x00ffff, 
            emissiveIntensity: 3.0,
            transparent: true,
            opacity: 0.9
        });
        const laser = new THREE.Mesh(laserGeo, laserMat);
        
        laser.position.copy(this.mesh.position);
        laser.position.y += 2; 
        
        // Add a slight variance to look realistic
        const targetPos = this.target.position.clone();
        targetPos.x += (Math.random()-0.5)*2;
        targetPos.y += (Math.random()-0.5)*2;
        laser.lookAt(targetPos);
        
        this.scene.add(laser);
        this.lasers.push({ mesh: laser, target: this.target, speed: 3000 }); // Balas del jugador super rápidas
    }

    updateLasers(delta, enemyManager, environment) {
        for(let i = this.lasers.length - 1; i >= 0; i--) {
            const laser = this.lasers[i];
            const dir = new THREE.Vector3();
            laser.mesh.getWorldDirection(dir);
            laser.mesh.position.addScaledVector(dir, laser.speed * delta);

            // Hit radius: lo suficiente para impactar cualquier modelo
            let hitRadius = 200;
            if (laser.target && laser.target.userData.type === 'Drone') hitRadius = 150;

            if (laser.target && laser.mesh.position.distanceTo(laser.target.position) < hitRadius) {
                enemyManager.takeDamage(laser.target, 20);
                this.updateTargetUI();
                this.scene.remove(laser.mesh);
                this.lasers.splice(i, 1);
            } else if (laser.mesh.position.distanceTo(this.mesh.position) > 8000) {
                // Rango máximo aumentado: el láser viaja lejos para llegar al objetivo
                this.scene.remove(laser.mesh);
                this.lasers.splice(i, 1);
            }
        }
    }

    update(delta, enemyManager, environment, controls) {
        this.time += delta;

        // Lógica de Nitro
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

        if (this.keys.tab) {
            this.keys.tab = false;
            this.activateAutoPilot(enemyManager);
        }
        if (this.keys['1']) {
            this.keys['1'] = false;
            this.autoAttack = !this.autoAttack;
        }

        if (this.keys[' ']) this.shoot();
        if (this.autoAttack && this.target && this.target.userData.hp > 0 && this.position.distanceTo(this.target.position) < 2500) {
            this.shoot();
        }

        this.updateLasers(delta, enemyManager, environment);

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

        // Calcular altura del terreno y colisiones con paredes
        if (environment) {
            let nextX = this.position.x + this.velocity.x * delta;
            let nextZ = this.position.z + this.velocity.z * delta;
            
            // Pared es cualquier terreno por encima de 50 de altura
            const wallHeight = 50; 
            
            let hNextX = environment.getHeightAt(nextX, this.position.z);
            let hNextZ = environment.getHeightAt(this.position.x, nextZ);
            
            // Bloqueo duro: Si vas a chocar, tu posición en ese eje no se actualiza
            if (hNextX > wallHeight) {
                this.velocity.x = 0;
                nextX = this.position.x;
            }
            if (hNextZ > wallHeight) {
                this.velocity.z = 0;
                nextZ = this.position.z;
            }
            
            this.position.set(nextX, this.position.y, nextZ);

            this.currentTerrainHeight = environment.getHeightAt(this.position.x, this.position.z);
            const targetHover = Math.max(0, this.currentTerrainHeight) + 35; // Flotar a 35 unidades 
            this.position.y += (targetHover - this.position.y) * 0.1; // Suavizado
        } else {
            this.position.addScaledVector(this.velocity, delta);
        }

        // Rotar la nave principal hacia su vector de velocidad
        if (this.velocity.lengthSq() > 1) {
            const lookTarget = this.position.clone().add(this.velocity);
            const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(
                new THREE.Matrix4().lookAt(this.position, lookTarget, new THREE.Vector3(0, 1, 0))
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

        // Estelas de Motor (Trails Púrpuras)
        if (this.velocity.lengthSq() > 50) {
            const engineOffsets = [new THREE.Vector3(0, 0, 6.5)];
            
            // Si hay nitro, emitir estelas adicionales para mayor efecto visual
            if (isUsingNitro) {
                engineOffsets.push(new THREE.Vector3(1, 0, 6.5));
                engineOffsets.push(new THREE.Vector3(-1, 0, 6.5));
            }

            engineOffsets.forEach(offset => {
                const worldPos = offset.clone().applyMatrix4(this.mesh.matrixWorld);
                const p = new THREE.Mesh(this.particleGeo, this.particleMat);
                p.position.copy(worldPos);
                
                // Las partículas del nitro son más grandes y duran más
                p.userData.life = isUsingNitro ? 1.5 : 1.0; 
                this.scene.add(p);
                this.trailParticles.push(p);
            });
        }

        for(let i = this.trailParticles.length - 1; i >= 0; i--) {
            const p = this.trailParticles[i];
            p.userData.life -= delta * 3.0; // Desaparece rápido
            if(p.userData.life <= 0) {
                this.scene.remove(p);
                this.trailParticles.splice(i, 1);
            } else {
                p.scale.setScalar(p.userData.life);
                p.lookAt(this.camera.position); // Que mire a la cámara siempre
            }
        }

        // Desplazar la cámara junto con la nave (OrbitControls usa target)
        // Mover la cámara con el jugador suavemente
        const movementDelta = this.position.clone().sub(oldPos);
        if (movementDelta.lengthSq() > 0) {
            this.camera.position.add(movementDelta);
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
