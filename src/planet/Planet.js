import * as THREE from 'three';
import { Quadtree } from './Quadtree.js';
import { PlanetDecorator } from './PlanetDecorator.js';
import { AsteroidRing } from './AsteroidRing.js';
import { GrassManager } from './GrassManager.js';
import { CloudLayer } from './CloudLayer.js';

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

    // 3D grass ON TOP of Terran floor (Earth only) — never block planet if grass fails
    if (this.biome === 'Terran') {
        try {
            this.grassManager = new GrassManager(this.group, this.radius);
        } catch (err) {
            console.warn('[Planet] GrassManager failed, terrain still loads:', err);
            this.grassManager = null;
        }
    }

    // Soft cloud shell (Terran / Ice / Toxic / GasGiant)
    this.cloudLayer = null;
    if (biome === 'Terran' || biome === 'Ice' || biome === 'Toxic' || biome === 'GasGiant') {
      try {
        this.cloudLayer = new CloudLayer(this.group, this.radius, this.biome);
      } catch (err) {
        console.warn('[Planet] CloudLayer failed:', err);
      }
    }

    // Create Atmosphere — thick shell so epic peaks (up to ~6% of radius) sit well inside the sky
    // Fog / re-entry in main.js use the same ATMO_SHELL factor.
    const ATMO_SHELL = 1.18;
    const atmoGeometry = new THREE.SphereGeometry(this.radius * ATMO_SHELL, 64, 64);
    
    // Advanced Procedural Atmospheric Fresnel Shader
    const vertexShader = `
      varying vec3 vNormal;
      void main() {
        // Calculate normal in view space
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      uniform vec3 color;
      varying vec3 vNormal;
      void main() {
        // View direction in view space is always (0,0,1)
        float dotNV = max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0)));
        // Fresnel effect: transparent in center, glowing on edges
        float intensity = pow(1.0 - dotNV, 3.5) * 1.2;
        gl_FragColor = vec4(color, intensity);
      }
    `;

    const atmoMaterial = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(this.color).multiplyScalar(1.5) } // Boosted brightness
      },
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide, // FrontSide for external atmospheric glow
      transparent: true,
      depthWrite: false
    });
    this.atmosphere = new THREE.Mesh(atmoGeometry, atmoMaterial);
    this.group.add(this.atmosphere);
  }

  update(cameraPosition, spaceshipSpeed = 0, delta = 0.016) {
    for (const qt of this.quadtrees) {
      qt.update(cameraPosition, spaceshipSpeed);
    }
    if (this.grassManager) {
      this.grassManager.update(cameraPosition);
    }
    if (this.cloudLayer) {
      this.cloudLayer.update(delta);
    }
  }
}
