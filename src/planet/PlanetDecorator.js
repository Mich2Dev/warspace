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

// Generador procedural eliminado. Usamos geometría 3D pura y estilizada (Low-poly AAA)

// --- Generadores Terran (árboles / sotobosque) ---

function _perturbCylinder(geom, amount = 0.25) {
    const pos = geom.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        v.x += (Math.random() - 0.5) * amount;
        v.z += (Math.random() - 0.5) * amount;
        pos.setXYZ(i, v.x, v.y, v.z);
    }
}

/** Conifer / pine — stacked irregular cones */
function generatePineTreePair() {
    const trunkRadius = 0.45 + Math.random() * 0.35;
    const trunkHeight = 7 + Math.random() * 5;
    const trunkGeom = new THREE.CylinderGeometry(trunkRadius * 0.55, trunkRadius * 1.15, trunkHeight, 6, 2);
    trunkGeom.translate(0, trunkHeight / 2, 0);
    _perturbCylinder(trunkGeom, 0.22);

    const leavesGeometries = [];
    const numTiers = 4 + Math.floor(Math.random() * 2);
    let currentHeight = trunkHeight * 0.28;
    let currentRadius = 2.8 + Math.random() * 1.2;
    const v = new THREE.Vector3();

    for (let i = 0; i < numTiers; i++) {
        const tierHeight = 3.2 + Math.random() * 2.2;
        const tierGeom = new THREE.ConeGeometry(currentRadius, tierHeight, 7, 1);
        tierGeom.translate(0, currentHeight + tierHeight / 2, 0);
        const tPos = tierGeom.attributes.position;
        const midY = currentHeight + tierHeight / 2;
        for (let j = 0; j < tPos.count; j++) {
            v.fromBufferAttribute(tPos, j);
            if (v.y < midY) {
                v.y += (Math.random() - 0.5) * 1.1;
                v.x += (Math.random() - 0.5) * 0.45;
                v.z += (Math.random() - 0.5) * 0.45;
            }
            tPos.setXYZ(j, v.x, v.y, v.z);
        }
        leavesGeometries.push(tierGeom);
        currentHeight += tierHeight * 0.55;
        currentRadius *= 0.72;
    }

    const mTrunk = BufferGeometryUtils.mergeGeometries([trunkGeom]);
    const mLeaves = BufferGeometryUtils.mergeGeometries(leavesGeometries);
    mTrunk.computeVertexNormals();
    mLeaves.computeVertexNormals();
    return [mTrunk, mLeaves];
}

/** Broadleaf — trunk + clustered canopy blobs */
function generateBroadleafTreePair() {
    const trunkRadius = 0.55 + Math.random() * 0.4;
    const trunkHeight = 5 + Math.random() * 3.5;
    const trunkGeom = new THREE.CylinderGeometry(trunkRadius * 0.7, trunkRadius * 1.2, trunkHeight, 6, 2);
    trunkGeom.translate(0, trunkHeight / 2, 0);
    _perturbCylinder(trunkGeom, 0.28);

    // Small branch stubs for silhouette
    const branchGeoms = [trunkGeom];
    for (let b = 0; b < 2; b++) {
        const br = new THREE.CylinderGeometry(0.12, 0.22, 1.8 + Math.random(), 4, 1);
        br.rotateZ((Math.random() > 0.5 ? 1 : -1) * (0.7 + Math.random() * 0.5));
        br.translate(
            (Math.random() - 0.5) * 0.8,
            trunkHeight * (0.55 + Math.random() * 0.25),
            (Math.random() - 0.5) * 0.8
        );
        branchGeoms.push(br);
    }

    const leavesGeometries = [];
    const canopyY = trunkHeight * 0.85;
    const blobs = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < blobs; i++) {
        const s = 1.6 + Math.random() * 1.4;
        const leaf = new THREE.IcosahedronGeometry(s, 0);
        leaf.scale(1.15 + Math.random() * 0.35, 0.75 + Math.random() * 0.35, 1.1 + Math.random() * 0.3);
        leaf.translate(
            (Math.random() - 0.5) * 2.4,
            canopyY + Math.random() * 2.2,
            (Math.random() - 0.5) * 2.4
        );
        leavesGeometries.push(leaf);
    }

    const mTrunk = BufferGeometryUtils.mergeGeometries(branchGeoms);
    const mLeaves = BufferGeometryUtils.mergeGeometries(leavesGeometries);
    mTrunk.computeVertexNormals();
    mLeaves.computeVertexNormals();
    return [mTrunk, mLeaves];
}

