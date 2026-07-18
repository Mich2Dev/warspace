import * as THREE from 'three';
import { Quadtree } from './Quadtree.js';
import { PlanetDecorator } from './PlanetDecorator.js';
import { AsteroidRing } from './AsteroidRing.js';

export class Planet {
  constructor(scene, radius, position = new THREE.Vector3(0,0,0), color = 0x339944, biome = 'Terran', hasRings = false) {
    this.scene = scene;
    this.radius = radius;
    this.color = color;
    this.biome = biome;
    
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
      return new Quadtree(this.group, face.localUp, this.radius, this.color, this.biome);
    });
    
    // Add Global Permanent Decorators (No more LOD pop-in!)
    this.decorations = PlanetDecorator.createGlobalDecorations(this.radius, this.biome);
    this.group.add(this.decorations);
    
    // Add Asteroid Rings if specified
    if (hasRings) {
        this.rings = AsteroidRing.createRingSystem(this.radius);
        this.group.add(this.rings);
    }

    // Create Atmosphere
    const atmoGeometry = new THREE.SphereGeometry(this.radius * 1.05, 64, 64);
    
    // Add glowing atmosphere effect
    const atmoMaterial = new THREE.MeshStandardMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.15,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.atmosphere = new THREE.Mesh(atmoGeometry, atmoMaterial);
    this.group.add(this.atmosphere);
  }

  update(cameraPosition) {
    for (const qt of this.quadtrees) {
      qt.update(cameraPosition);
    }
  }
}
