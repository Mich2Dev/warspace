import * as THREE from 'three';
import { Quadtree } from './Quadtree.js';
import { PlanetDecorator } from './PlanetDecorator.js';
import { AsteroidRing } from './AsteroidRing.js';
import { GrassManager } from './GrassManager.js';
import { CloudLayer } from './CloudLayer.js';
import { LavaVapor } from './LavaVapor.js';

export class Planet {
  constructor(scene, radius, position = new THREE.Vector3(0,0,0), color = 0x339944, biome = 'Terran', hasRings = false) {
    this.scene = scene;
    this.radius = radius;
    this.color = color;
    this.biome = biome;
    this._lodElapsed = 999;
    
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

    // Soft cloud / ash shell
    this.cloudLayer = null;
    if (biome === 'Terran' || biome === 'Ice' || biome === 'Toxic' || biome === 'GasGiant' || biome === 'Lava') {
      try {
        this.cloudLayer = new CloudLayer(this.group, this.radius, this.biome);
      } catch (err) {
        console.warn('[Planet] CloudLayer failed:', err);
      }
    }

    this.lavaVapor = null;
    if (biome === 'Lava') {
      try {
        this.lavaVapor = new LavaVapor(this.group, this.radius, this.biome);
      } catch (err) {
        console.warn('[Planet] LavaVapor failed:', err);
      }
    }

    // Create Atmosphere — thick shell so epic peaks (up to ~6% of radius) sit well inside the sky
    // Fog / re-entry in main.js use the same ATMO_SHELL factor.
    const ATMO_SHELL = biome === 'Lava' ? 1.12 : 1.18;
    const atmoGeometry = new THREE.SphereGeometry(this.radius * ATMO_SHELL, 48, 48);
    
    // Fresnel atmosphere — Lava: halo caliente en el limbo, no cielo rojo sólido
    const vertexShader = `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `;

    const fragmentShader = `
      uniform vec3 color;
      uniform vec3 horizonColor;
      uniform float power;
      uniform float strength;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main() {
        float dotNV = max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0)));
        float fresnel = pow(1.0 - dotNV, power) * strength;
        // Un poco más de glow hacia el “horizonte” de la esfera
        vec3 col = mix(color, horizonColor, fresnel);
        gl_FragColor = vec4(col, fresnel);
      }
    `;

    const isLava = biome === 'Lava';
    const atmoMaterial = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(isLava ? 0x1a0a06 : this.color).multiplyScalar(isLava ? 1.0 : 1.5) },
        horizonColor: { value: new THREE.Color(isLava ? 0xff7030 : this.color).multiplyScalar(isLava ? 1.4 : 1.2) },
        power: { value: isLava ? 2.8 : 3.5 },
        strength: { value: isLava ? 1.55 : 1.2 }
      },
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      transparent: true,
      depthWrite: false
    });
    this.atmosphere = new THREE.Mesh(atmoGeometry, atmoMaterial);
    this.group.add(this.atmosphere);
  }

  update(cameraPosition, spaceshipSpeed = 0, delta = 0.016) {
    // Planetas lejanos: no regenerar LOD/hierba (eso era el lag a alta velocidad)
    const dist = cameraPosition.distanceTo(this.group.position);
    const nearLimit = this.radius * 2.2 + 250000;
    if (dist > nearLimit) {
      if (this.grassManager?.mesh) this.grassManager.mesh.visible = false;
      if (this.grassManager?.fireflyMesh) this.grassManager.fireflyMesh.visible = false;
      if (this.decorations) this.decorations.visible = false;
      this.cloudLayer?.setVisible(false);
      this.lavaVapor?.setVisible(false);
      this._lodElapsed = 999;
      return;
    }

    if (this.decorations) this.decorations.visible = true;
    this.cloudLayer?.setVisible(true);
    if (this.cloudLayer) this.cloudLayer.update(delta);
    if (this.lavaVapor) this.lavaVapor.update(cameraPosition, delta);

    // El LOD no necesita recorrer todos sus nodos 60 veces por segundo.
    // A 8–10 Hz sigue reaccionando rápido y libera CPU para física/render.
    this._lodElapsed += delta;
    const lodInterval = spaceshipSpeed > 5000 ? 0.16 : 0.1;
    if (this._lodElapsed < lodInterval) return;
    this._lodElapsed = 0;

    for (const qt of this.quadtrees) {
      qt.update(cameraPosition, spaceshipSpeed);
    }
    if (this.grassManager) {
      this.grassManager.update(cameraPosition, spaceshipSpeed);
    }
  }
}
