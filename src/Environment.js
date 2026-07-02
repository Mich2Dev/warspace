import * as THREE from 'three';
/**
 * Capa L1 — Terreno visual (altura, chunks, minimapa bake).
 * Alimenta L2 vía getHeightAt() / getPartitionWallHeight().
 * @see docs/LAYERS.md — no duplicar reglas de bloqueo aquí (van en terrainRules.js).
 */
import { CONFIG } from '../config.js';
import { isTerrainBlocking as checkTerrainBlocking } from './terrainRules.js';
import planet01 from '../data/planet_01.json';
import { getHub } from './hubSafe.js';
import {
    isNavCorridorAt,
    isChunkInsideWorld,
    WORLD_MAP,
    NAV_CORRIDOR_WIDTH,
} from './worldNav.js';
import {
    resolveStreamForward,
    iterStreamCells,
    streamChunkPriority,
    shouldUnloadChunk,
    shouldStreamChunk,
    shouldDecorChunk,
    detailForStreamCell,
} from './chunkStreaming.js';

export class Environment {
    constructor(scene, loadingManager) {
        this.scene = scene;
        this.loadingManager = loadingManager;
        this.initLighting();
        this.initSkyAndSun();
        this.initTerrain();
        this.initStars();
        this.initDustParticles();

        this._ascendPerfMode = false;
        this._highAltMask = 0;
        this._shellVisBucket = -1;
        this._shellBlendKey = '';
        this._blendHorizon = new THREE.Color();
        this._blendZenith = new THREE.Color();
        this._blendMid = new THREE.Color();
    }

    initLighting() {
        const ambientLight = new THREE.AmbientLight(0xfff0e0, CONFIG.GRAPHICS.AMBIENT_INTENSITY);
        this.scene.add(ambientLight);

        this.hemiLight = new THREE.HemisphereLight(0xb8cce0, 0x4a3828, 0.48);
        this.scene.add(this.hemiLight);

        this.sunLight = new THREE.DirectionalLight(0xffe8c8, CONFIG.GRAPHICS.SUN_INTENSITY);
        this.sunLight.position.set(1000, 1500, -2000);
        this.sunLight.castShadow = !!CONFIG.GRAPHICS.ENABLE_SHADOWS;
        
        this.sunLight.shadow.camera.left = -500;
        this.sunLight.shadow.camera.right = 500;
        this.sunLight.shadow.camera.top = 500;
        this.sunLight.shadow.camera.bottom = -500;
        this.sunLight.shadow.camera.near = 100;
        this.sunLight.shadow.camera.far = 3000;
        this.sunLight.shadow.mapSize.width = 1024;
        this.sunLight.shadow.mapSize.height = 1024;

        this.sunLight.position.set(820, 1180, 640);
        
        this.scene.add(this.sunLight);
        this.scene.add(this.sunLight.target);
    }

