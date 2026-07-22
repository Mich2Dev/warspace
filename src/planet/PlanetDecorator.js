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

// --- Generador de Textura Procedural de Hojas ---
function generateLeafTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    
    // Transparente por defecto
    ctx.clearRect(0, 0, 128, 128);
    
    // Dibujar rama central
    ctx.strokeStyle = '#4a3623';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(64, 128);
    ctx.lineTo(64, 10);
    ctx.stroke();
    
    // Dibujar múltiples hojas
    for (let i = 0; i < 40; i++) {
        const y = 10 + Math.random() * 110;
        const side = Math.random() > 0.5 ? 1 : -1;
        const length = 15 + Math.random() * 25;
        const width = 8 + Math.random() * 10;
        
        ctx.fillStyle = `hsl(${100 + Math.random() * 40}, ${60 + Math.random() * 20}%, ${30 + Math.random() * 20}%)`;
        
        ctx.beginPath();
        ctx.ellipse(64 + (length / 2) * side, y, length, width, (Math.random() - 0.5) * 0.5, 0, Math.PI * 2);
        ctx.fill();
    }
    
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

let sharedLeafTexture = null;

// --- Generadores Terran (árboles / sotobosque) ---

function generateAlienTreePair() {
    const trunkGeometries = [];
    const leavesGeometries = [];
    
    // Un árbol tipo Pino/Roble híbrido, majestuoso y grueso
    const trunkRadius = 1.0 + Math.random() * 0.8;
    const trunkHeight = 15 + Math.random() * 10; // Altura: 15-25 (muy alto)
    const trunkGeom = new THREE.CylinderGeometry(trunkRadius * 0.4, trunkRadius, trunkHeight, 7, 4);
    trunkGeom.translate(0, trunkHeight / 2, 0); // Base at 0
    
    // Perturbar el tronco para que se vea orgánico (AAA style)
    const pos = trunkGeom.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        v.x += noise3D(v.x*2, v.y*2, v.z*2) * 0.4;
        v.z += noise3D(v.x*2, v.y*2, v.z*2 + 10) * 0.4;
        pos.setXYZ(i, v.x, v.y, v.z);
    }
    trunkGeometries.push(trunkGeom);

    // Hojas (Canopy fotorrealista con Cross-Quads de cero lag)
    const numLeafClusters = 6 + Math.floor(Math.random() * 5);
    
    // Creamos la geometría de las ramas (dos planos cruzados = 4 triángulos por rama)
    const leafGeo = new THREE.PlaneGeometry(8, 8);
    // Mover el centro del plano a la base para que la rama nazca del tronco
    leafGeo.translate(0, 4, 0); 

    for (let i = 0; i < numLeafClusters; i++) {
        // Distribuimos los clusters alrededor de la copa
        const angle = (i / numLeafClusters) * Math.PI * 2 + (Math.random() * 0.5);
        const r = 0.5 + Math.random() * 1.5; // Muy cerca del tronco
        const lx = Math.cos(angle) * r;
        const lz = Math.sin(angle) * r;
        const ly = trunkHeight * 0.4 + Math.random() * (trunkHeight * 0.5);
        
        // Creamos la geometría cruzada (Cross-Quad)
        const branchGroup = new THREE.Group();
        const mesh1 = new THREE.Mesh(leafGeo);
        const mesh2 = new THREE.Mesh(leafGeo);
        mesh2.rotation.y = Math.PI / 2;
        
        // Las ramas cuelgan o se alzan un poco aleatoriamente
        branchGroup.rotation.x = (Math.random() - 0.5) * 1.5;
        branchGroup.rotation.z = (Math.random() - 0.5) * 1.5;
        branchGroup.rotation.y = Math.random() * Math.PI;
        branchGroup.position.set(lx, ly, lz);
        branchGroup.scale.setScalar(0.8 + Math.random() * 0.6);
        branchGroup.updateMatrixWorld(true);
        
        // Aplicar la matriz global del grupo a los planos y añadirlos
        const geom1 = leafGeo.clone().applyMatrix4(mesh1.matrixWorld).applyMatrix4(branchGroup.matrixWorld);
        const geom2 = leafGeo.clone().applyMatrix4(mesh2.matrixWorld).applyMatrix4(branchGroup.matrixWorld);
        
        leavesGeometries.push(geom1, geom2);
    }
    
    const mTrunk = trunkGeometries.length > 0 ? BufferGeometryUtils.mergeGeometries(trunkGeometries) : new THREE.BufferGeometry();
    const mLeaves = leavesGeometries.length > 0 ? BufferGeometryUtils.mergeGeometries(leavesGeometries) : new THREE.BufferGeometry();
    
    // OJO: Los planos ya tienen sus normales correctas hacia afuera de fábrica, no llamar a computeVertexNormals para evitar shading feo
    mTrunk.computeVertexNormals();
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
          const [trunk, leaves] = generateAlienTreePair();
          this.geometries.treeTrunk.push(trunk);
          this.geometries.treeLeaves.push(leaves);
      }
      
      if (!sharedLeafTexture) sharedLeafTexture = generateLeafTexture();
      
      this.materials = {
          trunk: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, flatShading: false }),
          leaves: new THREE.MeshStandardMaterial({ 
              color: 0xffffff, 
              roughness: 0.9, 
              map: sharedLeafTexture,
              alphaTest: 0.5,
              side: THREE.DoubleSide
          }),
          bushMat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: false })
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
    const baseColorObj1 = new THREE.Color(0x4a3623);
    const geoms2 = this.geometries.treeLeaves;
    const mat2 = this.materials.leaves;
    const baseColorObj2 = new THREE.Color(0x22cc55);

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
        
        if (slope > radius * 0.05) continue; 
        if (height - radius < -28.0) continue;
        // Solo sembrar árboles si el ruido supera 0.4 (Bosques hiper-densos en el 30% del mapa)
        if (clusterNoise < 0.4) continue;
        
        const pos = dir.clone().multiplyScalar(height);
        dummy.position.copy(pos);
        dummy.quaternion.setFromUnitVectors(upVector, dir);
        
        const baseScale = radius * 0.0005; 
        const scale = baseScale + noise3D(dir.x * 5, dir.y * 5, 3) * (baseScale * 1.0); 
        const scaleX = scale * (0.8 + noise3D(dir.x * 20, dir.y * 20, 1) * 0.4);
        const scaleY = scale * (0.8 + noise3D(dir.x * 20, dir.y * 20, 2) * 1.2);
        const scaleZ = scale * (0.8 + noise3D(dir.x * 20, dir.y * 20, 3) * 0.4);
        
        dummy.scale.set(scaleX * 1.2, scaleY * 1.2, scaleZ * 1.2);
        dummy.rotateX((noise3D(dir.x * 15, dir.y * 15, 1) * Math.PI) / 16);
        dummy.rotateZ((noise3D(dir.x * 15, dir.y * 15, 2) * Math.PI) / 16);
        dummy.rotateY(noise3D(dir.x * 10, dir.y * 10, 4) * Math.PI * 2);
        dummy.updateMatrix();
        
        const v = Math.floor(Math.random() * NUM_VARIANTS);
        const idx = instanceCounts[v];
        instancedMeshes1[v].setMatrixAt(idx, dummy.matrix);
        
        let hueShift = noise3D(dir.x * 30, dir.y * 30, 5); 
        colorDummy.copy(baseColorObj1);
        const hsl = {}; colorDummy.getHSL(hsl);
        colorDummy.setHSL(hsl.h + hueShift * 0.1, 0.5, 0.3 + Math.abs(hueShift)*0.15);
        instancedMeshes1[v].setColorAt(idx, colorDummy);
        
        instancedMeshes2[v].setMatrixAt(idx, dummy.matrix);
        let hueShift2 = noise3D(dir.x * 25, dir.y * 25, 6); 
        colorDummy2.copy(baseColorObj2);
        const hsl2 = {}; colorDummy2.getHSL(hsl2);
        colorDummy2.setHSL(hsl2.h + hueShift2 * 0.8, 0.8, 0.5); 
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
    const baseClutterColor = new THREE.Color(0x33aa44);
    
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
        if (height - radius < -28.0) continue;
        
        const clusterNoise = noise3D(dir.x * 2, dir.y * 2, dir.z * 2); 
        if (clusterNoise < 0.1) continue; 
        
        const pos = dir.clone().multiplyScalar(height);
        dummy.position.copy(pos);
        dummy.quaternion.setFromUnitVectors(upVector, dir);
        
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
