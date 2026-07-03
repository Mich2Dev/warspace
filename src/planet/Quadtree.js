import * as THREE from 'three';
import { TerrainBuilder } from './TerrainBuilder.js';

const MAX_DEPTH = 6;

export class Quadtree {
  constructor(group, localUp, radius, color, depth = 0, center = new THREE.Vector2(0,0), size = 2) {
    this.group = group;
    this.localUp = localUp;
    this.radius = radius;
    this.color = color;
    this.depth = depth;
    this.center = center; // coordinates mapped from -1 to 1 based on original cube face
    this.size = size;
    
    this.isLeaf = true;
    this.children = [];
    
    // Calculate axes A and B for this face
    this.axisA = new THREE.Vector3(localUp.y, localUp.z, localUp.x);
    this.axisB = new THREE.Vector3().crossVectors(localUp, this.axisA);
    
    // Approximate world center of this quad for distance check
    const pointOnCube = new THREE.Vector3()
      .copy(this.localUp)
      .addScaledVector(this.axisA, this.center.x)
      .addScaledVector(this.axisB, this.center.y);
      
    // The surface center in local space
    this.localCenter = pointOnCube.normalize().multiplyScalar(this.radius);
    // The absolute world center (considering the planet group position)
    this.worldCenter = this.localCenter.clone().add(this.group.position);
    
    this.mesh = null;
    if (this.isLeaf) {
      this.buildMesh();
    }
  }
  
  buildMesh() {
    this.mesh = TerrainBuilder.buildChunk(this.localUp, this.axisA, this.axisB, this.radius, this.center, this.size, this.color);
    this.group.add(this.mesh);
  }
  
  removeMesh() {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
  }

  update(cameraPosition) {
    const distance = cameraPosition.distanceTo(this.worldCenter);
    
    // Distance thresholds (heuristic: split if distance < size of node in world space * factor)
    const worldSize = this.size * this.radius; // rough approx
    const splitThreshold = worldSize * 1.5; 
    
    if (this.isLeaf && this.depth < MAX_DEPTH && distance < splitThreshold) {
      this.split();
    } else if (!this.isLeaf && distance > splitThreshold * 1.1) {
      this.merge();
    }
    
    if (!this.isLeaf) {
      for (const child of this.children) {
        child.update(cameraPosition);
      }
    }
  }

  split() {
    this.isLeaf = false;
    this.removeMesh();
    
    const halfSize = this.size / 2;
    const quarterSize = this.size / 4;
    
    // Create 4 children
    const offsets = [
      [-1, -1], [1, -1], [-1, 1], [1, 1]
    ];
    
    for (const offset of offsets) {
      const childCenter = new THREE.Vector2(
        this.center.x + offset[0] * quarterSize,
        this.center.y + offset[1] * quarterSize
      );
      this.children.push(new Quadtree(this.group, this.localUp, this.radius, this.color, this.depth + 1, childCenter, halfSize));
    }
  }

  merge() {
    this.isLeaf = true;
    for (const child of this.children) {
      child.destroy();
    }
    this.children = [];
    this.buildMesh();
  }

  destroy() {
    this.removeMesh();
    for (const child of this.children) {
      child.destroy();
    }
  }
}
