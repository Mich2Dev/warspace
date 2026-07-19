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
const RESOLUTION = 32; // Lowered from 48 to fix lag while preserving smooth terrain via normals

export class TerrainBuilder {
  static buildChunk(localUp, axisA, axisB, radius, center, size, color, biome = 'Terran') {
    const geometry = new THREE.PlaneGeometry(size, size, RESOLUTION, RESOLUTION);
    const positions = geometry.attributes.position;
    
    // Arrays for vertex colors
    const colors = new Float32Array(positions.count * 3);
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
      
      const heightOffset = rawRadius - radius; // Unclamped depth used for color gradients
      
      let vColor;
      
      if (biome === 'Lava') {
        if (heightOffset < -50) {
           const lavaHeat = Math.min(1.0, Math.abs(heightOffset + 50) / 300.0);
           vColor = new THREE.Color(0x220000).lerp(new THREE.Color(0xff5500), lavaHeat); // Glowing magma gradient
        } else {
           const rockDarkness = Math.max(0.05, 0.2 - (heightOffset / 4000));
           vColor = new THREE.Color(rockDarkness, rockDarkness, rockDarkness); // Very dark obsidian rock
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
      } else { // Terran / Default
        if (heightOffset <= -30) {
           // AAA Water gradient: Pre-calculate deep ocean colors directly in the vertex based on un-clamped depth
           const depthPercent = Math.min(1, Math.abs(heightOffset + 30) / 300);
           vColor = new THREE.Color(0x0088ff).lerp(new THREE.Color(0x002266), depthPercent);
        } else if (heightOffset < -10) {
           // Beach / shallow ground transition
           vColor = new THREE.Color(0xdcaa77).lerp(valleyColorObj, (heightOffset + 30) / 20);
        } else if (heightOffset > 12000) {
           const peakPercent = Math.min(1, (heightOffset - 12000) / 8000);
           vColor = baseColorObj.clone().lerp(new THREE.Color(0xffffff), peakPercent); // Snow only on highest peaks
        } else {
           const groundPercent = Math.max(0, (heightOffset + 10) / 12010); // 0 to 1
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
    
    geometry.computeVertexNormals();
    
    // Assign a basic material
    const material = new THREE.MeshStandardMaterial({ 
      vertexColors: true,
      roughness: (biome === 'Ice') ? 0.3 : (biome === 'Lava' ? 0.8 : 0.95), // More grounded realism
      metalness: (biome === 'Ice') ? 0.1 : (biome === 'Lava' ? 0.2 : 0.0),
      flatShading: false,
      side: THREE.DoubleSide // AAA FIX: Prevents seeing through the planet if the camera clips
    });
    
    // AAA FIX: Prevent Three.js from caching and sharing shaders across different biomes!
    material.customProgramCacheKey = function() {
        return biome;
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
         ${noiseGLSL}
        `
      );
       shader.vertexShader = shader.vertexShader.replace(
         '#include <begin_vertex>',
         `#include <begin_vertex>
          vLocalPos = position;
          vHeightOffset = length(position) - ${radius.toFixed(1)};
          
          // Physical Vertex Waves for Terran Water
          int vBiomeType = ${(biome === 'Lava') ? 1 : (biome === 'GasGiant') ? 2 : (biome === 'Terran') ? 3 : (biome === 'Ice') ? 4 : 5};
          if (vBiomeType == 3 && vHeightOffset <= -28.0) {
              // Organic 3D noise for physical ocean swells instead of a grid
              float physicalWave = vnoise(position * 0.003 + time * 0.5) * 6.0; 
              transformed += normalize(position) * physicalWave;
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
          ${noiseGLSL}
         `
      );

      // 3. Normal Perturbation
      shader.fragmentShader = shader.fragmentShader.replace(
         '#include <normal_fragment_begin>',
         `#include <normal_fragment_begin>
          int _biomeType = ${(biome === 'Lava') ? 1 : (biome === 'GasGiant') ? 2 : (biome === 'Terran') ? 3 : (biome === 'Ice') ? 4 : 5};
          if (_biomeType == 3 && vHeightOffset <= -28.0) {
              // Dynamic Normal Perturbation for AAA liquid reflections
              float eps = 2.0;
              float n0 = fbm(vLocalPos * 0.005 - time * 0.5);
              float nx = fbm((vLocalPos + vec3(eps, 0.0, 0.0)) * 0.005 - time * 0.5);
              float nz = fbm((vLocalPos + vec3(0.0, 0.0, eps)) * 0.005 - time * 0.5);
              
              vec3 waveNormal = vec3(nx - n0, 0.0, nz - n0);
              normal = normalize(normal - waveNormal * 1.5);
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
             
             // --- PROCEDURAL GRASS & DIRT (TERRAN) ---
             if (biomeType == 3 && vHeightOffset > -28.0 && vHeightOffset < 12000.0) {
                 // Mix dirt and grass based on noise
                 vec3 grassColor = vec3(0.1, 0.4, 0.1);
                 vec3 dirtColor = vec3(0.3, 0.2, 0.1);
                 float grassMix = smoothstep(0.3, 0.7, n2 + n3 * 0.5);
                 vec3 proceduralTex = mix(dirtColor, grassColor, grassMix);
                 // Blend procedural texture with vertex color
                 diffuseColor.rgb = mix(diffuseColor.rgb, proceduralTex * grit * 1.5, 0.6);
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
         
         // --- PROCEDURAL LAVA ---
         if (biomeType == 1 && vHeightOffset < -50.0) {
             // Animated magma flow
             float magmaNoise = fbm(vLocalPos * 0.005 + time);
             float heat = smoothstep(0.3, 0.7, magmaNoise);
             
             // HDR glowing magma colors
             vec3 darkMagma = vec3(2.0, 0.2, 0.0);
             vec3 hotMagma = vec3(5.0, 2.0, 0.0); // Extremely bright HDR for bloom!
             vec3 magmaColor = mix(darkMagma, hotMagma, heat);
             
             // Replace vertex color entirely with procedural magma
             diffuseColor.rgb = magmaColor;
         }
        `
      );
      
      shader.fragmentShader = shader.fragmentShader.replace(
         '#include <roughnessmap_fragment>',
         `#include <roughnessmap_fragment>
          if (biomeType == 3 && vHeightOffset <= -28.0) {
              roughnessFactor = 0.05;
          }
         `
       );
       
       shader.fragmentShader = shader.fragmentShader.replace(
         '#include <metalnessmap_fragment>',
         `#include <metalnessmap_fragment>
          if (biomeType == 3 && vHeightOffset <= -28.0) {
              metalnessFactor = 0.0;
          }
         `
       );
    };
    
    return new THREE.Mesh(geometry, material);
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
        if (nCont < 0.3) {
            elevation = -(baseRadius * 0.01) + nCont * (baseRadius * 0.005); // Mares de lava profundos
        } else {
            let mountainMask = (nCont - 0.3) / 0.7;
            elevation = mountainMask * nMount * (baseRadius * 0.015); // Volcanes (1.5% del radio)
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