    initSkyAndSun() {
        // Cielo diurno — horizonte pálido azulado (no el mismo tono que el suelo)
        this._skyTopDefault = 0x4a7ab5;
        this._skyMidDefault = 0x78a8d0;
        this._skyHorizonDefault = 0xe2ecf4;
        this._surfaceFogColor = 0x0a0520;
        this._surfaceBgColor = 0x050210;

        const skyGeo = new THREE.SphereGeometry(22000, 32, 16);
        const skyMat = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            depthTest: true,
            fog: false,
            uniforms: {
                topColor:     { value: new THREE.Color(this._skyTopDefault) },
                midColor:     { value: new THREE.Color(this._skyMidDefault) },
                horizonColor: { value: new THREE.Color(this._skyHorizonDefault) },
                aerialT:      { value: 0.0 },
                offset:       { value: 0.02 },
                exponent:     { value: 0.85 },
                time:         { value: 0.0 }
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    gl_Position.z = gl_Position.w; // Always render at background depth
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 midColor;
                uniform vec3 horizonColor;
                uniform float aerialT;
                uniform float time;
                varying vec3 vWorldPosition;

                float hash(vec3 p) {
                    p = fract(p * 0.3183099 + 0.1);
                    p *= 17.0;
                    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
                }

                void main() {
                    vec3 dir = normalize(vWorldPosition);
                    vec3 sunDir = normalize(vec3(820.0, 1180.0, 640.0));
                    
                    if (dir.y < -0.05) discard;
                    
                    float gradient = pow(max(0.0, dir.y), 0.55);
                    vec3 finalColor = mix(horizonColor, midColor, smoothstep(0.0, 0.45, gradient));
                    finalColor = mix(finalColor, topColor, smoothstep(0.35, 1.0, gradient));
                    
                    float starHash = hash(dir * 280.0);
                    float star = smoothstep(0.988, 1.0, starHash);
                    float twinkle = sin(time * 1.2 + hash(dir * 90.0) * 16.0) * 0.5 + 0.5;
                    float starVis = smoothstep(0.42, 0.88, aerialT);
                    finalColor += vec3(0.95, 0.97, 1.0) * star * twinkle * 0.9 * starVis;
                    
                    float sunDist = max(0.0, dot(dir, sunDir));
                    float sunDisk = smoothstep(0.9992, 1.0, sunDist);
                    vec3 sunColor = vec3(1.0, 0.92, 0.72);
                    finalColor += sunColor * sunDisk * 2.8;
                    finalColor += vec3(1.0, 0.75, 0.45) * pow(sunDist, 48.0) * 0.35;
                    finalColor += vec3(0.55, 0.72, 0.95) * pow(sunDist, 6.0) * 0.18;
                    
                    // Bruma atmosférica en el horizonte — separa cielo de tierra (dispersión real)
                    float horizonT = 1.0 - smoothstep(0.0, 0.22, dir.y);
                    vec3 atmoHaze = mix(horizonColor, vec3(0.94, 0.96, 0.99), 0.55);
                    finalColor = mix(finalColor, atmoHaze, horizonT * 0.62);
                    
                    finalColor = mix(finalColor, horizonColor, aerialT * 0.28);
                    finalColor = finalColor / (finalColor + vec3(0.15));
                    finalColor = pow(finalColor, vec3(1.0 / 1.08));
                    
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `
        });
        this.skyDome = new THREE.Mesh(skyGeo, skyMat);
        this.skyDome.frustumCulled = false;
        this.skyDome.renderOrder = -100;
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

        // Capa de bruma baja — color acoplado a la niebla (no al terreno)
        const hazeGeo = new THREE.PlaneGeometry(28000, 28000);
        const hazeMat = new THREE.MeshBasicMaterial({
            color: 0xb8ccd8,
            transparent: true,
            opacity: 0.2,
            blending: THREE.NormalBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        this.haze = new THREE.Mesh(hazeGeo, hazeMat);
        this.haze.rotation.x = Math.PI / 2;
        this.haze.position.y = 140;
        this.haze.renderOrder = 2; // Asegura que la atmósfera siempre se dibuje SOBRE el agua
        this.scene.add(this.haze);

        const veilGeo = new THREE.SphereGeometry(16000, 12, 6);
        this._transitionVeil = new THREE.Mesh(veilGeo, new THREE.MeshBasicMaterial({
            color: 0xd0e4f4,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            fog: false,
            side: THREE.BackSide,
        }));
        this._transitionVeil.frustumCulled = false;
        this._transitionVeil.renderOrder = 80;
        this._transitionVeil.visible = false;
        this._stratosphereSpaceView = false;
        /** Vista esfera 3D activa — mapa plano totalmente bloqueado. */
        this._planetSphereActive = false;
        this.scene.add(this._transitionVeil);
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
            color: 0xffcc44, // Polvo estelar / esporas doradas
            size: 2.2,   // Más visibles
            transparent: true,
            opacity: 0.6, // Más opaco y brillante
            sizeAttenuation: true,   
            blending: THREE.AdditiveBlending, // Brillo mágico
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
        this.CHUNK_RES = 48;
        this.CHUNK_RES_MID = 24;
        this.CHUNK_RES_LOW = 10;
        this.CHUNK_RADIUS_FULL = 2;
        this.CHUNK_RADIUS_MID = 3;
        this.CHUNK_RADIUS_LOW = 3;
        this._streamSearchRadius = 4;
        this._streamForward = { fx: 0, fz: -1, speed: 0, source: 'default' };
        this._lastStreamPos = new THREE.Vector3();
        this._buildBudgetMs = 7;
        this._ensureDecorTimer = 0;
        this._maxQueueSize = 16;
        this.HORIZON_FAR_START = (this.CHUNK_RADIUS_LOW + 1.5) * this.CHUNK_SIZE;
        this.loadedChunks = new Map(); // clave "cx,cz" -> mesh
        this.chunkQueue = []; // Cola de chunks para generar uno por frame y evitar lag
        this.queuedChunkKeys = new Set(); // lookup O(1) para evitar .some() costoso
        this._lastChunkCellX = null;
        this._lastChunkCellZ = null;
        this._gfxDust = true;
        this._horizonInterval = 3.5;
        this._buildPerFrameMax = 1;
        this._enableGrass = true;
        this._carpetPoints = CONFIG.VISUALS?.GRASS?.carpetPoints ?? 28000;
        this._maxGrassPerChunk = CONFIG.VISUALS?.GRASS?.maxPerChunk ?? 18000;
        this._combatLoadLevel = 'light';
        this._decorHidden = false;
        this._combatBuildSkip = 0;
        this._wasCombatBusy = false;
        this._wasFastTravel = false;
        this._decorateBurstUntil = 0;
        this._grassJobs = [];
        this._grassJobBudgetMs = 6;

        const loader = new THREE.TextureLoader(this.loadingManager);
        this.terrainDiffuse = loader.load('/textures/rock_diffuse.jpg');
        this.terrainNormal = loader.load('/textures/rock_normal.jpg');
        this.terrainRough = loader.load('/textures/rock_rough.jpg');
        [this.terrainDiffuse, this.terrainNormal, this.terrainRough].forEach((tex) => {
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(18, 18);
        });
        this.terrainDiffuse.colorSpace = THREE.SRGBColorSpace;

        const rockDiffuse = this.terrainDiffuse.clone();
        rockDiffuse.repeat.set(5, 5);
        const rockNormal = this.terrainNormal.clone();
        rockNormal.repeat.set(5, 5);
        const rockRough = this.terrainRough.clone();
        rockRough.repeat.set(5, 5);

        this.terrainMat = new THREE.MeshStandardMaterial({
            vertexColors: true,
            map: this.terrainDiffuse,
            normalMap: this.terrainNormal,
            roughnessMap: this.terrainRough,
            normalScale: new THREE.Vector2(1.5, 1.5),
            metalness: 0.04,
            roughness: 0.92,
            flatShading: false,
        });

        const rockGeo = new THREE.DodecahedronGeometry(1, 3);
        rockGeo.translate(0, 0.5, 0);
        const rockMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: rockDiffuse,
            normalMap: rockNormal,
            roughnessMap: rockRough,
            normalScale: new THREE.Vector2(1.6, 1.6),
            roughness: 0.88,
            metalness: 0.06,
            flatShading: false,
        });
        this.rockGeo = rockGeo;
        this.rockMat = rockMat;
        
        const pebbleGeo = new THREE.IcosahedronGeometry(1, 2);
        pebbleGeo.translate(0, 0.35, 0);
        const pebbleMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: rockDiffuse,
            normalMap: rockNormal,
            roughnessMap: rockRough,
            normalScale: new THREE.Vector2(1.2, 1.2),
            roughness: 0.94,
            metalness: 0.04,
            flatShading: false,
        });
        this.pebbleGeo = pebbleGeo;
        this.pebbleMat = pebbleMat;
        
        // Formaciones minerales en llanuras (sin neón synthwave)
        const crystalGeo = new THREE.CylinderGeometry(0.15, 0.55, 2.2, 5, 1);
        crystalGeo.translate(0, 1.1, 0);
        const crystalMat = new THREE.MeshStandardMaterial({
            color: 0x7a9a88,
            emissive: 0x1a2820,
            emissiveIntensity: 0.12,
            roughness: 0.48,
            metalness: 0.22,
            flatShading: false,
        });
        this.crystalGeo = crystalGeo;
        this.crystalMat = crystalMat;





        // Shader para convertir el terreno en agua hiperrealista sin mallas superpuestas
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

                // 2D simplex noise + fbm: elimina artefactos cuadriculados del value noise
                vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

                float snoise(vec2 v) {
                    const vec4 C = vec4(
                        0.211324865405187,  // (3.0-sqrt(3.0))/6.0
                        0.366025403784439,  // 0.5*(sqrt(3.0)-1.0)
                        -0.577350269189626, // -1.0 + 2.0 * C.x
                        0.024390243902439   // 1.0 / 41.0
                    );

                    vec2 i = floor(v + dot(v, C.yy));
                    vec2 x0 = v - i + dot(i, C.xx);
                    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
                    vec4 x12 = x0.xyxy + C.xxzz;
                    x12.xy -= i1;

                    i = mod289(i);
                    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));

                    vec3 m = max(0.5 - vec3(
                        dot(x0, x0),
                        dot(x12.xy, x12.xy),
                        dot(x12.zw, x12.zw)
                    ), 0.0);
                    m = m * m;
                    m = m * m;

                    vec3 x = 2.0 * fract(p * C.www) - 1.0;
                    vec3 h = abs(x) - 0.5;
                    vec3 ox = floor(x + 0.5);
                    vec3 a0 = x - ox;

                    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);

                    vec3 g;
                    g.x = a0.x * x0.x + h.x * x0.y;
                    g.y = a0.y * x12.x + h.y * x12.y;
                    g.z = a0.z * x12.z + h.z * x12.w;

                    return 130.0 * dot(m, g);
                }

                float fbm2(vec2 p) {
                    float v = 0.0;
                    float a = 0.5;
                    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
                    for (int i = 0; i < 2; i++) {
                        v += a * snoise(p);
                        p = m * p + vec2(21.3, 17.7);
                        a *= 0.5;
                    }
                    return v * 0.5 + 0.5; // map [-1,1] -> [0,1]
                }
                float fastPattern(vec2 p) {
                    // Patrón barato para variar color/turbidez sin FBM pesado
                    float a = sin(dot(p, vec2(0.017, 0.011)));
                    float b = sin(dot(p, vec2(-0.013, 0.019)));
                    return a * 0.3 + b * 0.2 + 0.5;
                }
                float coastWarp(vec2 p) {
                    // Warp barato: evita coste alto de ruido fractal repetido
                    float a = sin(dot(p, vec2(0.0038, 0.0029)));
                    float b = sin(dot(p, vec2(-0.0027, 0.0041)));
                    return a * 0.95 + b * 0.65;
                }
                float saturate1(float v) { return clamp(v, 0.0, 1.0); }
                float biomeHumidity(vec2 p) {
                    // Macro-humedad barata
                    float h1 = fastPattern(p * 0.30 + vec2(19.3, -7.1));
                    float h2 = fastPattern(p * 0.65 + vec2(-31.0, 22.0));
                    return saturate1(h1 * 0.68 + h2 * 0.32);
                }
                float shorelineSediment(vec2 p, float shoreBand) {
                    // Suspensión de sedimento orgánico/mineral cerca de orilla
                    float s = fastPattern(p * 0.90 + vec2(70.1, -14.2));
                    return shoreBand * smoothstep(0.34, 0.84, s);
                }
                float shorelineVegetation(vec2 p, float shoreBand) {
                    // Densidad vegetal costera (algas/microflora)
                    float v = fastPattern(p * 0.55 + vec2(-9.7, 41.2));
                    return shoreBand * smoothstep(0.50, 0.86, v);
                }
                float waterHeightField(vec2 p, float t) {
                    // Oleaje coherente: pocas direcciones, amplitud suave, velocidad natural
                    vec2 d1 = normalize(vec2(0.93, 0.37));
                    vec2 d2 = normalize(vec2(-0.41, 0.91));
                    vec2 d3 = normalize(vec2(0.18, -0.98));
                    float w1 = sin(dot(p, d1) * 0.018 + t * 1.12);
                    float w2 = sin(dot(p, d2) * 0.014 - t * 0.92);
                    float w3 = sin(dot(p, d3) * 0.024 + t * 1.36);
                    float envelope = 0.82 + 0.18 * sin(dot(p, vec2(0.0036, 0.0028)) + t * 0.24);
                    return (w1 * 0.22 + w2 * 0.15 + w3 * 0.10) * envelope;
                }
            ` + shader.fragmentShader;

            // 1. Propiedades físicas del agua (menos "espejo perfecto", más natural)
            shader.fragmentShader = shader.fragmentShader.replace(
                `#include <roughnessmap_fragment>`,
                `
                #include <roughnessmap_fragment>
                // Transición costa -> agua profunda (más amplia para sentirse "cuerpo de agua")
                float shoreY = vWorldTerrainPos.y + coastWarp(vWorldTerrainPos.xz);
                float waterBlend = 1.0 - smoothstep(-22.0, -18.0, shoreY);
                float waterLevel = -18.6;
                float opticalDepth = clamp((waterLevel - shoreY) / 10.0, 0.0, 1.0);
                float depthFactor = pow(opticalDepth, 0.65);
                // Rugosidad dinámica: más lisa en profundo, más movida en orilla
                vec2 wp = vWorldTerrainPos.xz * 0.014;
                float smallRipples = sin(dot(wp, vec2(1.0, 0.37)) + time * 1.1) * 0.5 + 0.5;
                float roughWater = mix(0.18, 0.135, depthFactor) + smallRipples * 0.003;
                roughnessFactor = mix(roughnessFactor, roughWater, waterBlend);
                `
            );
            
            shader.fragmentShader = shader.fragmentShader.replace(
                `#include <metalnessmap_fragment>`,
                `
                #include <metalnessmap_fragment>
                float shoreYM = vWorldTerrainPos.y + coastWarp(vWorldTerrainPos.xz);
                float waterBlendM = 1.0 - smoothstep(-22.0, -18.0, shoreYM);
                float waterLevelM = -18.6;
                float depthFactorM = pow(clamp((waterLevelM - shoreYM) / 10.0, 0.0, 1.0), 0.65);
                // Metalness bajo pero no cero: permite brillo natural suave
                metalnessFactor = mix(metalnessFactor, mix(0.01, 0.035, depthFactorM), waterBlendM);
                `
            );

            // 1.5. Color de agua por profundidad + transición suave con arena
            shader.fragmentShader = shader.fragmentShader.replace(
                `#include <color_fragment>`,
                `
                #include <color_fragment>
                float shoreYC = vWorldTerrainPos.y + coastWarp(vWorldTerrainPos.xz);
                float waterBlendC = 1.0 - smoothstep(-22.0, -18.0, shoreYC);
                float waterLevelC = -18.6;
                float depthFactorC = pow(clamp((waterLevelC - shoreYC) / 9.0, 0.0, 1.0), 0.62);
                float viewDistC = distance(cameraPosition.xz, vWorldTerrainPos.xz);
                float farFactorC = smoothstep(1300.0, 6200.0, viewDistC);
                vec3 viewDirC = normalize(cameraPosition - vWorldTerrainPos);
                float grazingC = pow(1.0 - abs(dot(viewDirC, vec3(0.0, 1.0, 0.0))), 1.6);
                // Lejos: reducir lectura de "pozo" para que se perciba lámina superficial
                depthFactorC = mix(depthFactorC, depthFactorC * 0.45, farFactorC);

                // Modelo de color: profundidad + sedimento + materia orgánica + humedad del entorno
                vec3 shallowColor = vec3(0.06, 0.36, 0.44); // menos cian "pintura de piscina"
                vec3 deepColor = vec3(0.02, 0.14, 0.24);    // profundo más acuático natural
                vec3 oceanColor = mix(shallowColor, deepColor, depthFactorC);
                
                // Cobertura de agua: reducir visibilidad del fondo en rasante/distancia/profundidad
                float waterBody = smoothstep(0.12, 0.88, waterBlendC);
                float shoreFeather = smoothstep(0.05, 0.26, depthFactorC); // orilla más suave, menos borde de "hueco"
                float waterBodyFar = clamp((waterBody + farFactorC * 0.06 + grazingC * 0.10) * shoreFeather, 0.0, 1.0);
                float shoreBandC = 1.0 - smoothstep(-20.1, -18.1, shoreYC);
                float humidityC = biomeHumidity(vWorldTerrainPos.xz);
                float sedimentC = shorelineSediment(vWorldTerrainPos.xz, shoreBandC);
                float vegetationC = shorelineVegetation(vWorldTerrainPos.xz, shoreBandC);
                vec3 sedimentTint = vec3(0.34, 0.45, 0.38);
                vec3 organicTint = vec3(0.08, 0.30, 0.22);
                oceanColor = mix(oceanColor, sedimentTint, sedimentC * 0.14);
                oceanColor = mix(oceanColor, organicTint, vegetationC * 0.12 + humidityC * 0.05);
                vec3 farWaterColor = vec3(0.06, 0.34, 0.45);
                oceanColor = mix(oceanColor, farWaterColor, farFactorC * 0.16);
                float turbidityC = saturate1(sedimentC * 0.7 + vegetationC * 0.45 + humidityC * 0.2);
                float opticalDepthC = clamp((waterLevelC - shoreYC) / 7.2, 0.0, 1.0);
                float bottomVisibility = (1.0 - opticalDepthC * mix(0.70, 0.92, turbidityC)) * (1.0 - grazingC * 0.55) * (1.0 - farFactorC * 0.35);
                float waterCover = clamp(max(waterBodyFar, (1.0 - bottomVisibility) * 0.75), 0.0, 1.0);
                
                // --- DETALLE REALISTA DEL TERRENO (FUERA DEL AGUA) ---
                // --- DETALLE ESTILIZADO DEL TERRENO (FUERA DEL AGUA) ---
                if (waterCover < 1.0) {
                    vec3 terrainColor = diffuseColor.rgb;
                    float n1 = fbm2(vWorldTerrainPos.xz * 0.08);
                    float n2 = fbm2(vWorldTerrainPos.xz * 0.22);
                    terrainColor *= mix(0.88, 1.10, n1 * 0.55 + n2 * 0.45);
                    diffuseColor.rgb = mix(terrainColor, oceanColor, waterCover);
                } else {
                    diffuseColor.rgb = oceanColor;
                }

                
                // Absorción más suave para mantener lectura de "superficie" (no de pozo)
                float absorption = mix(1.0, 0.93 - turbidityC * 0.03, depthFactorC) * waterBody + (1.0 - waterBody);
                diffuseColor.rgb *= absorption;

                // Perspectiva atmosférica en tierra — lejos se funde con la bruma (no con el cielo de golpe)
                float landAerial = smoothstep(1800.0, 9000.0, viewDistC);
                vec3 aerialTint = vec3(0.72, 0.80, 0.86);
                diffuseColor.rgb = mix(diffuseColor.rgb, aerialTint, landAerial * (1.0 - waterCover) * 0.78);
                `
            );

            // 2. Normales del agua: mezcla de olas largas + capilaridad fina
            shader.fragmentShader = shader.fragmentShader.replace(
                `#include <normal_fragment_maps>`,
                `
                #include <normal_fragment_maps>
                
                float shoreYN = vWorldTerrainPos.y + coastWarp(vWorldTerrainPos.xz);
                float waterMaskN = 1.0 - smoothstep(-19.2, -18.2, shoreYN);
                if (waterMaskN > 0.001) {
                    // Campo de altura orgánico -> normal derivada (evita bandas lineales)
                    vec2 p = vWorldTerrainPos.xz;
                    float h0 = waterHeightField(p, time);

                    // Micro-olas de orilla
                    float shoreBandN = waterMaskN;
                    float shoreA = sin(dot(p, vec2(0.14, 0.06)) - time * 1.25);
                    float shoreB = sin(dot(p, vec2(-0.08, 0.13)) + time * 1.05);
                    h0 += (shoreA + shoreB) * 0.04 * shoreBandN;

                    // Respuesta local de la nave en el campo de altura
                    vec2 toPlayerN = p - playerPos.xz;
                    float dPlayerN = length(toPlayerN);
                    float velMagN = length(playerVel.xz);
                    if (velMagN > 0.5 && dPlayerN < 420.0) {
                        vec2 shipDir = normalize(playerVel.xz + vec2(0.0001));
                        vec2 radial = normalize(toPlayerN + vec2(0.0001));
                        float front = max(0.0, dot(radial, shipDir));
                        float side = abs(dot(radial, vec2(-shipDir.y, shipDir.x)));
                        float behind = max(0.0, dot(radial, -shipDir));

                        float bow = sin(dPlayerN * 0.21 - time * 6.3);
                        float bowMask = smoothstep(360.0, 20.0, dPlayerN) * smoothstep(0.0, 0.78, front);
                        h0 += bow * bowMask * 0.22;

                        float sideWave = sin((dPlayerN + side * 90.0) * 0.18 - time * 5.5);
                        float sideMask = smoothstep(320.0, 30.0, dPlayerN) * smoothstep(0.05, 0.9, side);
                        h0 += sideWave * sideMask * 0.11;

                        float wake = sin(dPlayerN * 0.07 - time * 10.6 + side * 2.2);
                        float wakeMask = smoothstep(620.0, 80.0, dPlayerN) * smoothstep(0.0, 0.82, behind) * min(velMagN * 0.013, 1.2);
                        h0 += wake * wakeMask * 0.16;
                    }

                    float eps = 1.05;
                    float hx = waterHeightField(p + vec2(eps, 0.0), time) - h0;
                    float hz = waterHeightField(p + vec2(0.0, eps), time) - h0;
                    vec3 waterN = normalize(vec3(-hx * 0.92, 1.0, -hz * 0.92));
                    float viewDistN = distance(cameraPosition.xz, vWorldTerrainPos.xz);
                    float farFactorN = smoothstep(1400.0, 6200.0, viewDistN);
                    vec3 viewDirN = normalize(cameraPosition - vWorldTerrainPos);
                    float grazingN = pow(1.0 - abs(dot(viewDirN, vec3(0.0, 1.0, 0.0))), 1.5);
                    // Lejos: mantener ondulación macro para que el agua no se vea "plana azul"
                    float macroX = sin(dot(p * 0.012, vec2(1.0, 0.37)) + time * 0.42);
                    float macroZ = sin(dot(p * 0.012, vec2(-0.42, 0.91)) - time * 0.36);
                    vec3 farSurfaceN = normalize(vec3(macroX * 0.06, 1.0, macroZ * 0.06));
                    waterN = normalize(mix(waterN, farSurfaceN, farFactorN));
                    // Oleaje automático suave (barato): añade vida sin ruido granular
                    float autoA = sin(dot(p * 0.020, vec2(1.0, 0.35)) + time * 1.55);
                    float autoB = sin(dot(p * 0.020, vec2(-0.42, 0.91)) - time * 1.34);
                    vec3 autoN = normalize(vec3(autoA * 0.11, 1.0, autoB * 0.11));
                    float autoMix = (0.34 + shoreBandN * 0.10) * (1.0 - farFactorN * 0.38);
                    waterN = normalize(mix(waterN, autoN, autoMix));
                    // Vista rasante: suavizar normal para evitar tramado/parpadeo lateral
                    vec3 calmSurfaceN = vec3(0.0, 1.0, 0.0);
                    float calmMix = clamp(grazingN * 0.22 + farFactorN * 0.14, 0.0, 0.36);
                    waterN = normalize(mix(waterN, calmSurfaceN, calmMix));
                    // Mezcla gradual para evitar corte duro en bordes de agua
                    normal = normalize(mix(normal, waterN, waterMaskN));
                }
                
                // --- NORMALES SUAVES DEL TERRENO (ESTILIZADO) ---
                if (waterMaskN < 1.0) {
                    float eps = 1.4;
                    float h0 = fbm2(vWorldTerrainPos.xz * 0.05);
                    float hx = fbm2((vWorldTerrainPos.xz + vec2(eps, 0.0)) * 0.05);
                    float hz = fbm2((vWorldTerrainPos.xz + vec2(0.0, eps)) * 0.05);
                    
                    vec3 detailNormal = normalize(vec3((h0 - hx) * 1.8, 1.0, (h0 - hz) * 1.8));
                    
                    float slope = dot(normal, vec3(0.0, 1.0, 0.0));
                    vec3 blendedNormal = mix(detailNormal, normal, smoothstep(0.72, 0.96, slope));
                    
                    normal = normalize(mix(blendedNormal, normal, waterMaskN));
                }
                `
            );
            
            shader.fragmentShader = shader.fragmentShader.replace(
                `#include <dithering_fragment>`,
                `
                #include <dithering_fragment>
                float shoreY2 = vWorldTerrainPos.y + coastWarp(vWorldTerrainPos.xz);
                float waterMask2 = 1.0 - smoothstep(-19.2, -18.2, shoreY2);
                if (waterMask2 > 0.001) {
                    // Fresnel limpio + brillo solar amplio (sin glitter/punteado)
                    vec3 viewDir = normalize(cameraPosition - vWorldTerrainPos);
                    float viewDist = distance(cameraPosition.xz, vWorldTerrainPos.xz);
                    float farFactor = smoothstep(1300.0, 6200.0, viewDist);
                    float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 2.0);
                    vec3 skyColor = vec3(0.28, 0.62, 0.95);
                    gl_FragColor.rgb += skyColor * fresnel * (0.58 + farFactor * 0.10) * waterMask2;
                    float horizon = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 1.35);
                    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.10, 0.38, 0.50), horizon * farFactor * 0.07 * waterMask2);
                    float longWaveShade = sin(dot(vWorldTerrainPos.xz * 0.010, vec2(0.94, 0.34)) + time * 0.55);
                    float crossWaveShade = sin(dot(vWorldTerrainPos.xz * 0.013, vec2(-0.36, 0.93)) - time * 0.49);
                    float waveShade = (longWaveShade * 0.6 + crossWaveShade * 0.4) * 0.03;
                    gl_FragColor.rgb *= 1.0 + waveShade * waterMask2;

                    // Brillo solar controlado (ancho y cálido, sin glitter puntual)
                    vec3 sunDir = normalize(vec3(0.36, 0.72, 0.25));
                    vec3 halfVec = normalize(viewDir + sunDir);
                    float ndh = max(dot(normal, halfVec), 0.0);
                    float broadSpec = pow(ndh, 19.0);
                    float glintMask = smoothstep(0.34, 0.78, fastPattern(vWorldTerrainPos.xz * 0.8 + vec2(time * 1.0, -time * 0.9)));
                    float waveGlint = sin(dot(vWorldTerrainPos.xz * 0.030, vec2(0.95, 0.31)) + time * 3.1) * 0.5 + 0.5;
                    float specAmount = broadSpec * (0.23 + glintMask * 0.14 + waveGlint * 0.10) * (1.0 - farFactor * 0.28);
                    gl_FragColor.rgb += vec3(1.0, 0.84, 0.58) * specAmount * waterMask2;

                    // Sin crestas globales: evitamos cualquier tramado claro repetitivo

                    // Espuma de costa suave por capas (sin granulado)
                    float shoreBand = 1.0 - smoothstep(-19.6, -17.8, shoreY2);
                    vec2 fp = vWorldTerrainPos.xz * 0.11;
                    float foamPattern = fastPattern(fp * 1.2 + vec2(time * 0.34, -time * 0.28));
                    float foamMix = smoothstep(0.46, 0.78, foamPattern);
                    float shoreFoam = shoreBand * foamMix;
                    gl_FragColor.rgb += vec3(0.80, 0.92, 0.97) * shoreFoam * mix(0.08, 0.12, farFactor) * waterMask2;

                    // Línea de ola mínima en orilla (sutil y orgánica, no lineal)
                    float shorePulse = fastPattern(vWorldTerrainPos.xz * 0.7 + vec2(time * 0.30, -time * 0.24));
                    float shoreLine = shoreBand * smoothstep(0.56, 0.82, shorePulse);
                    gl_FragColor.rgb += vec3(0.64, 0.84, 0.94) * shoreLine * 0.05 * waterMask2;

                    // Estela de la nave (detrás) + halo de perturbación alrededor
                    vec3 toPlayer = vWorldTerrainPos - playerPos;
                    float dist = length(toPlayer.xz);
                    float velMag = length(playerVel.xz);
                    
                    if (velMag > 1.0 && dist < 650.0) {
                        vec2 dir = normalize(playerVel.xz + vec2(0.0001)); 
                        vec2 toP = normalize(toPlayer.xz);
                        float behind = dot(toP, -dir); 
                        
                        if (behind > 0.0) {
                            float wakeWidth = abs(dot(toP, vec2(-dir.y, dir.x))); 
                            float wave = sin(dist * 0.07 - time * 11.0 + wakeWidth * 2.3);
                            float fade = smoothstep(640.0, 90.0, dist) * smoothstep(0.0, 0.75, behind) * min(velMag * 0.013, 1.2);
                            
                            // Espuma/blanco de estela
                            gl_FragColor.rgb += vec3(0.66, 0.88, 0.95) * max(0.0, wave) * fade * 0.70 * waterMask2;
                        }

                        // Perturbación circular cercana (cuando pasas sobre el agua)
                        float nearRing = sin(dist * 0.30 - time * 7.8);
                        float nearMask = smoothstep(260.0, 30.0, dist) * min(velMag * 0.014, 1.25);
                        gl_FragColor.rgb += vec3(0.52, 0.78, 0.90) * max(0.0, nearRing) * nearMask * 0.16 * waterMask2;
                    }

                    // Suaviza cualquier resto de micro-contraste de la textura base
                    float depthFade2 = pow(clamp((-shoreY2 - 18.6) / 9.0, 0.0, 1.0), 0.72);
                    gl_FragColor.rgb *= mix(1.0, 0.90, depthFade2 * waterMask2); // centro ligeramente más profundo
                    gl_FragColor.rgb = mix(gl_FragColor.rgb, oceanColor, (0.11 + farFactor * 0.07) * waterMask2);
                }
                `
            );
            this.terrainMat.userData.shader = shader;
        };
        
        // La malla del agua plana causaba "clipping" (bordes dentados aserrados) al chocar con
        // el terreno low-poly. La eliminamos por completo.
        // Ahora el océano es el propio terreno gracias al Fragment Shader superior.



        // Chunks alrededor del hub (spawn real) — sin bloquear el hilo principal
        this._initGrassResources();
        this._initHorizonTerrain();
        const hub = getHub();
        this._bootStreaming = true;
        this._preloadInitialChunks(hub.x, hub.z, { boot: true });

        // Minimapa en segundo plano (evita ~440k getHeightAt síncronos al arrancar)
        this.scheduleMinimapBake();
    }

    setSessionActive(active) {
        this._bootStreaming = !active;
        if (active) {
            this._decorateBurstUntil = performance.now() + 2000;
        }
    }

    /** Loop ligero mientras el jugador elige nick / espera carga — sin simular combate. */
    updateBootPreview(playerPosition) {
        if (this.terrainMat?.userData?.shader) {
            this.terrainMat.userData.shader.uniforms.time.value += 0.008;
        }

        for (let n = 0; n < 1 && this.chunkQueue.length > 0; n++) {
            const chunk = this._pickNextChunk(playerPosition, false);
            if (!chunk) break;
            this.queuedChunkKeys.delete(`${this._chunkKey(chunk.cx, chunk.cz)}:${chunk.detailLevel}`);
            this._buildChunk(chunk.cx, chunk.cz, chunk.detailLevel || 'mid');
        }
        this._processGrassJobs(8);

        if (this.skyDome) {
            this.skyDome.position.copy(playerPosition);
            if (this.skyDome.material?.uniforms?.time) {
                this.skyDome.material.uniforms.time.value += 0.006;
            }
        }
        if (this.starsMesh) this.starsMesh.position.copy(playerPosition);
    }

    _organicBiomeAt(x, z) {
        let n = Math.sin(x * 0.004 + Math.cos(z * 0.005)) * 1.0;
        n += Math.sin(z * 0.011 - Math.cos(x * 0.013)) * 0.5;
        n += Math.sin(x * 0.025 + z * 0.02) * 0.25;
        return n * 0.5;
    }

    _paintTerrainColor(wx, wz, color) {
        const h = this.getHeightAt(wx, wz);

        if (h < -22) {
            color.setHex(0x0a2840);
        } else if (h < 18) {
            color.setHex(0xe8c396);
        } else if (h < 55) {
            color.setHex(0xd49a6a);
        } else if (h < 120) {
            color.setHex(0x8faa58);
        } else if (h < 200) {
            color.setHex(0x8a5b4c);
        } else if (h > 300) {
            color.setHex(0x3a3238);
        } else {
            const band = Math.floor(h / 28) % 3;
            if (band === 0) color.setHex(0x6a5048);
            else if (band === 1) color.setHex(0x7a6050);
            else color.setHex(0x5a4840);
        }

        const macro = this._organicBiomeAt(wx * 0.35, wz * 0.35);
        const micro = this._organicBiomeAt(wx * 1.8, wz * 1.8);
        if (h > -18 && h < 220) {
            color.lerp(new THREE.Color(0xc9925a), Math.max(0, macro) * 0.18);
            color.lerp(new THREE.Color(0x4a8a42), Math.max(0, -macro) * 0.28);
            color.multiplyScalar(0.96 + micro * 0.06);
        }

        return { h };
    }

    _terrainColorAtHeight(h, colorOut) {
        if (h < -22) colorOut.setHex(0x0a1c3a);
        else if (h < 20) colorOut.setHex(0xe8c396);
        else if (h < 70) colorOut.setHex(0xd49a6a);
        else if (h < 150) colorOut.setHex(0x8a5b4c);
        else if (h > 320) colorOut.setHex(0x18141c);
        else if (Math.floor(h / 30) % 3 === 0) colorOut.setHex(0x2c202a);
        else if (Math.floor(h / 30) % 3 === 1) colorOut.setHex(0x453440);
        else colorOut.setHex(0x3d2c38);
    }

    isCorridorAt(x, z) {
        return isNavCorridorAt(x, z, NAV_CORRIDOR_WIDTH);
    }

    /** API pública para colisión — ver terrainRules.js (no tocar al cambiar visuals). */
    getPartitionWallHeight(x, z) {
        return this._getPartitionWallHeight(x, z);
    }

    isTerrainBlocking(fromX, fromZ, toX, toZ, flightY) {
        return checkTerrainBlocking(this, fromX, fromZ, toX, toZ, flightY);
    }

    _smoothstep(e0, e1, v) {
        const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0)));
        return t * t * (3 - 2 * t);
    }

    /** Ruido 2D suave (sin picos triangulares tipo abs(a*b)). */
    _organicNoise2D(x, z, scale) {
        const sx = x * scale;
        const sz = z * scale;
        let n = Math.sin(sx + Math.cos(sz * 1.31)) * 0.55;
        n += Math.sin(sz * 1.73 - Math.cos(sx * 0.87)) * 0.30;
        n += Math.sin((sx + sz) * 2.07 + Math.cos(sx - sz)) * 0.15;
        return n;
    }

    /** Cordilleras redondeadas con domain-warp (formas orgánicas). */
    _mountainHeightAt(x, z) {
        const warpX = x + this._organicNoise2D(x, z, 0.00028) * 1400;
        const warpZ = z + this._organicNoise2D(x + 700, z - 400, 0.00026) * 1400;

        let ridge = this._organicNoise2D(warpX, warpZ, 0.00036);
        ridge += 0.52 * this._organicNoise2D(warpX, warpZ, 0.00072);
        ridge += 0.26 * this._organicNoise2D(warpX, warpZ, 0.00144);
        ridge /= 1.78;

        const ridgeMask = this._smoothstep(-0.18, 0.48, ridge);
        let h = ridgeMask * ridgeMask * (0.32 + Math.max(0, ridge) * 0.68) * 480;

        const detail = this._organicNoise2D(x, z, 0.0018) * 14
            + this._organicNoise2D(x, z, 0.0045) * 6
            + this._organicNoise2D(x, z, 0.009) * 2.5;
        h += detail * Math.min(1, h / 90);

        return Math.max(0, h);
    }

    _nearPartitionGate(x, z) {
        const angle = Math.atan2(z, x);
        const gates = [
            0,
            Math.PI,
            Math.atan2(CONFIG.ZONES.ZONA1.z, CONFIG.ZONES.ZONA1.x),
            Math.atan2(CONFIG.ZONES.ZONA2.z, CONFIG.ZONES.ZONA2.x),
            Math.atan2(CONFIG.ZONES.ZONA3.z, CONFIG.ZONES.ZONA3.x),
            Math.atan2(getHub().z ?? 4000, getHub().x ?? 0),
            Math.PI / 2,
            -Math.PI / 2,
        ];
        for (const g of gates) {
            let diff = Math.abs(angle - g);
            if (diff > Math.PI) diff = Math.PI * 2 - diff;
            if (diff < 0.88) return true;
        }
        return false;
    }

    _getPartitionWallHeight(x, z) {
        // Solo precipicio en la frontera del sector — sin anillos divisorios artificiales.
        const dist = Math.hypot(x, z);
        const outerR = WORLD_MAP.playableRadius;
        const edgeBand = 1100;
        if (dist <= outerR - edgeBand) return 0;

        const t = Math.min(1, Math.max(0, (dist - (outerR - edgeBand)) / edgeBand));
        return t * t * (3 - 2 * t) * 220;
    }

    _grassPerfMul() {
        if (this._perfTier === 'critical') return 0.45;
        if (this._perfTier === 'economy') return 0.65;
        if (this._perfTier === 'balanced') return 0.82;
        return 1;
    }

    _getGrassBudget(detailLevel = 'full') {
        const cfg = CONFIG.VISUALS?.GRASS ?? {};
        const tierMul = this._grassPerfMul();
        const levelMul = detailLevel === 'full' ? 1
            : detailLevel === 'mid' ? 0.92
                : detailLevel === 'low' ? 0.6
                    : 0;
        const baseCarpet = this._carpetPoints ?? cfg.carpetPoints ?? 24000;
        const baseMax = this._maxGrassPerChunk ?? cfg.maxPerChunk ?? 14000;
        return {
            samples: Math.round(baseCarpet * tierMul * levelMul),
            maxInstances: Math.round(baseMax * tierMul * levelMul),
            skipQueue: this._perfTier === 'critical' && this._combatLoadLevel === 'heavy',
        };
    }

    _seededRng(seed) {
        let s = seed | 0;
        return () => {
            s = (s + 0x6D2B79F5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    _cancelGrassJob(key) {
        if (!this._grassJobs?.length) return;
        this._grassJobs = this._grassJobs.filter((j) => j.key !== key);
    }

    _queueGrassJob(mesh, cx, cz, detailLevel, centerX, centerZ, S) {
        const pcx = this._streamPlayerCx ?? cx;
        const pcz = this._streamPlayerCz ?? cz;
        const dx = cx - pcx;
        const dz = cz - pcz;
        const forward = this._streamForward ?? { fx: 0, fz: -1 };
        if (!shouldDecorChunk(dx, dz, forward, detailLevel)) {
            mesh.userData.grassReady = true;
            return;
        }

        const budget = this._getGrassBudget(detailLevel);
        if (budget.samples <= 0 || budget.skipQueue) return;
        const key = this._chunkKey(cx, cz);
        this._cancelGrassJob(key);
        this._grassJobs.push({
            key,
            mesh,
            detailLevel,
            centerX,
            centerZ,
            S,
            sampleIdx: 0,
            sampleTotal: budget.samples,
            maxInstances: budget.maxInstances,
            grassPositions: [],
            mossPositions: [],
            rng: this._seededRng(cx * 73856093 ^ cz * 19349663),
            heightCache: this._makeHeightCache(),
        });
        if (this._grassJobs.length > 10) {
            this._grassJobs.splice(0, this._grassJobs.length - 10);
        }
    }

    _fillGrassSamples(job, from, to) {
        const { centerX, centerZ, S, rng, heightCache: sampleHeight } = job;
        const getOrganicBiome = (x, z) => this._organicBiomeAt(x, z);

        for (let i = from; i < to; i++) {
            const rx = centerX + (rng() - 0.5) * S;
            const rz = centerZ + (rng() - 0.5) * S;
            const h = sampleHeight(rx, rz);
            if (h < -22 || h > 280) continue;

            if (h > -21 && h < 180) {
                const biomeVal = getOrganicBiome(rx, rz);
                const nearWaterBand = Math.max(0, 1.0 - Math.min(1.0, Math.abs(h + 18.6) / 36.0));
                const lowlandBand = Math.max(0, 1.0 - Math.min(1.0, Math.abs(h - 10.0) / 40.0));
                const edgeFactor = 0.35 + Math.max(0, 0.65 * (1.0 - Math.abs(h - 65) / 55.0));
                const fertility = biomeVal * edgeFactor + nearWaterBand * 0.11 + lowlandBand * 0.04;
                const grassChance = 0.38 + nearWaterBand * 0.55 + lowlandBand * 0.2;

                if (fertility > 0.015 && rng() < grassChance) {
                    const baseRot = rng() * Math.PI;
                    job.grassPositions.push({ x: rx, y: h, z: rz, rotY: baseRot });
                    job.grassPositions.push({ x: rx, y: h, z: rz, rotY: baseRot + Math.PI * 0.5 });
                    const clusterCount = nearWaterBand > 0.35
                        ? 4 + Math.floor(rng() * 5)
                        : 2 + Math.floor(rng() * 3);
                    for (let c = 1; c < clusterCount; c++) {
                        const ox = rx + (rng() - 0.5) * 18;
                        const oz = rz + (rng() - 0.5) * 18;
                        const cr = rng() * Math.PI;
                        job.grassPositions.push({ x: ox, y: h, z: oz, rotY: cr });
                        job.grassPositions.push({ x: ox, y: h, z: oz, rotY: cr + Math.PI * 0.5 });
                    }
                } else if (fertility > 0.012 && rng() < (0.14 + nearWaterBand * 0.42)) {
                    job.mossPositions.push({ x: rx, y: h, z: rz });
                }
            }
        }
    }

    _finishGrassJob(job) {
        const mesh = job.mesh;
        if (!mesh || !this.loadedChunks.has(job.key)) return;

        if (this._grassGeo && this._grassMat && job.grassPositions.length > 0) {
            const cappedGrass = this._trimGrassPositions(job.grassPositions, job.maxInstances);
            const grassInstanced = new THREE.InstancedMesh(this._grassGeo, this._grassMat, cappedGrass.length);
            const dummy = new THREE.Object3D();
            const rnd = job.rng;
            for (let i = 0; i < cappedGrass.length; i++) {
                const gp = cappedGrass[i];
                dummy.position.set(gp.x, gp.y, gp.z);
                dummy.rotation.y = gp.rotY ?? (rnd() * Math.PI);
                dummy.rotation.x = (rnd() - 0.5) * 0.22;
                dummy.rotation.z = (rnd() - 0.5) * 0.22;
                const scale = 0.95 + rnd() * 0.65;
                dummy.scale.set(scale, scale, scale);
                dummy.updateMatrix();
                grassInstanced.setMatrixAt(i, dummy.matrix);
            }
            grassInstanced.instanceMatrix.needsUpdate = true;
            grassInstanced.receiveShadow = false;
            grassInstanced.castShadow = false;
            grassInstanced.frustumCulled = true;
            this.scene.add(grassInstanced);
            mesh.userData.grassMesh = grassInstanced;
        }

        if (job.mossPositions.length > 0) {
            const mossGeo = new THREE.PlaneGeometry(8, 8, 1, 1);
            mossGeo.rotateX(-Math.PI / 2);
            const mossMat = new THREE.MeshLambertMaterial({ color: 0x1f3c0f, side: THREE.DoubleSide });
            const mossInstanced = new THREE.InstancedMesh(mossGeo, mossMat, job.mossPositions.length);
            const dummyMoss = new THREE.Object3D();
            const rnd = job.rng;
            for (let i = 0; i < job.mossPositions.length; i++) {
                const mp = job.mossPositions[i];
                dummyMoss.position.set(mp.x, mp.y + 0.3, mp.z);
                dummyMoss.rotation.y = rnd() * Math.PI;
                dummyMoss.rotation.x = (rnd() - 0.5) * 0.4;
                dummyMoss.rotation.z = (rnd() - 0.5) * 0.4;
                dummyMoss.scale.setScalar(0.6 + rnd() * 0.8);
                dummyMoss.updateMatrix();
                mossInstanced.setMatrixAt(i, dummyMoss.matrix);
            }
            mossInstanced.receiveShadow = false;
            mossInstanced.castShadow = false;
            this.scene.add(mossInstanced);
            mesh.userData.mossMesh = mossInstanced;
        }

        mesh.userData.grassReady = true;
        this._applyChunkVisibility(mesh);
    }

    _processGrassJobs(budgetMs = this._grassJobBudgetMs) {
        if (!this._grassJobs?.length) return;
        const start = performance.now();
        const batchSize = this._combatLoadLevel === 'heavy' ? 1200 : 2200;

        while (this._grassJobs.length && performance.now() - start < budgetMs) {
            const job = this._grassJobs[0];
            if (!this.loadedChunks.has(job.key) || this.loadedChunks.get(job.key) !== job.mesh) {
                this._grassJobs.shift();
                continue;
            }
            const end = Math.min(job.sampleIdx + batchSize, job.sampleTotal);
            this._fillGrassSamples(job, job.sampleIdx, end);
            job.sampleIdx = end;
            if (job.sampleIdx >= job.sampleTotal) {
                this._finishGrassJob(job);
                this._grassJobs.shift();
            }
        }
    }

    _makeHeightCache() {
        const cache = new Map();
        return (x, z) => {
            const k = `${Math.round(x * 0.5) * 2},${Math.round(z * 0.5) * 2}`;
            if (!cache.has(k)) cache.set(k, this.getHeightAt(x, z));
            return cache.get(k);
        };
    }

    _purgeInvisibleQueue(pcx, pcz, forward, fastTravel) {
        if (!this.chunkQueue.length) return;
        const kept = [];
        for (const c of this.chunkQueue) {
            const dx = c.cx - pcx;
            const dz = c.cz - pcz;
            if (shouldStreamChunk(dx, dz, forward, fastTravel)) {
                kept.push(c);
            } else {
                this.queuedChunkKeys.delete(`${this._chunkKey(c.cx, c.cz)}:${c.detailLevel}`);
            }
        }
        this.chunkQueue = kept;
    }

    _purgeInvisibleGrassJobs(pcx, pcz, forward) {
        if (!this._grassJobs?.length) return;
        this._grassJobs = this._grassJobs.filter((job) => {
            const coord = job.mesh?.userData?.chunkCoord;
            if (!coord) return false;
            const dx = coord[0] - pcx;
            const dz = coord[1] - pcz;
            return shouldDecorChunk(dx, dz, forward, job.detailLevel);
        });
    }

    _trimChunkQueue(maxSize = this._maxQueueSize) {
        if (this.chunkQueue.length <= maxSize) return;
        this.chunkQueue.sort((a, b) => a.dist - b.dist);
        const drop = this.chunkQueue.splice(maxSize);
        for (const c of drop) {
            this.queuedChunkKeys.delete(`${this._chunkKey(c.cx, c.cz)}:${c.detailLevel}`);
        }
    }

    _initGrassResources() {
        const gcfg = CONFIG.VISUALS?.GRASS ?? {};
        const bw = gcfg.bladeWidth ?? 6.5;
        const bh = gcfg.bladeHeight ?? 15;
        this._grassGeo = new THREE.PlaneGeometry(bw, bh, 1, 3);
        this._grassGeo.translate(0, bh * 0.5, 0);

        this._grassMat = new THREE.MeshLambertMaterial({
            color: 0x00cc88,
            side: THREE.DoubleSide,
        });

        this._grassMat.onBeforeCompile = (shader) => {
            shader.uniforms.time = { value: 0 };
            shader.uniforms.playerPos = { value: new THREE.Vector3() };
            shader.uniforms.windMul = { value: 1.0 };

            shader.vertexShader = `
                uniform float time;
                uniform vec3 playerPos;
                uniform float windMul;
                varying float vGrassHeight;
                varying vec3 vGrassWorldPos;
            ` + shader.vertexShader;

            shader.vertexShader = shader.vertexShader.replace(
                `#include <begin_vertex>`,
                `
                #include <begin_vertex>
                vec4 worldPos = instanceMatrix * vec4(position, 1.0);
                vGrassWorldPos = worldPos.xyz;
                float hFactor = max(0.0, position.y / 12.0);
                vGrassHeight = hFactor;
                transformed.x *= (1.0 - hFactor * 0.85);
                transformed.z += abs(position.x) * 0.45;
                float wave = sin(worldPos.x * 0.02 + worldPos.z * 0.02 + time * 1.6);
                float wind = wave * 2.5 * windMul;
                float pDist = distance(worldPos.xz, playerPos.xz);
                float lodScale = pDist > 5200.0 ? 0.0 : (pDist > 3600.0 ? 1.0 - (pDist - 3600.0) / 1600.0 : 1.0);
                transformed *= lodScale;
                vec3 toPlayer = worldPos.xyz - playerPos;
                toPlayer.y = 0.0;
                float dist = length(toPlayer);
                vec3 bend = vec3(0.0);
                if (dist < 120.0) {
                    float push = smoothstep(120.0, 0.0, dist) * 8.0 * windMul;
                    bend = -(toPlayer / max(dist, 1.0)) * push;
                }
                float curveFactor = pow(hFactor, 2.0);
                transformed.x += (wind + bend.x) * curveFactor;
                transformed.z += (wind + bend.z) * curveFactor;
                `
            );

            shader.fragmentShader = `
                varying float vGrassHeight;
                varying vec3 vGrassWorldPos;
            ` + shader.fragmentShader;

            shader.fragmentShader = shader.fragmentShader.replace(
                `#include <color_fragment>`,
                `
                #include <color_fragment>
                vec3 rootColor = vec3(0.06, 0.22, 0.12);
                vec3 midColor = vec3(0.12, 0.58, 0.38);
                vec3 tipColor = vec3(0.45, 0.92, 0.62);
                vec3 finalGrassColor = mix(rootColor, mix(midColor, tipColor, pow(vGrassHeight, 0.85)), pow(vGrassHeight, 0.55));
                diffuseColor.rgb = finalGrassColor;
                `
            );

            this._grassMat.userData.shader = shader;
        };
    }

    _initHorizonTerrain() {
        // Siluetas a distancia: no escribe profundidad → no se superpone con chunks reales
        this.HORIZON_INNER = this.HORIZON_FAR_START;
        this.HORIZON_OUTER = this.HORIZON_FAR_START + 3800;
        this.HORIZON_SEGS = 56;
        this.HORIZON_RINGS = 7;
        this._horizonUpdateTimer = 0;
        this._lastHorizonPos = new THREE.Vector3(NaN, 0, NaN);

        const segCount = this.HORIZON_SEGS;
        const ringCount = this.HORIZON_RINGS;
        const vertCount = (segCount + 1) * (ringCount + 1);
        const positions = new Float32Array(vertCount * 3);
        const colors = new Float32Array(vertCount * 3);
        const indices = [];

        let vi = 0;
        for (let ri = 0; ri <= ringCount; ri++) {
            const t = ri / ringCount;
            const radius = this.HORIZON_INNER + t * (this.HORIZON_OUTER - this.HORIZON_INNER);
            for (let si = 0; si <= segCount; si++) {
                const angle = (si / segCount) * Math.PI * 2;
                positions[vi * 3] = Math.cos(angle) * radius;
                positions[vi * 3 + 1] = 0;
                positions[vi * 3 + 2] = Math.sin(angle) * radius;
                vi++;
            }
        }

        for (let ri = 0; ri < ringCount; ri++) {
            for (let si = 0; si < segCount; si++) {
                const a = ri * (segCount + 1) + si;
                const b = a + segCount + 1;
                indices.push(a, b, a + 1, b, b + 1, a + 1);
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.setIndex(indices);

        this.horizonMesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
            vertexColors: true,
            flatShading: false,
            fog: true,
            depthWrite: false,
            depthTest: true,
        }));
        this.horizonMesh.frustumCulled = false;
        this.horizonMesh.renderOrder = -50;
        this.horizonMesh.visible = false;
        this._horizonEnabled = false;
        this.scene.add(this.horizonMesh);
    }

    _updateHorizonTerrain(playerPosition) {
        if (!this.horizonMesh) return;

        const pos = this.horizonMesh.geometry.attributes.position;
        const col = this.horizonMesh.geometry.attributes.color;
        const scratch = new THREE.Color();
        const snap = 1200;
        const px = Math.round(playerPosition.x / snap) * snap;
        const pz = Math.round(playerPosition.z / snap) * snap;

        for (let i = 0; i < pos.count; i++) {
            const lx = pos.getX(i);
            const lz = pos.getZ(i);
            const wx = px + lx;
            const wz = pz + lz;
            const distWorld = Math.hypot(wx, wz);
            const outerR = WORLD_MAP.playableRadius;
            let h = this.getHeightAt(wx, wz);
            // El muro perimetral del heightmap no debe verse como pilares en el horizonte lejano
            if (distWorld > outerR * 0.9) {
                const soft = THREE.MathUtils.clamp((distWorld - outerR * 0.9) / (outerR * 0.12), 0, 1);
                const gentle = 18 + Math.sin(wx * 0.0018) * 6 + Math.cos(wz * 0.0016) * 5;
                h = THREE.MathUtils.lerp(h, gentle, soft);
            }
            if (distWorld > outerR + 500) {
                h = 16 + Math.sin(Math.atan2(wz, wx) * 8) * 4;
            }
            pos.setY(i, h - 8);
            this._paintTerrainColor(wx, wz, scratch);
            const dist = Math.hypot(lx, lz);
            const fade = THREE.MathUtils.clamp((dist - this.HORIZON_INNER) / 5200, 0.72, 1);
            col.setXYZ(i, scratch.r * fade, scratch.g * fade, scratch.b * fade);
        }

        pos.needsUpdate = true;
        col.needsUpdate = true;
        this.horizonMesh.position.set(px, 0, pz);
        this._lastHorizonPos.set(px, playerPosition.y, pz);
    }

    _preloadInitialChunks(wx, wz, opts = {}) {
        const { cx, cz } = this._worldToChunk(wx, wz);
        const forward = this._streamForward ?? { fx: 0, fz: -1 };
        this.chunkQueue.length = 0;
        this.queuedChunkKeys.clear();

        if (opts.boot) {
            this._buildChunk(cx, cz, 'mid');
            for (const { dx, dz, cx: tcx, cz: tcz } of iterStreamCells(cx, cz, forward, false, 3)) {
                if (dx === 0 && dz === 0) continue;
                if (!isChunkInsideWorld(tcx, tcz, this.CHUNK_SIZE)) continue;
                const manhattan = Math.abs(dx) + Math.abs(dz);
                const detail = manhattan <= 1 ? 'mid' : 'low';
                this._queueChunk(tcx, tcz, detail, streamChunkPriority(dx, dz, forward, null));
            }
        } else {
            for (const { dx, dz, cx: tcx, cz: tcz } of iterStreamCells(cx, cz, forward, false, 3)) {
                if (!isChunkInsideWorld(tcx, tcz, this.CHUNK_SIZE)) continue;
                const detail = detailForStreamCell(dx, dz, forward, false, this.CHUNK_RADIUS_FULL);
                if (Math.abs(dx) + Math.abs(dz) <= 1) {
                    this._buildChunk(tcx, tcz, detail);
                } else {
                    this._queueChunk(tcx, tcz, detail, streamChunkPriority(dx, dz, forward, null));
                }
            }
        }
        if (!opts.boot) {
            this._updateHorizonTerrain(new THREE.Vector3(wx, 0, wz));
        }
    }

    _detailRank(level) {
        return ({ full: 3, mid: 2, low: 1 }[level] || 0);
    }

    _detailNeedsUpgrade(current, target) {
        return this._detailRank(target) > this._detailRank(current);
    }

    _detailForManhattan(m, fastTravel = false) {
        if (fastTravel) {
            if (m === 0) return 'full';
            if (m <= 1) return 'mid';
            return 'low';
        }
        if (m <= this.CHUNK_RADIUS_FULL) return 'full';
        return 'mid';
    }

    /** Tras impulsor: priorizar yerba solo en chunks visibles al frente. */
    _queueFullDecorNear(wx, wz) {
        const { cx, cz } = this._worldToChunk(wx, wz);
        const forward = this._streamForward ?? { fx: 0, fz: -1 };
        const R = this.CHUNK_RADIUS_FULL + 1;
        for (let dx = -R; dx <= R; dx++) {
            for (let dz = -R; dz <= R; dz++) {
                const m = Math.abs(dx) + Math.abs(dz);
                if (m > R) continue;
                if (!shouldDecorChunk(dx, dz, forward, 'full')) continue;
                const targetCx = cx + dx;
                const targetCz = cz + dz;
                if (!isChunkInsideWorld(targetCx, targetCz, this.CHUNK_SIZE)) continue;
                this._queueChunk(targetCx, targetCz, 'full', -90 - m);
            }
        }
        if (this.chunkQueue.length > 1) {
            this.chunkQueue.sort((a, b) => a.dist - b.dist);
        }
    }

    _ensureFullDecorNear(wx, wz) {
        const { cx, cz } = this._worldToChunk(wx, wz);
        const forward = this._streamForward ?? { fx: 0, fz: -1 };
        const R = this.CHUNK_RADIUS_FULL + 1;
        let queued = false;
        for (let dx = -R; dx <= R; dx++) {
            for (let dz = -R; dz <= R; dz++) {
                if (Math.abs(dx) + Math.abs(dz) > R) continue;
                if (!shouldDecorChunk(dx, dz, forward, 'full')) continue;
                const key = this._chunkKey(cx + dx, cz + dz);
                const existing = this.loadedChunks.get(key);
                if (existing && existing.userData.detail !== 'full') {
                    this._queueChunk(cx + dx, cz + dz, 'full', -85 - Math.abs(dx) - Math.abs(dz));
                    queued = true;
                }
            }
        }
        if (queued && this.chunkQueue.length > 1) {
            this.chunkQueue.sort((a, b) => a.dist - b.dist);
        }
    }

    _isFastTravel(velocity, opts = {}) {
        if (opts.nitro) return true;
        if (!velocity) return false;
        const speedSq = velocity.x * velocity.x + velocity.z * velocity.z;
        return speedSq > 180 * 180;
    }

    _preloadCriticalChunks(wx, wz, velocity, fastTravel = false) {
        if (this.chunkQueue.length > (fastTravel ? 12 : 16)) return;

        const forward = this._streamForward ?? resolveStreamForward(velocity, null);
        const { cx, cz } = this._worldToChunk(wx, wz);

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const need = detailForStreamCell(dx, dz, forward, fastTravel, this.CHUNK_RADIUS_FULL);
                this._queueChunk(cx + dx, cz + dz, need, -20 + Math.abs(dx) + Math.abs(dz));
            }
        }

        if (!velocity || !fastTravel) return;
        const vx = velocity.x;
        const vz = velocity.z;
        const speedSq = vx * vx + vz * vz;
        if (speedSq < 36) return;

        const maxSteps = this.chunkQueue.length > 8 ? 2 : 3;
        for (let step = 1; step <= maxSteps; step++) {
            for (const { dx, dz, cx: ncx, cz: ncz } of iterStreamCells(cx, cz, forward, true, step + 1)) {
                const manhattan = Math.abs(dx) + Math.abs(dz);
                if (manhattan !== step && manhattan !== step + 1) continue;
                if (!shouldStreamChunk(dx, dz, forward, true)) continue;
                this._queueChunk(ncx, ncz, 'low', -12 - step);
            }
        }
    }

    _chunkPriority(dx, dz, velocity) {
        const forward = this._streamForward ?? { fx: 0, fz: -1 };
        return streamChunkPriority(dx, dz, forward, velocity);
    }

    _chunkKey(cx, cz) { return `${cx},${cz}`; }

    _worldToChunk(wx, wz) {
        return {
            cx: Math.floor(wx / this.CHUNK_SIZE),
            cz: Math.floor(wz / this.CHUNK_SIZE)
        };
    }

    _disposeChunkMesh(mesh) {
        const coord = mesh.userData?.chunkCoord;
        if (coord) this._cancelGrassJob(this._chunkKey(coord[0], coord[1]));
        this.scene.remove(mesh);
        if (mesh.userData.grassMesh) {
            this.scene.remove(mesh.userData.grassMesh);
        }
        if (mesh.userData.mossMesh) {
            this.scene.remove(mesh.userData.mossMesh);
            mesh.userData.mossMesh.geometry.dispose();
        }
        if (mesh.userData.waterPlantMesh) {
            this.scene.remove(mesh.userData.waterPlantMesh);
            mesh.userData.waterPlantMesh.geometry.dispose();
            mesh.userData.waterPlantMesh.material.dispose();
        }
        if (mesh.userData.rockMesh) {
            this.scene.remove(mesh.userData.rockMesh);
            mesh.userData.rockMesh.geometry.dispose();
        }
        if (mesh.userData.pebbleMesh) {
            this.scene.remove(mesh.userData.pebbleMesh);
            mesh.userData.pebbleMesh.geometry.dispose();
        }
        if (mesh.userData.crystalMesh) {
            this.scene.remove(mesh.userData.crystalMesh);
        }
        mesh.geometry.dispose();
    }

    _buildChunk(cx, cz, detailLevel = 'full') {
        const key = this._chunkKey(cx, cz);
        this._cancelGrassJob(key);
        const existing = this.loadedChunks.get(key);
        if (existing) {
            if (!this._detailNeedsUpgrade(existing.userData.detail, detailLevel)) return;
        }

        const S = this.CHUNK_SIZE;
        const R = detailLevel === 'low'
            ? this.CHUNK_RES_LOW
            : detailLevel === 'mid'
                ? this.CHUNK_RES_MID
                : this.CHUNK_RES;
        const geometry = new THREE.PlaneGeometry(S, S, R, R);
        const pos = geometry.attributes.position;
        const colors = [];
        const color = new THREE.Color();
        const rockPositions = [];
        const pebblePositions = [];
        const floraPositions = [];
        const waterPlantPositions = [];

        const getOrganicBiome = (x, z) => this._organicBiomeAt(x, z);

        const centerX = cx * S + S * 0.5;
        const centerZ = cz * S + S * 0.5;
        const sampleHeight = this._makeHeightCache();

        for (let i = 0; i < pos.count; i++) {
            const lx = pos.getX(i);
            const ly = pos.getY(i);
            const wx = centerX + lx;
            const wz = centerZ - ly;
            const h = sampleHeight(wx, wz);
            pos.setZ(i, h);
            this._paintTerrainColor(wx, wz, color);
            colors.push(color.r, color.g, color.b);
        }

        const propsLevel = detailLevel === 'full' ? 1 : detailLevel === 'mid' ? 0.45 : 0;
        const tierMul = this._grassPerfMul();
        const propPoints = propsLevel > 0
            ? Math.round((this._carpetPoints ?? 24000) * tierMul * propsLevel * 0.22)
            : 0;

        if (propPoints > 0) {
        for (let i = 0; i < propPoints; i++) {
            const rx = centerX + (Math.random() - 0.5) * S;
            const rz = centerZ + (Math.random() - 0.5) * S;
            const h = sampleHeight(rx, rz);
            if (h < -22 || h > 280) continue;

            if (detailLevel === 'full' && h > -20 && h < 120 && Math.random() < 0.003) {
                floraPositions.push({ x: rx, y: h, z: rz, scale: Math.random() * 8.0 + 3.0, rotY: Math.random() * Math.PI * 2 });
            }

            if (detailLevel === 'full' && h > -20 && h < 200) {
                const hillBias = h > 45 ? 1.0 : 0.35;
                if (Math.random() < 0.0035 * hillBias) {
                    rockPositions.push({ x: rx, y: h, z: rz, scale: Math.random() * 22 + 5, rotY: Math.random() * Math.PI * 2, rotX: Math.random() * Math.PI });
                }
            }
            if (h > -15 && h < 180 && Math.random() < (detailLevel === 'full' ? 0.009 : 0.004)) {
                pebblePositions.push({
                    x: rx, y: h, z: rz,
                    scale: Math.random() * 2.8 + 0.6,
                    rotY: Math.random() * Math.PI * 2,
                    rotX: Math.random() * Math.PI,
                });
            }

            if (detailLevel === 'full' && h > -20.8 && h < -16.2) {
                const biomeVal = getOrganicBiome(rx, rz);
                const shoreProximity = 1.0 - Math.min(1.0, Math.abs(h + 18.4) / 2.8);
                if (shoreProximity > 0.1 && biomeVal > -0.2 && Math.random() < (0.002 + shoreProximity * 0.01)) {
                    waterPlantPositions.push({
                        x: rx,
                        y: h,
                        z: rz,
                        scale: 0.7 + Math.random() * 1.1,
                        rotY: Math.random() * Math.PI * 2
                    });
                }
            }
        }
        }
        geometry.computeVertexNormals();
        const normals = geometry.attributes.normal;
        for (let i = 0; i < pos.count; i++) {
            const ny = normals.getY(i);
            const slope = 1.0 - Math.abs(ny);
            const ao = THREE.MathUtils.clamp(0.58 + ny * 0.34 - slope * 0.20, 0.52, 1.02);
            colors[i * 3] *= ao;
            colors[i * 3 + 1] *= ao;
            colors[i * 3 + 2] *= ao;
        }
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        // Usar el material global que tiene incrustado el Shader de Océano
        const material = this.terrainMat;

        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(centerX, 0, centerZ);
        mesh.receiveShadow = false;
        mesh.renderOrder = 1;
        mesh.userData.detail = detailLevel;
        mesh.userData.chunkCoord = [cx, cz];
        mesh.userData.grassReady = false;

        // --- Generar InstancedMesh de Cristales (Synthwave) ---
        if (waterPlantPositions.length > 0) {
            const reedGeo = new THREE.PlaneGeometry(2.4, 12, 1, 1);
            reedGeo.translate(0, 6, 0); // pivote en la base

            const reedMat = new THREE.MeshLambertMaterial({
                color: 0x2f6e4f,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.9
            });

            const reeds = new THREE.InstancedMesh(reedGeo, reedMat, waterPlantPositions.length);
            const dummyReed = new THREE.Object3D();
            for (let i = 0; i < waterPlantPositions.length; i++) {
                const wp = waterPlantPositions[i];
                dummyReed.position.set(wp.x, wp.y + 0.2, wp.z);
                dummyReed.rotation.set((Math.random() - 0.5) * 0.18, wp.rotY, (Math.random() - 0.5) * 0.18);
                dummyReed.scale.setScalar(wp.scale);
                dummyReed.updateMatrix();
                reeds.setMatrixAt(i, dummyReed.matrix);
            }
            reeds.castShadow = false;
            reeds.receiveShadow = false;
            this.scene.add(reeds);
            mesh.userData.waterPlantMesh = reeds;
        }

        // --- Generar InstancedMesh de Cristales (Synthwave) ---
        if (floraPositions.length > 0) {
            const crystalInstanced = new THREE.InstancedMesh(this.crystalGeo, this.crystalMat, floraPositions.length);
            const dummyCrystal = new THREE.Object3D();
            
            const colorQuartz = new THREE.Color(0x9ab0a8);
            const colorBasalt = new THREE.Color(0x6a5858);
            
            for (let i = 0; i < floraPositions.length; i++) {
                const fp = floraPositions[i];
                dummyCrystal.position.set(fp.x, fp.y, fp.z);
                dummyCrystal.rotation.set((Math.random() - 0.5) * 0.4, fp.rotY, (Math.random() - 0.5) * 0.4);
                dummyCrystal.scale.setScalar(fp.scale);
                dummyCrystal.updateMatrix();
                crystalInstanced.setMatrixAt(i, dummyCrystal.matrix);
                crystalInstanced.setColorAt(i, Math.random() > 0.5 ? colorQuartz : colorBasalt);
            }
            crystalInstanced.instanceColor.needsUpdate = true;
            this.scene.add(crystalInstanced);
            mesh.userData.crystalMesh = crystalInstanced;
        }

        // --- Generar InstancedMesh de Rocas ---
        if (rockPositions.length > 0) {
            const rockInstanced = new THREE.InstancedMesh(this.rockGeo, this.rockMat, rockPositions.length);
            const dummyRock = new THREE.Object3D();
            const rockPalette = [
                new THREE.Color(0x8a7060),
                new THREE.Color(0x7a6050),
                new THREE.Color(0x9a8070),
                new THREE.Color(0x6a5850),
            ];
            for (let i = 0; i < rockPositions.length; i++) {
                const rp = rockPositions[i];
                const tiltX = Math.atan2(
                    this.getHeightAt(rp.x, rp.z + 3) - this.getHeightAt(rp.x, rp.z - 3),
                    6
                ) * 0.55;
                const tiltZ = -Math.atan2(
                    this.getHeightAt(rp.x + 3, rp.z) - this.getHeightAt(rp.x - 3, rp.z),
                    6
                ) * 0.55;
                dummyRock.position.set(rp.x, rp.y, rp.z);
                dummyRock.rotation.set(rp.rotX * 0.4 + tiltX, rp.rotY, tiltZ + (Math.random() - 0.5) * 0.4);
                const s = rp.scale * (0.85 + Math.random() * 0.35);
                dummyRock.scale.set(
                    s * (0.75 + Math.random() * 0.45),
                    s * (0.55 + Math.random() * 0.55),
                    s * (0.70 + Math.random() * 0.50)
                );
                dummyRock.updateMatrix();
                rockInstanced.setMatrixAt(i, dummyRock.matrix);
                rockInstanced.setColorAt(i, rockPalette[i % rockPalette.length].clone().multiplyScalar(0.88 + Math.random() * 0.24));
            }
            rockInstanced.instanceColor.needsUpdate = true;
            rockInstanced.castShadow = false;
            rockInstanced.receiveShadow = false;
            this.scene.add(rockInstanced);
            mesh.userData.rockMesh = rockInstanced;
        }

        if (pebblePositions.length > 0) {
            const pebbleInstanced = new THREE.InstancedMesh(this.pebbleGeo, this.pebbleMat, pebblePositions.length);
            const dummyPebble = new THREE.Object3D();
            const pebbleColor = new THREE.Color();
            for (let i = 0; i < pebblePositions.length; i++) {
                const pp = pebblePositions[i];
                dummyPebble.position.set(pp.x, pp.y + 0.15, pp.z);
                dummyPebble.rotation.set(pp.rotX, pp.rotY, (Math.random() - 0.5) * 0.6);
                dummyPebble.scale.setScalar(pp.scale);
                dummyPebble.updateMatrix();
                pebbleInstanced.setMatrixAt(i, dummyPebble.matrix);
                pebbleColor.setHSL(0.08 + Math.random() * 0.06, 0.18 + Math.random() * 0.12, 0.28 + Math.random() * 0.18);
                pebbleInstanced.setColorAt(i, pebbleColor);
            }
            pebbleInstanced.instanceColor.needsUpdate = true;
            this.scene.add(pebbleInstanced);
            mesh.userData.pebbleMesh = pebbleInstanced;
        }


        this.scene.add(mesh);
        if (existing) this._disposeChunkMesh(existing);
        this.loadedChunks.set(key, mesh);
        this._applyChunkVisibility(mesh);
        this._queueGrassJob(mesh, cx, cz, detailLevel, centerX, centerZ, S);
    }

    _queueChunk(cx, cz, detailLevel, dist) {
        const key = this._chunkKey(cx, cz);
        const existing = this.loadedChunks.get(key);
        if (existing && !this._detailNeedsUpgrade(existing.userData.detail, detailLevel)) return;

        const queueKey = `${key}:${detailLevel}`;
        if (this.queuedChunkKeys.has(queueKey)) return;

        this.chunkQueue.push({ cx, cz, dist, detailLevel });
        this.queuedChunkKeys.add(queueKey);
    }

    _loadChunksAround(wx, wz, velocity = null, fastTravel = false) {
        const forward = this._streamForward ?? resolveStreamForward(velocity, null);
        const { cx: pcxEarly, cz: pczEarly } = this._worldToChunk(wx, wz);

        let leadX = wx;
        let leadZ = wz;
        if (velocity && (velocity.x * velocity.x + velocity.z * velocity.z) > 4) {
            const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
            const leadCap = fastTravel ? this.CHUNK_SIZE * 1.1 : this.CHUNK_SIZE * 1.6;
            const lead = Math.min(speed * (fastTravel ? 2.5 : 4.0), leadCap);
            leadX = wx + (velocity.x / speed) * lead;
            leadZ = wz + (velocity.z / speed) * lead;
        }

        const { cx: pcx, cz: pcz } = this._worldToChunk(leadX, leadZ);
        const searchR = this._atmosphericFlightView
            ? 2
            : (fastTravel ? 5 : this._streamSearchRadius);
        const queueCap = fastTravel ? 14 : 18;

        for (const { dx, dz, cx: targetCx, cz: targetCz } of iterStreamCells(pcx, pcz, forward, fastTravel, searchR)) {
            if (this.chunkQueue.length >= queueCap) break;
            if (!isChunkInsideWorld(targetCx, targetCz, this.CHUNK_SIZE)) continue;
            const detailLevel = detailForStreamCell(dx, dz, forward, fastTravel, this.CHUNK_RADIUS_FULL);
            this._queueChunk(targetCx, targetCz, detailLevel, this._chunkPriority(dx, dz, velocity));
        }

        if (this.chunkQueue.length > 1) {
            this.chunkQueue.sort((a, b) => a.dist - b.dist);
        }

        this._disposeFarChunks(pcx, pcz, forward, fastTravel);
    }

    _disposeFarChunks(pcx, pcz, forward, fastTravel = false) {
        const toRemove = [];
        for (const [key, mesh] of this.loadedChunks.entries()) {
            const [kcx, kcz] = key.split(',').map(Number);
            const dx = kcx - pcx;
            const dz = kcz - pcz;
            if (shouldUnloadChunk(dx, dz, forward, fastTravel)) {
                toRemove.push(key);
            }
        }
        for (const key of toRemove) {
            const mesh = this.loadedChunks.get(key);
            if (mesh) this._disposeChunkMesh(mesh);
            this.loadedChunks.delete(key);
        }
    }

    _pickNextChunk(playerPosition, fastTravel) {
        if (!this.chunkQueue.length) return null;
        if (!fastTravel || this.chunkQueue.length <= 4) {
            return this.chunkQueue.shift();
        }

        const { cx, cz } = this._worldToChunk(playerPosition.x, playerPosition.z);
        let bestIdx = 0;
        let bestScore = Infinity;
        for (let i = 0; i < this.chunkQueue.length; i++) {
            const c = this.chunkQueue[i];
            const manhattan = Math.abs(c.cx - cx) + Math.abs(c.cz - cz);
            const lodPenalty = c.detailLevel === 'full'
                ? (manhattan <= 1 ? 1 : 5)
                : c.detailLevel === 'low' ? 1 : 0;
            const score = manhattan + lodPenalty + (c.dist ?? 0) * 0.05;
            if (score < bestScore) {
                bestScore = score;
                bestIdx = i;
            }
        }
        return this.chunkQueue.splice(bestIdx, 1)[0];
    }

    applyGraphicsProfile(p = {}) {
        this._gfxDust = p.dust !== false;
        if (this.dustParticles) this.dustParticles.visible = this._gfxDust;
        if (this.haze) this.haze.visible = p.haze !== false;
        if (this.sunCore) this.sunCore.visible = p.sunHalo !== false;

        this.CHUNK_RADIUS_FULL = p.chunkRadiusFull ?? this.CHUNK_RADIUS_FULL;
        this.CHUNK_RADIUS_MID = p.chunkRadiusMid ?? this.CHUNK_RADIUS_MID;
        this.CHUNK_RADIUS_LOW = p.chunkRadiusLow ?? this.CHUNK_RADIUS_LOW;
        this.CHUNK_RES = p.chunkRes ?? this.CHUNK_RES;
        this.CHUNK_RES_MID = p.chunkResMid ?? this.CHUNK_RES_MID;
        this.CHUNK_RES_LOW = p.chunkResLow ?? this.CHUNK_RES_LOW;
        this._horizonInterval = p.horizonInterval ?? this._horizonInterval;
        this._buildPerFrameMax = p.buildPerFrame ?? this._buildPerFrameMax;
        if (p.carpetPoints != null) this._carpetPoints = p.carpetPoints;
        if (p.grass != null) this._enableGrass = p.grass;
        else if (this._enableGrass == null) this._enableGrass = true;
    }

    setPerfTier(tier) {
        this._perfTier = tier || 'normal';
        if (tier === 'critical') this._maxGrassPerChunk = 8000;
        else if (tier === 'economy') this._maxGrassPerChunk = 10000;
        else if (tier === 'balanced') this._maxGrassPerChunk = 12000;
        else this._maxGrassPerChunk = CONFIG.VISUALS?.GRASS?.maxPerChunk ?? 14000;

        if (tier === 'critical' || tier === 'economy') {
            if (this.dustParticles) this.dustParticles.visible = false;
        } else if (this._gfxDust !== false && this.dustParticles) {
            this.dustParticles.visible = true;
        }
    }

    setCombatLoad(level) {
        this._combatLoadLevel = level || 'light';
    }

    /** En vuelo alto: transición gradual hacia estratosfera (sin corte brusco). */
    updateHighAltitudeFlight(agl, scene) {
        if (this._planetSphereActive) return;

        const fadeStart = 1800;
        const fadeEnd = 4800;
        const planetHandoffEnd = 3400;

        if (agl < fadeStart) {
            if (this._highAltMask > 0.01) {
                this._highAltMask = 0;
                if (!this._atmosphericFlightView) {
                    this.setSurfaceFade(1);
                }
            }
            if (this.skyDome) this.skyDome.visible = true;
            if (this.starsMesh) this.starsMesh.visible = false;
            return;
        }

        const t = THREE.MathUtils.clamp((agl - fadeStart) / (fadeEnd - fadeStart), 0, 1);
        this._highAltMask = t;

        if (agl > planetHandoffEnd - 400) {
            this.setSurfaceVisible(false);
            this.setSurfaceFade(0);
        } else {
            const surfaceVis = 1 - THREE.MathUtils.smoothstep(0.35, 0.92, t);
            if (surfaceVis <= 0.04) {
                for (const mesh of this.loadedChunks.values()) {
                    mesh.visible = false;
                    if (mesh.userData.grassMesh) mesh.userData.grassMesh.visible = false;
                    if (mesh.userData.mossMesh) mesh.userData.mossMesh.visible = false;
                    if (mesh.userData.rockMesh) mesh.userData.rockMesh.visible = false;
                    if (mesh.userData.pebbleMesh) mesh.userData.pebbleMesh.visible = false;
                }
            } else {
                this.setSurfaceFade(surfaceVis);
            }
        }

        if (this.skyDome?.material?.uniforms) {
            const u = this.skyDome.material.uniforms;
            u.aerialT.value = t * 0.55;
            u.topColor.value.setHex(this._skyTopDefault).lerp(
                this._blendZenith.setHex(0x0e1a30), t * 0.72,
            );
            u.horizonColor.value.setHex(this._skyHorizonDefault).lerp(
                this._blendHorizon.setHex(0x2a4060), t * 0.55,
            );
            u.midColor.value.copy(u.topColor.value).lerp(u.horizonColor.value, 0.45);
        }
        if (this.skyDome) {
            this.skyDome.visible = t < 0.98;
        }
        if (this.starsMesh) {
            this.starsMesh.visible = t > 0.42;
            if (this.starsMesh.material) {
                this.starsMesh.material.opacity = THREE.MathUtils.smoothstep(0.42, 0.85, t) * 0.85;
            }
        }

        if (scene) {
            const skyBg = this._blendHorizon.setHex(0x050210).lerp(
                this._blendZenith.setHex(0x050a14), t,
            );
            scene.background = skyBg;
            scene.fog = t > 0.3 ? null : new THREE.FogExp2(skyBg, 0.000002 + t * 0.000005);
        }
    }

    /** Mezcla suave mapa → estratosfera (0 = cielo día, 1 = espacio completo). */
    blendStratosphereEntry(blend, agl, scene) {
        const t = THREE.MathUtils.clamp(blend, 0, 1);
        if (t < 0.02) return;

        if (t > 0.25) {
            // Esconder chunks del terreno + cielo plano a partir de 25% de mezcla
            this._planetSphereActive = true;
            this._forceSurfaceHidden();
        } else {
            if (this.skyDome) {
                this.skyDome.visible = true;
                if (this.skyDome.material?.uniforms) {
                    const u = this.skyDome.material.uniforms;
                    u.aerialT.value = (1 - t) * 0.45 + t * 0.55;
                    u.topColor.value.setHex(this._skyTopDefault).lerp(
                        this._blendZenith.setHex(0x060a12), t * 0.5,
                    );
                }
            }
            if (this.haze) this.haze.visible = t < 0.2;
            if (this.dustParticles) this.dustParticles.visible = t < 0.15;
        }
        if (this.horizonMesh) this.horizonMesh.visible = false;
        if (this.starsMesh) {
            this.starsMesh.visible = t > 0.15 && t < 0.85;
            if (this.starsMesh.material) {
                this.starsMesh.material.opacity = THREE.MathUtils.smoothstep(0.15, 0.55, t) * 0.85;
            }
        }
        if (this._transitionVeil) this._transitionVeil.visible = false;

        if (scene) {
            const day = new THREE.Color(0x050210);
            const space = new THREE.Color(0x010108);
            scene.background = day.clone().lerp(space, t);
            scene.fog = t > 0.15 ? null : new THREE.FogExp2(scene.background, 0.000001 * (1 - t));
        }
    }

    /** Estratosfera plena: apaga mapa/chunks y capas planas del mundo. */
    applyStratosphereView(_agl, scene) {
        this._stratosphereSpaceView = true;
        this._planetSphereActive = true;
        this._forceSurfaceHidden();
        if (scene) {
            scene.fog = null;
            scene.background = new THREE.Color(0x03050c);
        }
    }

    /** Restaura mapa, cielo y streaming tras volver del espacio / estratosfera. */
    finishPlanetaryReentry(scene, wx, wz) {
        this._stratosphereSpaceView = false;
        this._planetSphereActive = false;
        this._flightMode = false;
        this._surfaceHidden = false;
        this._surfaceFade = 1;
        this._highAltMask = 0;
        this._shellVisBucket = -1;
        this._shellBlendKey = '';
        this.setAscentPerfMode(false);
        this.setTransitionVeil(0);

        for (const mesh of this.loadedChunks.values()) {
            mesh.visible = true;
            if (mesh.userData.grassMesh) mesh.userData.grassMesh.visible = true;
            if (mesh.userData.mossMesh) mesh.userData.mossMesh.visible = true;
            if (mesh.userData.rockMesh) mesh.userData.rockMesh.visible = true;
            if (mesh.userData.pebbleMesh) mesh.userData.pebbleMesh.visible = true;
            if (mesh.userData.crystalMesh) mesh.userData.crystalMesh.visible = true;
            if (mesh.userData.waterPlantMesh) mesh.userData.waterPlantMesh.visible = true;
        }
        if (this.horizonMesh) this.horizonMesh.visible = false;
        if (this.dustParticles) this.dustParticles.visible = true;

        this.resetSkyToDay(scene);

        if (Number.isFinite(wx) && Number.isFinite(wz)) {
            this._preloadInitialChunks(wx, wz);
        }
    }

    clearStratosphereView(scene, wx, wz) {
        if (!this._stratosphereSpaceView && !this._surfaceHidden) return;
        this.finishPlanetaryReentry(scene, wx, wz);
    }

    /** Pausa streaming de chunks/yerba durante vuelo y ascenso (evita tirones). */
    setAscentPerfMode(active) {
        this._ascendPerfMode = !!active;
        if (active) {
            this.chunkQueue.length = 0;
            this.queuedChunkKeys.clear();
            this._grassJobs = [];
        } else {
            this._shellVisBucket = -1;
            this._shellBlendKey = '';
        }
    }

    /** Bruma previa al ascenso — solo cielo, sin universo 3D ni recorrer chunks. */
    applyPreAscentBlend(t, scene) {
        if (!this._atmosphericFlightView) this.setAtmosphericFlightView(true);
        const dark = Math.min(0.38, t * 0.9);
        if (this.skyDome?.material?.uniforms) {
            const u = this.skyDome.material.uniforms;
            u.aerialT.value = dark;
            u.topColor.value.setHex(this._skyTopDefault).lerp(
                this._blendZenith.setHex(0x1a3050), dark * 0.45,
            );
            u.horizonColor.value.setHex(this._skyHorizonDefault).lerp(
                this._blendHorizon.setHex(0x8aa8c8), dark * 0.35,
            );
        }
        if (this.haze) this.haze.material.opacity = 0.2 + dark * 0.1;
        if (this.starsMesh) this.starsMesh.visible = false;
    }

    _tickSkyFollow(playerPosition) {
        if (this.skyDome) {
            this.skyDome.position.copy(playerPosition);
            if (this.skyDome.material?.uniforms?.time) {
                this.skyDome.material.uniforms.time.value += 0.01;
            }
        }
        if (this.starsMesh) this.starsMesh.position.copy(playerPosition);
        if (this.haze) {
            this.haze.position.x = playerPosition.x;
            this.haze.position.z = playerPosition.z;
        }
        if (this._transitionVeil) {
            this._transitionVeil.position.copy(playerPosition);
        }
    }

    /** Velo de bruma en el pico de transición — oculta el remapeo mapa ↔ órbita. */
    setTransitionVeil(strength) {
        if (!this._transitionVeil) return;
        const s = THREE.MathUtils.clamp(strength, 0, 0.88);
        this._transitionVeil.visible = s > 0.025;
        this._transitionVeil.material.opacity = s;
    }

    /** Fundido suave cielo espacial → día tras reentrada. */
    lerpSkyToSurface(t, scene) {
        const ease = t * t * (3 - 2 * t);
        if (this.skyDome?.material?.uniforms) {
            const u = this.skyDome.material.uniforms;
            u.aerialT.value = (1 - ease) * 0.55;
            u.topColor.value.setHex(this._skyTopDefault).lerp(
                this._blendZenith.setHex(0x1a3050), (1 - ease) * 0.5,
            );
            u.horizonColor.value.setHex(this._skyHorizonDefault).lerp(
                this._blendHorizon.setHex(0x8aa8c8), (1 - ease) * 0.4,
            );
            u.midColor.value.copy(u.topColor.value).lerp(u.horizonColor.value, 0.45);
        }
        if (this.starsMesh) this.starsMesh.visible = ease < 0.35;
        if (this.haze) {
            this.haze.visible = !this._planetSphereActive && !this._stratosphereSpaceView;
            if (this.haze.visible) {
                this.haze.material.opacity = 0.12 + ease * 0.1;
            }
        }
        this.setTransitionVeil(0);
        if (ease >= 0.98) this.resetSkyToDay(scene);
    }

    /** Cancela mezcla a medias (ascenso abortado o bajada de altitud). */
    cancelShellTransition(scene) {
        this._shellBlendKey = '';
        this._shellVisBucket = -1;
        this._atmosphericFlightView = true;
        this._flightMode = false;
        this.setTransitionVeil(0);
        this.releasePlanetShellView(scene, { restoreSky: true });
        this._surfaceHidden = false;
        this._surfaceFade = 1;
        for (const mesh of this.loadedChunks.values()) {
            this._applyChunkVisibility(mesh);
        }
        this.resetSkyToDay(scene);
    }

    /** Niebla + fondo de superficie — perspectiva atmosférica azulada (cielo ≠ suelo). */
    _applySurfaceAtmosphere(scene) {
        if (!scene) return;
        scene.background = new THREE.Color(this._surfaceBgColor);
        scene.fog = new THREE.Fog(this._surfaceFogColor, 900, 10500);
    }

    /** Cielo diurno + niebla de superficie (sin tocar chunks ni modo vuelo). */
    resetSkyToDay(scene) {
        if (this.skyDome) {
            this.skyDome.visible = true;
            const u = this.skyDome.material?.uniforms;
            if (u) {
                u.topColor.value.setHex(this._skyTopDefault);
                u.midColor.value.setHex(this._skyMidDefault);
                u.horizonColor.value.setHex(this._skyHorizonDefault);
                u.aerialT.value = 0;
            }
        }
        if (this.starsMesh) this.starsMesh.visible = false;
        if (this.haze) {
            this.haze.visible = true;
            this.haze.material.opacity = 0.2;
            this.haze.material.color.setHex(0xb8ccd8);
        }
        this._applySurfaceAtmosphere(scene);
    }

    /** Restaura presentación completa de superficie tras vuelo / transición espacial. */
    resetSurfacePresentation(scene) {
        this._planetSphereActive = false;
        this._stratosphereSpaceView = false;
        this._atmosphericFlightView = false;
        this._surfaceHidden = false;
        this._surfaceFade = 1;
        this._flightMode = false;
        this._highAltMask = 0;

        for (const mesh of this.loadedChunks.values()) {
            mesh.visible = true;
            if (mesh.userData.grassMesh) mesh.userData.grassMesh.visible = true;
            if (mesh.userData.mossMesh) mesh.userData.mossMesh.visible = true;
            if (mesh.userData.rockMesh) mesh.userData.rockMesh.visible = true;
            if (mesh.userData.pebbleMesh) mesh.userData.pebbleMesh.visible = true;
            if (mesh.userData.crystalMesh) mesh.userData.crystalMesh.visible = true;
            if (mesh.userData.waterPlantMesh) mesh.userData.waterPlantMesh.visible = true;
        }
        if (this.horizonMesh) this.horizonMesh.visible = false;
        if (this.dustParticles) this.dustParticles.visible = true;

        this.resetSkyToDay(scene);
        this.setTransitionVeil(0);
        this.setAscentPerfMode(false);
        this._shellBlendKey = '';
    }

    /** Ocultar/mostrar terreno chunk (modo espacio). */
    setSurfaceVisible(visible) {
        if (!visible && this._planetSphereActive) {
            this._forceSurfaceHidden();
            return;
        }
        this._surfaceHidden = !visible;
        this._surfaceFade = visible ? 1 : 0;
        for (const mesh of this.loadedChunks.values()) {
            this._applyChunkVisibility(mesh);
        }
        if (this.horizonMesh) this.horizonMesh.visible = false;
        if (!visible) {
            this.chunkQueue.length = 0;
            this.queuedChunkKeys.clear();
            this._grassJobs = [];
        }
    }

    /** Solo órbita — apaga mapa plano por completo (handoff mapa→esfera). */
    lockToOrbitView() {
        this._flightMode = true;
        this.setPlanetSphereView(true);
        if (this.skyDome) this.skyDome.visible = false;
        if (this.haze) this.haze.visible = false;
        if (this.horizonMesh) this.horizonMesh.visible = false;
        if (this.starsMesh) this.starsMesh.visible = false;
        if (this.dustParticles) this.dustParticles.visible = false;
        this.chunkQueue.length = 0;
        this.queuedChunkKeys.clear();
        this._grassJobs = [];
        this._shellBlendKey = '';
        this._shellVisBucket = -1;
    }

    /** Tras cruce esfera→mapa — deja que setShellBlend reintroduzca el terreno. */
    releaseOrbitViewForDescent() {
        this._flightMode = false;
        this._surfaceHidden = true;
        this._surfaceFade = 0;
        this._planetSphereActive = false;
        this._stratosphereSpaceView = false;
        if (this.skyDome) this.skyDome.visible = true;
        if (this.dustParticles) this.dustParticles.visible = true;
        this._shellBlendKey = '';
        this._shellVisBucket = -1;
    }

    /** Modo vuelo espacial — oculta mapa/chunks/horizonte y pausa streaming. */
    setFlightMode(active) {
        if (this._flightMode === active) return;
        this._flightMode = active;
        if (active) {
            this.setSurfaceVisible(false);
            if (this.skyDome) this.skyDome.visible = false;
            if (this.haze) this.haze.visible = false;
            if (this.horizonMesh) this.horizonMesh.visible = false;
            if (this.starsMesh) this.starsMesh.visible = false;
            this.chunkQueue.length = 0;
            this.queuedChunkKeys.clear();
            this._grassJobs = [];
        } else {
            this.resetSurfacePresentation(this.scene);
        }
    }

    /** Modo vuelo 3D — horizonte falso desactivado (provoca muros verdes). */
    setAtmosphericFlightView(active) {
        this._atmosphericFlightView = !!active;
        if (this.horizonMesh) this.horizonMesh.visible = false;
    }

    /** Desvanecer terreno gradualmente al ascender (0 = oculto, 1 = visible). */
    setSurfaceFade(fade01) {
        if (this._planetSphereActive) {
            this._forceSurfaceHidden();
            return;
        }
        const f = Math.max(0, Math.min(1, fade01));
        this._surfaceFade = f;
        const show = f > 0.04;
        if (!show) {
            if (!this._surfaceHidden) this.setSurfaceVisible(false);
            return;
        }
        this._surfaceHidden = false;
        for (const mesh of this.loadedChunks.values()) {
            this._applyChunkVisibility(mesh);
        }
        if (this.horizonMesh) this.horizonMesh.visible = false;
    }

    /** Mezcla natural mapa ↔ órbita — niebla y cielo coherentes, sin apagar el mundo de golpe. */
    setShellBlend(visuals, scene) {
        if (!visuals) return;

        const {
            surfaceFade = 1,
            planetReveal = 0,
            spaceBlend = 0,
            horizon,
            zenith,
            fogDensity = 0.000008,
            skyAerial = 0,
        } = visuals;

        const blendKey = `${surfaceFade.toFixed(2)}|${spaceBlend.toFixed(2)}|${skyAerial.toFixed(2)}`;
        const keyChanged = blendKey !== this._shellBlendKey;
        this._shellBlendKey = blendKey;

        if (!this._atmosphericFlightView) this.setAtmosphericFlightView(true);

        if (planetReveal > 0.06 && spaceT > 0.04) {
            this.setPlanetSphereView(true);
            if (surfaceFade > 0.05) {
                visuals = { ...visuals, surfaceFade: 0, planetReveal };
            }
        } else if (surfaceFade > 0.08 && planetReveal <= 0.04) {
            this.releasePlanetShellView(scene);
        }

        const safeSurfaceFade = visuals.surfaceFade ?? surfaceFade;
        this._surfaceFade = safeSurfaceFade;

        const visBucket = safeSurfaceFade <= 0.08 ? 0 : safeSurfaceFade <= 0.35 ? 1 : 2;
        if (keyChanged || visBucket !== this._shellVisBucket) {
            this._shellVisBucket = visBucket;
            const showTerrain = safeSurfaceFade > 0.03 && planetReveal <= 0.05;
            if (showTerrain) {
                this._surfaceHidden = false;
                const vis = visBucket >= 1;
                const grass = visBucket >= 2;
                for (const mesh of this.loadedChunks.values()) {
                    mesh.visible = vis;
                    if (mesh.userData.grassMesh) mesh.userData.grassMesh.visible = grass;
                    if (mesh.userData.mossMesh) mesh.userData.mossMesh.visible = grass;
                    if (mesh.userData.rockMesh) mesh.userData.rockMesh.visible = vis;
                    if (mesh.userData.pebbleMesh) mesh.userData.pebbleMesh.visible = vis;
                }
            } else if (!this._surfaceHidden) {
                this.setSurfaceVisible(false);
                this._shellVisBucket = -1;
            }
        }

        if (keyChanged && this.skyDome) {
            this.skyDome.visible = spaceBlend < 0.98;
            const u = this.skyDome.material?.uniforms;
            if (u && horizon && zenith) {
                u.horizonColor.value.copy(horizon);
                this._blendMid.copy(zenith).lerp(horizon, 0.4);
                u.midColor.value.copy(this._blendMid);
                u.topColor.value.copy(zenith);
                u.aerialT.value = skyAerial;
            }
        }

        if (keyChanged) {
            if (this.starsMesh) this.starsMesh.visible = spaceBlend > 0.35;
            if (this.haze) {
                this.haze.visible = safeSurfaceFade > 0.1 && spaceBlend < 0.85;
                this.haze.material.opacity = THREE.MathUtils.lerp(0.08, 0.2, visuals.atmoHaze ?? 0);
            }
        }

        if (visuals.veilStrength != null) {
            this.setTransitionVeil(visuals.veilStrength);
        }

        if (scene && spaceBlend < 0.96 && horizon && keyChanged) {
            if (!scene.fog || scene.fog.isFog) {
                scene.fog = new THREE.FogExp2(horizon, fogDensity);
            } else {
                scene.fog.color.copy(horizon);
                scene.fog.density = fogDensity;
            }
            if (scene.background?.isColor) scene.background.copy(horizon);
            else scene.background = horizon.clone();
        }
    }

    /**
     * Ascenso atmosférico — oculta mapa/chunks antes y oscurece el cielo hacia el espacio.
     * @param {number} surfaceVisibility 0..1 — 0 = mapa oculto
     * @param {number} skyDarken 0..1 — 1 = cielo casi negro
     */
    setAscentBlend(surfaceVisibility, skyDarken) {
        const vis = THREE.MathUtils.clamp(surfaceVisibility, 0, 1);
        const dark = THREE.MathUtils.clamp(skyDarken, 0, 1);
        this.setSurfaceFade(vis);
        if (this.haze) this.haze.visible = vis > 0.22;
        if (this.skyDome) this.skyDome.visible = dark < 0.88;
        if (this.starsMesh) this.starsMesh.visible = dark > 0.42;
        if (this.horizonMesh) this.horizonMesh.visible = false;
    }

    _trimGrassPositions(list, maxCount) {
        if (list.length <= maxCount) return list;
        const stride = list.length / maxCount;
        const trimmed = [];
        for (let i = 0; i < maxCount; i++) trimmed.push(list[Math.floor(i * stride)]);
        return trimmed;
    }

    isPlanetSphereView() {
        return this._planetSphereActive;
    }

    /** Activa vista esfera — oculta mapa plano. */
    setPlanetSphereView(active) {
        if (active) {
            this._planetSphereActive = true;
            this._stratosphereSpaceView = true;
            this._forceSurfaceHidden();
            return;
        }
        this.releasePlanetShellView();
    }

    /** Libera vista esfera — permite que vuelva el mapa plano. */
    releasePlanetShellView(scene = null, { restoreSky = false } = {}) {
        this._planetSphereActive = false;
        this._stratosphereSpaceView = false;
        if (restoreSky && scene) {
            this.resetSkyToDay(scene);
            if (this.haze) this.haze.visible = true;
            if (this.dustParticles) this.dustParticles.visible = true;
        }
    }

    _setChunkPartVisible(mesh, visible) {
        if (!mesh) return;
        mesh.visible = visible;
    }

    _applyChunkVisibility(mesh) {
        if (!mesh) return;
        if (this._planetSphereActive) {
            this._setChunkPartVisible(mesh, false);
            this._setChunkPartVisible(mesh.userData.grassMesh, false);
            this._setChunkPartVisible(mesh.userData.mossMesh, false);
            this._setChunkPartVisible(mesh.userData.rockMesh, false);
            this._setChunkPartVisible(mesh.userData.pebbleMesh, false);
            this._setChunkPartVisible(mesh.userData.crystalMesh, false);
            this._setChunkPartVisible(mesh.userData.waterPlantMesh, false);
            return;
        }
        const f = this._surfaceFade;
        const show = !this._surfaceHidden && f > 0.38;
        const grass = !this._surfaceHidden && f > 0.25;
        const decor = !this._surfaceHidden && f > 0.15;
        mesh.visible = show;
        if (mesh.userData.grassMesh) mesh.userData.grassMesh.visible = grass;
        if (mesh.userData.mossMesh) mesh.userData.mossMesh.visible = grass;
        if (mesh.userData.rockMesh) mesh.userData.rockMesh.visible = decor;
        if (mesh.userData.pebbleMesh) mesh.userData.pebbleMesh.visible = decor;
        if (mesh.userData.crystalMesh) mesh.userData.crystalMesh.visible = grass;
        if (mesh.userData.waterPlantMesh) mesh.userData.waterPlantMesh.visible = grass;
    }

    _forceSurfaceHidden() {
        this._surfaceHidden = true;
        this._surfaceFade = 0;
        this.chunkQueue.length = 0;
        this.queuedChunkKeys.clear();
        this._grassJobs = [];
        for (const mesh of this.loadedChunks.values()) {
            this._applyChunkVisibility(mesh);
        }
        
        // Nuclear fallback: ocultar cualquier mesh de terreno huérfano en la escena
        if (this.scene) {
            this.scene.traverse((obj) => {
                if (obj.userData?.chunkCoord || obj.userData?.grassMesh || obj.userData?.rockMesh || obj.userData?.isTerrainChunk) {
                    obj.visible = false;
                }
            });
        }
        
        this._hideFlatWorldLayers();
    }

    /** Apaga cielo plano, bruma y velo — solo esfera 3D + estrellas en estratosfera. */
    _hideFlatWorldLayers() {
        if (this.skyDome) this.skyDome.visible = false;
        if (this.haze) this.haze.visible = false;
        if (this.horizonMesh) this.horizonMesh.visible = false;
        if (this.starsMesh) this.starsMesh.visible = false;
        if (this.dustParticles) this.dustParticles.visible = false;
        if (this._transitionVeil) {
            this._transitionVeil.visible = false;
            this._transitionVeil.material.opacity = 0;
        }
    }

    // Llamado cada frame desde game.js con la posición y velocidad del jugador
    update(playerPosition, playerVelocity, travelOpts = {}) {
        if (this._flightMode) return;

        if (this._planetSphereActive) {
            this._forceSurfaceHidden();
            this._tickSkyFollow(playerPosition);
            return;
        }

        if (this._ascendPerfMode) {
            this._tickSkyFollow(playerPosition);
            return;
        }

        const combatLoad = window.__game?.enemyManager?.combatLoadLevel ?? this._combatLoadLevel ?? 'light';
        this.setCombatLoad(combatLoad);
        const combatBusy = combatLoad !== 'light';
        const combatHeavy = combatLoad === 'heavy';

        this._lastStreamPos.copy(playerPosition);
        const { cx: pcx, cz: pcz } = this._worldToChunk(playerPosition.x, playerPosition.z);
        this._streamPlayerCx = pcx;
        this._streamPlayerCz = pcz;
        this._streamForward = resolveStreamForward(playerVelocity, travelOpts.viewDir ?? null);

        const fastTravel = this._isFastTravel(playerVelocity, travelOpts);
        this._purgeInvisibleQueue(pcx, pcz, this._streamForward, fastTravel);
        this._purgeInvisibleGrassJobs(pcx, pcz, this._streamForward);

        if (this._wasCombatBusy && !combatBusy) {
            this._queueFullDecorNear(playerPosition.x, playerPosition.z);
            this._decorateBurstUntil = performance.now() + 1800;
        }
        this._wasCombatBusy = combatBusy;

        const wasFastTravel = this._wasFastTravel;
        this._wasFastTravel = fastTravel;
        this._fastTravel = fastTravel;

        if (wasFastTravel && !fastTravel && !combatBusy) {
            this._decorateBurstUntil = performance.now() + 2800;
            this._queueFullDecorNear(playerPosition.x, playerPosition.z);
        }

        this.updateShadows(playerPosition);
        
        if (this.terrainMat && this.terrainMat.userData.shader) {
            this.terrainMat.userData.shader.uniforms.time.value += 0.016;
        }

        if (this.floraCapMat && this.floraCapMat.userData.shader) {
            this.floraCapMat.userData.shader.uniforms.time.value += 0.016;
        }
        
        // Precarga en cola (nunca síncrona — evita tirones con impulsor)
        this._preloadCriticalChunks(playerPosition.x, playerPosition.z, playerVelocity, fastTravel);
        this._loadChunksAround(playerPosition.x, playerPosition.z, playerVelocity, fastTravel);
        this._trimChunkQueue();

        this._ensureDecorTimer -= 0.016;
        if (!fastTravel && !combatHeavy && this._ensureDecorTimer <= 0) {
            const speedSq = playerVelocity
                ? playerVelocity.x * playerVelocity.x + playerVelocity.z * playerVelocity.z
                : 0;
            if (speedSq < 120 * 120) {
                this._ensureFullDecorNear(playerPosition.x, playerPosition.z);
            }
            this._ensureDecorTimer = 1.8;
        }

        const queueSize = this.chunkQueue.length;
        const buildStart = performance.now();
        const buildPerFrame = this._bootStreaming && queueSize <= 8
            ? Math.min(this._buildPerFrameMax, 2)
            : 1;

        for (let n = 0; n < buildPerFrame && this.chunkQueue.length > 0; n++) {
            if (n > 0 && performance.now() - buildStart > this._buildBudgetMs) break;

            const chunk = this._pickNextChunk(playerPosition, fastTravel);
            if (!chunk) break;
            this.queuedChunkKeys.delete(`${this._chunkKey(chunk.cx, chunk.cz)}:${chunk.detailLevel}`);
            const cdx = chunk.cx - pcx;
            const cdz = chunk.cz - pcz;
            if (shouldStreamChunk(cdx, cdz, this._streamForward, fastTravel)) {
                let detail = chunk.detailLevel || 'full';
                const chunkManhattan = Math.abs(cdx) + Math.abs(cdz);
                if (combatHeavy && detail === 'full' && chunkManhattan > this.CHUNK_RADIUS_FULL) {
                    detail = 'mid';
                }
                this._buildChunk(chunk.cx, chunk.cz, detail);
            }

            if (performance.now() - buildStart > this._buildBudgetMs) break;
        }

        this._processGrassJobs(this._combatLoadLevel === 'heavy' ? 4 : this._grassJobBudgetMs);

        this._horizonUpdateTimer -= 0.016;
        const horizonMoved = !Number.isFinite(this._lastHorizonPos.x)
            || Math.hypot(
                playerPosition.x - this._lastHorizonPos.x,
                playerPosition.z - this._lastHorizonPos.z
            ) > 1200;
        const horizonBlocked = !this._horizonEnabled || fastTravel || queueSize > 10 || this._atmosphericFlightView;
        if (!horizonBlocked && (this._horizonUpdateTimer <= 0 || horizonMoved)) {
            this._updateHorizonTerrain(playerPosition);
            this._horizonUpdateTimer = this._horizonInterval;
        }
        
        // El cielo y el horizonte siguen al jugador para parecer infinitos
        this._tickSkyFollow(playerPosition);

        // Animar partículas de polvo (omitir bajo carga de combate o impulsor)
        const streamingMap = fastTravel || queueSize > 10;
        if (this.dustParticles && this._gfxDust && !combatHeavy && !streamingMap) {
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

        // Animar la hierba procedural solo en chunks cercanos (full LOD)
        if (this._grassMat?.userData?.shader && !streamingMap) {
            const sh = this._grassMat.userData.shader;
            sh.uniforms.time.value += 0.016;
            sh.uniforms.playerPos.value.copy(playerPosition);
            sh.uniforms.windMul.value = combatHeavy ? 0.2 : combatBusy ? 0.55 : 1.0;
        }

        // Ya no hacemos escaneo extra de chunks por distancia en cada frame.
    }


    // Calcula la altura para crear un Mundo Abierto con Cordilleras Montañosas
    getHeightAt(x, z) {
        // 1. Llanuras base y colinas suaves (Nunca es 100% plano)
        let base = Math.sin(x * 0.001) * Math.cos(z * 0.0012) * 20;
        base += Math.sin(x * 0.003 + z * 0.002) * 10;
        base += 15; // Promedio en 15 (tierra firme)

        // 2. Dunas ondulantes + colinas medias (visibles a 1–4 km)
        let d1 = Math.sin(x * 0.0006 + Math.cos(z * 0.0004)) * 30;
        let d2 = Math.cos(z * 0.0008 + Math.sin(x * 0.0007)) * 20;
        let dunes = d1 + d2;
        let midHills = Math.sin(x * 0.00017 + 1.3) * Math.cos(z * 0.00015 + 0.7) * 38;
        midHills += Math.sin(x * 0.00024 - z * 0.00021) * 22;
        midHills += Math.cos(x * 0.00011 + z * 0.00013) * 18;
        
        // 3. Cordilleras orgánicas (sin terrazas ni picos triangulares)
        let mountainHeight = this._mountainHeightAt(x, z);

        let h = base + dunes + midHills + mountainHeight;
        h += this._getPartitionWallHeight(x, z);

        // Coordenadas de zonas para esculpir cuencas más orgánicas y menos simétricas
        const z1x = CONFIG.ZONES.ZONA1.x, z1z = CONFIG.ZONES.ZONA1.z;
        const z2x = CONFIG.ZONES.ZONA2.x, z2z = CONFIG.ZONES.ZONA2.z;
        const z3x = CONFIG.ZONES.ZONA3.x, z3z = CONFIG.ZONES.ZONA3.z;

        const smoothstep = (e0, e1, v) => this._smoothstep(e0, e1, v);

        // 3. Macro-cuencas orgánicas (sin patrón sinusoidal espejo)
        const rx = x * 0.00046 + z * 0.00019;
        const rz = -x * 0.00023 + z * 0.00051;
        const warpX = Math.sin(rz * 2.7 + Math.cos(rx * 1.9)) * 0.42;
        const warpZ = Math.cos(rx * 2.4 - Math.sin(rz * 1.7)) * 0.38;
        const bx = rx + warpX;
        const bz = rz + warpZ;
        const basinField = Math.sin(bx * 3.4) * 0.55 + Math.cos(bz * 3.0) * 0.45 + Math.sin((bx + bz) * 2.2) * 0.25;
        const basinMask = smoothstep(0.78, 0.97, basinField);
        h -= basinMask * basinMask * 75;

        // 3.1 Cuencas dirigidas entre rutas principales para costas más creíbles
        let phase = 19.0;
        let ox = Math.sin((z + phase) * 0.0011) * 140 + Math.cos((x - phase) * 0.0009) * 90;
        let oz = Math.cos((x - phase) * 0.0010) * 130 - Math.sin((z + phase) * 0.0008) * 85;
        let dxn = (x + ox - z1x * 0.45) / 1800;
        let dzn = (z + oz - z1z * 0.45) / 1500;
        let dn = Math.sqrt(dxn * dxn + dzn * dzn);
        let core = 1.0 - smoothstep(0.58, 1.0, dn);
        let rim = smoothstep(0.66, 0.96, dn) * (1.0 - smoothstep(0.96, 1.16, dn));
        let localNoise = 0.8 + 0.2 * Math.sin((x + phase) * 0.0017 + Math.cos((z - phase) * 0.0013));
        h -= core * core * 50 * localNoise;
        h += rim * 5.0;

        phase = 91.0;
        ox = Math.sin((z + phase) * 0.0011) * 140 + Math.cos((x - phase) * 0.0009) * 90;
        oz = Math.cos((x - phase) * 0.0010) * 130 - Math.sin((z + phase) * 0.0008) * 85;
        dxn = (x + ox - (z1x + z2x) * 0.5) / 2100;
        dzn = (z + oz - (z1z + z2z) * 0.5) / 1700;
        dn = Math.sqrt(dxn * dxn + dzn * dzn);
        core = 1.0 - smoothstep(0.58, 1.0, dn);
        rim = smoothstep(0.66, 0.96, dn) * (1.0 - smoothstep(0.96, 1.16, dn));
        localNoise = 0.8 + 0.2 * Math.sin((x + phase) * 0.0017 + Math.cos((z - phase) * 0.0013));
        h -= core * core * 64 * localNoise;
        h += rim * 5.0;

        phase = 177.0;
        ox = Math.sin((z + phase) * 0.0011) * 140 + Math.cos((x - phase) * 0.0009) * 90;
        oz = Math.cos((x - phase) * 0.0010) * 130 - Math.sin((z + phase) * 0.0008) * 85;
        dxn = (x + ox - (z2x + z3x) * 0.5) / 2300;
        dzn = (z + oz - (z2z + z3z) * 0.5) / 1900;
        dn = Math.sqrt(dxn * dxn + dzn * dzn);
        core = 1.0 - smoothstep(0.58, 1.0, dn);
        rim = smoothstep(0.66, 0.96, dn) * (1.0 - smoothstep(0.96, 1.16, dn));
        localNoise = 0.8 + 0.2 * Math.sin((x + phase) * 0.0017 + Math.cos((z - phase) * 0.0013));
        h -= core * core * 74 * localNoise;
        h += rim * 5.0;

        // 4. Muro perimetral — borde del disco jugable (precipicio visible)
        let distFromCenter = Math.sqrt(x * x + z * z);
        const outerR = WORLD_MAP.playableRadius;
        if (distFromCenter > outerR) {
            const over = distFromCenter - outerR;
            h += over * 0.85 + over * over * 0.004;
            if (distFromCenter > outerR + 800) return 380;
        }

        return h;
    }

    // Dibuja el mapa procedimental — repartido en frames para no congelar el arranque
    scheduleMinimapBake() {
        const minimap = document.getElementById('minimap');
        if (!minimap || this._minimapBake) return;

        const MAP = 24000;
        const HALF = MAP / 2;
        const RES = 256;
        const canvas = document.createElement('canvas');
        canvas.width = RES;
        canvas.height = RES;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(RES, RES);
        const scratch = new THREE.Color();

        this._minimapBake = { minimap, canvas, ctx, imgData, scratch, MAP, HALF, RES, row: 0, rowsPerTick: 6 };
        requestAnimationFrame(() => this._tickMinimapBake());
    }

    _tickMinimapBake() {
        const job = this._minimapBake;
        if (!job) return;

        const { imgData, scratch, MAP, HALF, RES } = job;
        const endRow = Math.min(job.row + job.rowsPerTick, RES);

        for (let i = job.row; i < endRow; i++) {
            for (let j = 0; j < RES; j++) {
                const worldX = (i / RES) * MAP - HALF;
                const worldZ = (j / RES) * MAP - HALF;
                this._paintTerrainColor(worldX, worldZ, scratch);

                const hLeft = this.getHeightAt(worldX - 80, worldZ);
                const hHere = this.getHeightAt(worldX, worldZ);
                const slope = (hHere - hLeft) / 80;
                const light = Math.max(0.55, Math.min(1.35, 1.0 + slope * 1.2));

                const idx = (j * RES + i) * 4;
                imgData.data[idx]     = Math.min(255, scratch.r * 255 * light);
                imgData.data[idx + 1] = Math.min(255, scratch.g * 255 * light);
                imgData.data[idx + 2] = Math.min(255, scratch.b * 255 * light);
                imgData.data[idx + 3] = 255;
            }
        }

        job.row = endRow;
        if (job.row < RES) {
            requestAnimationFrame(() => this._tickMinimapBake());
            return;
        }

        job.ctx.putImageData(imgData, 0, 0);
        this._drawMinimapOverlays(job.ctx, job.RES, job.MAP, job.HALF);
        job.minimap.style.backgroundImage = `url(${job.canvas.toDataURL()})`;
        job.minimap.style.backgroundSize = 'cover';
        this._minimapBake = null;
    }

    _drawMinimapOverlays(ctx, RES, MAP, HALF) {
        const w2p = (wx, wz) => ({
            x: ((wx + HALF) / MAP) * RES,
            y: ((wz + HALF) / MAP) * RES,
        });

        ctx.lineWidth = 1.5;

        const mapCenter = w2p(0, 0);
        const playablePx = (WORLD_MAP.playableRadius / MAP) * RES;
        const cliffPx = (WORLD_MAP.playableRadius * WORLD_MAP.playerClampScale / MAP) * RES;

        ctx.beginPath();
        ctx.strokeStyle = 'rgba(180, 90, 60, 0.85)';
        ctx.lineWidth = 3;
        ctx.arc(mapCenter.x, mapCenter.y, cliffPx, 0, Math.PI * 2);
        ctx.stroke();

        for (const region of planet01.regions || []) {
            const p = w2p(region.center.x, region.center.z);
            const rad = (region.radius / MAP) * RES;
            ctx.beginPath();
            ctx.strokeStyle = region.color || 'rgba(255,255,255,0.35)';
            ctx.lineWidth = region.hasSpawner ? 2.5 : 1.5;
            ctx.setLineDash(region.hasSpawner ? [] : [3, 5]);
            ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        const zoneColors = { ZONA1: '#ff4444', ZONA2: '#44aaff', ZONA3: '#bb66ff' };
        for (const [key, zone] of Object.entries(CONFIG.ZONES)) {
            const p = w2p(zone.x, zone.z);
            const rad = (zone.radius / MAP) * RES;
            ctx.beginPath();
            ctx.strokeStyle = zoneColors[key] || '#ffffff';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = zoneColors[key] || '#fff';
            ctx.font = 'bold 9px monospace';
            ctx.fillText(key.replace('ZONA', 'Z'), p.x - 6, p.y + 3);
        }

        const hub = planet01.hub || { x: 0, z: 4000 };
        const spawn = w2p(hub.x, hub.z);
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(120, 255, 180, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 4]);
        ctx.arc(spawn.x, spawn.y, ((hub.safeRadius || 2200) / MAP) * RES, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.fillStyle = 'rgba(255, 220, 120, 0.9)';
        ctx.arc(spawn.x, spawn.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 8px monospace';
        ctx.fillText('HUB', spawn.x - 10, spawn.y - 7);

        ctx.fillStyle = 'rgba(4, 8, 14, 0.62)';
        ctx.beginPath();
        ctx.rect(0, 0, RES, RES);
        ctx.moveTo(mapCenter.x + playablePx, mapCenter.y);
        ctx.arc(mapCenter.x, mapCenter.y, playablePx, 0, Math.PI * 2, true);
        ctx.fill();

        ctx.beginPath();
        ctx.strokeStyle = 'rgba(90, 190, 215, 0.75)';
        ctx.lineWidth = 2;
        ctx.arc(mapCenter.x, mapCenter.y, playablePx, 0, Math.PI * 2);
        ctx.stroke();
    }

    /** @deprecated Usar scheduleMinimapBake — conservado por compatibilidad interna. */
    generateMinimapBackground() {
        this.scheduleMinimapBake();
    }

    updateShadows(playerPosition) {
        if (!CONFIG.GRAPHICS.ENABLE_SHADOWS || !this.sunLight) return;
        // El sol se mueve con el jugador para que las sombras sean nítidas a su alrededor
        this.sunLight.position.set(playerPosition.x + 500, playerPosition.y + 1000, playerPosition.z + 500);
        this.sunLight.target.position.copy(playerPosition);
        this.sunLight.target.updateMatrixWorld();
    }

    initStars() {
        const starCount = 2200;
        const posArray = new Float32Array(starCount * 3);
        const colorsArray = new Float32Array(starCount * 3);
        const sizeArray = new Float32Array(starCount);
        const c = new THREE.Color();
        const radius = 21000;
        const minElev = 0.22;

        for (let i = 0; i < starCount; i++) {
            const theta = 2 * Math.PI * Math.random();
            const cosPhi = minElev + (1 - minElev) * Math.random();
            const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);

            posArray[i * 3] = radius * sinPhi * Math.cos(theta);
            posArray[i * 3 + 1] = radius * cosPhi;
            posArray[i * 3 + 2] = radius * sinPhi * Math.sin(theta);

            const randColor = Math.random();
            if (randColor > 0.92) c.setHex(0xaaccff);
            else if (randColor > 0.85) c.setHex(0xffddbb);
            else c.setHex(0xffffff);

            colorsArray[i * 3] = c.r;
            colorsArray[i * 3 + 1] = c.g;
            colorsArray[i * 3 + 2] = c.b;
            sizeArray[i] = 0.6 + Math.random() * 2.2;
        }

        const starGeo = new THREE.BufferGeometry();
        starGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        starGeo.setAttribute('color', new THREE.BufferAttribute(colorsArray, 3));
        starGeo.setAttribute('size', new THREE.BufferAttribute(sizeArray, 1));

        const starMat = new THREE.ShaderMaterial({
            uniforms: {},
            vertexColors: true,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            fog: false,
            blending: THREE.AdditiveBlending,
            vertexShader: `
                attribute float size;
                attribute vec3 color;
                varying vec3 vColor;
                varying float vBright;
                void main() {
                    vColor = color;
                    vBright = 0.7 + 0.3 * fract(sin(dot(color.xy, vec2(12.9898, 78.233))) * 43758.5453);
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = size * (420.0 / max(-mvPosition.z, 1.0));
                    gl_PointSize = clamp(gl_PointSize, 0.5, 5.0);
                    gl_Position = projectionMatrix * mvPosition;
                    gl_Position.z = gl_Position.w * 0.9995;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vBright;
                void main() {
                    vec2 uv = gl_PointCoord - 0.5;
                    float d = length(uv);
                    float core = 1.0 - smoothstep(0.0, 0.12, d);
                    float halo = 1.0 - smoothstep(0.05, 0.45, d);
                    float alpha = core + halo * 0.25;
                    if (alpha < 0.03) discard;
                    vec3 col = vColor * vBright;
                    col += vec3(0.08) * halo;
                    gl_FragColor = vec4(col, alpha * 0.92);
                }
            `
        });

        this.starsMesh = new THREE.Points(starGeo, starMat);
        this.starsMesh.frustumCulled = false;
        this.starsMesh.renderOrder = -90;
        this.starsMesh.visible = false;
        this.scene.add(this.starsMesh);
    }
}
