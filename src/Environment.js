import * as THREE from 'three';
import { CONFIG } from '../config.js';

// Helper matematico para calcular la distancia al cuadrado entre un punto y un segmento de linea
function distToSegmentSq(px, pz, ax, az, bx, bz) {
    let abx = bx-ax, abz = bz-az;
    let t = Math.max(0, Math.min(1, ((px-ax)*abx + (pz-az)*abz) / (abx*abx + abz*abz)));
    let rx = ax + t*abx - px, rz = az + t*abz - pz;
    return rx*rx + rz*rz;
}

export class Environment {
    constructor(scene, loadingManager) {
        this.scene = scene;
        this.loadingManager = loadingManager;
        this.initLighting();
        this.initSkyAndSun();
        this.initTerrain();
        this.initStars();
        this.initDustParticles();
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

    initSkyAndSun() {
        // Sky dome gradient (Twilight Earth atmosphere)
        const skyGeo = new THREE.SphereGeometry(3000, 32, 16);
        const skyMat = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            uniforms: {
                topColor:    { value: new THREE.Color(0x2b005e) },   // Deep violet
                horizonColor:{ value: new THREE.Color(0x00f3ff) },   // Vivid cyan
                offset:      { value: 0.05 },
                exponent:    { value: 0.6 },
                time:        { value: 0.0 }
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 horizonColor;
                uniform float offset;
                uniform float exponent;
                uniform float time;
                varying vec3 vWorldPosition;

                // Simple 3D Noise for Nebula effect
                vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
                vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
                float snoise(vec3 v) {
                    const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
                    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
                    vec3 i  = floor(v + dot(v, C.yyy) );
                    vec3 x0 = v - i + dot(i, C.xxx) ;
                    vec3 g = step(x0.yzx, x0.xyz);
                    vec3 l = 1.0 - g;
                    vec3 i1 = min( g.xyz, l.zxy );
                    vec3 i2 = max( g.xyz, l.zxy );
                    vec3 x1 = x0 - i1 + C.xxx;
                    vec3 x2 = x0 - i2 + C.yyy;
                    vec3 x3 = x0 - D.yyy;
                    i = mod289(i); 
                    vec4 p = permute( permute( permute( 
                               i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                             + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
                             + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
                    float n_ = 0.142857142857;
                    vec3  ns = n_ * D.wyz - D.xzx;
                    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
                    vec4 x_ = floor(j * ns.z);
                    vec4 y_ = floor(j - 7.0 * x_ );
                    vec4 x = x_ *ns.x + ns.yyyy;
                    vec4 y = y_ *ns.x + ns.yyyy;
                    vec4 h = 1.0 - abs(x) - abs(y);
                    vec4 b0 = vec4( x.xy, y.xy );
                    vec4 b1 = vec4( x.zw, y.zw );
                    vec4 s0 = floor(b0)*2.0 + 1.0;
                    vec4 s1 = floor(b1)*2.0 + 1.0;
                    vec4 sh = -step(h, vec4(0.0));
                    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
                    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
                    vec3 p0 = vec3(a0.xy,h.x);
                    vec3 p1 = vec3(a0.zw,h.y);
                    vec3 p2 = vec3(a1.xy,h.z);
                    vec3 p3 = vec3(a1.zw,h.w);
                    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
                    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
                    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
                    m = m * m;
                    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
                }

                void main() {
                    float h = normalize(vWorldPosition).y + offset;
                    vec3 skyBase = mix(horizonColor, topColor, max(pow(max(h, 0.0), exponent), 0.0));
                    
                    // Procedural Cirrus Clouds using noise
                    vec3 dir = normalize(vWorldPosition);
                    // Mover nubes lentamente
                    float n = snoise(dir * 3.0 + vec3(time * 0.015)) * 0.5 + 0.5;
                    float n2 = snoise(dir * 5.0 - vec3(time * 0.01)) * 0.5 + 0.5;
                    
                    // Máscara de nubes: Solo aparecen en la parte alta del cielo, se desvanecen en el horizonte
                    float cloudMask = smoothstep(0.4, 0.75, n * n2) * smoothstep(0.05, 0.5, dir.y);
                    
                    vec3 cloudColor = vec3(1.0, 0.4, 0.8); // Nubes rosas/purpuras (Neon/Synthwave)
                    
                    gl_FragColor = vec4(mix(skyBase, cloudColor, cloudMask), 1.0);
                }
            `
        });
        this.skyDome = new THREE.Mesh(skyGeo, skyMat);
        this.scene.add(this.skyDome);

        // Visible sun sphere (glowing orb)
        const sunPos = new THREE.Vector3(1500, 800, -2500);
        
        // Sun glow halo (large, additive)
        const haloGeo = new THREE.SphereGeometry(80, 16, 16);
        const haloMat = new THREE.MeshBasicMaterial({
            color: 0xff6600,
            transparent: true,
            opacity: 0.15,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const halo = new THREE.Mesh(haloGeo, haloMat);
        halo.position.copy(sunPos);
        this.scene.add(halo);

        // Sun core (small, bright)
        const sunCoreGeo = new THREE.SphereGeometry(30, 16, 16);
        const sunCoreMat = new THREE.MeshBasicMaterial({
            color: 0xffdd88,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this.sunCore = new THREE.Mesh(sunCoreGeo, sunCoreMat);
        this.sunCore.position.copy(sunPos);
        this.scene.add(this.sunCore);

        // Point light from the sun for rim lighting on ships
        const sunPointLight = new THREE.PointLight(0xffaa44, 0.8, 8000);
        sunPointLight.position.copy(sunPos);
        this.scene.add(sunPointLight);

        // Atmospheric haze layer (horizontal plane near ground)
        const hazeGeo = new THREE.PlaneGeometry(20000, 20000);
        const hazeMat = new THREE.MeshBasicMaterial({
            color: 0x401500,
            transparent: true,
            opacity: 0.12,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        this.haze = new THREE.Mesh(hazeGeo, hazeMat);
        this.haze.rotation.x = Math.PI / 2;
        this.haze.position.y = 60;
        this.scene.add(this.haze);
    }

    initDustParticles() {
        // Floating dust/debris particles in the atmosphere
        const count = 800; // Reducido para mejor FPS
        const dustGeo = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const velocities = [];

        for (let i = 0; i < count; i++) {
            positions[i * 3]     = (Math.random() - 0.5) * 1500;
            positions[i * 3 + 1] = Math.random() * 200 + 10;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 1500;
            velocities.push(
                (Math.random() - 0.5) * 0.2,
                (Math.random() - 0.5) * 0.02,
                (Math.random() - 0.5) * 0.2
            );
        }
        dustGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const dustMat = new THREE.PointsMaterial({
            color: 0xaa6633, // Más oscuro, menos brillante
            size: 1.0,   // Más sutiles
            transparent: true,
            opacity: 0.15, // Menos opaco para no parecer estrellas
            sizeAttenuation: true,   
            blending: THREE.NormalBlending, // Normal blending en vez de additive para no brillar como estrellas
            depthWrite: false
        });

        this.dustParticles = new THREE.Points(dustGeo, dustMat);
        this.dustVelocities = velocities;
        this.scene.add(this.dustParticles);
    }

    initTerrain() {
        // Sistema de chunks: divide el mundo en tiles de 3000x3000
        // Solo se renderizan los 9 chunks alrededor del jugador (radio 1 chunk)
        this.CHUNK_SIZE = 3000;
        this.CHUNK_RES = 40; // Reducido de 60 a 40 para mejor rendimiento
        this.loadedChunks = new Map(); // clave "cx,cz" -> mesh
        this.chunkQueue = []; // Cola de chunks para generar uno por frame y evitar lag

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
        
        // --- Material Global del Terreno (Agua Dinámica Integrada) ---
        this.terrainMat = new THREE.MeshStandardMaterial({
            vertexColors: true,
            map: this.terrainDiffuse,
            normalMap: this.terrainNormal,
            roughnessMap: this.terrainRough,
            metalness: 0.1, // Tierra base
            roughness: 0.9,
            flatShading: false
        });

        // --- Geometría de Cristales (Pre-cargada) ---
        // Pirámide pentagonal muy afilada (CylinderGeo con radiusTop 0)
        const crystalGeo = new THREE.CylinderGeometry(0, 15, 60, 5); 
        crystalGeo.translate(0, 30, 0); // Ajustar el pivote a la base
        const crystalMat = new THREE.MeshStandardMaterial({
            color: 0x44ffff,
            emissive: 0x0088aa,
            emissiveIntensity: 0.6,
            metalness: 0.9,
            roughness: 0.1
        });
        this.crystalGeo = crystalGeo;
        this.crystalMat = crystalMat;

        // Shader para convertir zonas hondas en agua interactiva sin Z-Fighting
        this.terrainMat.onBeforeCompile = (shader) => {
            shader.uniforms.time = { value: 0 };
            shader.uniforms.playerPos = { value: new THREE.Vector3(0,0,0) };
            shader.uniforms.playerVel = { value: new THREE.Vector3(0,0,0) };
            
            shader.vertexShader = `
                varying vec3 vWorldTerrainPos;
            ` + shader.vertexShader;
            
            shader.vertexShader = shader.vertexShader.replace(
                `#include <begin_vertex>`,
                `
                #include <begin_vertex>
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vWorldTerrainPos = worldPos.xyz;
                `
            );

            shader.fragmentShader = `
                uniform float time;
                uniform vec3 playerPos;
                uniform vec3 playerVel;
                varying vec3 vWorldTerrainPos;
            ` + shader.fragmentShader;

            // Sobrescribir roughness y metalness si estamos en zona de agua (Y < -22)
            shader.fragmentShader = shader.fragmentShader.replace(
                `#include <roughnessmap_fragment>`,
                `
                #include <roughnessmap_fragment>
                float isWaterR = step(vWorldTerrainPos.y, -22.0); // 1.0 si es agua
                roughnessFactor = mix(roughnessFactor, 0.05, isWaterR); // Espejo perfecto
                `
            );
            
            shader.fragmentShader = shader.fragmentShader.replace(
                `#include <metalnessmap_fragment>`,
                `
                #include <metalnessmap_fragment>
                float isWaterM = step(vWorldTerrainPos.y, -22.0);
                metalnessFactor = mix(metalnessFactor, 0.95, isWaterM); // Refleja el cielo
                `
            );

            // Inyectar físicas interactivas en el agua (Ripples)
            shader.fragmentShader = shader.fragmentShader.replace(
                `#include <dithering_fragment>`,
                `
                #include <dithering_fragment>
                
                float waterArea = step(vWorldTerrainPos.y, -22.0);
                if (waterArea > 0.5) {
                    vec3 toPlayer = vWorldTerrainPos - playerPos;
                    float dist = length(toPlayer.xz);
                    float velMag = length(playerVel.xz);
                    
                    if (velMag > 1.0 && dist < 600.0) {
                        vec2 dir = normalize(playerVel.xz + vec2(0.0001)); 
                        vec2 toP = normalize(toPlayer.xz);
                        float behind = dot(toP, -dir); 
                        
                        if (behind > 0.0) {
                            float wakeWidth = abs(dot(toP, vec2(-dir.y, dir.x))); 
                            float wave = sin(dist * 0.08 - time * 15.0 + wakeWidth * 2.0);
                            float fade = smoothstep(600.0, 100.0, dist) * smoothstep(0.0, 0.7, behind) * min(velMag * 0.01, 1.0);
                            
                            // Espuma / Reflejo Cyan en la ola
                            gl_FragColor.rgb += vec3(0.2, 0.6, 0.8) * max(0.0, wave) * fade * 1.5;
                        }
                    }
                }
                `
            );
            this.terrainMat.userData.shader = shader;
        };
        
        // Ya no necesitamos waterPlane, el agua está en el material del terreno

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
        const grassPositions = [];
        const mossPositions = []; // Almacena posiciones para el musgo de bajo coste
        const crystalPositions = []; // Posiciones de los cristales

        // Función de pseudo-ruido fractal para evitar simetrías (rompe el patrón de tablero de ajedrez)
        const getOrganicBiome = (x, z) => {
            let n = Math.sin(x * 0.004 + Math.cos(z * 0.005)) * 1.0;
            n += Math.sin(z * 0.011 - Math.cos(x * 0.013)) * 0.5;
            n += Math.sin(x * 0.025 + z * 0.02) * 0.25;
            return n * 0.5; // Normalizado
        };

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

            // Teñir el terreno de colores más realistas (Tierra oscura, grises y musgo)
            if (h < -22)      color.setHex(0x051a22); // Agua lodosa azul oscura
            else if (h < 50)  color.setHex(0x2c3b24); // Llanura verde/tierra (más oscuro y natural)
            else if (h < 150) color.setHex(0x4a433d); // Faldas rocosas (gris pardo)
            else               color.setHex(0x3a3d40); // Montaña gris oscura

            // Tint the ground green/dark where grass grows
            if (h < 120) {
                let edgeFactor = 0.35 + Math.max(0, 0.65 * (1.0 - Math.abs(h - 65) / 55.0));
                const biomeVal = getOrganicBiome(wx, wz);
                
                if (biomeVal * edgeFactor > 0.05) {
                    const soilColor = new THREE.Color(0x1a2e0a); // Tierra verde musgo muy oscuro
                    const fertility = Math.min((biomeVal * edgeFactor - 0.05) * 8.0, 1.0);
                    // Suavizamos el borde de la textura del suelo
                    color.lerp(soilColor, fertility * 0.9);
                }
            }

            colors.push(color.r, color.g, color.b);
        }
        
        // --- Generación de Alfombras de Hierba (Campos continuos y súper densos) ---
        // Se reduce a 15,000 para optimizar el CPU y eliminar completamente el Lag.
        const carpetPoints = 15000; 
        for (let i = 0; i < carpetPoints; i++) {
            const rx = centerX + (Math.random() - 0.5) * S;
            const rz = centerZ + (Math.random() - 0.5) * S;
            const h = this.getHeightAt(rx, rz);
            
            // Generar cristales aleatorios en cualquier altura, pero raros (como árboles masivos)
            if (Math.random() < 0.00003) { // Probabilidad bajísima (muy pocos)
                crystalPositions.push({ x: rx, y: h, z: rz });
            }
            
            // Permitimos vegetación en llanuras y faldas, pero NO bajo el agua (h > -21) ni en picos (h < 120)
            if (h > -21 && h < 120) {
                // Factor base de 0.35 para que siempre haya hierba en el centro plano
                // Bonus de hasta +0.65 en las faldas de las montañas (aprox h=65)
                let edgeFactor = 0.35 + Math.max(0, 0.65 * (1.0 - Math.abs(h - 65) / 55.0));
                
                // Usar el nuevo ruido asimétrico orgánico
                const biomeVal = getOrganicBiome(rx, rz);
                
                // Si es muy fértil, hierba densa
                if (biomeVal * edgeFactor > 0.08) {
                    grassPositions.push({ x: rx, y: h, z: rz });
                } 
                // Si no es tan fértil, musgo de relleno esporádico
                else if (biomeVal * edgeFactor > 0.02) {
                    if (Math.random() > 0.6) { // Reduce la cantidad de musgo para no sobrecargar
                        mossPositions.push({ x: rx, y: h, z: rz });
                    }
                }
            }
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

        // --- Generar InstancedMesh de Grama/Hierba ---
        if (grassPositions.length > 0) {
            // Hojas más anchas para que al unirse cubran el suelo como una alfombra
            const grassGeo = new THREE.PlaneGeometry(4.0, 12, 1, 4);
            grassGeo.translate(0, 6, 0); // Ajustar el pivote a la base
            
            const grassMat = new THREE.MeshLambertMaterial({ 
                color: 0x5a9a2a,
                side: THREE.DoubleSide
            });
            
            // Inyectar custom shader para físicas, viento y color hiper-realista
            grassMat.onBeforeCompile = (shader) => {
                shader.uniforms.time = { value: 0 };
                shader.uniforms.playerPos = { value: new THREE.Vector3(0,0,0) };
                
                // --- VERTEX SHADER ---
                shader.vertexShader = `
                    uniform float time;
                    uniform vec3 playerPos;
                    varying float vGrassHeight;
                    varying vec3 vGrassWorldPos;
                ` + shader.vertexShader;
                
                shader.vertexShader = shader.vertexShader.replace(
                    `#include <begin_vertex>`,
                    `
                    #include <begin_vertex>
                    
                    vec4 worldPos = instanceMatrix * vec4(position, 1.0);
                    vGrassWorldPos = worldPos.xyz;
                    
                    // Altura (0 en la base, 1 en la punta)
                    float hFactor = max(0.0, position.y / 14.0);
                    vGrassHeight = hFactor;
                    
                    // 1. Dar forma de hoja y evitar el look de "papel"
                    // Encogemos la punta
                    transformed.x *= (1.0 - hFactor * 0.9);
                    // Doblamos la hoja en forma de V (crea un perfil 3D en lugar de ser totalmente plana)
                    transformed.z += abs(position.x) * 0.6;
                    
                    // 2. Ondas de viento sincronizadas (Traveling waves más suaves)
                    float wave = sin(worldPos.x * 0.02 + worldPos.z * 0.02 + time * 2.0);
                    float noise = sin(worldPos.x * 0.1) * cos(worldPos.z * 0.1);
                    float wind = (wave + noise * 0.2) * 4.0;
                    
                    // --- SISTEMA DE OPTIMIZACIÓN (LOD) ---
                    // Evita lag escondiendo la hierba que está muy lejos del jugador
                    // Usamos playerPos en lugar de cameraPosition para que el Scroll (Zoom out) no desaparezca el pasto
                    float pDist = distance(worldPos.xz, playerPos.xz);
                    float lodScale = 1.0;
                    
                    if (pDist > 3000.0) {
                        lodScale = 0.0; // Totalmente invisible (GPU se ahorra dibujarla)
                    } else if (pDist > 2000.0) {
                        // Transición hiper suave a gran distancia para que sea imperceptible
                        lodScale = 1.0 - ((pDist - 2000.0) / 1000.0);
                    }
                    
                    // Aplicar escala por distancia
                    transformed *= lodScale;
                    // -------------------------------------
                    
                    // 3. Interacción con el jugador (Suavizada para evitar movimientos bruscos)
                    vec3 toPlayer = worldPos.xyz - playerPos;
                    toPlayer.y = 0.0;
                    float dist = length(toPlayer);
                    vec3 bend = vec3(0.0);
                    
                    if (dist < 150.0) {
                        // Smoothstep crea una transición de fuerza muy suave sin tirones
                        float push = smoothstep(150.0, 0.0, dist) * 12.0; 
                        bend = -(toPlayer / max(dist, 1.0)) * push; 
                    }
                    
                    // 4. Aplicar curva natural (Las hojas se doblan más en la punta)
                    float curveFactor = pow(hFactor, 2.0); 
                    
                    // Aplicar deformación al vértice local usando el factor curvo
                    transformed.x += (wind + bend.x) * curveFactor;
                    transformed.z += (wind + bend.z) * curveFactor;
                    `
                );

                // --- FRAGMENT SHADER (Color Realista) ---
                shader.fragmentShader = `
                    varying float vGrassHeight;
                    varying vec3 vGrassWorldPos;
                ` + shader.fragmentShader;

                shader.fragmentShader = shader.fragmentShader.replace(
                    `#include <color_fragment>`,
                    `
                    #include <color_fragment>
                    
                    // Gradiente de raíz a punta (Colores desaturados, verde militar/olivo para realismo)
                    vec3 rootColor = vec3(0.04, 0.12, 0.02); // Verde musgo oscuro profundo
                    vec3 tipColor = vec3(0.20, 0.40, 0.15);  // Verde olivo vibrante pero natural
                    
                    // Añadir manchas secas en el mundo para romper la monotonía
                    // Usamos una función seno combinada para generar "parches" grandes
                    float patchNoise = sin(vGrassWorldPos.x * 0.015) * cos(vGrassWorldPos.z * 0.015);
                    vec3 dryColor = vec3(0.35, 0.35, 0.15); // Verde militar amarillento muy desaturado
                    
                    // Mezclar la punta con el color seco en base al ruido
                    vec3 finalTip = mix(tipColor, dryColor, smoothstep(0.4, 1.0, patchNoise));
                    
                    // Color final de la hoja interpolado por su altura
                    vec3 finalGrassColor = mix(rootColor, finalTip, pow(vGrassHeight, 0.7));
                    
                    // Sobrescribir el color base antes de que Three.js calcule la luz (Sol/Sombras)
                    diffuseColor.rgb = finalGrassColor;
                    `
                );
                
                grassMat.userData.shader = shader;
            };

            const grassInstanced = new THREE.InstancedMesh(grassGeo, grassMat, grassPositions.length);
            
            const dummy = new THREE.Object3D();
            for (let i = 0; i < grassPositions.length; i++) {
                const gp = grassPositions[i];
                dummy.position.set(gp.x, gp.y, gp.z); 
                dummy.rotation.y = Math.random() * Math.PI;
                // Rotaciones ligeras para dar aleatoriedad a la postura
                dummy.rotation.x = (Math.random() - 0.5) * 0.3;
                dummy.rotation.z = (Math.random() - 0.5) * 0.3;
                const scale = 0.7 + Math.random() * 0.8; // Variar un poco la altura
                dummy.scale.set(scale, scale, scale);
                dummy.updateMatrix();
                grassInstanced.setMatrixAt(i, dummy.matrix);
            }
            grassInstanced.receiveShadow = false;
            grassInstanced.castShadow = false;
            
            this.scene.add(grassInstanced);
            mesh.userData.grassMesh = grassInstanced; 
        }

        // --- Generar InstancedMesh de Musgo (Ultra Optimizado) ---
        if (mossPositions.length > 0) {
            // Un simple plano de 4 vértices, extremadamente barato
            const mossGeo = new THREE.PlaneGeometry(8, 8, 1, 1);
            mossGeo.rotateX(-Math.PI / 2); // Acostado en el piso
            
            const mossMat = new THREE.MeshLambertMaterial({
                color: 0x1f3c0f, // Verde oscuro apagado
                side: THREE.DoubleSide
            });
            
            const mossInstanced = new THREE.InstancedMesh(mossGeo, mossMat, mossPositions.length);
            const dummyMoss = new THREE.Object3D();
            
            for (let i = 0; i < mossPositions.length; i++) {
                const mp = mossPositions[i];
                // Ligeramente elevado para evitar Z-fighting con el terreno
                dummyMoss.position.set(mp.x, mp.y + 0.3, mp.z);
                dummyMoss.rotation.y = Math.random() * Math.PI;
                // Pequeñas inclinaciones para adaptarse al terreno irregular
                dummyMoss.rotation.x = (Math.random() - 0.5) * 0.4;
                dummyMoss.rotation.z = (Math.random() - 0.5) * 0.4;
                const scale = 0.6 + Math.random() * 0.8;
                dummyMoss.scale.setScalar(scale);
                dummyMoss.updateMatrix();
                mossInstanced.setMatrixAt(i, dummyMoss.matrix);
            }
            
            mossInstanced.receiveShadow = false;
            mossInstanced.castShadow = false;
            this.scene.add(mossInstanced);
            mesh.userData.mossMesh = mossInstanced;
        }

        // --- Generar InstancedMesh de Cristales ---
        if (crystalPositions.length > 0) {
            const crystalInstanced = new THREE.InstancedMesh(this.crystalGeo, this.crystalMat, crystalPositions.length);
            const dummyCrys = new THREE.Object3D();
            
            for (let i = 0; i < crystalPositions.length; i++) {
                const cp = crystalPositions[i];
                dummyCrys.position.set(cp.x, cp.y, cp.z); // Anclado al suelo
                dummyCrys.rotation.y = Math.random() * Math.PI;
                // Inclinación aleatoria y dentada
                dummyCrys.rotation.x = (Math.random() - 0.5) * 0.4;
                dummyCrys.rotation.z = (Math.random() - 0.5) * 0.4;
                const scale = 0.8 + Math.random() * 2.5; // Tamaños irregulares masivos
                dummyCrys.scale.setScalar(scale);
                dummyCrys.updateMatrix();
                crystalInstanced.setMatrixAt(i, dummyCrys.matrix);
            }
            this.scene.add(crystalInstanced);
            mesh.userData.crystalMesh = crystalInstanced;
        }

        this.scene.add(mesh);
        this.loadedChunks.set(key, mesh);
    }

    _loadChunksAround(wx, wz) {
        const { cx: pcx, cz: pcz } = this._worldToChunk(wx, wz);
        const RADIUS = 1; // 3x3 grid = 9 chunks visibles (buen balance FPS/distancia)

        for (let dx = -RADIUS; dx <= RADIUS; dx++) {
            for (let dz = -RADIUS; dz <= RADIUS; dz++) {
                const targetCx = pcx + dx;
                const targetCz = pcz + dz;
                const key = this._chunkKey(targetCx, targetCz);
                
                // Si no está cargado ni en la cola, lo metemos a la cola
                if (!this.loadedChunks.has(key) && !this.chunkQueue.some(c => c.cx === targetCx && c.cz === targetCz)) {
                    this.chunkQueue.push({ cx: targetCx, cz: targetCz });
                }
            }
        }

        // Descargar chunks que ya están lejos
        for (const [key, mesh] of this.loadedChunks.entries()) {
            const [kcx, kcz] = key.split(',').map(Number);
            if (Math.abs(kcx - pcx) > RADIUS + 1 || Math.abs(kcz - pcz) > RADIUS + 1) {
                this.scene.remove(mesh);
                if (mesh.userData.grassMesh) {
                    this.scene.remove(mesh.userData.grassMesh);
                    mesh.userData.grassMesh.geometry.dispose();
                    mesh.userData.grassMesh.material.dispose();
                }
                if (mesh.userData.mossMesh) {
                    this.scene.remove(mesh.userData.mossMesh);
                    mesh.userData.mossMesh.geometry.dispose();
                    // material is shared
                }
                if (mesh.userData.crystalMesh) {
                    this.scene.remove(mesh.userData.crystalMesh);
                    // geometry and material are shared
                }
                mesh.geometry.dispose();
                mesh.material.dispose();
                this.loadedChunks.delete(key);
            }
        }
    }

    // Llamado cada frame desde game.js con la posición y velocidad del jugador
    update(playerPosition, playerVelocity) {
        this.updateShadows(playerPosition);
        
        // Procesar un solo chunk de la cola por frame para evitar tirones (Lag Spikes)
        this._loadChunksAround(playerPosition.x, playerPosition.z);
        if (this.chunkQueue.length > 0) {
            const chunk = this.chunkQueue.shift();
            // Comprobamos si todavía está en rango antes de construirlo
            const { cx: pcx, cz: pcz } = this._worldToChunk(playerPosition.x, playerPosition.z);
            const RADIUS = 1;
            if (Math.abs(chunk.cx - pcx) <= RADIUS + 1 && Math.abs(chunk.cz - pcz) <= RADIUS + 1) {
                this._buildChunk(chunk.cx, chunk.cz);
            }
        }
        
        // El cielo y el horizonte siguen al jugador para parecer infinitos
        if (this.skyDome) {
            this.skyDome.position.copy(playerPosition);
            if (this.skyDome.material && this.skyDome.material.uniforms.time) {
                this.skyDome.material.uniforms.time.value += 0.01;
            }
        }
        if (this.starsMesh) {
            this.starsMesh.position.copy(playerPosition);
        }
        if (this.haze) {
            this.haze.position.x = playerPosition.x;
            this.haze.position.z = playerPosition.z;
        }

        // Animar partículas de polvo
        if (this.dustParticles) {
            const positions = this.dustParticles.geometry.attributes.position.array;
            const count = positions.length / 3;
            const RANGE = 1000;

            for (let i = 0; i < count; i++) {
                positions[i * 3]     += this.dustVelocities[i * 3];
                positions[i * 3 + 1] += this.dustVelocities[i * 3 + 1];
                positions[i * 3 + 2] += this.dustVelocities[i * 3 + 2];

                // Re-center near player to give infinite effect
                if (Math.abs(positions[i * 3] - playerPosition.x) > RANGE) {
                    positions[i * 3] = playerPosition.x + (Math.random() - 0.5) * RANGE * 2;
                }
                if (positions[i * 3 + 1] > playerPosition.y + 300 || positions[i * 3 + 1] < 5) {
                    positions[i * 3 + 1] = Math.random() * 200 + 10;
                }
                if (Math.abs(positions[i * 3 + 2] - playerPosition.z) > RANGE) {
                    positions[i * 3 + 2] = playerPosition.z + (Math.random() - 0.5) * RANGE * 2;
                }
            }
            this.dustParticles.geometry.attributes.position.needsUpdate = true;
        }

        // Animar la hierba procedural y su interacción
        for (const mesh of this.loadedChunks.values()) {
            if (mesh.userData.grassMesh && mesh.userData.grassMesh.material.userData.shader) {
                const shader = mesh.userData.grassMesh.material.userData.shader;
                shader.uniforms.time.value += 0.016;
                shader.uniforms.playerPos.value.copy(playerPosition);
            }
        }

        // Solo recargar chunks cuando el jugador se mueve significativamente
        const px = playerPosition.x, pz = playerPosition.z;
        if (!this._lastChunkX || Math.abs(px - this._lastChunkX) > 500 || Math.abs(pz - this._lastChunkZ) > 500) {
            this._lastChunkX = px;
            this._lastChunkZ = pz;
            this._loadChunksAround(px, pz);
        }
    }


    // Calcula la altura para crear un Mundo Abierto con Cordilleras Montañosas
    getHeightAt(x, z) {
        // 1. Llanuras y colinas suaves (Terreno Base)
        let base = Math.sin(x * 0.001) * Math.cos(z * 0.0012) * 30;
        base += Math.sin(x * 0.003 + z * 0.002) * 15;
        base += 15; // Promedio en 15 (tierra firme)

        // 2. Montañas Dentadas y Altas (Cordilleras para separar zonas y dar referencia)
        let ridgeX = x + Math.sin(z * 0.0005) * 1000;
        let ridgeZ = z + Math.cos(x * 0.0005) * 1000;
        let ridgeNoise = 1.0 - Math.abs(Math.sin(ridgeX * 0.0008) * Math.cos(ridgeZ * 0.0008));
        ridgeNoise = Math.pow(ridgeNoise, 12.0); // Crestas muy escarpadas
        let mountainHeight = ridgeNoise * 450; // Picos inmensos

        let h = base + mountainHeight;

        // 3. Valles profundos para formar lagos de agua
        let valley = Math.sin(x * 0.0005) * Math.cos(z * 0.0006);
        if (valley > 0.6) {
            h -= (valley - 0.6) * 300; // Hundimiento severo (forma el lago por debajo de -22)
        }

        // 4. Muro perimetral para no salir del mapa
        let distFromCenter = Math.sqrt(x*x + z*z);
        if (distFromCenter > 9000) {
            h += (distFromCenter - 9000) * 0.25;
        }

        // Calculamos la distancia a las bases (Zonas Seguras)
        let dx, dz;
        dx = x; dz = z; let dPlayer = dx*dx + dz*dz;
        dx = x - CONFIG.ZONES.ZONA1.x; dz = z - CONFIG.ZONES.ZONA1.z; let dZona1 = dx*dx + dz*dz;
        dx = x - CONFIG.ZONES.ZONA2.x; dz = z - CONFIG.ZONES.ZONA2.z; let dZona2 = dx*dx + dz*dz;
        dx = x - CONFIG.ZONES.ZONA3.x; dz = z - CONFIG.ZONES.ZONA3.z; let dZona3 = dx*dx + dz*dz;
        
        let minSq = Math.min(dPlayer, dZona1, dZona2, dZona3);

        // Corredores entre zonas: distancia de punto a segmento de linea
        // spawn(0,0)->Zona1, Zona1->Zona2, Zona2->Zona3, spawn->Zona3
        const corridorWidth = 500; // ancho del corredor en unidades
        const z1x = CONFIG.ZONES.ZONA1.x, z1z = CONFIG.ZONES.ZONA1.z;
        const z2x = CONFIG.ZONES.ZONA2.x, z2z = CONFIG.ZONES.ZONA2.z;
        const z3x = CONFIG.ZONES.ZONA3.x, z3z = CONFIG.ZONES.ZONA3.z;
        const corridorSq = corridorWidth * corridorWidth;
        let inCorridor = false;
        if (distToSegmentSq(x, z, 0, 0,  z1x, z1z) < corridorSq) inCorridor = true;
        if (distToSegmentSq(x, z, z1x, z1z, z2x, z2z) < corridorSq) inCorridor = true;
        if (distToSegmentSq(x, z, z2x, z2z, z3x, z3z) < corridorSq) inCorridor = true;
        if (distToSegmentSq(x, z, 0, 0, z3x, z3z) < corridorSq) inCorridor = true;

        if (inCorridor) {
            // Dentro del corredor: aplana todo a terreno llano
            return Math.min(h, 15);
        }

        // Optimizacion: Si estamos lejos de cualquier base (>1600m), saltar las mates
        if (minSq > 2560000) {
            return h;
        }

        // Factor de zona segura: 0 en el centro de las bases, 1 a partir de los 1500 metros
        let minDist = Math.sqrt(minSq);
        let safeZoneFactor = Math.min(1.0, Math.max(0.0, (minDist - 600) / 1000));

        return 15 + ((h - 15) * safeZoneFactor);
    }

    // Dibuja el mapa procedimental 24000x24000 en un canvas (VISTA SATELITAL REAL)
    generateMinimapBackground() {
        const minimap = document.getElementById('minimap');
        if (!minimap) return;

        const canvas = document.createElement('canvas');
        canvas.width = 250; // Más resolución para el radar
        canvas.height = 250;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(250, 250);

        // Función idéntica a la que rige el bioma 3D para lograr un mapa 100% exacto
        const getOrganicBiome = (x, z) => {
            let n = Math.sin(x * 0.004 + Math.cos(z * 0.005)) * 1.0;
            n += Math.sin(z * 0.011 - Math.cos(x * 0.013)) * 0.5;
            n += Math.sin(x * 0.025 + z * 0.02) * 0.25;
            return n * 0.5; 
        };

        for (let i = 0; i < 250; i++) {
            for (let j = 0; j < 250; j++) {
                // Mapear pixel (0-250) a mundo 3D (-12000 a +12000)
                let worldX = (i / 250) * 24000 - 12000;
                let worldZ = (j / 250) * 24000 - 12000;
                
                let h = this.getHeightAt(worldX, worldZ);
                // Calcular pendiente para sombreado direccional (iluminación Oeste->Este)
                let hLeft = this.getHeightAt(worldX - 50, worldZ);
                let slope = (h - hLeft) / 50.0;
                let light = Math.max(0.4, Math.min(1.8, 1.0 + slope * 1.5));
                
                let idx = (j * 250 + i) * 4;
                let r, g, b;
                
                // Paleta topográfica HD
                if (h < -22) {
                    // Agua Profunda
                    r = 10; g = 60; b = 90;
                    light = 1.0; // El agua es plana, sin sombras
                } else if (h < 50) {
                    // Llanuras (Verde Oliva y Tierra)
                    if (h > 40) {
                        r = 136; g = 102; b = 85; // Roca marciana
                    } else if (h > 10) {
                        r = 168; g = 136; b = 102; // Suelo claro
                    } else if (h > 2) {
                        r = 204; g = 170; b = 136; // Tierra dorada
                    } else {
                        r = 238; g = 221; b = 204; // Arena blanca/brillante
                    }
                    let dirt = Math.sin(worldX/100) * Math.cos(worldZ/100);
                    if (dirt > 0) { r += 20; g -= 15; b -= 15; } // Zonas de tierra seca
                } else if (h < 150) {
                    // Faldas de cordilleras (Marrón rocoso)
                    r = 105; g = 75; b = 55;
                } else {
                    // Picos de Montañas Altas (Gris y Nieve)
                    r = 70; g = 75; b = 80;
                    if (h > 300) { 
                        // Nieve/Hielo en las puntas súper altas
                        r = 200; g = 210; b = 220;
                    }
                }
                
                // Aplicar luz direccional para simular relieve 3D en el minimapa 2D
                r *= light;
                g *= light;
                b *= light;
                
                // Dibujar el pixel en la imagen de datos
                imgData.data[idx] = Math.min(255, r);
                imgData.data[idx+1] = Math.min(255, g);
                imgData.data[idx+2] = Math.min(255, b);
                imgData.data[idx+3] = 255; // Alpha
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
            // Distribuir estrellas en todo el domo superior, hasta el horizonte exacto
            const r = 2900; 
            const theta = 2 * Math.PI * Math.random();
            const phi = Math.acos(Math.random()); // phi va de 0 (zenith) a PI/2 (horizonte), cubriendo TODO el cielo
            
            posArray[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            posArray[i * 3 + 1] = r * Math.cos(phi) + 100; // Subir las estrellas muy por encima de las montañas para que no se vean en el piso
            posArray[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

            // Estrellas de colores (azuladas, blancas, naranjas, púrpuras)
            const randColor = Math.random();
            if(randColor > 0.8) c.setHex(0x99ccff);
            else if(randColor > 0.6) c.setHex(0xffcc99);
            else if(randColor > 0.4) c.setHex(0xccaaff);
            else c.setHex(0xffffff);

            colorsArray[i * 3] = c.r;
            colorsArray[i * 3 + 1] = c.g;
            colorsArray[i * 3 + 2] = c.b;
        }

        starGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        starGeo.setAttribute('color', new THREE.BufferAttribute(colorsArray, 3));
        
        const starMat = new THREE.PointsMaterial({
            size: 5.0,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            sizeAttenuation: true,
            blending: THREE.AdditiveBlending
        });

        this.starsMesh = new THREE.Points(starGeo, starMat);
        this.scene.add(this.starsMesh);
    }
}
