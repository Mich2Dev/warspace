import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class Environment {
    constructor(scene, loadingManager) {
        this.scene = scene;
        this.loadingManager = loadingManager;
        this.initLighting();
        this.initTerrain();
        this.initStars();
    }

    initLighting() {
        // Reducimos la luz direccional y aumentamos la ambiental para mejorar contraste
        const ambientLight = new THREE.AmbientLight(0xffffff, CONFIG.GRAPHICS.AMBIENT_INTENSITY); // (antes 0.4)
        this.scene.add(ambientLight);

        this.sunLight = new THREE.DirectionalLight(0xffeebb, CONFIG.GRAPHICS.SUN_INTENSITY);
        this.sunLight.position.set(1000, 1500, -2000);
        this.sunLight.castShadow = true;
        
        // Shadow map optimizado para rendimiento
        this.sunLight.shadow.camera.left = -500;
        this.sunLight.shadow.camera.right = 500;
        this.sunLight.shadow.camera.top = 500;
        this.sunLight.shadow.camera.bottom = -500;
        this.sunLight.shadow.camera.near = 100;
        this.sunLight.shadow.camera.far = 3000;
        this.sunLight.shadow.mapSize.width = 1024; // Reducido para mejor FPS
        this.sunLight.shadow.mapSize.height = 1024;

        this.sunLight.position.set(500, 1000, 500);
        
        this.scene.add(this.sunLight);
        this.scene.add(this.sunLight.target);
    }

    initTerrain() {
        // Sistema de chunks: divide el mundo en tiles de 3000x3000
        // Solo se renderizan los 9 chunks alrededor del jugador (radio 1 chunk)
        this.CHUNK_SIZE = 3000;
        this.CHUNK_RES = 60; // vértices por chunk (antes era 200 para TODO el mapa)
        this.loadedChunks = new Map(); // clave "cx,cz" -> mesh

        // Cargar texturas una sola vez
        const loader = new THREE.TextureLoader(this.loadingManager);
        this.terrainDiffuse = loader.load('/textures/rock_diffuse.jpg');
        this.terrainNormal  = loader.load('/textures/rock_normal.jpg');
        this.terrainRough   = loader.load('/textures/rock_rough.jpg');
        [this.terrainDiffuse, this.terrainNormal, this.terrainRough].forEach(tex => {
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(20, 20); // repetición por chunk
        });
        this.terrainDiffuse.colorSpace = THREE.SRGBColorSpace;

        // Cargar chunks iniciales alrededor del origen (posición inicial del jugador)
        this._loadChunksAround(0, 4000);

        // Renderizar el laberinto en el minimapa de la UI
        this.generateMinimapBackground();
    }

    _chunkKey(cx, cz) { return `${cx},${cz}`; }

    _worldToChunk(wx, wz) {
        return {
            cx: Math.floor(wx / this.CHUNK_SIZE),
            cz: Math.floor(wz / this.CHUNK_SIZE)
        };
    }

    _buildChunk(cx, cz) {
        const key = this._chunkKey(cx, cz);
        if (this.loadedChunks.has(key)) return;

        const S = this.CHUNK_SIZE;
        const R = this.CHUNK_RES;
        const geometry = new THREE.PlaneGeometry(S, S, R, R);
        const pos = geometry.attributes.position;
        const colors = [];
        const color = new THREE.Color();

        // El mesh se centra en (cx*S + S/2, 0, cz*S + S/2)
        // Un vértice local (lx, ly) tiene posición world: (cx*S + S/2 + lx, h, cz*S + S/2 - ly)
        const centerX = cx * S + S * 0.5;
        const centerZ = cz * S + S * 0.5;

        for (let i = 0; i < pos.count; i++) {
            const lx = pos.getX(i);
            const ly = pos.getY(i);
            const wx = centerX + lx;       // posición world X real del vértice
            const wz = centerZ - ly;       // posición world Z real (PlaneGeometry rotado -PI/2 X)
            const h = this.getHeightAt(wx, wz);
            pos.setZ(i, h);

            if (h < -40)      color.setHex(0xd2a679);
            else if (h < 50)  color.setHex(0xcc7722);
            else if (h < 150) color.setHex(0xaa4411);
            else               color.setHex(0x553322);
            colors.push(color.r, color.g, color.b);
        }
        geometry.computeVertexNormals();
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            map: this.terrainDiffuse,
            normalMap: this.terrainNormal,
            roughnessMap: this.terrainRough,
            metalness: 0.05,
            flatShading: false
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(centerX, 0, centerZ);
        mesh.receiveShadow = false;
        this.scene.add(mesh);
        this.loadedChunks.set(key, mesh);
    }

    _loadChunksAround(wx, wz) {
        const { cx: pcx, cz: pcz } = this._worldToChunk(wx, wz);
        const RADIUS = 1; // 3x3 grid = 9 chunks visibles (buen balance FPS/distancia)

        for (let dx = -RADIUS; dx <= RADIUS; dx++) {
            for (let dz = -RADIUS; dz <= RADIUS; dz++) {
                this._buildChunk(pcx + dx, pcz + dz);
            }
        }

        // Descargar chunks que ya están lejos
        for (const [key, mesh] of this.loadedChunks.entries()) {
            const [kcx, kcz] = key.split(',').map(Number);
            if (Math.abs(kcx - pcx) > RADIUS + 1 || Math.abs(kcz - pcz) > RADIUS + 1) {
                this.scene.remove(mesh);
                mesh.geometry.dispose();
                mesh.material.dispose();
                this.loadedChunks.delete(key);
            }
        }
    }

    // Llamado cada frame desde game.js con la posición del jugador
    update(playerPosition) {
        this.updateShadows(playerPosition);

        // Solo recargar chunks cuando el jugador se mueve significativamente
        const px = playerPosition.x, pz = playerPosition.z;
        if (!this._lastChunkX || Math.abs(px - this._lastChunkX) > 500 || Math.abs(pz - this._lastChunkZ) > 500) {
            this._lastChunkX = px;
            this._lastChunkZ = pz;
            this._loadChunksAround(px, pz);
        }
    }


    // Calcula la altura para crear el Laberinto Orgánico (Cañones Naturales pero Escarpados)
    getHeightAt(x, z) {
        // Deformación orgánica de las coordenadas (Domain Warping)
        let warpX = x + Math.sin(z/1500) * 800;
        let warpZ = z + Math.cos(x/1500) * 800;

        // Patrón de ruido orgánico entrelazado
        let val1 = Math.sin(warpX/1000) * Math.cos(warpZ/1000);
        let val2 = Math.sin((warpX+warpZ)/1500);
        let canyon = Math.abs(val1) + Math.abs(val2) * 0.5;

        // Textura base del suelo
        let baseHeight = -35 + (Math.sin(x/100) * Math.cos(z/100)) * 5;

        // Calculamos la distancia a la base más cercana para aplanar el terreno y crear "cráteres" o valles para las bases
        let distToPlayer = Math.sqrt(x*x + Math.pow(z - 4000, 2));
        let distToDrone = Math.sqrt(Math.pow(x - CONFIG.ZONES.DRONE.x, 2) + Math.pow(z - CONFIG.ZONES.DRONE.z, 2));
        let distToFighter = Math.sqrt(Math.pow(x - CONFIG.ZONES.FIGHTER.x, 2) + Math.pow(z - CONFIG.ZONES.FIGHTER.z, 2));
        let distToBoss = Math.sqrt(Math.pow(x - CONFIG.ZONES.BOSS.x, 2) + Math.pow(z - CONFIG.ZONES.BOSS.z, 2));
        let distToZona1 = Math.sqrt(Math.pow(x - CONFIG.ZONES.ZONA1.x, 2) + Math.pow(z - CONFIG.ZONES.ZONA1.z, 2));
        let distToZona2 = Math.sqrt(Math.pow(x - CONFIG.ZONES.ZONA2.x, 2) + Math.pow(z - CONFIG.ZONES.ZONA2.z, 2));
        
        let minDist = Math.min(distToPlayer, distToDrone, distToFighter, distToBoss, distToZona1, distToZona2);

        // Factor de zona segura: 0 en el centro de las bases, 1 a partir de los 1500 metros
        let safeZoneFactor = Math.min(1.0, Math.max(0.0, (minDist - 500) / 1500));

        if (canyon < 0.4) {
            return baseHeight;
        } else {
            // Elevación agresiva pero continua (sin saltos bruscos que rompan los polígonos)
            let cliff = Math.pow((canyon - 0.4) * 4, 2); 
            let height = baseHeight + (cliff * 150);
            
            // Textura rocosa en las paredes
            height += (Math.sin(x/150) * Math.cos(z/150)) * 20;
            
            if (height > 350) height = 350 + (Math.sin(x/50)*Math.cos(z/50))*10;
            
            // Aplicar el factor de zona segura para hundir suavemente las montañas cerca del spawn
            return baseHeight + ((height - baseHeight) * safeZoneFactor);
        }
    }

    // Dibuja el mapa procedimental 24000x24000 en un canvas y lo pone de fondo en el radar
    generateMinimapBackground() {
        const minimap = document.getElementById('minimap');
        if (!minimap) return;

        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 200;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(200, 200);

        for (let i = 0; i < 200; i++) {
            for (let j = 0; j < 200; j++) {
                // Mapear pixel (0-200) a mundo 3D (-12000 a +12000)
                let worldX = (i / 200) * 24000 - 12000;
                let worldZ = (j / 200) * 24000 - 12000;
                
                let h = this.getHeightAt(worldX, worldZ);
                
                let idx = (j * 200 + i) * 4;
                if (h > 50) {
                    // Montaña / Pared (Gris Oscuro)
                    imgData.data[idx] = 60;
                    imgData.data[idx+1] = 60;
                    imgData.data[idx+2] = 60;
                    imgData.data[idx+3] = 255;
                } else {
                    // Suelo / Camino (Azul muy oscuro o negro)
                    imgData.data[idx] = 10;
                    imgData.data[idx+1] = 15;
                    imgData.data[idx+2] = 25;
                    imgData.data[idx+3] = 255;
                }
            }
        }
        ctx.putImageData(imgData, 0, 0);
        
        minimap.style.backgroundImage = `url(${canvas.toDataURL()})`;
        minimap.style.backgroundSize = 'cover';
    }

    updateShadows(playerPosition) {
        if (!this.sunLight) return;
        // El sol se mueve con el jugador para que las sombras sean nítidas a su alrededor
        this.sunLight.position.set(playerPosition.x + 500, playerPosition.y + 1000, playerPosition.z + 500);
        this.sunLight.target.position.copy(playerPosition);
        this.sunLight.target.updateMatrixWorld();
    }

    initStars() {
        const starGeo = new THREE.BufferGeometry();
        const starCount = 8000;
        const posArray = new Float32Array(starCount * 3);
        const colorsArray = new Float32Array(starCount * 3);
        const c = new THREE.Color();

        for(let i = 0; i < starCount * 3; i++) {
            const r = 2000 + Math.random() * 1000;
            const theta = 2 * Math.PI * Math.random();
            const phi = Math.acos(2 * Math.random() - 1);
            
            posArray[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            posArray[i * 3 + 1] = Math.abs(r * Math.sin(phi) * Math.sin(theta)); 
            posArray[i * 3 + 2] = r * Math.cos(phi);

            // Estrellas de colores (azuladas, blancas, naranjas)
            if(Math.random() > 0.8) c.setHex(0x99ccff);
            else if(Math.random() > 0.6) c.setHex(0xffcc99);
            else c.setHex(0xffffff);

            colorsArray[i * 3] = c.r;
            colorsArray[i * 3 + 1] = c.g;
            colorsArray[i * 3 + 2] = c.b;
        }

        starGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        starGeo.setAttribute('color', new THREE.BufferAttribute(colorsArray, 3));
        
        const starMat = new THREE.PointsMaterial({
            size: 4.0,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            sizeAttenuation: true
        });

        const stars = new THREE.Points(starGeo, starMat);
        this.scene.add(stars);
        
        // Nebulosa de fondo
        const nebulaGeo = new THREE.SphereGeometry(2500, 32, 32);
        const nebulaMat = new THREE.MeshBasicMaterial({
            color: 0x110033,
            side: THREE.BackSide,
            transparent: true,
            opacity: 0.5
        });
        const nebula = new THREE.Mesh(nebulaGeo, nebulaMat);
        this.scene.add(nebula);
    }
}
