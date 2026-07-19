import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { TerrainBuilder } from './TerrainBuilder.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function mulberry32(a) {
    return function() {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}
const noise3D = createNoise3D(mulberry32(987654321)); 

// --- Generadores Fractales y L-Systems (Principal) ---

function generateOrganicRockCluster() {
    const geometries = [];
    const numRocks = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < numRocks; i++) {
        const geom = new THREE.DodecahedronGeometry(1.0 + Math.random()*0.5, 1); 
        const pos = geom.attributes.position;
        const v = new THREE.Vector3();
        for (let j = 0; j < pos.count; j++) {
            v.fromBufferAttribute(pos, j);
            const n = Math.abs(noise3D(v.x * 1.8, v.y * 1.8, v.z * 1.8));
            v.normalize().multiplyScalar(1.0 + (0.5 - n) * 1.2); 
            pos.setXYZ(j, v.x, v.y, v.z);
        }
        geom.scale(1 + Math.random(), 0.5 + Math.random()*0.8, 1 + Math.random());
        geom.rotateX(Math.random() * Math.PI);
        geom.rotateY(Math.random() * Math.PI);
        geom.translate((Math.random()-0.5)*1.5, (Math.random()-0.5)*0.5, (Math.random()-0.5)*1.5);
        geometries.push(geom);
    }
    const merged = BufferGeometryUtils.mergeGeometries(geometries);
    merged.computeVertexNormals();
    return merged;
}

function generateCrystalGeode() {
    const geometries = [];
    function buildCrystal(pos, dir, length, radius, depth) {
        const dummy = new THREE.Object3D();
        dummy.position.copy(pos).add(dir.clone().multiplyScalar(length / 2));
        const up = new THREE.Vector3(0, 1, 0);
        dummy.quaternion.setFromUnitVectors(up, dir.clone().normalize());
        dummy.updateMatrix();
        
        const shard = new THREE.CylinderGeometry(0, radius, length, 6, 1);
        shard.applyMatrix4(dummy.matrix);
        geometries.push(shard);
        
        if (depth > 2) return;
        
        const endPoint = pos.clone().add(dir.clone().multiplyScalar(length * (0.4 + Math.random()*0.4)));
        for (let i = 0; i < 6; i++) {
            if (Math.random() > 0.4) continue; 
            const angle = i * (Math.PI / 3);
            const tempUp = (Math.abs(dir.y) > 0.9) ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
            const right = new THREE.Vector3().crossVectors(dir, tempUp).normalize();
            const forward = new THREE.Vector3().crossVectors(right, dir).normalize();
            const faceNormal = right.clone().multiplyScalar(Math.cos(angle)).add(forward.clone().multiplyScalar(Math.sin(angle)));
            const branchDir = faceNormal.clone().multiplyScalar(Math.sin(Math.PI/3)).add(dir.clone().multiplyScalar(Math.cos(Math.PI/3))).normalize();
            buildCrystal(endPoint, branchDir, length * (0.5 + Math.random()*0.3), radius * (0.5 + Math.random()*0.2), depth + 1);
        }
    }
    buildCrystal(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 3 + Math.random()*2, 1.2, 0);
    const merged = BufferGeometryUtils.mergeGeometries(geometries);
    merged.computeVertexNormals();
    return merged;
}

