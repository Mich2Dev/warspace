import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CONFIG } from '../../config.js';
import { buildSimpleEnemyShip, stripPoliceLightMeshes, getVisualVariant, applyZonePropulsorTint } from '../enemyVisuals.js';
import { BASE_DISPLAY } from '../enemyNames.js';
import { Spawner } from './EnemyEntities.js';
import {
    ENEMY_DESIGNS,
    PATROL_COMMANDER,
    PATROL_ESCORT,
    PATROL_DROID,
    PATROL_DESIGN_KEYS,
    allPatrolDesignsReady,
    getDesignBySpawnType,
    getDesignSpawnerUnits,
    getDesignSpawnRate,
    getEnemyTemplate,
    getPatrolDesignTemplate,
    getPatrolDesignVisuals,
    isPatrolGlbTemplate,
    getSpawnerVisualSize,
    getVisualSize,
} from './enemyModelCatalog.js';

/** @typedef {import('../EnemyManager.js').EnemyManager} EnemyManager */

export const enemyManagerModelsMethods = {
    _proceduralTint(spawnType) {
        return { Zona1: 0xff5544, Zona2: 0x4499ff, Zona3: 0xbb55ff }[spawnType] || 0xff6644;
    },

    _attachProceduralMesh(enemy, spawnType, boxSize) {
        buildSimpleEnemyShip(enemy.visualGroup, spawnType, boxSize);
    },

    _isPlaceholderTemplate(template) {
        if (!template) return true;
        if (isPatrolGlbTemplate(template)) return false;
        template.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(template);
        const size = new THREE.Vector3();
        box.getSize(size);
        return Math.max(size.x, size.y, size.z) < 80;
    },

    _setupEnemyVisuals(enemy, spawnType, template, ringSize, boxSize, variant) {
        if (template && !this._isPlaceholderTemplate(template)) {
            enemy.setupVisuals(template, ringSize, boxSize, variant);
            const root = enemy.visualGroup?.children[0];
            if (root && !enemy.userData.patrolDesign && enemy.userData.patrolRole !== 'squad_commander') {
                applyZonePropulsorTint(root, spawnType);
            }
            return;
        }
        enemy.setupVisuals(null, ringSize, boxSize, variant);
        this._attachProceduralMesh(enemy, spawnType, boxSize);
    },

    initBaseModels() {
        for (const design of ENEMY_DESIGNS) {
            this[design.groupRef] = new THREE.Group();
        }
        this.patrolCommanderGroup = new THREE.Group();
        this.patrolEscortGroup = new THREE.Group();
        this.patrolDroidGroup = new THREE.Group();
        this.patrolGroup = this.patrolCommanderGroup;

        // Invasion event templates (separate model line)
        this.invader_alphaGroup = this.buildInvaderAlphaModel();
        this.invader_betaGroup = this.buildInvaderBetaModel();
        this.invader_gammaGroup = this.buildInvaderGammaModel();
    },
    buildInvaderAlphaModel() {
        const group = new THREE.Group();
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x381511, metalness: 0.82, roughness: 0.28, emissive: 0x140404, emissiveIntensity: 0.45 });
        const coreMat = new THREE.MeshStandardMaterial({ color: 0xff5533, emissive: 0xff5533, emissiveIntensity: 1.1, metalness: 0.2, roughness: 0.05 });

        const body = new THREE.Mesh(new THREE.OctahedronGeometry(16, 1), bodyMat);
        const core = new THREE.Mesh(new THREE.SphereGeometry(5.5, 16, 16), coreMat);
        group.add(body);
        group.add(core);

        for (let i = 0; i < 4; i++) {
            const fin = new THREE.Mesh(new THREE.BoxGeometry(3, 2.5, 20), bodyMat);
            fin.position.set(Math.cos((i / 4) * Math.PI * 2) * 12, 0, Math.sin((i / 4) * Math.PI * 2) * 12);
            fin.lookAt(0, 0, 0);
            group.add(fin);
        }
        const bladeMat = new THREE.MeshStandardMaterial({ color: 0x7a2115, metalness: 0.95, roughness: 0.15, emissive: 0x2a0805, emissiveIntensity: 0.5 });
        for (let i = 0; i < 3; i++) {
            const blade = new THREE.Mesh(new THREE.ConeGeometry(2.6, 18, 5), bladeMat);
            const a = (i / 3) * Math.PI * 2 + Math.PI * 0.2;
            blade.position.set(Math.cos(a) * 9, (i - 1) * 3.8, Math.sin(a) * 9);
            blade.lookAt(0, blade.position.y * 0.2, 0);
            group.add(blade);
        }
        return group;
    },
    buildInvaderBetaModel() {
        const group = new THREE.Group();
        const shellMat = new THREE.MeshStandardMaterial({ color: 0x0f1f3f, metalness: 0.88, roughness: 0.22, emissive: 0x041226, emissiveIntensity: 0.45 });
        const glowMat = new THREE.MeshStandardMaterial({ color: 0x44bbff, emissive: 0x44bbff, emissiveIntensity: 1.0, transparent: true, opacity: 0.85, metalness: 0.1, roughness: 0.08 });

        const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(14, 1), shellMat);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(16, 2.2, 8, 24), glowMat);
        ring.rotation.x = Math.PI / 2;
        const eye = new THREE.Mesh(new THREE.SphereGeometry(4.2, 14, 14), glowMat);
        const spineMat = new THREE.MeshStandardMaterial({ color: 0x15456a, metalness: 0.82, roughness: 0.19, emissive: 0x0a2038, emissiveIntensity: 0.55 });
        group.add(shell);
        group.add(ring);
        group.add(eye);
        for (let i = 0; i < 6; i++) {
            const arm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 12), spineMat);
            const a = (i / 6) * Math.PI * 2;
            arm.position.set(Math.cos(a) * 11.5, Math.sin(a * 2.0) * 2.2, Math.sin(a) * 11.5);
            arm.lookAt(0, 0, 0);
            group.add(arm);
        }
        return group;
    },
    buildInvaderGammaModel() {
        const group = new THREE.Group();
        const hullMat = new THREE.MeshStandardMaterial({ color: 0x2a1133, metalness: 0.92, roughness: 0.24, emissive: 0x150019, emissiveIntensity: 0.5 });
        const pulseMat = new THREE.MeshStandardMaterial({ color: 0xcc66ff, emissive: 0xbb44ff, emissiveIntensity: 1.15, transparent: true, opacity: 0.9, metalness: 0.15, roughness: 0.1 });

        const hull = new THREE.Mesh(new THREE.DodecahedronGeometry(18, 0), hullMat);
        const pulse = new THREE.Mesh(new THREE.TorusKnotGeometry(8, 1.4, 72, 10), pulseMat);
        pulse.scale.set(1, 1.35, 1);
        group.add(hull);
        group.add(pulse);

        for (let i = 0; i < 3; i++) {
            const spine = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 0.8, 18, 8), hullMat);
            spine.position.y = 3 + i * 4;
            spine.rotation.z = (i - 1) * 0.45;
            group.add(spine);
        }
        const shardMat = new THREE.MeshStandardMaterial({ color: 0x4f1d63, metalness: 0.85, roughness: 0.2, emissive: 0x220833, emissiveIntensity: 0.6 });
        for (let i = 0; i < 5; i++) {
            const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(4.8, 0), shardMat);
            const a = (i / 5) * Math.PI * 2;
            shard.position.set(Math.cos(a) * 16, Math.sin(a * 1.7) * 4, Math.sin(a) * 16);
            shard.lookAt(0, 0, 0);
            group.add(shard);
        }
        return group;
    },
    buildColmenaModel() {
        const group = new THREE.Group();
        
        // Base Hexagonal
        const baseGeo = new THREE.CylinderGeometry(40, 50, 20, 6);
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x221133, roughness: 0.9, metalness: 0.2 });
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.y = 10;
        group.add(base);
        
        // NÃºcleo PÃºrpura Brillante
        const coreGeo = new THREE.SphereGeometry(20, 16, 16);
        const coreMat = new THREE.MeshBasicMaterial({ color: 0xaa00ff, wireframe: true, transparent: true, opacity: 0.8 });
        const core = new THREE.Mesh(coreGeo, coreMat);
        core.position.y = 35;
        group.add(core);

        // Anillos flotantes metÃ¡licos
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
    },
    buildScavengerNest() {
        const group = new THREE.Group();
        
        // Base plate (Gran plataforma oscura hexagonal tipo Landing Pad)
        const baseGeo = new THREE.CylinderGeometry(80, 90, 15, 6);
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.2 });
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.y = 7.5;
        group.add(base);
        
        // NÃºcleo central de Plasma Naranja
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
            pillar.lookAt(0, 30, 0); // Miran al nÃºcleo
            pillar.rotation.x -= 0.4; // Inclinados como garras sobre el nÃºcleo
            group.add(pillar);
        }

        // Anillos magnÃ©ticos flotantes alrededor del plasma
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
    },
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

        // Ojo de radar pÃºrpura
        const radar = new THREE.Mesh(
            new THREE.SphereGeometry(15, 16, 16),
            new THREE.MeshStandardMaterial({ color: 0xaa00ff, emissive: 0xaa00ff, emissiveIntensity: 2.0 })
        );
        radar.position.y = 110;
        group.add(radar);

        return group;
    },
    initStandardSpawners() {
        const minimapContainer = document.getElementById('minimap-enemies');
        if (minimapContainer) minimapContainer.innerHTML = '';

        const spawnerVisuals = {
            colmena: () => this.buildColmenaModel(),
            scavenger: () => this.buildScavengerNest(),
            fortress: () => this.buildFortressModel(),
        };
        const minimap = document.getElementById('minimap-enemies');

        for (const design of ENEMY_DESIGNS) {
            if (!design.zoneConfigKey) continue;
            const zone = CONFIG.ZONES[design.zoneConfigKey];
            const spawnerHp = { Zona1: 1500, Zona2: 1200, Zona3: 2500 }[design.spawnType] ?? 1500;
            const maxUnits = getDesignSpawnerUnits(design);
            const spawnRate = getDesignSpawnRate(design);
            const spawnerType = `${design.spawnType}Spawner`;

            const spawner = new Spawner(
                this,
                spawnerType,
                BASE_DISPLAY[spawnerType],
                spawnerHp,
                design.spawnType,
                maxUnits,
                spawnRate,
            );
            const buildVisual = spawnerVisuals[design.spawnerVisual];
            spawner.setupVisuals(
                buildVisual?.() ?? new THREE.Group(),
                getSpawnerVisualSize(design, 'ring'),
                getSpawnerVisualSize(design, 'box'),
            );
            spawner.position.set(zone.x, design.spawnType === 'Zona1' ? 35 : 0, zone.z);
            spawner.createMinimapDot(minimap, 'minimap-boss', design.minimapLabel);
            this.scene.add(spawner);
            this.enemies.push(spawner);
            this[design.spawnerRef] = spawner;
        }

        if (this._mpMode !== 'guest' && this._allZoneModelsReady()) {
            this._bootstrapHostEnemies();
        }
    },

    _modelKeyForZone(spawnType) {
        return getDesignBySpawnType(spawnType)?.modelKey ?? null;
    },
    _isZoneModelReady(spawnType) {
        const key = this._modelKeyForZone(spawnType);
        return !key || !!this._modelsReady[key];
    },
    _allZoneModelsReady() {
        return this._modelsReady.e1 && this._modelsReady.e2 && this._modelsReady.e3;
    },
    _allPatrolModelsReady() {
        return allPatrolDesignsReady(this);
    },
    _patrolSlotReady(patrolDesign, unitType) {
        if (patrolDesign) {
            const def = PATROL_DESIGN_KEYS[patrolDesign];
            if (!def || !this._modelsReady[def.modelKey]) return false;
            const tpl = this[def.groupRef];
            return isPatrolGlbTemplate(tpl);
        }
        return this._isZoneModelReady(unitType);
    },
    _patrolReady(_p) {
        return this._allZoneModelsReady();
    },

    _onModelLoaded(which) {
        this._modelsReady[which] = true;
        if (which === PATROL_COMMANDER.modelKey) {
            this._upgradePatrolDesignVisuals('comandante');
        }
        if (which === PATROL_ESCORT.modelKey) {
            this._upgradePatrolDesignVisuals('escolta');
        }
        if (which === PATROL_DROID.modelKey) {
            this._upgradePatrolDesignVisuals('droid');
        }
        if (this._allPatrolModelsReady()) {
            this.patrolSquads?.trySpawn(this.environment);
        }
        if (this._allZoneModelsReady()) {
            const log = document.getElementById('log-text');
            if (log && log.textContent.includes('segundo plano')) {
                log.textContent = 'Listo — J misiones · H hangar · E eventos · B mercado · P perfil';
            }
            if (this._mpMode !== 'guest') {
                this._bootstrapHostEnemies();
            }
        }
        if (this._mpMode === 'host') {
            this._ensureHostWorld(false);
        } else {
            this._trySpawnPatrolQueue();
            this.patrolSquads?.trySpawn(this.environment);
        }
        this._retryPendingSyncGhosts();
    },

    getPatrolTemplate(spawnType) {
        return getEnemyTemplate(this, spawnType);
    },

    createEngineAnchor(enemy, pos, size) {
        const dummy = new THREE.Object3D();
        dummy.position.copy(pos);
        enemy.add(dummy);
        enemy.userData.engineAnchors.push({ dummy: dummy, size: size });
    },

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
    },
    getThrusterTexture() {
        if (this._thrusterTex) return this._thrusterTex;
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        // Rebajar la agresividad del blanco puro
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.8)'); // NÃºcleo
        grad.addColorStop(0.2, 'rgba(255, 255, 255, 0.5)'); // Anillo intenso
        grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)'); // Cola
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)'); // Desvanecimiento
        ctx.fillStyle = grad;
        ctx.fillRect(0,0,64,64);
        this._thrusterTex = new THREE.CanvasTexture(canvas);
        return this._thrusterTex;
    },
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
        
        // Ya no es un Sprite (que siempre mira a la cÃ¡mara como un bombillo), 
        // ahora es un Cono 3D que deja un rastro fÃ­sico hacia atrÃ¡s.
        const mesh = new THREE.Mesh(this.enemyFlameGeo, mat);
        mesh.userData.isFlame = true; // Marcador para animarlo en el update loop
        mesh.userData.baseScale = size;
        
        // Ajustamos la escala inicial
        mesh.scale.set(size * 0.15, size * 0.15, size * 0.6);
        return mesh;
    },
    _upgradeZoneVisuals(spawnType) {
        const design = getDesignBySpawnType(spawnType);
        const template = getEnemyTemplate(this, spawnType);
        if (!template || this._isPlaceholderTemplate(template)) return;
        const ringSize = design ? getVisualSize(design, 'ring') : CONFIG.VISUALS[spawnType.toUpperCase() + '_RING_SIZE'];
        const boxSize = design ? getVisualSize(design, 'box') : CONFIG.VISUALS[spawnType.toUpperCase() + '_BOX_SIZE'];
        const variant = getVisualVariant(spawnType, null);

        for (const enemy of this.enemies) {
            if (enemy.spawnType !== undefined) continue;
            if (enemy.userData.syncGhost) continue;
            if (enemy.userData.type !== spawnType) continue;
            if (enemy.userData.isSquadMember) continue;
            enemy.visualGroup.clear();
            this._setupEnemyVisuals(enemy, spawnType, template, ringSize, boxSize, variant);
        }
    },
    _upgradePatrolDesignVisuals(designKey) {
        const template = getPatrolDesignTemplate(this, designKey);
        if (!isPatrolGlbTemplate(template)) return;

        const visuals = getPatrolDesignVisuals(designKey);
        const ringSize = visuals?.ringSize ?? CONFIG.VISUALS.ZONA2_RING_SIZE;
        const boxSize = visuals?.boxSize ?? CONFIG.VISUALS.ZONA2_BOX_SIZE;

        for (const enemy of this.enemies) {
            if (enemy.userData?.patrolDesign !== designKey) continue;
            if (enemy.userData.syncGhost) continue;
            const spawnType = enemy.userData.type;
            enemy.visualGroup.clear();
            this._setupEnemyVisuals(
                enemy,
                spawnType,
                template,
                ringSize,
                boxSize,
                { preserveOriginal: true, scale: 1.0 },
            );
        }

        if (this.patrolSquads?._spawned) {
            this.patrolSquads.despawnAll();
            this.patrolSquads.trySpawn(this.environment);
        }
    },
    _applyPatrolDesignGlb(def, scene) {
        scene.updateMatrixWorld(true);
        stripPoliceLightMeshes(scene);

        const box = new THREE.Box3().setFromObject(scene);
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        box.getCenter(center);
        box.getSize(size);
        scene.position.sub(center);

        const maxDim = Math.max(size.x, size.y, size.z);
        const targetSize = def.targetSize ?? CONFIG.VISUALS.ZONA2_BOX_SIZE;
        if (maxDim > 0.001) {
            const s = targetSize / maxDim;
            scene.scale.set(s, s, s);
        }
        if (def.rotationY != null) scene.rotation.y = def.rotationY;

        scene.userData.isPatrolGlb = true;
        scene.userData.patrolDesign = Object.entries(PATROL_DESIGN_KEYS)
            .find(([, d]) => d === def)?.[0] ?? null;

        scene.traverse((c) => {
            if (!c.isMesh || !c.material) return;
            c.castShadow = true;
            c.receiveShadow = true;
            c.frustumCulled = false;
            c.material = c.material.clone();
        });

        this[def.groupRef] = scene;
        if (def === PATROL_COMMANDER) this.patrolGroup = scene;
        this._onModelLoaded(def.modelKey);
    },
    _applyPatrolEscortGlb(scene) {
        this._applyPatrolDesignGlb(PATROL_ESCORT, scene);
    },
    _buildPatrolEscortFallback() {
        const escortModel = new THREE.Group();
        escortModel.scale.set(
            CONFIG.VISUALS.ZONA1_SCALE * 1.05,
            CONFIG.VISUALS.ZONA1_SCALE * 1.05,
            CONFIG.VISUALS.ZONA1_SCALE * 1.05,
        );
        escortModel.rotation.y = 0;
        const hull = new THREE.Group();
        buildSimpleEnemyShip(hull, 'Zona2', CONFIG.VISUALS.ZONA2_BOX_SIZE);
        escortModel.add(hull);
        this.patrolEscortGroup = escortModel;
    },
    _applyPatrolDroidGlb(scene) {
        this._applyPatrolDesignGlb(PATROL_DROID, scene);
    },
    _buildPatrolDroidFallback() {
        const droidModel = new THREE.Group();
        droidModel.scale.set(
            CONFIG.VISUALS.ZONA1_SCALE * 1.0,
            CONFIG.VISUALS.ZONA1_SCALE * 1.0,
            CONFIG.VISUALS.ZONA1_SCALE * 1.0,
        );
        droidModel.rotation.y = 0;
        const hull = new THREE.Group();
        buildSimpleEnemyShip(hull, 'Zona1', CONFIG.VISUALS.ZONA1_BOX_SIZE);
        droidModel.add(hull);
        this.patrolDroidGroup = droidModel;
    },
    _applyPatrolCommanderGlb(scene) {
        this._applyPatrolDesignGlb(PATROL_COMMANDER, scene);
    },
    _buildPatrolCommanderFallback() {
        const patrolModel = new THREE.Group();
        patrolModel.scale.set(
            CONFIG.VISUALS.ZONA3_SCALE * 1.05,
            CONFIG.VISUALS.ZONA3_SCALE * 1.05,
            CONFIG.VISUALS.ZONA3_SCALE * 1.05,
        );
        patrolModel.rotation.y = 0;
        const hull = new THREE.Group();
        buildSimpleEnemyShip(hull, 'Zona3', CONFIG.VISUALS.ZONA3_BOX_SIZE);
        patrolModel.add(hull);
        this.patrolCommanderGroup = patrolModel;
        this.patrolGroup = patrolModel;
    },
    _buildPatrolFallbackGroup() {
        this._buildPatrolCommanderFallback();
    },
    _gltfLoadFailed(which, url, err) {
        console.warn(`[EnemyManager] Modelo no cargado (${which}):`, url, err);
        if (which === PATROL_COMMANDER.modelKey) this._buildPatrolCommanderFallback();
        if (which === PATROL_ESCORT.modelKey) this._buildPatrolEscortFallback();
        if (which === PATROL_DROID.modelKey) this._buildPatrolDroidFallback();
        this._onModelLoaded(which);
    },
    _applyEnemyGlbToDesign(design, scene) {
        const scale = CONFIG.VISUALS[design.scaleKey];
        scene.updateMatrixWorld(true);
        stripPoliceLightMeshes(scene);

        if (design.cloneForTemplate) {
            const master = scene;
            master.traverse((c) => {
                if (c.isMesh) {
                    c.castShadow = true;
                    c.receiveShadow = true;
                    c.frustumCulled = false;
                    if (c.material) c.material = c.material.clone();
                }
            });
            this[design.groupRef] = SkeletonUtils.clone(master);
            this[design.groupRef].scale.set(scale, scale, scale);
            this[design.groupRef].traverse((c) => {
                if (c.isMesh && c.material) c.material = c.material.clone();
            });
        } else {
            scene.scale.set(scale, scale, scale);
            if (design.rotationY != null) scene.rotation.y = design.rotationY;
            scene.traverse((c) => {
                if (!c.isMesh || !c.material) return;
                c.castShadow = design.spawnType !== 'Zona1';
                c.receiveShadow = design.spawnType !== 'Zona1';
                c.frustumCulled = false;
                c.material = c.material.clone();
                const m = c.material;
                if (m.emissive && m.emissive.getHex() !== 0) {
                    m.emissiveIntensity = Math.min(5, (m.emissiveIntensity || 1) * 2);
                }
            });
            this[design.groupRef] = scene;
        }

        this._onModelLoaded(design.modelKey);
        this._upgradeZoneVisuals(design.spawnType);
    },
    _loadSpawnerBaseGlb(design) {
        if (!design.baseGlbPath) return;
        const onFail = (which, url) => (err) => this._gltfLoadFailed(which, url, err);

        this.gltfLoader.load(design.baseGlbPath, (gltf) => {
            const model = gltf.scene;
            model.updateMatrixWorld(true);
            const baseScale = CONFIG.VISUALS[design.baseScaleKey];
            model.scale.set(baseScale, baseScale, baseScale);
            model.traverse((c) => {
                if (!c.isMesh) return;
                c.castShadow = false;
                c.receiveShadow = false;
                c.frustumCulled = false;
                if (!c.material || design.spawnType !== 'Zona1') return;
                if (c.material.emissive && (c.material.emissive.r > 0 || c.material.emissive.g > 0 || c.material.emissive.b > 0)) {
                    c.material = c.material.clone();
                    c.material.emissive.setHex(0xff0000);
                    c.material.emissiveIntensity = 8.0;
                } else if (c.material.name === 'Verre' || (c.material.name && c.material.name.includes('Window'))) {
                    c.material = c.material.clone();
                    c.material.emissive.setHex(0xff0000);
                    c.material.emissiveIntensity = 3.0;
                }
            });
            const spawner = this[design.spawnerRef];
            if (spawner) {
                spawner.visualGroup.clear();
                spawner.visualGroup.add(model.clone());
            }
        }, undefined, onFail(design.baseModelKey, design.baseGlbPath));
    },
    loadGLTFModels() {
        const onFail = (which, url) => (err) => this._gltfLoadFailed(which, url, err);

        // Patrullas primero — lo que más tarda en verse si va al final de la cola
        this.gltfLoader.load(
            PATROL_COMMANDER.glbPath,
            (gltf) => this._applyPatrolCommanderGlb(gltf.scene),
            undefined,
            onFail(PATROL_COMMANDER.modelKey, PATROL_COMMANDER.glbPath),
        );
        this.gltfLoader.load(
            PATROL_ESCORT.glbPath,
            (gltf) => this._applyPatrolEscortGlb(gltf.scene),
            undefined,
            onFail(PATROL_ESCORT.modelKey, PATROL_ESCORT.glbPath),
        );
        this.gltfLoader.load(
            PATROL_DROID.glbPath,
            (gltf) => this._applyPatrolDroidGlb(gltf.scene),
            undefined,
            onFail(PATROL_DROID.modelKey, PATROL_DROID.glbPath),
        );

        for (const design of ENEMY_DESIGNS) {
            this.gltfLoader.load(
                design.glbPath,
                (gltf) => this._applyEnemyGlbToDesign(design, gltf.scene),
                undefined,
                onFail(design.modelKey, design.glbPath),
            );
            this._loadSpawnerBaseGlb(design);
        }
    },

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
};
