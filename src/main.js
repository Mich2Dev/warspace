import './style.css';
import * as THREE from 'three';
import { Spaceship } from './Spaceship.js';
import { Planet } from './planet/Planet.js';
import { TerrainBuilder } from './planet/TerrainBuilder.js';
import { io } from 'socket.io-client';
import { RemotePlayer } from './RemotePlayer.js';
import { MobileController } from './MobileController.js';

// Setup basic scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050510);
// No fog in deep space! (Otherwise you can't see the sun or planets)
scene.fog = null;

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 50000000); // 50 million bounds
const mapCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 50000000);
mapCamera.position.set(0, 15000000, 0); // 15 million height to see massive orbits
// When looking straight down (-Y), we must change the UP vector to avoid mathematical singularity
mapCamera.up.set(0, 0, -1);
mapCamera.lookAt(0, 0, 0);

// Local Surface Minimap (Top-Down Orthographic Radar)
// Covers a 10km x 10km area of the surface
const localMapCamera = new THREE.OrthographicCamera(-5000, 5000, 5000, -5000, 0.1, 50000);

let isMapMode = false;
const renderer = new THREE.WebGLRenderer({ antialias: true });
// Ensure legacy lighting so PointLight doesn't decay to zero over 300,000 units
renderer.useLegacyLights = true; 
if (renderer.useLegacyLights === undefined) {
    renderer.physicallyCorrectLights = false;
}
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.getElementById('app').appendChild(renderer.domElement);

// Lighting (Realistic space lighting from the Sun)
const ambientLight = new THREE.AmbientLight(0xffffff, 0.02); // Very dark space, pitch black on the dark side
scene.add(ambientLight);

// ==========================================
// MULTIPLAYER NETWORK SETUP
// ==========================================
const socket = io();
const remotePlayers = {};

socket.on('current_players', (players) => {
  for (const id in players) {
    if (id !== socket.id) {
      addRemotePlayer(id, players[id]);
    }
  }
});

socket.on('player_joined', (playerData) => {
  if (playerData.id !== socket.id) {
    addRemotePlayer(playerData.id, playerData);
  }
});

socket.on('player_moved', (data) => {
  if (remotePlayers[data.id]) {
    remotePlayers[data.id].updateNetworkState(data);
  }
});

socket.on('player_left', (id) => {
  if (remotePlayers[id]) {
    remotePlayers[id].destroy(scene);
    delete remotePlayers[id];
  }
});

function addRemotePlayer(id, data) {
  const rp = new RemotePlayer(scene);
  rp.updateNetworkState(data);
  remotePlayers[id] = rp;
}
// ==========================================

// The Sun (Massive PointLight)
const sunLight = new THREE.PointLight(0xffffee, 3.0, 0, 0);
sunLight.position.set(0, 0, 0);
scene.add(sunLight);

// Sun visual mesh (The Core)
const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(30000, 32, 32),
  new THREE.MeshBasicMaterial({ color: 0xffffff }) 
);
scene.add(sunMesh);

// Sun Corona (Glowing aura)
const sunGlow = new THREE.Mesh(
  new THREE.SphereGeometry(45000, 32, 32),
  new THREE.MeshBasicMaterial({ 
    color: 0xffaa00, 
    transparent: true, 
    opacity: 0.4, 
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide
  })
);
scene.add(sunGlow);
// Add a second larger softer glow
const sunGlowSoft = new THREE.Mesh(
  new THREE.SphereGeometry(70000, 32, 32),
  new THREE.MeshBasicMaterial({ 
    color: 0xff5500, 
    transparent: true, 
    opacity: 0.15, 
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide
  })
);
scene.add(sunGlowSoft);

