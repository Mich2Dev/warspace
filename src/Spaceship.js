import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TerrainBuilder } from './planet/TerrainBuilder.js';

export class Spaceship {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    
    // Create ship container
    this.mesh = new THREE.Group();
    // Start at Z = 15000 so we are well outside the first planet (Radius 10000)
    this.mesh.position.set(0, 0, 15000);
    this.scene.add(this.mesh);

    // Load custom GLB Model
    const loader = new GLTFLoader();
    loader.load('/nave1.glb', (gltf) => {
      const model = gltf.scene;
      // Adjust scale and rotation of the custom model so it faces forward (-Z)
      // This might require tweaking depending on how the original model was exported
      model.scale.set(1, 1, 1); 
      // model.rotation.y = Math.PI; // Adjust if the model is backwards
      this.mesh.add(model);
    });
    
    // Engine Thruster Flames (Real Volumetric Particle System)
    // 1. Procedural Glow Texture
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    gradient.addColorStop(0.2, 'rgba(200, 230, 255, 0.8)');
    gradient.addColorStop(0.5, 'rgba(0, 100, 255, 0.4)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    
    const particleTexture = new THREE.CanvasTexture(canvas);
    const particleMat = new THREE.SpriteMaterial({
      map: particleTexture,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    });
    
    this.engineParticles = [];
    // Pre-allocate a pool of 300 particles for high performance
    for (let i = 0; i < 300; i++) {
      const sprite = new THREE.Sprite(particleMat.clone());
      sprite.visible = false;
      this.mesh.add(sprite);
      this.engineParticles.push({
        mesh: sprite,
        life: 0,
        maxLife: 0,
        velocity: new THREE.Vector3(),
        baseScale: 1
      });
    }
    
    // Exact calibrated nozzle positions
    this.nozzleSettings = [
      { pos: new THREE.Vector3(0, 0.16, 11.55), scale: 1.8 },       // Center main
      { pos: new THREE.Vector3(-1.56, 2.14, 13.5), scale: 0.9 },     // Inner Left
      { pos: new THREE.Vector3(1.56, 2.14, 13.5), scale: 0.9 },      // Inner Right
      { pos: new THREE.Vector3(-5.26, -0.58, 13.5), scale: 2.1 },    // Outer Left
      { pos: new THREE.Vector3(5.26, -0.58, 13.5), scale: 2.1 }      // Outer Right
    ];
    
    // Add a glowing point light to the engine
    this.engineLight = new THREE.PointLight(0x00aaff, 4, 150);
    this.engineLight.position.set(0, -6, 20);
    this.mesh.add(this.engineLight);
    
    // Flight parameters (Massively boosted to traverse solar system!)
    this.speed = 0;
    this.maxSpeed = 15000;
    this.acceleration = 3000;
    
    this.rotationSpeed = 1.5; // rad/sec
    
    // We attach a dummy object for the camera to follow
    this.cameraBoom = new THREE.Object3D();
    this.mesh.add(this.cameraBoom);
    // Since ship is 32 units long, camera must be pushed back!
    this.cameraDistance = 45;
    this.cameraBoom.position.set(0, 10, this.cameraDistance); // Third person view
    
    // Mouse input accumulators
    this.pitchAccumulator = 0;
    this.yawAccumulator = 0;
    
    this.mode = 'FLIGHT'; // 'FLIGHT' or 'HOVER'
    this.hoverPlanet = null; // Planet data for anchoring
    this.hoverHeightOffset = 5; // Distance to hover above terrain
  }

  onMouseMove(movementX, movementY) {
    if (this.mode !== 'FLIGHT') return; // Ignore mouse when anchored
    const mouseSensitivity = 0.002;
    this.yawAccumulator -= movementX * mouseSensitivity;
    this.pitchAccumulator -= movementY * mouseSensitivity;
  }

  onScroll(deltaY) {
    // Zoom sensitivity
    this.cameraDistance += deltaY * 0.02;
    // Limit how close or far the camera can go
    this.cameraDistance = Math.max(5, Math.min(this.cameraDistance, 100));
    // Update the boom position (keeping the height offset roughly proportional or static)
    this.cameraBoom.position.z = this.cameraDistance;
    this.cameraBoom.position.y = this.cameraDistance * 0.25; 
  }