function generateAlienTreePair() {
    const trunkGeometries = [];
    const leavesGeometries = [];
    function buildBranch(startPoint, dir, length, radius, depth) {
        if (depth > 3) {
            const leaf = new THREE.IcosahedronGeometry(radius * 4.0, 1);
            leaf.scale(1, 0.4 + Math.random()*0.3, 1); 
            leaf.translate(startPoint.x, startPoint.y, startPoint.z);
            leavesGeometries.push(leaf);
            return;
        }
        const dummy = new THREE.Object3D();
        dummy.position.copy(startPoint).add(dir.clone().multiplyScalar(length / 2));
        const up = new THREE.Vector3(0, 1, 0);
        dummy.quaternion.setFromUnitVectors(up, dir.clone().normalize());
        dummy.updateMatrix();
        const branchGeom = new THREE.CylinderGeometry(radius * 0.6, radius, length, 5, 2);
        const pos = branchGeom.attributes.position;
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i);
            v.x += Math.sin(v.y * 1.5) * (radius * 0.2);
            pos.setXYZ(i, v.x, v.y, v.z);
        }
        branchGeom.applyMatrix4(dummy.matrix);
        trunkGeometries.push(branchGeom);
        
        const endPoint = startPoint.clone().add(dir.clone().multiplyScalar(length));
        const numBranches = (depth === 0) ? (2 + Math.floor(Math.random()*2)) : (1 + Math.floor(Math.random()*3));
        for (let i = 0; i < numBranches; i++) {
            const newDir = dir.clone();
            newDir.x += (Math.random() - 0.5) * 1.8;
            newDir.y += 0.2 + Math.random() * 0.8; 
            newDir.z += (Math.random() - 0.5) * 1.8;
            newDir.normalize();
            buildBranch(endPoint, newDir, length * (0.6 + Math.random()*0.25), radius * 0.65, depth + 1);
        }
    }
    buildBranch(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 4 + Math.random()*2, 0.8 + Math.random()*0.3, 0);
    const mTrunk = trunkGeometries.length > 0 ? BufferGeometryUtils.mergeGeometries(trunkGeometries) : new THREE.BufferGeometry();
    const mLeaves = leavesGeometries.length > 0 ? BufferGeometryUtils.mergeGeometries(leavesGeometries) : new THREE.BufferGeometry();
    
    const lpos = mLeaves.attributes.position;
    const v = new THREE.Vector3();
    if (lpos) {
        for (let j = 0; j < lpos.count; j++) {
            v.fromBufferAttribute(lpos, j);
            v.y += noise3D(v.x*4, v.y*4, v.z*4) * 0.3;
            lpos.setXYZ(j, v.x, v.y, v.z);
        }
    }
    if (trunkGeometries.length > 0) mTrunk.computeVertexNormals();
    if (leavesGeometries.length > 0) mLeaves.computeVertexNormals();
    return [mTrunk, mLeaves];
}

// --- Generadores de Sotobosque (Undergrowth / Clutter) ---

function generateBush() {
    const geometries = [];
    const numLeaves = 4 + Math.floor(Math.random() * 5);
    for (let i = 0; i < numLeaves; i++) {
        const leaf = new THREE.IcosahedronGeometry(0.5 + Math.random()*0.5, 1);
        leaf.scale(1, 0.5, 1);
        leaf.rotateX((Math.random() - 0.5) * Math.PI);
        leaf.rotateY(Math.random() * Math.PI);
        leaf.translate((Math.random()-0.5)*1.0, Math.random()*0.3, (Math.random()-0.5)*1.0);
        geometries.push(leaf);
    }
    const merged = BufferGeometryUtils.mergeGeometries(geometries);
    merged.computeVertexNormals();
    return merged;
}

function generatePebble() {
    const geom = new THREE.DodecahedronGeometry(0.3 + Math.random()*0.4, 0); 
    geom.scale(1 + Math.random(), 0.5 + Math.random(), 1 + Math.random());
    geom.rotateX(Math.random() * Math.PI);
    geom.rotateY(Math.random() * Math.PI);
    geom.computeVertexNormals();
    return geom;
}

// --------------------------------------

export class PlanetDecorator {
  