// Add stars (Massive spread to cover the gigantic solar system)
function createStars() {
  const geometry = new THREE.BufferGeometry();
  const vertices = [];
  for (let i = 0; i < 20000; i++) {
    // Spread across 50,000,000 units!
    const x = THREE.MathUtils.randFloatSpread(50000000);
    const y = THREE.MathUtils.randFloatSpread(50000000);
    const z = THREE.MathUtils.randFloatSpread(50000000);
    vertices.push(x, y, z);
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  // Size 1 instead of 2 to prevent huge squares on high DPI screens
  const material = new THREE.PointsMaterial({ color: 0xffffff, size: 1, sizeAttenuation: false });
  const stars = new THREE.Points(geometry, material);
  scene.add(stars);
}
createStars();

// Space Dust
const dustGeometry = new THREE.BufferGeometry();
const dustVertices = [];
for (let i = 0; i < 2000; i++) {
  dustVertices.push(THREE.MathUtils.randFloatSpread(4000), THREE.MathUtils.randFloatSpread(4000), THREE.MathUtils.randFloatSpread(4000));
}
dustGeometry.setAttribute('position', new THREE.Float32BufferAttribute(dustVertices, 3));
const dustMaterial = new THREE.PointsMaterial({ color: 0xaaddff, size: 6, sizeAttenuation: true, transparent: true, opacity: 0.6 });
const spaceDust = new THREE.Points(dustGeometry, dustMaterial);
scene.add(spaceDust);

// Initialize Spaceship
const spaceship = new Spaceship(scene, camera);

// Iniciar Controles Móviles (Si está en celular)
const mobileController = new MobileController(spaceship);
// Spawn the spaceship right next to the new massive Green Planet
spaceship.mesh.position.set(1601000, 0, 0);

// Initialize Procedural Planets (Massive Scale x10)
const planets = [];

// Planet 1: Forest/Green
const p1 = new Planet(scene, 100000, new THREE.Vector3(1500000, 0, 0), 0x339944);
p1.orbitRadius = 1500000; p1.orbitAngleOffset = 0; p1.orbitSpeed = 0.05;
planets.push(p1);

// Planet 2: Desert/Orange
const p2 = new Planet(scene, 80000, new THREE.Vector3(2500000, 0, 0), 0xd2a65a);
p2.orbitRadius = 2500000; p2.orbitAngleOffset = 2; p2.orbitSpeed = 0.03;
planets.push(p2);

// Planet 3: Ice/Blue
const p3 = new Planet(scene, 120000, new THREE.Vector3(3800000, 0, 0), 0x99ccff);
p3.orbitRadius = 3800000; p3.orbitAngleOffset = 4; p3.orbitSpeed = 0.015;
planets.push(p3);

// PRNG Determinista para sincronización de Asteroides
function mulberry32(a) {
    return function() {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}
const rng = mulberry32(987654321);

// Asteroid Belt (InstancedMesh for thousands of rocks)
const asteroidGeo = new THREE.IcosahedronGeometry(2000, 0); // 2km asteroids
const asteroidMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9 });
const asteroidCount = 10000;
const asteroidInstanced = new THREE.InstancedMesh(asteroidGeo, asteroidMat, asteroidCount);
const dummy = new THREE.Object3D();

for (let i = 0; i < asteroidCount; i++) {
  const angle = rng() * Math.PI * 2;
  // Radius between 1,900,000 and 2,100,000
  const radius = 2000000 + ((rng() - 0.5) * 200000);
  const height = ((rng() - 0.5) * 50000); // Belt thickness
  
  dummy.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
  
  // Random rotation and scale
  dummy.rotation.set(rng()*Math.PI, rng()*Math.PI, rng()*Math.PI);
  const scale = 0.5 + rng() * 1.5;
  dummy.scale.set(scale, scale, scale);
  
  dummy.updateMatrix();
  asteroidInstanced.setMatrixAt(i, dummy.matrix);
}
scene.add(asteroidInstanced);

