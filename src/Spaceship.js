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
    
    // Flight parameters
    this.speed = 0;
    this.maxSpeed = 500;
    this.acceleration = 200;
    
    this.rotationSpeed = 1.5; // rad/sec
    
    // We attach a dummy object for the camera to follow
    this.cameraBoom = new THREE.Object3D();
    this.mesh.add(this.cameraBoom);
    this.cameraDistance = 20;
    this.cameraBoom.position.set(0, 5, this.cameraDistance); // Third person view
    
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

    // Smooth camera movement
    this.camera.position.lerp(idealCameraPos, 0.1);
    
    // Smooth camera lookat
    // We need the actual world UP vector of the ship, not the default (0,1,0)
    const shipWorldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.mesh.quaternion).normalize();
    
    const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(this.camera.position, idealLookAt, shipWorldUp)
    );
    this.camera.quaternion.slerp(targetQuaternion, 0.1);
  }

  updateFlight(delta, keys) {
    // Thrust
    if (keys['KeyW']) {
      this.speed += this.acceleration * delta;
    } else if (keys['KeyS']) {
      this.speed -= this.acceleration * delta;
    } else {
      this.speed *= 0.98; // Drag
    }
    
    if (keys['ShiftLeft']) {
      this.speed += this.acceleration * 2 * delta; // Boost
    }
    
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
