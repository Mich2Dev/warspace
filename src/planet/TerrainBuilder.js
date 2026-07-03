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
const RESOLUTION = 16; // Number of segments per quad chunk

export class TerrainBuilder {
  static buildChunk(localUp, axisA, axisB, radius, center, size, color) {
    const geometry = new THREE.PlaneGeometry(size, size, RESOLUTION, RESOLUTION);
    const positions = geometry.attributes.position;
    
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
      vertex.multiplyScalar(finalRadius);
      
      positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    
    geometry.computeVertexNormals();
    
    // Assign a basic material
    const material = new THREE.MeshStandardMaterial({ 
      color: color,
      roughness: 0.8,
      metalness: 0.1
    });
    
    return new THREE.Mesh(geometry, material);
  }

  // Exposed so Spaceship can do collision detection exactly matching the procedural mesh
  static getHeight(normalizedVertex, baseRadius) {
    const frequency = 0.005;
    const amplitude = 30; // Max mountain height
    
    let noiseVal = noise3D(normalizedVertex.x * frequency * baseRadius, normalizedVertex.y * frequency * baseRadius, normalizedVertex.z * frequency * baseRadius);
    noiseVal = (noiseVal + 1) / 2; // 0 to 1
    
    // Add multiple octaves for detail
    let noiseVal2 = noise3D(normalizedVertex.x * frequency * baseRadius * 4, normalizedVertex.y * frequency * baseRadius * 4, normalizedVertex.z * frequency * baseRadius * 4);
    noiseVal += noiseVal2 * 0.25;

    return baseRadius + (noiseVal * amplitude);
  }
}
