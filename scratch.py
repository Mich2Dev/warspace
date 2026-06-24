import os

code = """import * as THREE from 'three';
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
            this.visualGroup.add(template.clone());
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

            let hNextX = environment.getHeightAt(nextX, this.position.z);
            let hNextZ = environment.getHeightAt(this.position.x, nextZ);

            if (hNextX > wallHeight) this.userData.velocity.x *= -1; 
            if (hNextZ > wallHeight) this.userData.velocity.z *= -1; 
        }

        this.position.addScaledVector(this.userData.velocity, delta);

        let terrainHeight = 0;
        if (environment) {
            terrainHeight = environment.getHeightAt(this.position.x, this.position.z);
        }
        
        let hoverDistance = 35; 
        let targetY = Math.max(hoverDistance, terrainHeight + hoverDistance);
        this.userData.baseHeight = targetY;

        let oscilation = Math.sin(time * 3 + this.userData.hoverOffset) * 5;
        let currentTargetY = this.userData.baseHeight + oscilation;
        this.position.y += (currentTargetY - this.position.y) * 2 * delta;

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
        this.updateBasePhysics(delta, environment, time);
        
        let scale = 1.0 + Math.sin(time * 2) * 0.05;
        this.visualGroup.scale.set(scale, scale, scale);
        
        this.spawnedUnits = this.spawnedUnits.filter(u => u.userData.hp > 0);
        
        if (this.spawnedUnits.length < this.maxUnits && time - this.lastSpawnTime > this.spawnRate) {
            this.manager.spawnUnitFromSpawner(this);
            this.lastSpawnTime = time;
        }
    }
}

class MobileEnemy extends BaseEnemy {
    update(delta, environment, player, time) {
        super.update(delta, environment, time);

        const distToPlayer = this.position.distanceTo(player.position);
        const aggroDist = CONFIG.COMBAT[this.userData.type.toUpperCase() + '_AGGRO_DIST'];

        if (distToPlayer < aggroDist) {
            const toPlayer = new THREE.Vector3().subVectors(player.position, this.position);
            toPlayer.y = 0; 
            const moveDir = toPlayer.clone();
            
            if (distToPlayer > 600) {
                moveDir.normalize();
                this.userData.velocity.lerp(moveDir.multiplyScalar(this.userData.maxSpeed), 0.02);
            } else {
                moveDir.normalize();
                const perp = new THREE.Vector3(-moveDir.z, 0, moveDir.x).multiplyScalar(this.userData.orbitDirection);
                const distanceCorrection = (distToPlayer - this.userData.orbitDistance) * 0.5;
                const orbitDir = new THREE.Vector3().addVectors(
                    perp.multiplyScalar(this.userData.maxSpeed), 
                    moveDir.multiplyScalar(distanceCorrection)
                );
                orbitDir.normalize();
                this.userData.velocity.lerp(orbitDir.multiplyScalar(this.userData.maxSpeed * 0.8), 0.05);
            }

            const fireRate = CONFIG.COMBAT[this.userData.type.toUpperCase() + '_FIRE_RATE'];
            const attackDist = CONFIG.COMBAT[this.userData.type.toUpperCase() + '_ATTACK_DIST'];
            
            if (time - this.userData.lastShot > fireRate && distToPlayer < attackDist) {
                const trueAimDir = new THREE.Vector3().subVectors(player.position, this.position).normalize();
                this.manager.enemyShoot(this, trueAimDir);
                this.userData.lastShot = time;
            }
        } else {
            this.userData.wanderAngle += (Math.random() - 0.5) * 0.2;
            const wanderDir = new THREE.Vector3(Math.cos(this.userData.wanderAngle), 0, Math.sin(this.userData.wanderAngle));
            this.userData.velocity.lerp(wanderDir.multiplyScalar(this.userData.maxSpeed * 0.4), 0.02);
        }

        let separation = new THREE.Vector3(0,0,0);
        for (const other of this.manager.enemies) {
            if (other !== this && other instanceof MobileEnemy) {
                const distSq = this.position.distanceToSquared(other.position);
                let minRad = this.userData.type === 'Boss' ? 400 : 120;
                let minDistSq = minRad * minRad;
                if (distSq < minDistSq && distSq > 0.1) {
                    const repelDir = new THREE.Vector3().subVectors(this.position, other.position).normalize();
                    const force = (minDistSq - distSq) / minDistSq; 
                    separation.addScaledVector(repelDir, force * 250);
                }
            }
        }
        this.userData.velocity.add(separation.multiplyScalar(delta));

        if (this.userData.velocity.lengthSq() > 0.1) {
            const lookTarget = this.position.clone().add(this.userData.velocity);
            if (environment) {
                const forwardTerrain = environment.getHeightAt(lookTarget.x, lookTarget.z);
                let hoverDist = 35; 
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
        
        // Spawn the hives
        this.initSpawners();

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
    }

    initSpawners() {
        const minimapContainer = document.getElementById('minimap-enemies');
        if (minimapContainer) minimapContainer.innerHTML = '';

        // DRONE SPAWNERS (Noreste)
        this.createSpawner('DroneSpawner', 'HIVE NEST', 500, 'Drone', 10, 4.0, CONFIG.ZONES.DRONE, this.droneGroup, minimapContainer, 'minimap-boss');
        // FIGHTER SPAWNER (Noroeste)
        this.createSpawner('FighterSpawner', 'COMMAND BASE', 800, 'Fighter', 8, 6.0, CONFIG.ZONES.FIGHTER, this.fighterGroup, minimapContainer, 'minimap-boss');
        // BOSS SPAWNER (Norte)
        this.createSpawner('BossSpawner', 'MOTHERSHIP', 5000, 'Boss', 2, 15.0, CONFIG.ZONES.BOSS, this.bossGroup, minimapContainer, 'minimap-boss');
    }

    createSpawner(type, name, hp, spawnType, maxUnits, spawnRate, zone, template, minimapContainer, minimapClass) {
        const spawner = new Spawner(this, type, name, hp, spawnType, maxUnits, spawnRate);
        spawner.setupVisuals(template, 400, 500);
        spawner.createMinimapDot(minimapContainer, minimapClass);
        spawner.position.set(zone.x, 35, zone.z);
        this.scene.add(spawner);
        this.enemies.push(spawner);
    }

    spawnUnitFromSpawner(spawner) {
        const spawnType = spawner.spawnType;
        let hp, speed, name, template, ringSize, boxSize, minimapClass;

        if (spawnType === 'Drone') {
            hp = CONFIG.COMBAT.DRONE_HP; speed = CONFIG.COMBAT.DRONE_SPEED; name = 'SCOUT DRONE';
            template = this.droneGroup; ringSize = 100; boxSize = 150; minimapClass = 'minimap-drone';
        } else if (spawnType === 'Fighter') {
            hp = CONFIG.COMBAT.FIGHTER_HP; speed = CONFIG.COMBAT.FIGHTER_SPEED; name = 'BC-303 CRUISER';
            template = this.fighterGroup; ringSize = 250; boxSize = 300; minimapClass = 'minimap-fighter';
        } else {
            hp = CONFIG.COMBAT.BOSS_HP; speed = CONFIG.COMBAT.BOSS_SPEED; name = 'OLYMPIC CARRIER';
            template = this.bossGroup; ringSize = 400; boxSize = 500; minimapClass = 'minimap-boss';
        }

        const unit = new MobileEnemy(this, spawnType, name, hp, speed);
        unit.setupVisuals(template, ringSize, boxSize);
        unit.createMinimapDot(document.getElementById('minimap-enemies'), minimapClass);

        const angle = Math.random() * Math.PI * 2;
        const dist = 300 + Math.random() * 200;
        unit.position.set(spawner.position.x + Math.cos(angle)*dist, 35, spawner.position.z + Math.sin(angle)*dist);

        this.scene.add(unit);
        this.enemies.push(unit);
        spawner.spawnedUnits.push(unit);
    }

    loadGLTFModels() {
        this.gltfLoader.load('/models/drone/drone.glb', (gltf) => {
            const model = gltf.scene;
            model.scale.set(CONFIG.SCALES.DRONE, CONFIG.SCALES.DRONE, CONFIG.SCALES.DRONE); 
            const box = new THREE.Box3().setFromObject(model);
            model.position.sub(box.getCenter(new THREE.Vector3()));
            model.traverse(c => { if(c.isMesh) { c.castShadow=true; c.receiveShadow=true; }});
            
            this.droneGroup = model; // Actualizamos template
            this.enemies.forEach(e => {
                if (e.userData.type === 'Drone' || e.spawnType === 'Drone') {
                    e.visualGroup.clear();
                    let clone = model.clone();
                    if (e.spawnType === 'Drone') clone.scale.multiplyScalar(2.0); // Spawner is bigger
                    e.visualGroup.add(clone);
                }
            });
        }, undefined, (err) => console.log("Using fallback for Drones."));

        this.gltfLoader.load('/models/evil/stargate__bc-303.glb', (gltf) => {
            const model = gltf.scene;
            model.scale.set(CONFIG.SCALES.FIGHTER, CONFIG.SCALES.FIGHTER, CONFIG.SCALES.FIGHTER); 
            const box = new THREE.Box3().setFromObject(model);
            model.position.sub(box.getCenter(new THREE.Vector3()));
            model.rotation.y = 0; 
            model.traverse(c => { if(c.isMesh) { c.castShadow=true; c.receiveShadow=true; }});
            
            this.fighterGroup = model;
            this.enemies.forEach(e => {
                if (e.userData.type === 'Fighter' || e.spawnType === 'Fighter') {
                    e.visualGroup.clear();
                    let clone = model.clone();
                    if (e.spawnType === 'Fighter') clone.scale.multiplyScalar(2.0);
                    e.visualGroup.add(clone);
                }
            });
        }, undefined, (err) => console.log("Using fallback for Fighters."));

        this.gltfLoader.load('/models/evil/bsg__olympic_carrier.glb', (gltf) => {
            const model = gltf.scene;
            model.scale.set(CONFIG.SCALES.BOSS, CONFIG.SCALES.BOSS, CONFIG.SCALES.BOSS); 
            const box = new THREE.Box3().setFromObject(model);
            model.position.sub(box.getCenter(new THREE.Vector3()));
            model.rotation.y = 0; 
            model.traverse(c => { if(c.isMesh) { c.castShadow=true; c.receiveShadow=true; }});
            
            this.bossGroup = model;
            this.enemies.forEach(e => {
                if (e.userData.type === 'Boss' || e.spawnType === 'Boss') {
                    e.visualGroup.clear();
                    let clone = model.clone();
                    if (e.spawnType === 'Boss') clone.scale.multiplyScalar(2.0);
                    e.visualGroup.add(clone);
                }
            });
        }, undefined, (err) => console.log("Using fallback for Bosses."));
    }

    update(delta, environment) {
        const time = Date.now() * 0.001;

        this.enemies.forEach(enemy => {
            if (enemy.userData.hp > 0) {
                enemy.update(delta, environment, this.player, time);
            }
        });

        this.updateEnemyLasers(delta, environment);
        this.updateExplosions(delta);
    }

    takeDamage(enemy, amount) {
        enemy.userData.hp -= amount;
        if (enemy.userData.hp <= 0) {
            let explosionScale = 1.0;
            if (enemy.userData.type === 'Fighter') explosionScale = 2.5;
            if (enemy.userData.type === 'Boss' || enemy.spawnType) explosionScale = 8.0;
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
"""

with open("src/EnemyManager.js", "w", encoding="utf-8") as f:
    f.write(code)

print("EnemyManager.js updated.")