// Hitboxes for map clicking
const planetHitboxes = [];
for (const p of planets) {
  // Invisible spheres just for intersection testing
  const hitbox = new THREE.Mesh(
    new THREE.SphereGeometry(p.radius, 16, 16),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hitbox.position.copy(p.group.position);
  hitbox.userData.planet = p;
  scene.add(hitbox);
  planetHitboxes.push(hitbox);
}

let targetPlanet = null;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// Selection ring for map mode
const selectionRing = new THREE.Group();

const ringMesh = new THREE.Mesh(
  new THREE.RingGeometry(1, 1.2, 64), // Thicker ring!
  new THREE.MeshBasicMaterial({ color: 0xffea00, side: THREE.DoubleSide, transparent: true, opacity: 1.0 })
);
ringMesh.rotation.x = -Math.PI / 2; // Flat on the XZ plane
selectionRing.add(ringMesh);

// Add a vertical beam/cylinder so it's visible from any angle!
const beamMesh = new THREE.Mesh(
  new THREE.CylinderGeometry(0.05, 0.05, 10, 16),
  new THREE.MeshBasicMaterial({ color: 0xffea00, transparent: true, opacity: 0.5 })
);
selectionRing.add(beamMesh);

scene.add(selectionRing);
selectionRing.visible = false;

// Map Mode Ship Marker (A big bright sphere so we can see where we are on the map)
const markerGeo = new THREE.SphereGeometry(1000, 8, 8);
const markerMat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true });
const shipMarker = new THREE.Mesh(markerGeo, markerMat);
scene.add(shipMarker);

