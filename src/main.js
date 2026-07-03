import './style.css';
import * as THREE from 'three';
import { Spaceship } from './Spaceship.js';
import { Planet } from './planet/Planet.js';
import { TerrainBuilder } from './planet/TerrainBuilder.js';

// Setup basic scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050510);
scene.fog = new THREE.FogExp2(0x050510, 0.0001);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500000);
const mapCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 5000000);
mapCamera.position.set(0, 600000, 0); // Much higher to see the massive orbits
// When looking straight down (-Y), we must change the UP vector to avoid mathematical singularity
mapCamera.up.set(0, 0, -1);
mapCamera.lookAt(0, 0, 0);

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

// The Sun (Massive PointLight)
const sunLight = new THREE.PointLight(0xffffee, 3.0, 0, 0);
sunLight.position.set(0, 0, 0);
scene.add(sunLight);

// Sun visual mesh
const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(30000, 32, 32),
  new THREE.MeshBasicMaterial({ color: 0xffffff }) // Basic material glows without needing light
);
scene.add(sunMesh);

// Add stars (Massive spread to cover the new solar system)
function createStars() {
  const geometry = new THREE.BufferGeometry();
  const vertices = [];
  for (let i = 0; i < 15000; i++) {
    // Spread across 3,000,000 units!
    const x = THREE.MathUtils.randFloatSpread(3000000);
    const y = THREE.MathUtils.randFloatSpread(3000000);
    const z = THREE.MathUtils.randFloatSpread(3000000);
    vertices.push(x, y, z);
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  // Make stars large enough to be seen from the map camera
  const material = new THREE.PointsMaterial({ color: 0xffffff, size: 2500, sizeAttenuation: true });
  const stars = new THREE.Points(geometry, material);
  scene.add(stars);
}
createStars();

// Initialize Spaceship
const spaceship = new Spaceship(scene, camera);
// Spawn the spaceship near the Green Planet so it's not trapped inside the Sun
spaceship.mesh.position.set(140000, 0, 0);

// Initialize Procedural Planets (Massive Scale)
const planets = [];

// Planet 1: Forest/Green
const p1 = new Planet(scene, 10000, new THREE.Vector3(150000, 0, 0), 0x339944);
p1.orbitRadius = 150000; p1.orbitAngle = Math.random() * Math.PI * 2; p1.orbitSpeed = 0.05;
planets.push(p1);

// Planet 2: Desert/Orange
const p2 = new Planet(scene, 8000, new THREE.Vector3(250000, 0, 0), 0xd2a65a);
p2.orbitRadius = 250000; p2.orbitAngle = Math.random() * Math.PI * 2; p2.orbitSpeed = 0.03;
planets.push(p2);

// Planet 3: Ice/Blue
const p3 = new Planet(scene, 12000, new THREE.Vector3(380000, 0, 0), 0x99ccff);
p3.orbitRadius = 380000; p3.orbitAngle = Math.random() * Math.PI * 2; p3.orbitSpeed = 0.015;
planets.push(p3);

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
  keys[e.code] = true; 
  if (e.code === 'KeyM') {
    isMapMode = !isMapMode;
    if (isMapMode) {
      document.exitPointerLock();
      scene.fog = null; // Disable fog so we can see from 150,000 units away!
      document.body.style.cursor = 'crosshair'; // Change cursor for map
    } else {
      document.body.requestPointerLock();
      scene.fog = new THREE.FogExp2(0x050510, 0.0001); // Restore fog
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

function animate() {
  requestAnimationFrame(animate);
  
  const delta = clock.getDelta();
  
  // ALWAYS UPDATE PHYSICS AND ORBITS (even in map mode!)
  if (!isMapMode) {
    // Only process steering input if not in map mode
    spaceship.update(delta, keys);
  }
  
  // Process Orbits and Collisions for all planets
  for (const p of planets) {
    // 1. Update Orbit
    const oldPos = p.group.position.clone();
    
    p.orbitAngle += p.orbitSpeed * delta;
    p.group.position.x = Math.cos(p.orbitAngle) * p.orbitRadius;
    p.group.position.z = Math.sin(p.orbitAngle) * p.orbitRadius;
    
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
