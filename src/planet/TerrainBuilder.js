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
  static buildChunk(localUp, axisA, axisB, radius, center, size, color) {
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
      
      const finalRadius = TerrainBuilder.getHeight(vertex, radius);
      
      const heightOffset = finalRadius - radius;
      
      let vColor;
      if (heightOffset < -100) {
        // Craters or deep valleys: darker, fading to black at the bottom
        const depthPercent = Math.min(1, Math.abs(heightOffset + 100) / 700);
        vColor = valleyColorObj.clone().lerp(new THREE.Color(0x111111), depthPercent);
      } else if (heightOffset > 400) {
        // High mountains / Snow caps
        const peakPercent = Math.min(1, (heightOffset - 400) / 400);
        vColor = baseColorObj.clone().lerp(peakColorObj, peakPercent);
      } else {
        // Normal ground
        const groundPercent = (heightOffset + 100) / 500; // 0 to 1
        vColor = valleyColorObj.clone().lerp(baseColorObj, groundPercent);
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
      roughness: 0.9,
      metalness: 0.02,
      flatShading: false
    });
    
    // Inject custom GLSL to generate procedural textures (Micro-details & Strata)
    material.onBeforeCompile = (shader) => {
      // 1. Pass Local Position from Vertex to Fragment
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>\n varying vec3 vLocalPos;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n vLocalPos = position;`
      );
      
      // 2. Add Noise Functions to Fragment Shader
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
         `#include <common>
          varying vec3 vLocalPos;
         
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
        `
      );
      
      // 3. Modulate Diffuse Color with Procedural Textures
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         // Micro-detail noise (Sand / Rock grit)
         float n1 = vnoise(vLocalPos * 0.002); // Medium features
         float n2 = vnoise(vLocalPos * 0.02);  // Fine gritty details
         
         float grit = 0.6 + (n1 * 0.3) + (n2 * 0.2);
         
         // Apply grit texture only, no height-based bands
         diffuseColor.rgb *= grit;
        `
      );
    };
    
    return new THREE.Mesh(geometry, material);
  }

  // Exposed so Spaceship can do collision detection exactly matching the procedural mesh
  static getHeight(normalizedVertex, baseRadius) {
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
    if (Math.abs(nCanyon) < 0.03) { // Si el ruido está muy cerca de 0, creamos una grieta
        let depth = (0.03 - Math.abs(nCanyon)) / 0.03; // 0 en los bordes, 1 en el centro
        canyonEffect = -Math.pow(depth, 1.5) * 2000; // Cañones de 2000 metros de profundidad!
    }
    
    // --- COMBINACIÓN DE GEOGRAFÍA ---
    let elevation = 0;
    if (nCont < 0.4) {
        // Zonas planas, valles bajos
        elevation = -200 + nCont * 400; 
    } else {
        // Masas de tierra (Cordilleras que emergen)
        let mountainMask = (nCont - 0.4) / 0.6; // Suave transición de valle a montaña
        elevation = mountainMask * nMount * 4000; // Montañas de hasta 4000m
    }
    
    // Aplicar cañones (solo restan altura, cortando el terreno)
    if (elevation > 0 && canyonEffect < 0) {
        elevation += canyonEffect;
    }

    // 4. Cráteres (Esparcidos)
    let nCrater = noise3D(normalizedVertex.x * freq * 18.0, normalizedVertex.y * freq * 18.0, normalizedVertex.z * freq * 18.0);
    let craterEffect = 0;
    if (nCrater > 0.6) {
        let t = (nCrater - 0.6) / 0.4; // 0 a 1
        if (t < 0.15) {
            craterEffect = (t / 0.15) * 500; // Borde del cráter
        } else {
            let depth = (t - 0.15) / 0.85;
            craterEffect = 500 - Math.pow(depth, 0.4) * 1500; // Cuenco profundo
        }
    }
    
    // 5. Micro Detalle (Rocas menores)
    let nDetail = noise3D(normalizedVertex.x * freq * 25.0, normalizedVertex.y * freq * 25.0, normalizedVertex.z * freq * 25.0);
    let detail = nDetail * 60;
    
    return baseRadius + elevation + craterEffect + detail;
  }
}
