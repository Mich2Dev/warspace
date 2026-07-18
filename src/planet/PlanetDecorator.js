import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { TerrainBuilder } from './TerrainBuilder.js';

function mulberry32(a) {
    return function() {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}
const noise3D = createNoise3D(mulberry32(987654321)); 

export class PlanetDecorator {
  static geometries = {
    arch: new THREE.TorusGeometry(1, 0.3, 8, 16, Math.PI),
    spire: new THREE.ConeGeometry(0.5, 4, 8),
    rock: new THREE.DodecahedronGeometry(1, 1)
  };
  
  static materials = {
    arch: new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9 }),
    iceSpire: new THREE.MeshStandardMaterial({ color: 0xaaffff, roughness: 0.1, metalness: 0.8 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.8 })
  };

  static createGlobalDecorations(radius, biome) {
    const decorGroup = new THREE.Group();
    if (biome === 'GasGiant') return decorGroup; 
    
    const numDecorations = 4000; 
    
    let geom, mat, baseColorObj;
    if (biome === 'Ice') {
       geom = this.geometries.spire;
       mat = this.materials.iceSpire;
       baseColorObj = new THREE.Color(0xaaffff);
    } else if (biome === 'Desert') {
       geom = this.geometries.arch;
       mat = this.materials.rock;
       baseColorObj = new THREE.Color(0xdcaa77);
    } else if (biome === 'Lava') {
       geom = this.geometries.spire;
       mat = this.materials.rock;
       baseColorObj = new THREE.Color(0x332222);
    } else {
       geom = this.geometries.rock;
       mat = this.materials.rock;
       baseColorObj = new THREE.Color(0x555555);
    }

    const instancedMesh = new THREE.InstancedMesh(geom, mat, numDecorations);
    const colorDummy = new THREE.Color();
    const dummy = new THREE.Object3D();
    const upVector = new THREE.Vector3(0, 1, 0);
    
    const phi = Math.PI * (3 - Math.sqrt(5)); 
    
    let validInstances = 0;
    
    for (let i = 0; i < numDecorations * 2; i++) { 
        if (validInstances >= numDecorations) break;
        
        const y = 1 - (i / (numDecorations * 2 - 1)) * 2; 
        const r = Math.sqrt(1 - y * y);
        const theta = phi * i;
        
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        
        const dir = new THREE.Vector3(x, y, z).normalize();
        
        let nDensity = noise3D(dir.x * 3, dir.y * 3, dir.z * 3);
        if (nDensity < 0.2) continue;
        
        const height = TerrainBuilder.getHeight(dir, radius, biome);
        
        if (height - radius < -(radius * 0.005) && biome !== 'Lava') continue;
        
        const pos = dir.clone().multiplyScalar(height);
        dummy.position.copy(pos);
        dummy.quaternion.setFromUnitVectors(upVector, dir);
        
        const baseScale = radius * 0.005;
        const scale = baseScale + noise3D(dir.x * 5, dir.y * 5, 3) * (baseScale * 0.8); 
        dummy.scale.set(scale, scale, scale);
        
        dummy.rotateY(noise3D(dir.x * 10, dir.y * 10, 4) * Math.PI * 2);
        
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(validInstances, dummy.matrix);
        
        const colorVar = (noise3D(dir.x * 30, dir.y * 30, 5) * 0.2); 
        colorDummy.copy(baseColorObj);
        colorDummy.r = Math.max(0, Math.min(1, colorDummy.r + colorVar));
        colorDummy.g = Math.max(0, Math.min(1, colorDummy.g + colorVar));
        colorDummy.b = Math.max(0, Math.min(1, colorDummy.b + colorVar));
        
        instancedMesh.setColorAt(validInstances, colorDummy);
        validInstances++;
    }
    
    instancedMesh.count = validInstances;
    
    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
    
    decorGroup.add(instancedMesh);
    return decorGroup;
  }
}
