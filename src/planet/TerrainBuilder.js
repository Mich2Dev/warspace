import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';

const noise3D = createNoise3D();
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
      wireframe: true, // Use wireframe initially to easily see Quadtree subdivisions
      roughness: 0.8
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