  static initVariations() {
      if (this.initialized) return;
      
      this.geometries = {
          arch: [generateOrganicRockCluster(), generateOrganicRockCluster(), generateOrganicRockCluster()],
          spire: [generateCrystalGeode(), generateCrystalGeode(), generateCrystalGeode()],
          rock: [generateOrganicRockCluster(), generateOrganicRockCluster(), generateOrganicRockCluster()],
          treeTrunk: [],
          treeLeaves: [],
          bush: [generateBush(), generateBush(), generateBush()],
          pebble: [generatePebble(), generatePebble(), generatePebble()]
      };
      
      for(let i=0; i<3; i++) {
          const [trunk, leaves] = generateAlienTreePair();
          this.geometries.treeTrunk.push(trunk);
          this.geometries.treeLeaves.push(leaves);
      }
      
      this.materials = {
          arch: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, flatShading: false }),
          iceSpire: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.8, emissive: 0x000000, flatShading: true, transparent: true, opacity: 0.9 }),
          rock: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, flatShading: false }),
          trunk: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, flatShading: false }),
          leaves: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: false }),
          // Clutter materials
          bushMat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: false }),
          pebbleMat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, flatShading: true })
      };
      
      this.initialized = true;
  }

  static createGlobalDecorations(radius, biome) {
    this.initVariations();
    const decorGroup = new THREE.Group();
    if (biome === 'GasGiant') return decorGroup; 
    
    // --- 1. PASADA PRINCIPAL (4000 Objetos Masivos) ---
    const numDecorations = 4000; 
    const NUM_VARIANTS = 3;
    
    let isDual = false;
    let geoms1, mat1, baseColorObj1;
    let geoms2, mat2, baseColorObj2;
    
    if (biome === 'Ice') {
       geoms1 = this.geometries.spire; mat1 = this.materials.iceSpire; baseColorObj1 = new THREE.Color(0xaaffff);
    } else if (biome === 'Desert') {
       geoms1 = this.geometries.arch; mat1 = this.materials.arch; baseColorObj1 = new THREE.Color(0xdcaa77);
    } else if (biome === 'Lava') {
       geoms1 = this.geometries.rock; mat1 = this.materials.rock; baseColorObj1 = new THREE.Color(0x332222);
    } else {
       isDual = true;
       geoms1 = this.geometries.treeTrunk; mat1 = this.materials.trunk; baseColorObj1 = new THREE.Color(0x4a3623);
       geoms2 = this.geometries.treeLeaves; mat2 = this.materials.leaves; baseColorObj2 = new THREE.Color(0x22cc55);
    }

    const instancedMeshes1 = [];
    const instancedMeshes2 = [];
    const instanceCounts = [0, 0, 0];
    
    for(let v = 0; v < NUM_VARIANTS; v++) {
        instancedMeshes1.push(new THREE.InstancedMesh(geoms1[v], mat1, numDecorations));
        if (isDual) instancedMeshes2.push(new THREE.InstancedMesh(geoms2[v], mat2, numDecorations));
    }
    
    const colorDummy = new THREE.Color();
    const colorDummy2 = new THREE.Color();
    const dummy = new THREE.Object3D();
    const upVector = new THREE.Vector3(0, 1, 0);
    const phi = Math.PI * (3 - Math.sqrt(5)); 
    
    for (let i = 0; i < numDecorations * 5; i++) { 
        let totalInstances = instanceCounts[0] + instanceCounts[1] + instanceCounts[2];
        if (totalInstances >= numDecorations) break;
        
        const y = 1 - (i / (numDecorations * 5 - 1)) * 2; 
        const r = Math.sqrt(1 - y * y);
        const theta = phi * i;
        
        let dir = new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r);
        dir.x += (Math.random() - 0.5) * 0.04;
        dir.y += (Math.random() - 0.5) * 0.04;
        dir.z += (Math.random() - 0.5) * 0.04;
        dir.normalize();
        
        const height = TerrainBuilder.getHeight(dir, radius, biome);
        const offsetDir = new THREE.Vector3(dir.x + 0.001, dir.y, dir.z).normalize();
        const slope = Math.abs(height - TerrainBuilder.getHeight(offsetDir, radius, biome)) / 0.001; 
        
        const clusterNoise = noise3D(dir.x * 2, dir.y * 2, dir.z * 2); 
        
        // Más densidad y contraste forzando un threshold de clustering más agresivo
        if (biome === 'Terran') {
            if (slope > radius * 0.05) continue; 
            if (height - radius < -28.0) continue; // No underwater trees!
            if (clusterNoise < 0.2) continue; // Más agresivo, agrupa más fuerte
        } else if (biome === 'Ice') {
            if (height - radius > 0) continue; 
            if (clusterNoise < 0.5) continue; 
        } else if (biome === 'Lava') {
            if (slope < radius * 0.03 && clusterNoise < 0.5) continue; 
        } else if (biome === 'Desert') {
            if (slope > radius * 0.02) continue;
            if (clusterNoise < 0.3) continue;
        }
        
        const pos = dir.clone().multiplyScalar(height);
        dummy.position.copy(pos);
        dummy.quaternion.setFromUnitVectors(upVector, dir);
        
        const baseScale = radius * 0.0005; 
        const scale = baseScale + noise3D(dir.x * 5, dir.y * 5, 3) * (baseScale * 1.0); 
        const scaleX = scale * (0.8 + noise3D(dir.x * 20, dir.y * 20, 1) * 0.4);
        const scaleY = scale * (0.8 + noise3D(dir.x * 20, dir.y * 20, 2) * 1.2);
        const scaleZ = scale * (0.8 + noise3D(dir.x * 20, dir.y * 20, 3) * 0.4);
        
        if (biome === 'Ice') {
            dummy.scale.set(scale * 1.5, scale * 1.5, scale * 1.5); 
            dummy.rotateX((noise3D(dir.x * 15, dir.y * 15, 1) * Math.PI) / 16); 
            dummy.rotateZ((noise3D(dir.x * 15, dir.y * 15, 2) * Math.PI) / 16);
        } else if (biome === 'Desert') {
            dummy.scale.set(scale * 1.5, scale * 2.5, scale * 1.5);
            dummy.rotateX((noise3D(dir.x * 15, dir.y * 15, 1) * Math.PI) / 12);
        } else {
            dummy.scale.set(scaleX * 1.2, scaleY * 1.2, scaleZ * 1.2);
            if (!isDual) {
                dummy.rotateX(noise3D(dir.x * 15, dir.y * 15, 1) * Math.PI); 
                dummy.rotateZ(noise3D(dir.x * 15, dir.y * 15, 2) * Math.PI);
            } else {
                dummy.rotateX((noise3D(dir.x * 15, dir.y * 15, 1) * Math.PI) / 16);
                dummy.rotateZ((noise3D(dir.x * 15, dir.y * 15, 2) * Math.PI) / 16);
            }
        }
        dummy.rotateY(noise3D(dir.x * 10, dir.y * 10, 4) * Math.PI * 2);
        dummy.updateMatrix();
        
        const v = Math.floor(Math.random() * NUM_VARIANTS);
        const idx = instanceCounts[v];
        instancedMeshes1[v].setMatrixAt(idx, dummy.matrix);
        
        let hueShift = noise3D(dir.x * 30, dir.y * 30, 5); 
        colorDummy.copy(baseColorObj1);
        const hsl = {}; colorDummy.getHSL(hsl);
        
        if (biome === 'Ice') colorDummy.setHSL(hsl.h + hueShift * 0.4, 0.9, 0.6); 
        else if (biome === 'Lava') colorDummy.setHSL(hsl.h + hueShift * 0.1, 0.5, 0.2 + Math.abs(hueShift)*0.2); 
        else if (biome === 'Desert') colorDummy.setHSL(hsl.h + hueShift * 0.2, 0.7, 0.4 + Math.abs(hueShift)*0.2);
        else colorDummy.setHSL(hsl.h + hueShift * 0.1, 0.5, 0.3 + Math.abs(hueShift)*0.15);
        instancedMeshes1[v].setColorAt(idx, colorDummy);
        
        if (isDual) {
            instancedMeshes2[v].setMatrixAt(idx, dummy.matrix);
            let hueShift2 = noise3D(dir.x * 25, dir.y * 25, 6); 
            colorDummy2.copy(baseColorObj2);
            const hsl2 = {}; colorDummy2.getHSL(hsl2);
            if (biome === 'Terran') colorDummy2.setHSL(hsl2.h + hueShift2 * 0.8, 0.8, 0.5); 
            instancedMeshes2[v].setColorAt(idx, colorDummy2);
        }
        
        instanceCounts[v]++;
    }
    
    for(let v=0; v<NUM_VARIANTS; v++) {
        if (instanceCounts[v] > 0) {
            instancedMeshes1[v].count = instanceCounts[v];
            instancedMeshes1[v].instanceMatrix.needsUpdate = true;
            if (instancedMeshes1[v].instanceColor) instancedMeshes1[v].instanceColor.needsUpdate = true;
            decorGroup.add(instancedMeshes1[v]);
            if (isDual) {
                instancedMeshes2[v].count = instanceCounts[v];
                instancedMeshes2[v].instanceMatrix.needsUpdate = true;
                if (instancedMeshes2[v].instanceColor) instancedMeshes2[v].instanceColor.needsUpdate = true;
                decorGroup.add(instancedMeshes2[v]);
            }
        }
    }

    // --- 2. PASADA DE SOTOBOSQUE / CLUTTER (8000 Objetos Menores) ---
    const numClutter = 8000;
    
    let clutterGeoms, clutterMat, baseClutterColor;
    if (biome === 'Terran') {
        clutterGeoms = this.geometries.bush;
        clutterMat = this.materials.bushMat;
        baseClutterColor = new THREE.Color(0x33aa44);
    } else if (biome === 'Ice') {
        clutterGeoms = this.geometries.pebble;
        clutterMat = this.materials.iceSpire; // usa mismo material reflexivo para trocitos de hielo
        baseClutterColor = new THREE.Color(0xaaffff);
    } else {
        clutterGeoms = this.geometries.pebble;
        clutterMat = this.materials.pebbleMat;
        baseClutterColor = biome === 'Lava' ? new THREE.Color(0x552222) : new THREE.Color(0xdcaa77);
    }
    
    const clutterMeshes = [];
    const clutterCounts = [0, 0, 0];
    for(let v=0; v<NUM_VARIANTS; v++) {
        clutterMeshes.push(new THREE.InstancedMesh(clutterGeoms[v], clutterMat, numClutter));
    }
    
    for (let i = 0; i < numClutter * 3; i++) { 
        let total = clutterCounts[0] + clutterCounts[1] + clutterCounts[2];
        if (total >= numClutter) break;
        
        const y = 1 - (i / (numClutter * 3 - 1)) * 2; 
        const r = Math.sqrt(1 - y * y);
        const theta = phi * i * 1.618; // offset angle for different pattern
        
        let dir = new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r);
        dir.x += (Math.random() - 0.5) * 0.05;
        dir.y += (Math.random() - 0.5) * 0.05;
        dir.z += (Math.random() - 0.5) * 0.05;
        dir.normalize();
        
        const height = TerrainBuilder.getHeight(dir, radius, biome);
        if (biome === 'Terran' && height - radius < -28.0) continue; // No underwater bushes
        
        // Clutter follows similar clustering rules to primary objects
        const clusterNoise = noise3D(dir.x * 2, dir.y * 2, dir.z * 2); 
        if (biome === 'Terran' && clusterNoise < 0.1) continue; 
        if (biome === 'Ice' && clusterNoise < 0.3) continue;
        
        const pos = dir.clone().multiplyScalar(height);
        dummy.position.copy(pos);
        dummy.quaternion.setFromUnitVectors(upVector, dir);
        
        // Much smaller scale!
        const baseScale = radius * 0.00015; 
        const scale = baseScale + noise3D(dir.x * 12, dir.y * 12, 3) * (baseScale * 0.8); 
        dummy.scale.set(scale, scale * (1.0 + Math.random()), scale);
        
        dummy.rotateX(Math.random() * Math.PI);
        dummy.rotateZ(Math.random() * Math.PI);
        dummy.updateMatrix();
        
        const v = Math.floor(Math.random() * NUM_VARIANTS);
        const idx = clutterCounts[v];
        clutterMeshes[v].setMatrixAt(idx, dummy.matrix);
        
        let hueShift = noise3D(dir.x * 40, dir.y * 40, 7); 
        colorDummy.copy(baseClutterColor);
        const hsl = {}; colorDummy.getHSL(hsl);
        
        if (biome === 'Terran') colorDummy.setHSL(hsl.h + hueShift * 0.5, 0.7, 0.4 + Math.abs(hueShift)*0.2);
        else if (biome === 'Ice') colorDummy.setHSL(hsl.h + hueShift * 0.4, 0.9, 0.7);
        else if (biome === 'Lava') colorDummy.setHSL(hsl.h + hueShift * 0.2, 0.8, 0.3 + Math.abs(hueShift)*0.3);
        else colorDummy.setHSL(hsl.h + hueShift * 0.2, 0.6, 0.5);
        
        clutterMeshes[v].setColorAt(idx, colorDummy);
        clutterCounts[v]++;
    }
    
    for(let v=0; v<NUM_VARIANTS; v++) {
        if (clutterCounts[v] > 0) {
            clutterMeshes[v].count = clutterCounts[v];
            clutterMeshes[v].instanceMatrix.needsUpdate = true;
            if (clutterMeshes[v].instanceColor) clutterMeshes[v].instanceColor.needsUpdate = true;
            decorGroup.add(clutterMeshes[v]);
        }
    }
    
    return decorGroup;
  }
}