  update(delta, keys) {
    if (this.mode === 'FLIGHT') {
      this.updateFlight(delta, keys);
    } else if (this.mode === 'HOVER') {
      this.updateHover(delta, keys);
    }
    
    // Update camera position to follow the boom
    const idealCameraPos = new THREE.Vector3();
    this.cameraBoom.getWorldPosition(idealCameraPos);
    
    const idealLookAt = new THREE.Vector3();
    this.mesh.getWorldPosition(idealLookAt);
    
    // Look slightly ahead of the ship
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.mesh.quaternion).multiplyScalar(20);
    idealLookAt.add(forward);

    // The camera perfectly tracks the ideal position without any lag,
    // so it never falls behind no matter how fast you travel.
    this.camera.position.copy(idealCameraPos);
    
    // Smooth camera lookat
    // We need the actual world UP vector of the ship, not the default (0,1,0)
    const shipWorldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.mesh.quaternion).normalize();
    
    const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(this.camera.position, idealLookAt, shipWorldUp)
    );
    this.camera.quaternion.slerp(targetQuaternion, 0.2); // Smooth turning
    
    // Dynamic FOV for hyperspace warp effect!
    // Base FOV is 75, max FOV is 115 on full boost
    const speedRatio = Math.max(0, this.speed / (this.maxSpeed * 2));
    const targetFov = 75 + (speedRatio * 40);
    this.camera.fov += (targetFov - this.camera.fov) * 0.1;
    this.camera.updateProjectionMatrix();
  }

  updateFlight(delta, keys) {
    // Engine visual defaults
    let targetFlameScale = 0.5; // Idle is visible
    let targetFlameColor = 0x0044ff;
    
    // Thrust
    if (keys['KeyW']) {
      this.speed += this.acceleration * delta;
      targetFlameScale = 1.2;
      targetFlameColor = 0x00ffff;
    } else if (keys['KeyS']) {
      this.speed -= this.acceleration * delta;
      targetFlameScale = 0.0;
    } else {
      this.speed *= 0.98; // Drag
    }
    
    // TURBO BOOST (Fixed to accept either shift key)
    if (keys['ShiftLeft'] || keys['ShiftRight']) {
      this.speed += this.acceleration * 4 * delta; // Even faster acceleration for boost
      targetFlameScale = 3.0; // Massive flame
      targetFlameColor = 0xffaa00; // Turns orange/red on boost!
    }
    // Sync point light
    this.engineLight.color.setHex(targetFlameColor);
    this.engineLight.intensity = targetFlameScale * 2;
    
    // Clamp speed
    this.speed = Math.max(-this.maxSpeed * 0.2, Math.min(this.speed, this.maxSpeed * 2));
    
    // Apply accumulated mouse rotations
    this.mesh.rotateY(this.yawAccumulator);
    this.mesh.rotateX(this.pitchAccumulator);
    
    // Dampen mouse movement (friction) so it doesn't spin forever
    this.yawAccumulator *= 0.5;
    this.pitchAccumulator *= 0.5;
    
    // Roll (A / D)
    if (keys['KeyA']) {
      this.mesh.rotateZ(this.rotationSpeed * delta);
    }
    if (keys['KeyD']) {
      this.mesh.rotateZ(-this.rotationSpeed * delta);
    }

    // Move forward
    this.mesh.translateZ(-this.speed * delta);
    
    // Save for network telemetry
    this.flameScale = targetFlameScale;
    
    this.updateParticles(delta, targetFlameScale, targetFlameColor);
  }

  updateParticles(delta, targetFlameScale, targetFlameColor) {
    // Particle Engine Exhaust System
    if (targetFlameScale > 0) {
      // Spawn more particles when boosting
      const particlesToSpawn = Math.floor(targetFlameScale * 5); 
      for(let i=0; i<particlesToSpawn; i++) {
        // Find a dead particle in the pool
        const p = this.engineParticles.find(p => p.life <= 0);
        if (p) {
          // Pick a random nozzle
          const nozzle = this.nozzleSettings[Math.floor(Math.random() * 5)];
          p.mesh.position.copy(nozzle.pos);
          
          // Add some jitter so it feels like chaotic plasma
          p.mesh.position.x += (Math.random() - 0.5) * nozzle.scale * 0.5;
          p.mesh.position.y += (Math.random() - 0.5) * nozzle.scale * 0.5;
          
          p.mesh.visible = true;
          p.life = 0.2 + Math.random() * 0.2; // Live for 0.2 to 0.4 seconds
          p.maxLife = p.life;
          
          // Shoot backwards (+Z) with speed relative to thrust
          p.velocity.set(
            (Math.random() - 0.5) * 5,
            (Math.random() - 0.5) * 5,
            40 + Math.random() * 20 + targetFlameScale * 30
          );
          
          p.baseScale = nozzle.scale * targetFlameScale * 2.5;
          p.mesh.material.color.setHex(targetFlameColor);
        }
      }
    }
    
    // Update existing particles
    for (const p of this.engineParticles) {
      if (p.life > 0) {
        p.life -= delta;
        p.mesh.position.addScaledVector(p.velocity, delta);
        
        // Shrink and fade out as it dies
        const lifeRatio = Math.max(0, p.life / p.maxLife);
        const scale = p.baseScale * lifeRatio;
        p.mesh.scale.set(scale, scale, scale);
        
        if (p.life <= 0) {
          p.mesh.visible = false;
        }
      }
    }
  }

  updateHover(delta, keys) {
    if (!this.hoverPlanet) return;
    
    // Hover speed is much slower than flight speed
    const maxHoverSpeed = 100;
    
    // Thrust (Forward / Backward)
    if (keys['KeyW']) {
      this.speed += this.acceleration * delta;
    } else if (keys['KeyS']) {
      this.speed -= this.acceleration * delta;
    } else {
      this.speed *= 0.8; // High friction on ground
    }
    
    // Clamp hover speed
    this.speed = Math.max(-maxHoverSpeed, Math.min(this.speed, maxHoverSpeed));
    
    // Steer (A / D)
    // In hover mode, A/D rotates the ship left/right (Yaw), not roll.
    if (keys['KeyA']) {
      this.mesh.rotateY(this.rotationSpeed * delta);
    }
    if (keys['KeyD']) {
      this.mesh.rotateY(-this.rotationSpeed * delta);
    }
    
    // Minimal flame when hovering
    const hoverFlameScale = (this.speed > 0) ? (this.speed / maxHoverSpeed) * 0.5 : 0.1;
    this.flameScale = hoverFlameScale;
    this.updateParticles(delta, hoverFlameScale, 0x00ffff);
    
    // Move forward locally
    this.mesh.translateZ(-this.speed * delta);
    
    // --- Align to Terrain ---
    // Calculate vector from planet center to ship (Surface Normal)
    const toShip = new THREE.Vector3().subVectors(this.mesh.position, this.hoverPlanet.group.position).normalize();
    
    // Calculate exact terrain height at this position
    const terrainHeight = TerrainBuilder.getHeight(toShip, this.hoverPlanet.radius);
    
    // Snap position to terrain height + hover offset
    const targetPosition = this.hoverPlanet.group.position.clone().add(toShip.clone().multiplyScalar(terrainHeight + this.hoverHeightOffset));
    this.mesh.position.lerp(targetPosition, 0.5); // Smooth snapping
    
    // --- Align ship UP vector with Surface Normal without spinning ---
    const up = toShip;
    // Get current forward vector (Negative Z axis)
    const currentForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.mesh.quaternion).normalize();
    
    // Calculate new orthogonal right vector (X axis)
    const right = new THREE.Vector3().crossVectors(currentForward, up).normalize();
    
    // Calculate true orthogonal forward vector (Negative Z axis)
    const trueForward = new THREE.Vector3().crossVectors(up, right).normalize();
    
    // Build a rotation matrix from X, Y, Z axes
    // Note: Z axis is the opposite of forward
    const matrix = new THREE.Matrix4().makeBasis(right, up, trueForward.negate());
    
    // Smoothly rotate the ship to this new orientation
    const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
    this.mesh.quaternion.slerp(targetQuaternion, 0.2);
  }

  handleCollision(surfaceNormal, targetDistance, planetCenter) {
    // 1. Force the ship position to sit exactly on the surface of the planet
    const targetPosition = planetCenter.clone().add(surfaceNormal.clone().multiplyScalar(targetDistance));
    this.mesh.position.copy(targetPosition);
    
    // 2. Kill the speed or bounce back slightly
    // If you were going very fast forward, bounce back a bit
    this.speed = -this.speed * 0.5;
  }
}