function generateTreePair(variantIndex) {
    // Mix: pine, pine, broadleaf for a natural forest feel
    if (variantIndex === 2) return generateBroadleafTreePair();
    return generatePineTreePair();
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

// --------------------------------------

export class PlanetDecorator {
  
  static initVariations() {
      if (this.initialized) return;
      
      // Earth-only assets for now (other planets stay bare while we focus Terran)
      this.geometries = {
          treeTrunk: [],
          treeLeaves: [],
          bush: [generateBush(), generateBush(), generateBush()]
      };
      
      for(let i=0; i<3; i++) {
          const [trunk, leaves] = generateTreePair(i);
          this.geometries.treeTrunk.push(trunk);
          this.geometries.treeLeaves.push(leaves);
      }
      
      this.materials = {
          trunk: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: false }),
          leaves: new THREE.MeshStandardMaterial({ 
              color: 0xffffff, 
              roughness: 0.88, 
              flatShading: true,
              side: THREE.FrontSide
          }),
          bushMat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, flatShading: false })
      };
      
      this.initialized = true;
  }

  static createGlobalDecorations(radius, biome) {
    const decorGroup = new THREE.Group();
    // Focus: only Earth (Terran) gets surface props. Strip rocks/crystals/arches from other worlds.
    if (biome !== 'Terran') return decorGroup;

    this.initVariations();
    
    // Agrupamos masivamente en bosques densos
    const numDecorations = 6000; 
    const NUM_VARIANTS = 3;
    
    const isDual = true;
    const geoms1 = this.geometries.treeTrunk;
    const mat1 = this.materials.trunk;
    const baseColorObj1 = new THREE.Color(0x3d2a1a);
    const geoms2 = this.geometries.treeLeaves;
    const mat2 = this.materials.leaves;
    // Muted forest greens (not neon)
    const leafPalettes = [
        new THREE.Color(0x2a4a28), // deep pine
        new THREE.Color(0x355c30), // mid forest
        new THREE.Color(0x3f6a38)  // broadleaf summer
    ];

    const instancedMeshes1 = [];
    const instancedMeshes2 = [];
    const instanceCounts = [0, 0, 0];
    
    for(let v = 0; v < NUM_VARIANTS; v++) {
        const m1 = new THREE.InstancedMesh(geoms1[v], mat1, numDecorations);
        const m2 = new THREE.InstancedMesh(geoms2[v], mat2, numDecorations);
        // Critical: trees must NOT be raycast targets (was tanking FPS near Earth)
        m1.raycast = () => {};
        m2.raycast = () => {};
        m1.frustumCulled = true;
        m2.frustumCulled = true;
        instancedMeshes1.push(m1);
        instancedMeshes2.push(m2);
    }
    
    const colorDummy = new THREE.Color();
    const colorDummy2 = new THREE.Color();
    const dummy = new THREE.Object3D();
    const upVector = new THREE.Vector3(0, 1, 0);
    const phi = Math.PI * (3 - Math.sqrt(5)); 
    
    // Iteramos muchas más veces porque el umbral de ruido de bosque rechazará la mayoría
    for (let i = 0; i < numDecorations * 25; i++) { 
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
        
        const elev = height - radius;
        if (slope > radius * 0.04) continue;
        if (elev < -28.0) continue;
        if (elev > 5500) continue; // tree line — no forest on alpine snow
        // Bosques densos en ~30% del mapa
        if (clusterNoise < 0.4) continue;
        
        const pos = dir.clone().multiplyScalar(height);
        dummy.position.copy(pos);
        dummy.quaternion.setFromUnitVectors(upVector, dir);
        
        // Slightly smaller / denser silhouette near the tree line
        // Árboles ~3–5× el alto del piloto (150 u)
        const alpineShrink = elev > 3200 ? THREE.MathUtils.clamp(1.0 - (elev - 3200) / 2300, 0.55, 1.0) : 1.0;
        const baseScale = radius * 0.00105 * alpineShrink;
        const scale = baseScale + noise3D(dir.x * 5, dir.y * 5, 3) * (baseScale * 0.9);
        const scaleX = scale * (0.85 + noise3D(dir.x * 20, dir.y * 20, 1) * 0.3);
        const scaleY = scale * (0.95 + noise3D(dir.x * 20, dir.y * 20, 2) * 0.9);
        const scaleZ = scale * (0.85 + noise3D(dir.x * 20, dir.y * 20, 3) * 0.3);
        
        dummy.scale.set(scaleX, scaleY, scaleZ);
        dummy.rotateX((noise3D(dir.x * 15, dir.y * 15, 1) * Math.PI) / 20);
        dummy.rotateZ((noise3D(dir.x * 15, dir.y * 15, 2) * Math.PI) / 20);
        dummy.rotateY(noise3D(dir.x * 10, dir.y * 10, 4) * Math.PI * 2);
        dummy.updateMatrix();
        
        // Prefer pines higher up; broadleaf in valleys
        let v = Math.floor(Math.random() * NUM_VARIANTS);
        if (elev > 2800 && Math.random() < 0.7) v = Math.floor(Math.random() * 2); // pine variants 0–1
        if (elev < 800 && Math.random() < 0.45) v = 2; // broadleaf lowlands
        
        const idx = instanceCounts[v];
        instancedMeshes1[v].setMatrixAt(idx, dummy.matrix);
        
        let hueShift = noise3D(dir.x * 30, dir.y * 30, 5);
        colorDummy.copy(baseColorObj1);
        const hsl = {}; colorDummy.getHSL(hsl);
        colorDummy.setHSL(hsl.h + hueShift * 0.04, 0.35, 0.22 + Math.abs(hueShift) * 0.08);
        instancedMeshes1[v].setColorAt(idx, colorDummy);
        
        instancedMeshes2[v].setMatrixAt(idx, dummy.matrix);
        colorDummy2.copy(leafPalettes[v]);
        const hsl2 = {}; colorDummy2.getHSL(hsl2);
        // Cooler / desaturated near tree line
        const cool = elev > 3000 ? 0.12 : 0;
        colorDummy2.setHSL(
            hsl2.h + hueShift * 0.06,
            Math.max(0.25, hsl2.s - cool - Math.abs(hueShift) * 0.05),
            hsl2.l + hueShift * 0.06 - cool * 0.05
        );
        instancedMeshes2[v].setColorAt(idx, colorDummy2);
        
        instanceCounts[v]++;
    }
    
    for(let v=0; v<NUM_VARIANTS; v++) {
        if (instanceCounts[v] > 0) {
            instancedMeshes1[v].count = instanceCounts[v];
            instancedMeshes1[v].instanceMatrix.needsUpdate = true;
            if (instancedMeshes1[v].instanceColor) instancedMeshes1[v].instanceColor.needsUpdate = true;
            decorGroup.add(instancedMeshes1[v]);
            instancedMeshes2[v].count = instanceCounts[v];
            instancedMeshes2[v].instanceMatrix.needsUpdate = true;
            if (instancedMeshes2[v].instanceColor) instancedMeshes2[v].instanceColor.needsUpdate = true;
            decorGroup.add(instancedMeshes2[v]);
        }
    }

    // --- 2. Sotobosque: arbustos (Terran only) ---
    const numClutter = 2000;
    const clutterGeoms = this.geometries.bush;
    const clutterMat = this.materials.bushMat;
    const baseClutterColor = new THREE.Color(0x2f5a2c);
    
    const clutterMeshes = [];
    const clutterCounts = [0, 0, 0];
    for(let v=0; v<NUM_VARIANTS; v++) {
        const mesh = new THREE.InstancedMesh(clutterGeoms[v], clutterMat, numClutter);
        mesh.raycast = () => {};
        mesh.frustumCulled = true;
        clutterMeshes.push(mesh);
    }
    
    for (let i = 0; i < numClutter * 3; i++) { 
        let total = clutterCounts[0] + clutterCounts[1] + clutterCounts[2];
        if (total >= numClutter) break;
        
        const y = 1 - (i / (numClutter * 3 - 1)) * 2; 
        const r = Math.sqrt(1 - y * y);
        const theta = phi * i * 1.618;
        
        let dir = new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r);
        dir.x += (Math.random() - 0.5) * 0.05;
        dir.y += (Math.random() - 0.5) * 0.05;
        dir.z += (Math.random() - 0.5) * 0.05;
        dir.normalize();
        
        const height = TerrainBuilder.getHeight(dir, radius, biome);
        const elev = height - radius;
        if (elev < -28.0 || elev > 4800) continue;
        
        const clusterNoise = noise3D(dir.x * 2, dir.y * 2, dir.z * 2); 
        if (clusterNoise < 0.1) continue; 
        
        const pos = dir.clone().multiplyScalar(height);
        dummy.position.copy(pos);
        dummy.quaternion.setFromUnitVectors(upVector, dir);
        
        // Arbustos a cintura/pecho del piloto
        const baseScale = radius * 0.00022; 
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
        colorDummy.setHSL(hsl.h + hueShift * 0.5, 0.7, 0.4 + Math.abs(hueShift)*0.2);
        
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
