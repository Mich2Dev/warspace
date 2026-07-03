import * as THREE from 'three';
import { Quadtree } from './Quadtree.js';

export class Planet {
  constructor(scene, radius, position = new THREE.Vector3(0,0,0), color = 0x339944) {
    this.scene = scene;
    this.radius = radius;
    this.color = color;
    
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.scene.add(this.group);
    
    // Create 6 faces of a cube
    const faces = [
      { localUp: new THREE.Vector3(0, 1, 0) }, // Top
      { localUp: new THREE.Vector3(0, -1, 0) }, // Bottom
      { localUp: new THREE.Vector3(1, 0, 0) }, // Right
      { localUp: new THREE.Vector3(-1, 0, 0) }, // Left
      { localUp: new THREE.Vector3(0, 0, 1) }, // Front
      { localUp: new THREE.Vector3(0, 0, -1) }, // Back
    ];
    
    this.quadtrees = faces.map(face => {
      return new Quadtree(this.group, face.localUp, this.radius, this.color);
    });
  }

  update(cameraPosition) {
    for (const qt of this.quadtrees) {
      qt.update(cameraPosition);
    }
  }
}
