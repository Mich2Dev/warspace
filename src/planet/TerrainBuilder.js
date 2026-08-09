import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';

export const globalTerrainUniforms = { time: { value: 0 } };

// PRNG Determinista (Mulberry32) para que el terreno sea idéntico en todos los clientes
function mulberry32(a) {
    return function() {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}
const noise3D = createNoise3D(mulberry32(123456789)); // Semilla global fija
export function getNoise(x, y, z) { return noise3D(x, y, z); }
const RESOLUTION = 22; // más densidad = menos pop al cambiar de LOD

export class TerrainBuilder {
  static buildChunk(localUp, axisA, axisB, radius, center, size, color, biome = 'Terran') {
    const geometry = new THREE.PlaneGeometry(size, size, RESOLUTION, RESOLUTION);
    const positions = geometry.attributes.position;
    
    // Arrays for vertex colors and normals
    const colors = new Float32Array(positions.count * 3);
    const normals = new Float32Array(positions.count * 3);
    const baseColorObj = new THREE.Color(color);
    const peakColorObj = baseColorObj.clone().lerp(new THREE.Color(0xffffff), 0.7); // Softer snowy peaks
    const valleyColorObj = new THREE.Color(color).multiplyScalar(0.2); // Darker valleys
    
    // We map the plane onto the sphere
    const vertex = new THREE.Vector3();
    
    for (let i = 0; i < positions.count; i++) {
      // Plane coordinates (-size/2 to size/2)
      const px = positions.getX(i);
      const py = positions.getY(i);
      
      // Map to cube face coordinates
      const cx = center.x + px;
      const cy = center.y + py;
      
      // Map to cube surface
      vertex.copy(localUp)
            .addScaledVector(axisA, cx)
            .addScaledVector(axisB, cy);
            
      // Map to sphere surface
      vertex.normalize();
      
      const rawRadius = TerrainBuilder.getHeight(vertex, radius, biome);
      
      let finalRadius = rawRadius;
      // AAA Technique: Clamp ocean/lake geometry so it's mathematically flat
      if (rawRadius < radius - 30.0) {
          finalRadius = radius - 30.0; 
      }
      
      // --- Calculate true seamless normals ---
      const epsT = 0.001; 
      const getPos = (dx, dy) => {
          const v = localUp.clone()
                .addScaledVector(axisA, cx + dx)
                .addScaledVector(axisB, cy + dy)
                .normalize();
          let r = TerrainBuilder.getHeight(v, radius, biome);
          if (r < radius - 30.0) r = radius - 30.0;
          return v.multiplyScalar(r);
      };
      
      const pCenter = vertex.clone().multiplyScalar(finalRadius);
      const pRight = getPos(epsT, 0);
      const pUp = getPos(0, epsT);
      
      const dPdx = pRight.sub(pCenter);
      const dPdy = pUp.sub(pCenter);
      const norm = new THREE.Vector3().crossVectors(dPdx, dPdy).normalize();
      
      normals[i * 3] = norm.x;
      normals[i * 3 + 1] = norm.y;
      normals[i * 3 + 2] = norm.z;
      // ----------------------------------------
      
      const heightOffset = rawRadius - radius; // Unclamped depth used for color gradients
      
      let vColor;
      
      if (biome === 'Lava') {
        // Transición suave costa→magma (evita manchas rojas planas)
        const shore = Math.min(1, Math.max(0, (-heightOffset - 10) / 120));
        const deep = Math.min(1, Math.max(0, (-heightOffset - 80) / 400));
        if (shore > 0.02) {
          const crust = new THREE.Color(0x1a0c08);
          const glow = new THREE.Color(0x5a1800).lerp(new THREE.Color(0xc43a00), deep);
          vColor = crust.lerp(glow, shore * shore);
        } else {
          // Basalto / ceniza / roca volcánica
          const t = Math.min(1, Math.max(0, heightOffset / 2500));
          const basalt = new THREE.Color(0x121214);
          const ash = new THREE.Color(0x2a2420);
          const ridge = new THREE.Color(0x3a322c);
          vColor = basalt.lerp(ash, Math.min(1, t * 1.4)).lerp(ridge, Math.max(0, t - 0.35));
        }
      } else if (biome === 'Ice') {
         vColor = baseColorObj.clone().lerp(new THREE.Color(0xffffff), 0.5 + Math.min(1.0, Math.max(0.0, heightOffset / 1000)));
      } else if (biome === 'Toxic') {
         if (heightOffset < -100) {
           vColor = new THREE.Color(0x88ff00); // Toxic sludge
         } else {
           vColor = baseColorObj.clone().multiplyScalar(0.7);
         }
      } else if (biome === 'GasGiant') {
         // Procedural swirls for gas giant vertex colors
         let swirl = (noise3D(vertex.x * 4.0, vertex.y * 4.0, vertex.z * 4.0) + 1) * 0.5;
         let swirl2 = (noise3D(vertex.x * 12.0, vertex.y * 12.0, vertex.z * 12.0) + 1) * 0.5;
         vColor = baseColorObj.clone().lerp(new THREE.Color(0xffffff), swirl * 0.5).lerp(new THREE.Color(0x442211), swirl2 * 0.3);
      } else if (biome === 'Desert') {
        if (heightOffset < -100) {
           const depthPercent = Math.min(1, Math.abs(heightOffset + 100) / 700);
           vColor = baseColorObj.clone().lerp(new THREE.Color(0x331100), depthPercent * 0.8);
        } else if (heightOffset > 400) {
           const peakPercent = Math.min(1, (heightOffset - 400) / 800);
           vColor = baseColorObj.clone().lerp(new THREE.Color(0xffcc88), peakPercent * 0.4); // Lighter sand, not snow
        } else {
           vColor = baseColorObj;
        }
      } else { // Terran / Default — alpine bands (meadow → rock → snow)
        if (heightOffset <= -30) {
           const depthPercent = Math.min(1, Math.abs(heightOffset + 30) / 300);
           vColor = new THREE.Color(0x0088ff).lerp(new THREE.Color(0x002266), depthPercent);
        } else if (heightOffset < -10) {
           vColor = new THREE.Color(0xdcaa77).lerp(valleyColorObj, (heightOffset + 30) / 20);
        } else if (heightOffset > 14000) {
           // High ice cap — cool blue-white
           const peakPercent = Math.min(1, (heightOffset - 14000) / 10000);
           vColor = new THREE.Color(0xc8d4e0).lerp(new THREE.Color(0xf2f6fa), peakPercent);
        } else if (heightOffset > 7000) {
           // Alpine: slate rock → patchy snow
           const alpine = Math.min(1, (heightOffset - 7000) / 7000);
           const rock = new THREE.Color(0x5a5854).lerp(new THREE.Color(0x8a8680), alpine * 0.5);
           vColor = rock.lerp(new THREE.Color(0xe8eef4), Math.pow(alpine, 1.35));
        } else if (heightOffset > 3500) {
           // Subalpine: cooler muted ground
           const t = (heightOffset - 3500) / 3500;
           vColor = valleyColorObj.clone().lerp(new THREE.Color(0x4a5a42), t * 0.55)
             .lerp(baseColorObj, 0.25).lerp(new THREE.Color(0x6a655c), t * 0.35);
        } else {
           const groundPercent = Math.max(0, (heightOffset + 10) / 3510);
           vColor = valleyColorObj.clone().lerp(baseColorObj, groundPercent);
        }
      }
      
      colors[i * 3] = vColor.r;
      colors[i * 3 + 1] = vColor.g;
      colors[i * 3 + 2] = vColor.b;
      
      vertex.multiplyScalar(finalRadius);
      
      positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    
    // Assign a basic material
    const material = new THREE.MeshStandardMaterial({ 
      vertexColors: true,
      roughness: (biome === 'Ice') ? 0.3 : (biome === 'Lava' ? 0.72 : 0.95),
      metalness: (biome === 'Ice') ? 0.1 : (biome === 'Lava' ? 0.08 : 0.0),
      emissive: biome === 'Lava' ? new THREE.Color(0x180600) : new THREE.Color(0x000000),
      emissiveIntensity: biome === 'Lava' ? 0.35 : 0,
      flatShading: false,
      side: THREE.DoubleSide
    });
    
    // Must change when onBeforeCompile GLSL changes, or WebGL keeps a broken/stale program
    material.customProgramCacheKey = function() {
        return biome + '_terrain_v5_lava_lod';
    };
    
    // Inject custom GLSL to generate procedural textures (Micro-details & Strata)
    material.onBeforeCompile = (shader) => {
      // Link the global time uniform to this shader instance
      shader.uniforms.time = globalTerrainUniforms.time;

      const noiseGLSL = `
          float hash(vec3 p) {
            p = fract(p * vec3(0.1031, 0.1030, 0.0973));
            p += dot(p, p.yxz + 33.33);
            return fract((p.x + p.y) * p.z);
          }
          float vnoise(vec3 x) {
            vec3 i = floor(x);
            vec3 f = fract(x);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                           mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                       mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                           mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
          }
          float fbm(vec3 x) {
              float v = 0.0;
              float a = 0.5;
              vec3 shift = vec3(100.0);
              for (int i = 0; i < 5; ++i) {
                  v += a * vnoise(x);
                  x = x * 2.0 + shift;
                  a *= 0.5;
              }
              return v;
          }
      `;

      // 1. Pass Local Position from Vertex to Fragment and add Time uniform
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
         uniform float time;
         varying vec3 vLocalPos;
         varying float vHeightOffset;
         varying vec3 vLocalNormal;
         varying float vCamDist;
         ${noiseGLSL}
        `
      );
       shader.vertexShader = shader.vertexShader.replace(
         '#include <begin_vertex>',
         `#include <begin_vertex>
          vLocalPos = position;
          vHeightOffset = length(position) - ${radius.toFixed(1)};
          vLocalNormal = normal;
          {
            vec4 _wp = modelMatrix * vec4(transformed, 1.0);
            vCamDist = length(cameraPosition - _wp.xyz);
          }
          
          int vBiomeType = ${(biome === 'Lava') ? 1 : (biome === 'GasGiant') ? 2 : (biome === 'Terran') ? 3 : (biome === 'Ice') ? 4 : 5};
          if (vBiomeType == 3 && vHeightOffset <= -28.0) {
              float physicalWave = vnoise(position * 0.003 + time * 0.5) * 6.0; 
              transformed += normalize(position) * physicalWave;
          }
          if (vBiomeType == 1 && vHeightOffset < -20.0) {
              // Ondulación solo de cerca (de lejos = estática tipo TV)
              float nearW = smoothstep(${(radius * 0.22).toFixed(1)}, ${(radius * 0.045).toFixed(1)}, vCamDist);
              float lavaWave = vnoise(position * 0.004 + time * 0.35) * 4.5
                            + vnoise(position * 0.012 - time * 0.55) * 1.8;
              float depthMask = smoothstep(-15.0, -70.0, vHeightOffset);
              transformed += normalize(position) * lavaWave * depthMask * nearW;
          }
         `
       );
      
      // 2. Add Noise Functions to Fragment Shader
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
          `#include <common>
           uniform float time;
           varying vec3 vLocalPos;
           varying float vHeightOffset;
           varying vec3 vLocalNormal;
           varying float vCamDist;
           ${noiseGLSL}
         `
      );

      // 3. Normal Perturbation
      shader.fragmentShader = shader.fragmentShader.replace(
         '#include <normal_fragment_begin>',
         `#include <normal_fragment_begin>
          int _biomeType = ${(biome === 'Lava') ? 1 : (biome === 'GasGiant') ? 2 : (biome === 'Terran') ? 3 : (biome === 'Ice') ? 4 : 5};
          if (_biomeType == 3) {
              if (vHeightOffset <= -28.0) {
                  // Dynamic Normal Perturbation for AAA liquid reflections
                  float eps = 2.0;
                  float n0 = fbm(vLocalPos * 0.005 - time * 0.5);
                  float nx = fbm((vLocalPos + vec3(eps, 0.0, 0.0)) * 0.005 - time * 0.5);
                  float nz = fbm((vLocalPos + vec3(0.0, 0.0, eps)) * 0.005 - time * 0.5);
                  
                  vec3 waveNormal = vec3(nx - n0, 0.0, nz - n0);
                  normal = normalize(normal - waveNormal * 1.5);
              } else {
                  float eps = 1.0;
                  float n0 = vnoise(vLocalPos * 0.08); 
                  float nx = vnoise((vLocalPos + vec3(eps, 0.0, 0.0)) * 0.08);
                  float ny = vnoise((vLocalPos + vec3(0.0, eps, 0.0)) * 0.08);
                  float nz = vnoise((vLocalPos + vec3(0.0, 0.0, eps)) * 0.08);
                  
                  vec3 bumpNormal = vec3(nx - n0, ny - n0, nz - n0);
                  normal = normalize(normal - bumpNormal * 2.5);
              }
          } else if (_biomeType == 1) {
              // Mercurio: relieve solo de cerca (órbita = limpio)
              float nearB = smoothstep(${(radius * 0.2).toFixed(1)}, ${(radius * 0.04).toFixed(1)}, vCamDist);
              if (nearB > 0.02) {
                float eps = 1.5;
                float freq = vHeightOffset < -25.0 ? 0.012 : 0.07;
                float n0 = vnoise(vLocalPos * freq + (vHeightOffset < -25.0 ? time * 0.25 : 0.0));
                float nx = vnoise((vLocalPos + vec3(eps, 0.0, 0.0)) * freq);
                float ny = vnoise((vLocalPos + vec3(0.0, eps, 0.0)) * freq);
                float nz = vnoise((vLocalPos + vec3(0.0, 0.0, eps)) * freq);
                vec3 bumpNormal = vec3(nx - n0, ny - n0, nz - n0);
                float bumpAmt = (vHeightOffset < -25.0 ? 1.8 : 2.8) * nearB;
                normal = normalize(normal - bumpNormal * bumpAmt);
              }
          }
         `
       );
      
      // 4. Modulate Diffuse Color with Procedural Textures and Biome Emissive Logic
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         
         // Biome-specific overrides
         int biomeType = ${(biome === 'Lava') ? 1 : (biome === 'GasGiant') ? 2 : (biome === 'Terran') ? 3 : (biome === 'Ice') ? 4 : 5};
         
         if (biomeType != 2) {
             // Solid planet: Micro-detail noise (Sand / Rock grit)
             float n1 = vnoise(vLocalPos * 0.0002); // Large features
             float n2 = vnoise(vLocalPos * 0.002);  // Medium features
             float n3 = vnoise(vLocalPos * 0.01);   // Fine details
             float grit = 0.6 + (n1 * 0.3) + (n2 * 0.2);
             
             // --- PROCEDURAL GRASS, DIRT, ALPINE ROCK & SNOW (TERRAN) ---
             if (biomeType == 3 && vHeightOffset > -28.0) {
                 float wetShore = 1.0 - smoothstep(-28.0, -20.0, vHeightOffset);
                 
                 vec3 localUp = normalize(vLocalPos);
                 float slope = abs(dot(normalize(vLocalNormal), localUp)); // 1.0 = flat
                 
                 float microNoise = vnoise(vLocalPos * 0.1) * 0.2;
                 float strata = vnoise(vLocalPos * 0.0008 + localUp * 40.0) * 0.15;
                 
                 vec3 grassColor = mix(vec3(0.06, 0.16, 0.07), vec3(0.04, 0.10, 0.05), wetShore);
                 grassColor += microNoise * vec3(0.02, 0.04, 0.01);
                 
                 // High meadow / tundra — cooler, shorter vegetation tone
                 vec3 alpineGrass = vec3(0.12, 0.16, 0.10) + microNoise * 0.08;
                 
                 vec3 dirtColor = mix(vec3(0.18, 0.14, 0.10), vec3(0.08, 0.06, 0.04), wetShore);
                 dirtColor += microNoise * 0.3;
                 
                 // Cold rock: slate + warm strata streaks
                 vec3 cliffColor = vec3(0.22, 0.21, 0.20) + microNoise * 0.45 + vec3(strata * 0.08, strata * 0.05, strata * 0.02);
                 vec3 alpineRock = vec3(0.38, 0.37, 0.36) + microNoise * 0.25 + vec3(0.02, 0.02, 0.03) * strata;
                 vec3 snowColor = vec3(0.88, 0.91, 0.95) + microNoise * 0.12;
                 vec3 iceCap = vec3(0.78, 0.84, 0.92) + microNoise * 0.08;
                 
                 float grassMix = smoothstep(0.1, 0.8, n2 + n3 * 0.5);
                 grassMix = mix(grassMix, grassMix * 0.4, wetShore * 0.8);
                 vec3 flatTerrain = mix(dirtColor, grassColor, grassMix);
                 
                 // Fade lush grass into alpine meadow with altitude
                 float meadowFade = smoothstep(2800.0, 5200.0, vHeightOffset + n1 * 600.0);
                 flatTerrain = mix(flatTerrain, mix(dirtColor * 0.9, alpineGrass, grassMix * 0.55), meadowFade);
                 
                 float rockBlend = smoothstep(0.68, 0.94, slope);
                 rockBlend = mix(1.0, rockBlend, 1.0 - wetShore);
                 
                 // Steeper faces go to alpine rock higher up
                 vec3 rockFace = mix(cliffColor, alpineRock, smoothstep(4000.0, 9000.0, vHeightOffset));
                 vec3 terrainMix = mix(rockFace, flatTerrain, rockBlend);
                 
                 // Patchy snow starts mid-mountain; solid ice on peaks / northish faces
                 float aspect = localUp.y * 0.5 + 0.5; // slight polar bias
                 float snowNoise = n1 * 1400.0 + n2 * 500.0;
                 float snowLine = smoothstep(5500.0, 9500.0, vHeightOffset + snowNoise - aspect * 800.0);
                 float iceLine = smoothstep(12000.0, 18000.0, vHeightOffset + snowNoise * 0.5);
                 // Less snow on near-vertical cliffs
                 snowLine *= smoothstep(0.35, 0.75, slope);
                 terrainMix = mix(terrainMix, snowColor, snowLine);
                 terrainMix = mix(terrainMix, iceCap, iceLine * 0.85);
                 
                 diffuseColor.rgb = mix(diffuseColor.rgb, terrainMix * grit * 1.45, 0.88);
                 
             } else if (biomeType == 4) { // ICE ONLY
                  diffuseColor.rgb *= grit; // Base snow/ice grit
                  
                  // Only add glowing cracks on flat ice lakes, not on snowy mountains
                  if (vHeightOffset < -50.0) {
                      float iceNoise = fbm(vLocalPos * 0.005); 
                      float cracks = 1.0 - smoothstep(0.0, 0.05, abs(iceNoise - 0.5)); 
                      float pulse = sin(time * 3.0 + fbm(vLocalPos * 0.001) * 10.0) * 0.5 + 0.5; 
                      vec3 iceGlow = vec3(0.0, 0.6, 1.0) * cracks * (1.0 + pulse * 2.0); 
                      diffuseColor.rgb += iceGlow;
                  }
             } else if (biomeType == 1) {
                 // --- MERCURIO / LAVA PLANET ---
                 // De lejos: mares suaves (sin ruido fino = sin “cucuyo”)
                 // De cerca: corteza, grietas y flujo animado
                 float nearD = smoothstep(${(radius * 0.28).toFixed(1)}, ${(radius * 0.05).toFixed(1)}, vCamDist);
                 float shore = smoothstep(-8.0, -55.0, vHeightOffset);
                 float deep = smoothstep(-40.0, -180.0, vHeightOffset);

                 // Vista lejana: color estable por altura + ruido MUY bajo
                 float big = vnoise(vLocalPos * 0.00015);
                 vec3 farRock = vec3(0.09, 0.08, 0.075) + big * 0.04;
                 vec3 farMagma = mix(vec3(0.35, 0.08, 0.02), vec3(0.7, 0.22, 0.04), deep);
                 vec3 farCol = mix(farRock, farMagma, shore);

                 vec3 nearCol = farCol;
                 if (nearD > 0.01) {
                   float micro = vnoise(vLocalPos * 0.09) * 0.2;
                   float strata = vnoise(vLocalPos * 0.0012) * 0.12;
                   vec3 localUp = normalize(vLocalPos);
                   float slope = abs(dot(normalize(vLocalNormal), localUp));

                   vec3 basalt = vec3(0.07, 0.065, 0.06) + micro * 0.15;
                   vec3 ash = vec3(0.16, 0.12, 0.10) + micro * 0.1;
                   vec3 scoria = vec3(0.22, 0.12, 0.08) + strata;
                   float ashMix = smoothstep(0.15, 0.85, n2);
                   vec3 rockCol = mix(basalt, ash, ashMix);
                   rockCol = mix(rockCol, scoria, (1.0 - slope) * 0.45);
                   rockCol *= grit * 1.15;

                   float flowA = fbm(vLocalPos * 0.0045 + vec3(time * 0.18, time * 0.07, -time * 0.11));
                   float flowB = fbm(vLocalPos * 0.011 - vec3(time * 0.22, -time * 0.09, time * 0.05));
                   float crustNoise = fbm(vLocalPos * 0.02 + flowA);
                   float cracks = 1.0 - smoothstep(0.0, 0.07, abs(crustNoise - 0.48));
                   float heat = smoothstep(0.35, 0.82, flowA * 0.65 + flowB * 0.35);
                   heat = mix(heat, 1.0, cracks * 0.85);
                   heat *= 0.55 + 0.45 * deep;

                   vec3 crust = vec3(0.05, 0.025, 0.015);
                   vec3 ember = vec3(0.55, 0.12, 0.02);
                   vec3 bright = vec3(1.1, 0.45, 0.08);
                   vec3 whiteHot = vec3(1.6, 1.1, 0.45);
                   vec3 magma = mix(ember, bright, heat);
                   magma = mix(magma, whiteHot, smoothstep(0.75, 0.95, heat) * deep);
                   magma = mix(crust, magma, clamp(0.35 + heat * 0.75 + cracks * 0.4, 0.0, 1.0));
                   float pulse = 0.88 + 0.12 * sin(time * 1.7 + flowA * 6.0);
                   magma *= pulse;
                   nearCol = mix(rockCol, magma, shore);
                 }

                 diffuseColor.rgb = mix(farCol, nearCol, nearD);
             } else {
                 diffuseColor.rgb *= grit;
             }
         } else {
             // Gas Giant: Swirling storms and atmospheric bands (AAA Quality)
             vec3 pos = normalize(vLocalPos); // pos is direction from center
             
             // Base bands based on latitude (y component)
             // We use multiple frequencies to make the bands irregular
             float bandNoise = fbm(pos * 5.0 + time * 0.1); // Animate clouds
             float lat = pos.y * 30.0 + bandNoise * 4.0; 
             float bands = sin(lat) * 0.5 + 0.5;
             
             // Add massive swirling storms (like Jupiter's red spot)
             float storm = fbm(pos * 15.0 + fbm(pos * 8.0) * 3.0 + time * 0.2);
             
             // Add micro-turbulence for up-close detail
             float micro = fbm(pos * 80.0 - time * 0.5);
             
             // Mix bands, storms and micro detail
             float finalDensity = (bands * 0.4) + (storm * 0.5) + (micro * 0.1);
             
             // Create rich color gradients (darker gas deeper down, lighter gas on top)
             vec3 darkGas = diffuseColor.rgb * 0.2;
             vec3 lightGas = diffuseColor.rgb * 1.5;
             vec3 stormGas = vec3(1.0, 0.9, 0.8); // whitish storm clouds
             
             // Blend
             vec3 blended = mix(darkGas, lightGas, finalDensity);
             
             // If storm is very intense, add storm cloud highlights
             if (storm > 0.7) {
                 blended = mix(blended, stormGas, (storm - 0.7) * 3.0);
             }
             
             diffuseColor.rgb = blended;
         }
         
         // --- PROCEDURAL WATER (TERRAN) ---
          if (biomeType == 3 && vHeightOffset <= -28.0) {
              // Chaotic, organic specular glints (like real ocean foam)
              float ripples = fbm(vLocalPos * 0.008 - time * 0.8);
              
              // Add bright specular highlights on waves
              float highlight = smoothstep(0.7, 1.0, ripples);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), highlight * 0.4);

              // Shoreline Foam
              float shoreBlend = smoothstep(-30.0, -28.0, vHeightOffset);
              float foamNoise = fbm(vLocalPos * 0.05 + time * 1.5);
              float foam = smoothstep(0.4, 0.8, foamNoise) * shoreBlend;
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), foam);
          }
        `
      );
      
      shader.fragmentShader = shader.fragmentShader.replace(
         '#include <emissivemap_fragment>',
         `#include <emissivemap_fragment>
          if (biomeType == 1) {
              float nearE = smoothstep(${(radius * 0.22).toFixed(1)}, ${(radius * 0.045).toFixed(1)}, vCamDist);
              float shoreE = smoothstep(-12.0, -70.0, vHeightOffset) * nearE;
              if (shoreE > 0.01) {
                  float flowE = fbm(vLocalPos * 0.005 + time * 0.15);
                  float crackE = 1.0 - smoothstep(0.0, 0.06, abs(fbm(vLocalPos * 0.018) - 0.5));
                  float heatE = smoothstep(0.4, 0.85, flowE) + crackE * 0.7;
                  heatE *= shoreE;
                  vec3 glow = mix(vec3(0.8, 0.15, 0.0), vec3(2.2, 0.9, 0.15), heatE);
                  float pulseE = 0.75 + 0.25 * sin(time * 2.0 + flowE * 8.0);
                  totalEmissiveRadiance += glow * heatE * pulseE * 1.6;
              }
              // Brillo suave lejano (sin grietas = sin cucuyo)
              float farGlow = smoothstep(-20.0, -90.0, vHeightOffset) * (1.0 - nearE);
              totalEmissiveRadiance += vec3(0.45, 0.12, 0.02) * farGlow * 0.35;
              float nearShore = smoothstep(80.0, -20.0, vHeightOffset) * (1.0 - smoothstep(-20.0, -80.0, vHeightOffset)) * nearE;
              if (nearShore > 0.05) {
                  float vein = 1.0 - smoothstep(0.0, 0.04, abs(fbm(vLocalPos * 0.03) - 0.5));
                  totalEmissiveRadiance += vec3(1.2, 0.25, 0.02) * vein * nearShore * 0.9;
              }
          }
         `
       );

      shader.fragmentShader = shader.fragmentShader.replace(
         '#include <roughnessmap_fragment>',
         `#include <roughnessmap_fragment>
          if (biomeType == 3) {
              if (vHeightOffset <= -28.0) {
                  roughnessFactor = 0.05; // Agua hiper-reflectante
              } else {
                  float wetShore = 1.0 - smoothstep(-28.0, -20.0, vHeightOffset);
                  float n1 = vnoise(vLocalPos * 0.0002);
                  float snowLine = smoothstep(5500.0, 9500.0, vHeightOffset + (n1 * 1400.0));
                  float iceLine = smoothstep(12000.0, 18000.0, vHeightOffset);
                  float baseRough = mix(0.95, 0.4, wetShore);
                  roughnessFactor = mix(baseRough, 0.55, snowLine);
                  roughnessFactor = mix(roughnessFactor, 0.35, iceLine);
              }
          } else if (biomeType == 1) {
              float magmaAmt = smoothstep(-15.0, -90.0, vHeightOffset);
              roughnessFactor = mix(0.92, 0.28, magmaAmt);
          }
         `
       );
       
       shader.fragmentShader = shader.fragmentShader.replace(
         '#include <metalnessmap_fragment>',
         `#include <metalnessmap_fragment>
          if (biomeType == 3 && vHeightOffset <= -28.0) {
              metalnessFactor = 0.0;
          }
          if (biomeType == 1) {
              float magmaAmt = smoothstep(-20.0, -100.0, vHeightOffset);
              metalnessFactor = mix(0.05, 0.25, magmaAmt);
          }
         `
       );
    };
    
    return new THREE.Mesh(geometry, material);
  }

  /**
   * Intensidad de lava jugable (0..1) según profundidad del magma.
   * 0 = roca / ceniza; costa caliente suave; 1 = charco profundo.
   */
  static getLavaIntensity(normalizedVertex, baseRadius, biome = 'Terran') {
    if (biome !== 'Lava') return 0;
    const h = TerrainBuilder.getHeight(normalizedVertex, baseRadius, biome, false);
    const elev = h - baseRadius;
    // Alineado con colores del shader (shore ~-8…-55, deep más abajo)
    if (elev >= -8) return 0;
    if (elev >= -40) {
      const t = (-8 - elev) / 32; // 0 en -8 → 1 en -40
      return 0.12 + t * t * 0.43; // costa: 0.12…0.55
    }
    const deep = Math.min(1, (-40 - elev) / 100); // -40 → 0, -140 → 1
    return 0.55 + deep * 0.45;
  }

  // Exposed so Spaceship can do collision detection exactly matching the procedural mesh
  static getHeight(normalizedVertex, baseRadius, biome = 'Terran', clampWater = false) {
    if (biome === 'GasGiant') return baseRadius; // Gas Giants are smooth spheres!

    const freq = 1.5; // Escala global
    
    // 1. Ruido Continental (Masa de tierra vs Valles planos)
    let nCont = noise3D(normalizedVertex.x * freq, normalizedVertex.y * freq, normalizedVertex.z * freq);
    nCont = (nCont + 1.0) * 0.5; // Rango [0, 1]
    
    // 2. Montañas Naturales (Ridged Multifractal suavizado)
    let nMount = noise3D(normalizedVertex.x * freq * 5.0, normalizedVertex.y * freq * 5.0, normalizedVertex.z * freq * 5.0);
    nMount = Math.max(0.0, 1.0 - Math.abs(nMount)); // Crea crestas afiladas y asegura que nunca sea negativo para Math.pow
    nMount = Math.pow(nMount, 1.5); // Exponente más suave para evitar picos aislados (artefactos)
    
    // 3. Cañones Gigantes (Grietas profundas en el terreno)
    let nCanyon = noise3D(normalizedVertex.x * freq * 3.0, normalizedVertex.y * freq * 3.0, normalizedVertex.z * freq * 3.0);
    let canyonEffect = 0;
    
    let canyonThreshold = (biome === 'Toxic') ? 0.08 : 0.03; // Toxic planets are riddled with canyons
    if (Math.abs(nCanyon) < canyonThreshold) { // Si el ruido está muy cerca de 0, creamos una grieta
        let depth = (canyonThreshold - Math.abs(nCanyon)) / canyonThreshold; // 0 en los bordes, 1 en el centro
        canyonEffect = -Math.pow(depth, 1.5) * (baseRadius * 0.02); // Cañones (2% del radio)
        if (biome === 'Toxic') canyonEffect *= 2.0; // Mega canyons
    }
    
    // --- COMBINACIÓN DE GEOGRAFÍA (POR BIOMA) ---
    let elevation = 0;
    
    // Todos los planetas deberían tener continentes y valles para no verse "planos"
    if (biome === 'Lava') {
        // Costas irregulares + mares menos “planos”
        let coast = noise3D(normalizedVertex.x * freq * 3.2, normalizedVertex.y * freq * 3.2, normalizedVertex.z * freq * 3.2);
        let coast2 = noise3D(normalizedVertex.x * freq * 7.5, normalizedVertex.y * freq * 7.5, normalizedVertex.z * freq * 7.5);
        let seaMask = nCont + coast * 0.18 + coast2 * 0.08;
        if (seaMask < 0.34) {
            let depth = (0.34 - seaMask) / 0.34;
            elevation = -(baseRadius * 0.004) - depth * depth * (baseRadius * 0.009)
              + coast2 * (baseRadius * 0.0008); // fondo irregular
        } else {
            let mountainMask = (seaMask - 0.34) / 0.66;
            elevation = mountainMask * nMount * (baseRadius * 0.018);
            // Mesetas de ceniza
            elevation += Math.max(0, coast) * mountainMask * (baseRadius * 0.002);
        }
    } else if (biome === 'Ice') {
        if (nCont < 0.5) {
            elevation = -(baseRadius * 0.005) + nCont * (baseRadius * 0.002); // Planicies lisas
        } else {
            let mountainMask = (nCont - 0.5) / 0.5;
            elevation = mountainMask * nMount * (baseRadius * 0.008); // Montañas nevadas altas (0.8% del radio)
        }
    } else if (biome === 'Desert') {
        let nDune = Math.sin(normalizedVertex.x * 200.0 + noise3D(normalizedVertex.x * 10, normalizedVertex.y * 10, normalizedVertex.z * 10) * 2.0);
        if (nCont < 0.4) {
            elevation = -(baseRadius * 0.005) + (nDune * (baseRadius * 0.001)) + nCont * (baseRadius * 0.005);
        } else {
            let mountainMask = (nCont - 0.4) / 0.6;
            elevation = mountainMask * nMount * (baseRadius * 0.012) + (nDune * (baseRadius * 0.0005)); // Montañas (1.2% del radio)
        }
    } else {
        // Terran / Default
        if (nCont < 0.4) {
            elevation = -(baseRadius * 0.005) + nCont * (baseRadius * 0.008); 
        } else {
            let mountainMask = (nCont - 0.4) / 0.6; 
            elevation = mountainMask * nMount * (baseRadius * 0.06); // Montañas épicas colosales (6% = 30,000m)
        }
    }
    
    // Aplicar cañones (solo restan altura, cortando el terreno)
    if (elevation > 0 && canyonEffect < 0) {
        elevation += canyonEffect;
    }

    // 4. Cráteres (Esparcidos)
    let craterFreq = (biome === 'Ice' || biome === 'Desert') ? 12.0 : 18.0; // More craters on barren planets
    let nCrater = noise3D(normalizedVertex.x * freq * craterFreq, normalizedVertex.y * freq * craterFreq, normalizedVertex.z * freq * craterFreq);
    let craterEffect = 0;
    
    if (nCrater > 0.6) {
        let t = (nCrater - 0.6) / 0.4; // 0 to 1
        
        // Smoothstep the crater rim to prevent jagged low-poly spikes
        if (t < 0.25) {
            let rim = t / 0.25;
            craterEffect = (rim * rim * (3.0 - 2.0 * rim)) * (baseRadius * 0.003); // Smoothed rim, lower height
        } else {
            let depth = (t - 0.25) / 0.75;
            // Smooth bowl shape instead of sharp Math.pow
            craterEffect = (baseRadius * 0.003) - (depth * (2.0 - depth) * (baseRadius * 0.010)); 
        }
    }
    
    // 5. Micro Detalle (Rocas menores)
    let nDetail = noise3D(normalizedVertex.x * freq * 25.0, normalizedVertex.y * freq * 25.0, normalizedVertex.z * freq * 25.0);
    let detail = nDetail * (baseRadius * 0.001);
    
    let rawRadius = baseRadius + elevation + craterEffect + detail;
    if (clampWater && biome === 'Terran' && rawRadius < baseRadius - 30.0) {
        return baseRadius - 30.0;
    }
    return rawRadius;
  }
}
