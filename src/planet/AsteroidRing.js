import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';

export class AsteroidRing {
    static createRingSystem(radius, innerScale = 1.3, outerScale = 2.5) {
        const ringGroup = new THREE.Group();
        const noise3D = createNoise3D();
        
        // ==========================================
        // 1. AAA ASTEROID GEOMETRY (CPU Displaced)
        // ==========================================
        // Create a high-poly sphere and deform it using Simplex Noise to look like a real cratered asteroid
        const geom = new THREE.IcosahedronGeometry(1, 2);
        const posAttribute = geom.attributes.position;
        const v = new THREE.Vector3();
        
        for (let i = 0; i < posAttribute.count; i++) {
            v.fromBufferAttribute(posAttribute, i);
            v.normalize();
            
            // Layer 1: General rock shape (low frequency)
            let n1 = noise3D(v.x * 1.5, v.y * 1.5, v.z * 1.5) * 0.3;
            // Layer 2: Craters and bumps (high frequency)
            let n2 = noise3D(v.x * 4.0, v.y * 4.0, v.z * 4.0) * 0.1;
            // Layer 3: Micro surface roughness
            let n3 = noise3D(v.x * 10.0, v.y * 10.0, v.z * 10.0) * 0.03;
            
            // Craters (invert positive noise bumps)
            if (n2 > 0.05) n2 = -n2 * 2.0;
            
            const radiusOffset = 1.0 + n1 + n2 + n3;
            v.multiplyScalar(radiusOffset);
            posAttribute.setXYZ(i, v.x, v.y, v.z);
        }
        geom.computeVertexNormals(); // Crucial for lighting to look right
        
        const mat = new THREE.MeshStandardMaterial({ 
            color: 0x887766, 
            roughness: 0.8,
            metalness: 0.1
        });
        
        const numAsteroids = 6000;
        const instancedMesh = new THREE.InstancedMesh(geom, mat, numAsteroids);
        instancedMesh.castShadow = true;
        instancedMesh.receiveShadow = true;
        
        const dummy = new THREE.Object3D();
        const colorDummy = new THREE.Color();
        
        const innerRadius = radius * innerScale;
        const outerRadius = radius * outerScale;
        
        // For Collisions
        const collisionData = [];
        
        for (let i = 0; i < numAsteroids; i++) {
            const theta = Math.random() * Math.PI * 2;
            const rDist = Math.random();
            // Bias towards inner rings for density
            const r = innerRadius + (rDist * rDist) * (outerRadius - innerRadius);
            
            const thicknessStr = Math.sin(rDist * Math.PI); 
            const y = (Math.random() - 0.5) * (radius * 0.08) * thicknessStr;
            
            const x = Math.cos(theta) * r;
            const z = Math.sin(theta) * r;
            
            dummy.position.set(x, y, z);
            
            // Size ranges from small boulders to massive city-sized rocks
            const scale = (radius * 0.0005) + Math.random() * (radius * 0.003);
            
            // Randomly stretch slightly so they don't all look like the identical mesh
            dummy.scale.set(
                scale * (0.8 + Math.random() * 0.4), 
                scale * (0.8 + Math.random() * 0.4), 
                scale * (0.8 + Math.random() * 0.4)
            );
            
            dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
            dummy.updateMatrix();
            instancedMesh.setMatrixAt(i, dummy.matrix);
            
            // Color variation
            const cVar = (Math.random() - 0.5) * 0.2;
            colorDummy.setHex(0x887766);
            colorDummy.r = Math.max(0, Math.min(1, colorDummy.r + cVar));
            colorDummy.g = Math.max(0, Math.min(1, colorDummy.g + cVar));
            colorDummy.b = Math.max(0, Math.min(1, colorDummy.b + cVar));
            instancedMesh.setColorAt(i, colorDummy);
            
            // Save collision data (Local space x, y, z, and actual collision radius)
            collisionData.push({ x, y, z, radius: scale * 1.2 }); 
        }
        
        instancedMesh.instanceMatrix.needsUpdate = true;
        instancedMesh.instanceColor.needsUpdate = true;
        ringGroup.add(instancedMesh);
        
        // Save to group for main.js to read
        ringGroup.userData.collisionData = collisionData;
        
        // ==========================================
        // 2. VOLUMETRIC STARDUST (THREE.Points)
        // ==========================================
        const numDustParticles = 30000;
        const dustGeom = new THREE.BufferGeometry();
        const dustPositions = new Float32Array(numDustParticles * 3);
        const dustColors = new Float32Array(numDustParticles * 3);
        
        const innerColor = new THREE.Color(0x221a11); // Dark rocky dust
        const outerColor = new THREE.Color(0x334455); // Dark icy dust
        const tempColor = new THREE.Color();
        
        let pIdx = 0;
        for (let i = 0; i < numDustParticles; i++) {
            const theta = Math.random() * Math.PI * 2;
            const rDist = Math.random();
            
            // Introduce Cassini and Encke divisions into the dust itself
            let isValid = true;
            if (rDist > 0.65 && rDist < 0.68) isValid = false;
            if (rDist > 0.85 && rDist < 0.86) isValid = false;
            
            if (!isValid) continue; // Skip particles in the gaps
            
            const r = innerRadius + rDist * (outerRadius - innerRadius);
            
            // Dust volume is thicker than the large asteroids, forming a massive torus
            const yOffset = (Math.random() - 0.5) * (radius * 0.15) * Math.sin(rDist * Math.PI);
            
            dustPositions[pIdx * 3] = Math.cos(theta) * r;
            dustPositions[pIdx * 3 + 1] = yOffset;
            dustPositions[pIdx * 3 + 2] = Math.sin(theta) * r;
            
            tempColor.lerpColors(innerColor, outerColor, rDist);
            // Add slight color noise
            tempColor.r += (Math.random() - 0.5) * 0.1;
            tempColor.g += (Math.random() - 0.5) * 0.1;
            tempColor.b += (Math.random() - 0.5) * 0.1;
            
            dustColors[pIdx * 3] = tempColor.r;
            dustColors[pIdx * 3 + 1] = tempColor.g;
            dustColors[pIdx * 3 + 2] = tempColor.b;
            
            pIdx++;
        }
        
        // Trim arrays to actual particle count (due to skipped gaps)
        const finalPositions = dustPositions.slice(0, pIdx * 3);
        const finalColors = dustColors.slice(0, pIdx * 3);
        
        dustGeom.setAttribute('position', new THREE.BufferAttribute(finalPositions, 3));
        dustGeom.setAttribute('color', new THREE.BufferAttribute(finalColors, 3));
        
        // Use a generic soft circle for particles
        const canvas = document.createElement('canvas');
        canvas.width = 32; canvas.height = 32;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0,0,32,32);
        const ptTex = new THREE.CanvasTexture(canvas);
        
        const dustMat = new THREE.PointsMaterial({
            size: radius * 0.08, // Huge particles to create smooth overlapping fog
            map: ptTex,
            vertexColors: true,
            transparent: true,
            opacity: 0.01, // Extremely soft, almost invisible individually
            depthWrite: false,
            blending: THREE.AdditiveBlending // Blends to create bright areas only where dense
        });
        
        const dustMesh = new THREE.Points(dustGeom, dustMat);
        ringGroup.add(dustMesh);
        
        return ringGroup;
    }
}
