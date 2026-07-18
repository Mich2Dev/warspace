import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';

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
const RESOLUTION = 48; // High resolution for smooth terrain

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
      
      const finalRadius = TerrainBuilder.getHeight(vertex, radius, biome);
      
      const heightOffset = finalRadius - radius;
      
      let vColor;
      
      if (biome === 'Lava') {
        if (heightOffset < -100) {
           vColor = new THREE.Color(0xff3300); // Glowing magma in valleys
        } else {
           const rockDarkness = Math.max(0.1, 0.4 - (heightOffset / 8000));
           vColor = new THREE.Color(rockDarkness, rockDarkness, rockDarkness); // Dark obsidian rock
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
      } else { // Terran / Desert / Default
        if (heightOffset < -100) {
          const depthPercent = Math.min(1, Math.abs(heightOffset + 100) / 700);
          vColor = valleyColorObj.clone().lerp(new THREE.Color(0x111111), depthPercent);
        } else if (heightOffset > 400) {
          const peakPercent = Math.min(1, (heightOffset - 400) / 400);
          vColor = baseColorObj.clone().lerp(peakColorObj, peakPercent);
        } else {
          const groundPercent = (heightOffset + 100) / 500; // 0 to 1
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
      roughness: (biome === 'Ice') ? 0.2 : 0.9, // Ice is shiny!
      metalness: (biome === 'Ice') ? 0.3 : 0.02,
      flatShading: false
    });
    
    // Inject custom GLSL to generate procedural textures (Micro-details & Strata)
    material.onBeforeCompile = (shader) => {
      // 1. Pass Local Position from Vertex to Fragment
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>\n varying vec3 vLocalPos;\n varying float vHeightOffset;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n vLocalPos = position;\n vHeightOffset = length(position) - ${radius.toFixed(1)};`
      );
      
      // 2. Add Noise Functions to Fragment Shader
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
         `#include <common>
          varying vec3 vLocalPos;
          varying float vHeightOffset;
         
         float hash(vec3 p) {
           p = fract(p * 0.3183099 + .1);
           p *= 17.0;
           return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
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
        `
      );
      
      // 3. Modulate Diffuse Color with Procedural Textures and Biome Emissive Logic
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         
         // Biome-specific overrides
         int biome = ${(biome === 'Lava') ? 1 : (biome === 'GasGiant') ? 2 : 0};
         
         if (biome != 2) {
             // Solid planet: Micro-detail noise (Sand / Rock grit)
             float n1 = vnoise(vLocalPos * 0.002); // Medium features
             float n2 = vnoise(vLocalPos * 0.02);  // Fine gritty details
             float grit = 0.6 + (n1 * 0.3) + (n2 * 0.2);
             diffuseColor.rgb *= grit;
         } else {
             // Gas Giant: Swirling storms and atmospheric bands (AAA Quality)
             vec3 pos = normalize(vLocalPos); // pos is direction from center
             
             // Base bands based on latitude (y component)
             // We use multiple frequencies to make the bands irregular
             float bandNoise = fbm(pos * 5.0);
             float lat = pos.y * 30.0 + bandNoise * 4.0; 
             float bands = sin(lat) * 0.5 + 0.5;
             
             // Add massive swirling storms (like Jupiter's red spot)
             float storm = fbm(pos * 15.0 + fbm(pos * 8.0) * 3.0);
             
             // Add micro-turbulence for up-close detail
             float micro = fbm(pos * 80.0);
             
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
         
         // Lava Emission Logic
         if (biome == 1 && vHeightOffset < -50.0) {
             // Make deep valleys emit light (glow)
             diffuseColor.rgb *= 1.5; 
         }
        `
      );
    };
    
    return new THREE.Mesh(geometry, material);
  }

  // Exposed so Spaceship can do collision detection exactly matching the procedural mesh
  static getHeight(normalizedVertex, baseRadius, biome = 'Terran') {
    if (biome === 'GasGiant') return baseRadius; // Gas Giants are smooth spheres!

    const freq = 1.5; // Escala global
    
    // 1. Ruido Continental (Masa de tierra vs Valles planos)
    let nCont = noise3D(normalizedVertex.x * freq, normalizedVertex.y * freq, normalizedVertex.z * freq);
    nCont = (nCont + 1.0) * 0.5; // Rango [0, 1]
    
    // 2. Montañas Afiladas (Ridged Multifractal)
    let nMount = noise3D(normalizedVertex.x * freq * 5.0, normalizedVertex.y * freq * 5.0, normalizedVertex.z * freq * 5.0);
    nMount = 1.0 - Math.abs(nMount); // Crea crestas afiladas
    nMount = Math.pow(nMount, 3.0); // Afila las cumbres aún más
    
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
            elevation = mountainMask * nMount * (baseRadius * 0.12); // Montañas extremas (12% del radio)
        }
    } else if (biome === 'Ice') {
        if (nCont < 0.5) {
            elevation = -(baseRadius * 0.005) + nCont * (baseRadius * 0.002); // Planicies lisas
        } else {
            let mountainMask = (nCont - 0.5) / 0.5;
            elevation = mountainMask * nMount * (baseRadius * 0.05); // Montañas nevadas altas (5% del radio)
        }
    } else if (biome === 'Desert') {
        let nDune = Math.sin(normalizedVertex.x * 200.0 + noise3D(normalizedVertex.x * 10, normalizedVertex.y * 10, normalizedVertex.z * 10) * 2.0);
        if (nCont < 0.4) {
            elevation = -(baseRadius * 0.005) + (nDune * (baseRadius * 0.001)) + nCont * (baseRadius * 0.005);
        } else {
            let mountainMask = (nCont - 0.4) / 0.6;
            elevation = mountainMask * nMount * (baseRadius * 0.08) + (nDune * (baseRadius * 0.0005)); // Montañas (8% del radio)
        }
    } else {
        // Terran / Default
        if (nCont < 0.4) {
            elevation = -(baseRadius * 0.005) + nCont * (baseRadius * 0.008); 
        } else {
            let mountainMask = (nCont - 0.4) / 0.6; 
            elevation = mountainMask * nMount * (baseRadius * 0.10); // Montañas colosales (10% del radio)
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
        let t = (nCrater - 0.6) / 0.4; // 0 a 1
        if (t < 0.15) {
            craterEffect = (t / 0.15) * (baseRadius * 0.005); // Borde del cráter
        } else {
            let depth = (t - 0.15) / 0.85;
            craterEffect = (baseRadius * 0.005) - (Math.pow(depth, 0.5) * (baseRadius * 0.015)); // Interior profundo
        }
    }
    
    // 5. Micro Detalle (Rocas menores)
    let nDetail = noise3D(normalizedVertex.x * freq * 25.0, normalizedVertex.y * freq * 25.0, normalizedVertex.z * freq * 25.0);
    let detail = nDetail * (baseRadius * 0.001);
    
    return baseRadius + elevation + craterEffect + detail;
  }
}