// Input handling for spaceship
const keys = {};
window.addEventListener('keydown', (e) => { 
  keys[e.code] = true;    if (e.code === 'KeyM') {
    isMapMode = !isMapMode;
    if (isMapMode) {
      document.exitPointerLock();
      document.body.style.cursor = 'crosshair'; // Change cursor for map
      // Don't show local minimap in galactic map mode
      document.getElementById('minimap-border').style.display = 'none';
    } else {
      document.body.requestPointerLock();
      document.body.style.cursor = 'default';
      selectionRing.visible = false; // Hide map ring in flight
    }
  } else if (e.code === 'Numpad5') {
    // Anchor to nearest planet
    let closestPlanet = null;
    let minDistance = Infinity;
    for (const p of planets) {
      const dist = spaceship.mesh.position.distanceTo(p.group.position);
      if (dist < minDistance) {
        minDistance = dist;
        closestPlanet = p;
      }
    }
    // Anchor if inside atmosphere
    if (closestPlanet && minDistance < closestPlanet.radius + 500) {
      spaceship.mode = 'HOVER';
      spaceship.hoverPlanet = closestPlanet;
      // Also release pointer lock so mouse doesn't get captured confusingly, although we ignore mouse
    }
  } else if (e.code === 'Numpad8') {
    // Un-anchor
    spaceship.mode = 'FLIGHT';
    spaceship.hoverPlanet = null;
  }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

// Pointer Lock and Map Click
document.addEventListener('click', (e) => {
  if (!isMapMode) {
    document.body.requestPointerLock();
  } else {
    // We are in map mode, do raycasting to select a planet
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(pointer, mapCamera);
    const intersects = raycaster.intersectObjects(planetHitboxes);
    
    if (intersects.length > 0) {
      targetPlanet = intersects[0].object.userData.planet;
    } else {
      targetPlanet = null; // click empty space to clear
    }
  }
});
document.addEventListener('mousemove', (e) => {
  if (isMapMode) {
    // Hover effect for planets
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, mapCamera);
    const intersects = raycaster.intersectObjects(planetHitboxes);
    if (intersects.length > 0) {
      document.body.style.cursor = 'pointer';
    } else {
      document.body.style.cursor = 'crosshair';
    }
  } else if (document.pointerLockElement === document.body) {
    spaceship.onMouseMove(e.movementX, e.movementY);
  }
});
document.addEventListener('wheel', (e) => {
  if (document.pointerLockElement === document.body) {
    spaceship.onScroll(e.deltaY);
  }
});


// Resize handler
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  mapCamera.aspect = window.innerWidth / window.innerHeight;
  mapCamera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Game loop
const clock = new THREE.Clock();
let lastNetworkTick = 0;

function animate() {
  requestAnimationFrame(animate);
  
  const delta = clock.getDelta();
  const time = clock.getElapsedTime();
  
  // ALWAYS UPDATE PHYSICS AND ORBITS (even in map mode!)
  if (!isMapMode) {
    // Determine active keys: physical keyboard OR virtual mobile joysticks
    const activeKeys = mobileController.isMobile ? mobileController.keys : keys;
    const isPointerLocked = document.pointerLockElement === document.body;
    
    if (isPointerLocked || mobileController.isMobile) {
        // Only process steering input if not in map mode
        spaceship.update(delta, activeKeys);
    } else {
        spaceship.update(delta, {});
    }

    // Broadcast telemetry to server (20 times per second)
    if (time - lastNetworkTick > 0.05) {
      socket.emit('player_moved', {
        position: spaceship.mesh.position,
        rotation: { x: spaceship.mesh.quaternion.x, y: spaceship.mesh.quaternion.y, z: spaceship.mesh.quaternion.z, w: spaceship.mesh.quaternion.w },
        flameScale: spaceship.flameScale || 0
      });
      lastNetworkTick = time;
    }
  }
  
  // Update network players
  const activeCamera = isMapMode ? mapCamera : camera;
  for (let id in remotePlayers) {
    remotePlayers[id].update(delta, activeCamera, spaceship.mesh.position);
  }
  
  // Sincronización Universal Mágica
  const universalTime = Date.now() / 1000; 

  // Rotate asteroid belt
  asteroidInstanced.rotation.y = universalTime * 0.005;

  // Process Orbits and Collisions for all planets
  
  for (const p of planets) {
    // 1. Update Orbit
    const oldPos = p.group.position.clone();
    
    // Instead of using delta which desyncs clients, use absolute universal time
    const currentAngle = p.orbitAngleOffset + (p.orbitSpeed * universalTime);
    p.group.position.x = Math.cos(currentAngle) * p.orbitRadius;
    p.group.position.z = Math.sin(currentAngle) * p.orbitRadius;
    
    // Rotación sobre su propio eje (Ciclo Día/Noche sincronizado)
    p.group.rotation.y = universalTime * 0.2; 
    
    const deltaPos = p.group.position.clone().sub(oldPos);
    
    // Update hitbox position to match planet
    const hitbox = planetHitboxes.find(h => h.userData.planet === p);
    if (hitbox) hitbox.position.copy(p.group.position);
    
    // 2. Relative Physics: If anchored, drag the ship along with the planet!
    if (spaceship.mode === 'HOVER' && spaceship.hoverPlanet === p) {
      spaceship.mesh.position.add(deltaPos);
      spaceship.camera.position.add(deltaPos); // Prevent camera lagging behind the moving ship
    }
    
    // 3. Collision Detection
    const distToPlanet = spaceship.mesh.position.distanceTo(p.group.position);
    if (distToPlanet < p.radius + 100) {
      const dirFromPlanet = new THREE.Vector3().subVectors(spaceship.mesh.position, p.group.position).normalize();
      const actualTerrainHeight = TerrainBuilder.getHeight(dirFromPlanet, p.radius);
      
      if (distToPlanet < actualTerrainHeight + 2) {
        spaceship.handleCollision(dirFromPlanet, actualTerrainHeight + 2, p.group.position);
      }
    }
  }

  // Update Space Dust endless wrapping field
  const positions = spaceDust.geometry.attributes.position.array;
  const shipPos = spaceship.mesh.position;
  let dustUpdated = false;
  for (let i = 0; i < 2000; i++) {
    const px = positions[i * 3];
    const py = positions[i * 3 + 1];
    const pz = positions[i * 3 + 2];
    
    // Wrap around logic: if a particle is too far behind the ship, spawn it in front
    if (Math.abs(px - shipPos.x) > 2000) { positions[i * 3] = shipPos.x + Math.sign(shipPos.x - px) * 2000; dustUpdated = true; }
    if (Math.abs(py - shipPos.y) > 2000) { positions[i * 3 + 1] = shipPos.y + Math.sign(shipPos.y - py) * 2000; dustUpdated = true; }
    if (Math.abs(pz - shipPos.z) > 2000) { positions[i * 3 + 2] = shipPos.z + Math.sign(shipPos.z - pz) * 2000; dustUpdated = true; }
  }
  if (dustUpdated) {
    spaceDust.geometry.attributes.position.needsUpdate = true;
  }
  
  // Stretch dust particles into lines based on ship speed and direction
  // This gives the Star Wars hyperspace effect!
  if (!isMapMode && spaceship.mode === 'FLIGHT') {
    // Only show dust when flying fast outside atmospheres
    spaceDust.visible = spaceship.speed > 50; 
  } else {
    spaceDust.visible = false;
  }

  if (!isMapMode) {
    shipMarker.visible = false;
    
    // Update planet quadtree LOD based on camera position
    for (const p of planets) {
      p.update(camera.position);
    }
    renderer.render(scene, camera);
  } else {
    shipMarker.visible = true;
    
    // Update ship marker position to match spaceship
    shipMarker.position.copy(spaceship.mesh.position);
    
    // In map mode, LOD doesn't need high detail updates
    renderer.render(scene, mapCamera);
  }
  
  // HUD Local Surface Minimap Rendering (Only in HOVER mode)
  if (!isMapMode && spaceship.mode === 'HOVER' && spaceship.hoverPlanet) {
    document.getElementById('minimap-border').style.display = 'block';
    
    // Position orthographic camera above ship looking down
    // The surface normal is the vector from planet center to ship
    const surfaceNormal = new THREE.Vector3().subVectors(spaceship.mesh.position, spaceship.hoverPlanet.group.position).normalize();
    localMapCamera.position.copy(spaceship.mesh.position).add(surfaceNormal.clone().multiplyScalar(20000));
    localMapCamera.lookAt(spaceship.mesh.position);
    
    // Align the camera UP vector with the ship's forward vector so the map rotates as you steer
    const shipForward = new THREE.Vector3(0, 0, -1).applyQuaternion(spaceship.mesh.quaternion).normalize();
    localMapCamera.up.copy(shipForward);
    
    const size = 250; // Map size from CSS
    // Setup scissor test to only render in the top right corner
    renderer.setScissorTest(true);
    renderer.setViewport(window.innerWidth - size - 20, window.innerHeight - size - 20, size, size);
    renderer.setScissor(window.innerWidth - size - 20, window.innerHeight - size - 20, size, size);
    
    renderer.render(scene, localMapCamera);
    
    // Restore viewport for the next frame
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  } else {
    document.getElementById('minimap-border').style.display = 'none';
  }
  
  // Update Map Mode Selection Ring
  if (isMapMode && targetPlanet) {
    selectionRing.visible = true;
    selectionRing.position.copy(targetPlanet.group.position);
    const s = targetPlanet.radius * 1.5;
    selectionRing.scale.set(s, s, s);
    selectionRing.rotation.y += delta;
  } else {
    selectionRing.visible = false;
  }
  
  // Update HUD Waypoint
  const navMarker = document.getElementById('nav-marker');
  if (targetPlanet) {
    const navDistance = document.getElementById('nav-distance');
    const dist = spaceship.mesh.position.distanceTo(targetPlanet.group.position);
    navDistance.innerText = Math.round(dist) + 'm';
    
    const targetPos = targetPlanet.group.position.clone();
    const activeCamera = isMapMode ? mapCamera : camera;
    targetPos.project(activeCamera);
    
    if (targetPos.z < 1) {
      navMarker.style.display = 'flex';
      const x = (targetPos.x *  .5 + .5) * window.innerWidth;
      const y = (targetPos.y * -.5 + .5) * window.innerHeight;
      navMarker.style.left = `${x}px`;
      navMarker.style.top = `${y}px`;
    } else {
      navMarker.style.display = 'none';
    }
  } else {
    navMarker.style.display = 'none';
  }
}

animate();
