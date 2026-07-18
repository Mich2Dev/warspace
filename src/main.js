import './style.css';
import * as THREE from 'three';
import { Spaceship } from './Spaceship.js';
import { Planet } from './planet/Planet.js';
import { TerrainBuilder } from './planet/TerrainBuilder.js';
import { io } from 'socket.io-client';
import { RemotePlayer } from './RemotePlayer.js';
import { MobileController } from './MobileController.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GalaxyBuilder } from './GalaxyBuilder.js';

// Setup Keybindings Configuration
const defaultKeys = {
  forward: 'KeyW',
  backward: 'KeyS',
  rollLeft: 'KeyA',
  rollRight: 'KeyD',
  hyperdrive: 'ShiftLeft', // Change default to Shift
  boost: 'Space', // Change default to Space
  fire: 'Digit1', // Primary keyboard fire key
  map: 'KeyM',
  surface: 'KeyN'
};

window.GameConfig = JSON.parse(localStorage.getItem('jg_keyconfig')) || { keys: defaultKeys };
// Merge with defaults in case of missing keys
window.GameConfig.keys = { ...defaultKeys, ...window.GameConfig.keys };

// Setup basic scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050510);
// No fog in deep space! (Otherwise you can't see the sun or planets)
scene.fog = null;

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500000000); // 500 million bounds
const mapCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000000000); // 2 billion for galaxy map
mapCamera.position.set(0, 250000000, 0); // 45 million height to see massive orbits
// When looking straight down (-Y), we must change the UP vector to avoid mathematical singularity
mapCamera.up.set(0, 0, -1);
mapCamera.lookAt(0, 0, 0);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Post-Processing (Bloom for Stars, Engine, Lasers)
const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
bloomPass.threshold = 0.5; // Solo objetos muy brillantes (sol, lasers, núcleo)
bloomPass.strength = 1.2; // Intensidad del glow moderada
bloomPass.radius = 0.5; // Radio del glow

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// OrbitControls para el mapa
const mapControls = new OrbitControls(mapCamera, renderer.domElement);
mapControls.enabled = false;
mapControls.enableDamping = true;
mapControls.maxDistance = 60000000; // Limite más allá de Neptuno
mapControls.minDistance = 1000000;
mapControls.target.set(0, 0, 0);

// Grupo que contiene todo lo que solo debe verse en el mapa (órbitas, sol)
const mapVisuals = new THREE.Group();
mapVisuals.visible = false;
scene.add(mapVisuals);

// ===========================================================================
// GALAXY — Construir Vía Láctea con datos astronómicos reales
// La galaxia vive en el mismo espacio pero a escala diferente.
// Se escala para que el sistema solar (~300M unidades) quepa en el bulbo central.
// ===========================================================================
const galaxyBuilder = new GalaxyBuilder(scene);
const galaxyGroup = galaxyBuilder.build();
// El mapa galáctico cambia al modo "vista galáctica" donde la galaxia
// se posiciona para ver desde arriba. Escalarla para que llene la vista.
// Radio galáctico en Three.js units: ~50000 años luz * 0.15 = 7500 unidades de galaxia
// El sistema solar usa hasta ~150M unidades, así que escalamos la galaxia a ese tamaño.
const GALAXY_MAP_SCALE = 20000; // Factor para que la galaxia llene el mapa galáctico
galaxyGroup.scale.setScalar(GALAXY_MAP_SCALE);
galaxyGroup.visible = false; // Solo visible en modo mapa galáctico

// Local Surface Minimap (Top-Down Orthographic Radar)
// Covers a 10km x 10km area of the surface
const localMapCamera = new THREE.OrthographicCamera(-5000, 5000, 5000, -5000, 0.1, 50000);

let isMapMode = false;
// Ensure legacy lighting so PointLight doesn't decay to zero over 300,000 units
renderer.useLegacyLights = true;
if (renderer.useLegacyLights === undefined) {
  renderer.physicallyCorrectLights = false;
}
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.getElementById('app').appendChild(renderer.domElement);

// Lighting (Realistic space lighting from the Sun)
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4); // Brighter space ambient
scene.add(ambientLight);

const starlight = new THREE.HemisphereLight(0xffffff, 0x000033, 0.5); // Top is white starlight, bottom is dark void
scene.add(starlight);

// Visual Sun at Center
const sunGeo = new THREE.SphereGeometry(10000000, 64, 64);
const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff5e6 }); // Warm white, not pure white to prevent extreme bloom
const sunMesh = new THREE.Mesh(sunGeo, sunMat);
scene.add(sunMesh); // Add to SCENE so it's always visible, not just in the map!
const sunGlowMat = new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false });
const sunGlow = new THREE.Mesh(new THREE.SphereGeometry(11000000, 32, 32), sunGlowMat);
scene.add(sunGlow);

// Real Sun Light emitting from the center
const sunLight = new THREE.PointLight(0xffffff, 2.0, 0); // distance 0 = infinite range
scene.add(sunLight);

// ==========================================
// MULTIPLAYER NETWORK SETUP
// ==========================================
const socket = io();
const remotePlayers = {};
let isLoggedIn = false;

// ==========================================
// LOGIN LOGIC
// ==========================================
document.getElementById('btn-login').addEventListener('click', () => {
  const user = document.getElementById('login-username').value.trim();
  const pass = document.getElementById('login-password').value.trim();
  const errorEl = document.getElementById('login-error');
  
  if (user.length < 3 || pass.length < 3) {
    errorEl.style.display = 'block';
    errorEl.innerText = "Usuario y contraseña deben tener al menos 3 caracteres.";
    return;
  }
  
  errorEl.style.display = 'block';
  errorEl.innerText = "Conectando al servidor...";
  socket.emit('login', { username: user, password: pass });
});

socket.on('login_success', (playerData) => {
  isLoggedIn = true;
  document.getElementById('login-screen').style.display = 'none';
  document.querySelector('.ui').style.display = 'block';
  
  // Handle Player Position Initialization
  let distToSun = 0;
  if (playerData.position) {
    distToSun = Math.sqrt(playerData.position.x**2 + playerData.position.y**2 + playerData.position.z**2);
  }

  if (playerData.position && distToSun > 11500000) {
    spaceship.mesh.position.set(playerData.position.x, playerData.position.y, playerData.position.z);
    spaceship.mesh.lookAt(0, 0, 0); // Always face the sun initially
  } else {
    // NUEVO JUGADOR: Hacer spawn en la órbita de la Tierra
    spawnAtEarth();
  }
  
  // Provide a global function to respawn the player without reloading the page
  window.respawnPlayer = () => {
    document.getElementById('death-screen').style.display = 'none';
    spaceship.hp = 100;
    spaceship.isDead = false;
    spaceship.speed = 0;
    spaceship.autopilotEngaged = false;
    spaceship.autoTarget = null;
    
    spawnAtEarth();
    
    // Attempt to relock the pointer
    document.body.requestPointerLock();
  };
  
  function spawnAtEarth() {
    const earth = planets.find(p => p.name === "Tierra");
    if (earth) {
      const universalTime = Date.now() / 1000;
      const currentAngle = earth.orbitAngleOffset + (earth.orbitSpeed * universalTime);
      const incRad = earth.inclination ? (earth.inclination * Math.PI / 180) : 0;
      const ex = Math.cos(currentAngle) * earth.orbitRadius;
      const ey = -Math.sin(currentAngle) * earth.orbitRadius * Math.sin(incRad);
      const ez = Math.sin(currentAngle) * earth.orbitRadius * Math.cos(incRad);
      
      // Aparecer a un lado de la Tierra, no directamente arriba (para evitar el bug de rotación NaN)
      spaceship.mesh.position.set(ex + earth.radius * 2.5, ey, ez + earth.radius * 2.5);
      
      // Voltear a ver a la Tierra majestuosamente
      spaceship.mesh.lookAt(ex, ey, ez);
    }
  }
  
  // Restore HP if exists
  if (playerData.hp !== undefined) {
    spaceship.hp = playerData.hp;
  }
  
  // Enable flight controls
  document.body.requestPointerLock();
});

socket.on('login_error', (msg) => {
  const errorEl = document.getElementById('login-error');
  errorEl.style.display = 'block';
  errorEl.innerText = msg;
});



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
    updateNavComputer();
  }
});

socket.on('player_shoot', (data) => {
  if (data.id !== socket.id) {
    createLaser(data.position, data.velocity, 0xffaa00); // Orange enemy laser
  }
});

socket.on('player_health_changed', (data) => {
  if (data.id === socket.id) {
    spaceship.takeDamage(data.hp);
  } else if (remotePlayers[data.id]) {
    remotePlayers[data.id].takeDamage(data.hp);
  }
});

socket.on('player_died', (id) => {
  if (id === socket.id) {
    spaceship.die();
  } else if (remotePlayers[id]) {
    remotePlayers[id].die();
  }
});

socket.on('player_respawned', (data) => {
  if (data.id === socket.id) {
    spaceship.respawn();
  } else if (remotePlayers[data.id]) {
    remotePlayers[data.id].updateNetworkState(data);
    remotePlayers[data.id].respawn(new THREE.Vector3(data.position.x, data.position.y, data.position.z));
  }
});

function addRemotePlayer(id, data) {
  const rp = new RemotePlayer(scene);
  rp.updateNetworkState(data);
  remotePlayers[id] = rp;
  updateNavComputer();
}
// ==========================================

// Add stars (Massive spread to cover the gigantic solar system)
function createStars() {
  const geometry = new THREE.BufferGeometry();
  const vertices = [];
  for (let i = 0; i < 150000; i++) {
    // Spread across 1,000,000,000 units to cover the massive 5x scaled solar system!
    const x = THREE.MathUtils.randFloatSpread(1000000000);
    const y = THREE.MathUtils.randFloatSpread(1000000000);
    const z = THREE.MathUtils.randFloatSpread(1000000000);
    vertices.push(x, y, z);
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  // Size 1 instead of 2 to prevent huge squares on high DPI screens
  // Color más oscuro para que el Bloom no las convierta en una plasta blanca
  const material = new THREE.PointsMaterial({ color: 0x444444, size: 1, sizeAttenuation: false });
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
  const dustMaterial = new THREE.PointsMaterial({ color: 0xaaddff, size: 6, sizeAttenuation: true, transparent: true, opacity: 0.4 });
  const spaceDust = new THREE.Points(dustGeometry, dustMaterial);
  scene.add(spaceDust);
// ==========================================
// THE BLACK HOLE (Gargantua) - Physical 3D Object
// ==========================================
const blackHoleGroup = new THREE.Group();
blackHoleGroup.position.set(250000000, 0, -100000000); 
const bhRadius = 8000000;

// 1. Event Horizon (Solid Black Sphere)
const solidSphereGeo = new THREE.SphereGeometry(bhRadius, 64, 64);
const solidSphereMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
const bhSphere = new THREE.Mesh(solidSphereGeo, solidSphereMat);
blackHoleGroup.add(bhSphere);

// 2. Inner Accretion Disk (Hot, fast, bright)
const innerDiskGeo = new THREE.TorusGeometry(bhRadius * 1.8, bhRadius * 0.4, 16, 128);
const innerDiskMat = new THREE.MeshBasicMaterial({ 
  color: 0xffaa00, 
  transparent: true, 
  opacity: 0.9, 
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  depthWrite: false
});
window.accretionDiskInner = new THREE.Mesh(innerDiskGeo, innerDiskMat);
window.accretionDiskInner.rotation.x = Math.PI / 2; // Flat horizontal
blackHoleGroup.add(window.accretionDiskInner);

// 3. Outer Accretion Disk (Cooler, slower, dimmer)
const outerDiskGeo = new THREE.TorusGeometry(bhRadius * 2.8, bhRadius * 0.7, 16, 128);
const outerDiskMat = new THREE.MeshBasicMaterial({ 
  color: 0xff4400, 
  transparent: true, 
  opacity: 0.4, 
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  depthWrite: false
});
window.accretionDiskOuter = new THREE.Mesh(outerDiskGeo, outerDiskMat);
window.accretionDiskOuter.rotation.x = Math.PI / 2;
blackHoleGroup.add(window.accretionDiskOuter);

scene.add(blackHoleGroup);

// Black Hole Map Marker
const mapBHGeo = new THREE.CircleGeometry(bhRadius * 4, 32);
const mapBHMat = new THREE.MeshBasicMaterial({ color: 0xff4400, side: THREE.DoubleSide });
const mapBH = new THREE.Mesh(mapBHGeo, mapBHMat);
mapBH.rotation.x = -Math.PI / 2;
mapBH.position.copy(blackHoleGroup.position);
mapVisuals.add(mapBH);

// ==========================================
// Spaceship Initialization
// ==========================================

// Initialize Spaceship
const spaceship = new Spaceship(scene, camera);

// Iniciar Controles Móviles (Si está en celular)
const mobileController = new MobileController(spaceship);
// Spawn the spaceship near Earth's orbit (safe distance from the Sun)
spaceship.mesh.position.set(30000000, 100000, 0);
spaceship.mesh.lookAt(0, 0, 0);

// Initialize Procedural Solar System (Hybrid Scale)
const planets = [];

const solarSystemData = [
  { name: "Mercurio", radius: 7600 * 25, distance: 15000000, color: 0x888888, speed: 0.0008, inclination: 7.00, desc: "Planeta rocoso. Es el más pequeño y cercano al Sol. Carece de atmósfera significativa y tiene temperaturas extremas." },
  { name: "Venus", radius: 19000 * 25, distance: 22500000, color: 0xe3bb76, speed: 0.0006, inclination: 3.39, desc: "Planeta rocoso. Similar a la Tierra en tamaño, pero con una atmósfera extremadamente densa, tóxica y caliente." },
  { name: "Tierra", radius: 20000 * 25, distance: 30000000, color: 0x2b82c9, speed: 0.0005, inclination: 0.00, desc: "Planeta rocoso. Nuestro hogar. El único planeta conocido con vida, agua en estado líquido y una atmósfera rica en oxígeno." },
  { name: "Marte", radius: 10600 * 25, distance: 40000000, color: 0xc1440e, speed: 0.0004, inclination: 1.85, desc: "Planeta rocoso. El 'Planeta Rojo'. Tiene un clima desértico y frío, con evidencia de haber tenido agua en el pasado." },
  { name: "Júpiter", radius: 223000 * 25, distance: 60000000, color: 0xd39c7e, speed: 0.0002, inclination: 1.30, desc: "Gigante gaseoso. El más masivo de todos. Compuesto de hidrógeno y helio, con tormentas inmensas como la Gran Mancha Roja." },
  { name: "Saturno", radius: 188000 * 25, distance: 85000000, color: 0xead6b8, speed: 0.00015, inclination: 2.49, desc: "Gigante gaseoso. Reconocido instantáneamente por su espectacular y complejo sistema de anillos." },
  { name: "Urano", radius: 80000 * 25, distance: 115000000, color: 0x4b70dd, speed: 0.0001, inclination: 0.77, desc: "Gigante helado. Rota prácticamente 'de lado' sobre su eje y tiene una atmósfera muy fría." },
  { name: "Neptuno", radius: 77000 * 25, distance: 150000000, color: 0x274687, speed: 0.00008, inclination: 1.77, desc: "Gigante helado. El planeta más lejano, oscuro, frío y azotado por vientos supersónicos." }
];

solarSystemData.forEach((data, index) => {
  // Angle offset so they don't form a straight line. Earth is index 2. We subtract 2 so Earth starts at angle 0.
  const angle = (index - 2) * 2.5; 
  
  // Base position on XZ plane
  const basePos = new THREE.Vector3(Math.cos(angle) * data.distance, 0, Math.sin(angle) * data.distance);
  // Apply orbital inclination (rotate around X axis)
  basePos.applyAxisAngle(new THREE.Vector3(1, 0, 0), data.inclination * Math.PI / 180);
  
  const p = new Planet(scene, data.radius, basePos, data.color);
  p.name = data.name;
  p.orbitRadius = data.distance;
  p.orbitAngleOffset = angle;
  p.orbitSpeed = data.speed;
  p.inclination = data.inclination;
  p.desc = data.desc;
  
  // Orbit Line for the Map
  const orbitGeo = new THREE.BufferGeometry();
  const orbitPoints = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const pt = new THREE.Vector3(Math.cos(a) * data.distance, 0, Math.sin(a) * data.distance);
    pt.applyAxisAngle(new THREE.Vector3(1, 0, 0), data.inclination * Math.PI / 180);
    orbitPoints.push(pt);
  }
  orbitGeo.setFromPoints(orbitPoints);
  const orbitMat = new THREE.LineBasicMaterial({ color: 0x334455, transparent: true, opacity: 0.5 });
  const orbitLine = new THREE.Line(orbitGeo, orbitMat);
  mapVisuals.add(orbitLine);
  
  planets.push(p);
});

// PRNG Determinista para sincronización de Asteroides
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
let isListeningForKey = null;

window.addEventListener('keydown', (e) => {
  if (document.activeElement === document.getElementById('chat-input')) return;
  if (isListeningForKey) {
    // Save new keybind
    window.GameConfig.keys[isListeningForKey] = e.code;
    localStorage.setItem('jg_keyconfig', JSON.stringify(window.GameConfig));
    renderSettingsMenu();
    isListeningForKey = null;
    return;
  }

  keys[e.code] = true; 
  if (e.code === window.GameConfig.keys.map) {
    isMapMode = !isMapMode;
    if (isMapMode) {
      document.exitPointerLock();
      document.body.style.cursor = 'crosshair';
      document.getElementById('minimap-border').style.display = 'none';
      mapControls.enabled = true;
      mapVisuals.visible = true;
      galaxyGroup.visible = false; // Solar system map by default
      document.getElementById('nav-computer').style.display = 'flex';
      document.getElementById('map-mode-label').style.display = 'block';
      document.getElementById('map-mode-label').innerText = 'MAPA: SISTEMA SOLAR | [G] = VISTA GALÁCTICA';
    } else {
      // Si estábamos en el mapa de la galaxia, restauramos los objetos locales antes de salir
      if (galaxyGroup.visible) {
        scene.children.forEach(child => {
          if (child !== galaxyGroup && child.userData.wasVisible !== undefined) {
            child.visible = child.userData.wasVisible;
          }
        });
      }
      
      document.body.requestPointerLock();
      document.body.style.cursor = 'default';
      selectionRing.visible = false;
      mapControls.enabled = false;
      mapVisuals.visible = false;
      galaxyGroup.visible = false;
      document.getElementById('nav-computer').style.display = 'none';
      document.getElementById('map-mode-label').style.display = 'none';
      
      // Restaurar la cámara del mapa a su posición de sistema solar por defecto para la próxima vez
      mapCamera.position.set(0, 250000000, 0);
      mapCamera.up.set(0, 0, -1);
      mapCamera.lookAt(0, 0, 0);
      mapControls.maxDistance = 150000000;
      mapControls.minDistance = 10000;
    }
  }
  
  // Toggle Galaxy View (only while in map mode)
  if (e.code === 'KeyG' && isMapMode) {
    const isGalaxyView = galaxyGroup.visible;
    if (!isGalaxyView) {
      // Switch to Galaxy View
      galaxyGroup.visible = true;
      
      // Hide all local solar system objects (planets, ship, sun, etc.)
      scene.children.forEach(child => {
        if (child !== galaxyGroup) {
          child.userData.wasVisible = child.visible;
          child.visible = false;
        }
      });
      
      // Position galaxy map camera high above to see the whole galaxy disk
      mapCamera.position.set(0, 250000000, 50000000);
      mapCamera.up.set(0, 0, -1);
      mapCamera.lookAt(0, 0, 0);
      mapControls.maxDistance = 600000000;
      mapControls.minDistance = 5000000;
      document.getElementById('map-mode-label').innerText = '✨ MAPA: VÍA LÁCTEA — 30 estrellas reales • 4 Brazos Espirales • Sagitario A* | [G] = SISTEMA SOLAR';
    } else {
      // Back to Solar System View
      galaxyGroup.visible = false;
      
      // Restore all local solar system objects
      scene.children.forEach(child => {
        if (child !== galaxyGroup && child.userData.wasVisible !== undefined) {
          child.visible = child.userData.wasVisible;
        }
      });
      
      mapCamera.position.set(0, 250000000, 0);
      mapCamera.up.set(0, 0, -1);
      mapCamera.lookAt(0, 0, 0);
      mapControls.maxDistance = 60000000;
      mapControls.minDistance = 1000000;
      document.getElementById('map-mode-label').innerText = 'MAPA: SISTEMA SOLAR | [G] = VISTA GALÁCTICA';
    }
  }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

// Pointer Lock, Map Click, and Combat Firing
const lasers = [];

function createLaser(position, velocity, colorHex) {
  const laserGroup = new THREE.Group();
  const length = 40000;

  // 1. White hot inner core
  const coreGeo = new THREE.CylinderGeometry(80, 80, length, 8);
  coreGeo.rotateX(Math.PI / 2);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  laserGroup.add(coreMesh);

  // 2. Glowing outer aura
  const glowGeo = new THREE.CylinderGeometry(250, 250, length, 8);
  glowGeo.rotateX(Math.PI / 2);
  const glowMat = new THREE.MeshBasicMaterial({ 
    color: colorHex, 
    transparent: true, 
    opacity: 0.7, 
    blending: THREE.AdditiveBlending 
  });
  const glowMesh = new THREE.Mesh(glowGeo, glowMat);
  laserGroup.add(glowMesh);

  laserGroup.position.copy(position);
  // Align laser to velocity vector
  const lookAtTarget = position.clone().add(velocity);
  laserGroup.lookAt(lookAtTarget);

  scene.add(laserGroup);

  lasers.push({
    mesh: laserGroup,
    velocity: new THREE.Vector3().copy(velocity),
    life: 3.0, // 3 seconds max life
    color: colorHex
  });
}

let lastFireTime = 0;
let lockedTarget = null;
const lockOnUI = document.getElementById('lock-on-ui');

document.addEventListener('contextmenu', (e) => {
  e.preventDefault(); // Prevent right click menu
  if (!document.pointerLockElement) return;
  
  // Find closest enemy to center of screen to lock on
  let bestTarget = null;
  let bestDot = 0.90; // Needs to be somewhat in front
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(spaceship.mesh.quaternion);
  
  for (const id in remotePlayers) {
    const rp = remotePlayers[id];
    if (rp.isDead) continue;
    const dirToEnemy = new THREE.Vector3().subVectors(rp.mesh.position, spaceship.mesh.position).normalize();
    const dot = forward.dot(dirToEnemy);
    if (dot > bestDot) {
      bestDot = dot;
      bestTarget = rp;
    }
  }
  
  if (bestTarget) {
    lockedTarget = bestTarget;
    lockOnUI.style.display = 'block';
  } else {
    lockedTarget = null;
    lockOnUI.style.display = 'none';
  }
});

function fireLaser() {
  if (spaceship.isDead || spaceship.mode !== 'FLIGHT') return;
  const now = Date.now();
  if (now - lastFireTime < 150) return; // Fire rate limit (150ms)
  lastFireTime = now;

  // Aim exactly where the crosshair (camera center) is pointing
  const cameraTarget = new THREE.Vector3(0, 0, -50000).applyMatrix4(camera.matrixWorld);
  let forward = new THREE.Vector3().subVectors(cameraTarget, spaceship.mesh.position).normalize();

  if (lockedTarget && !lockedTarget.isDead) {
    // Apuntar fijo al enemigo bloqueado
    forward = new THREE.Vector3().subVectors(lockedTarget.mesh.position, spaceship.mesh.position).normalize();
  } else {
    // Auto-aim at nearby enemies (optional)
    if (Object.keys(remotePlayers).length > 0) {
      let bestTarget = null;
      let bestDot = 0.96; // Tighter auto-aim cone
      for (const id in remotePlayers) {
        const rp = remotePlayers[id];
        if (rp.isDead) continue;
        const dirToEnemy = new THREE.Vector3().subVectors(rp.mesh.position, spaceship.mesh.position).normalize();
        const dot = forward.dot(dirToEnemy);
        if (dot > bestDot) {
          bestDot = dot;
          bestTarget = rp;
        }
      }
      if (bestTarget) {
        forward = new THREE.Vector3().subVectors(bestTarget.mesh.position, spaceship.mesh.position).normalize();
      }
    }
  }

  // Laser starting position (spawn half its length ahead so its tail is exactly at the ship's nose)
  const startPos = spaceship.mesh.position.clone().add(forward.clone().multiplyScalar(20000));
  
  // Laser velocity (Base speed slowed down slightly to prevent instant-disappearance, but still faster than ship)
  const baseLaserSpeed = 800000;
  const laserSpeed = Math.max(0, spaceship.speed) + baseLaserSpeed;
  const laserVelocity = forward.clone().multiplyScalar(laserSpeed);
  
  createLaser(startPos, laserVelocity, 0x00ff88); // Green friendly laser
  
  // Send to server
  socket.emit('player_shoot', { position: startPos, velocity: laserVelocity });
}

document.addEventListener('mousedown', (e) => {
  // Never trap the mouse if they clicked on the login screen or UI
  if (e.target.closest('#login-overlay') || e.target.closest('#nav-computer') || e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') {
    return;
  }

  if (!isMapMode) {
    if (document.pointerLockElement === document.body) {
      if (e.button === 0) fireLaser(); // Fire weapon if already locked (Left click only)
    } else {
      document.body.requestPointerLock();
    }
  } else {
    // Raycast on map
    const pointer = new THREE.Vector2();
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, mapCamera);

    const intersects = raycaster.intersectObjects(planetHitboxes);
    if (intersects.length > 0) {
      targetPlanet = intersects[0].object.userData.planet;
      if (window.selectPlanetInNav) {
        window.selectPlanetInNav(targetPlanet);
      }
    } else {
      targetPlanet = null; // click empty space to clear
    }
  }
});

// Mobile fire button
const mobileFireBtn = document.getElementById('btn-fire');
if (mobileFireBtn) {
  mobileFireBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    fireLaser();
  });
}

document.addEventListener('keydown', (e) => {
  if (e.code === window.GameConfig.keys.fire && !isMapMode && document.pointerLockElement === document.body) {
    fireLaser();
  }
});

// ==========================================
// SETTINGS MENU LOGIC
// ==========================================
const btnSettings = document.getElementById('btn-settings');
const settingsModal = document.getElementById('settings-modal');
const btnSettingsClose = document.getElementById('btn-settings-close');
const btnSettingsReset = document.getElementById('btn-settings-reset');
const keybindsList = document.getElementById('keybinds-list');

const actionLabels = {
  forward: 'Acelerar',
  backward: 'Frenar',
  rollLeft: 'Rotar Izquierda',
  rollRight: 'Rotar Derecha',
  hyperdrive: 'Hiperimpulsor',
  boost: 'Turbo',
  fire: 'Disparar Láser',
  map: 'Mapa Galáctico',
  surface: 'Anclaje de Superficie'
};

function renderSettingsMenu() {
  keybindsList.innerHTML = '';
  for (const action in window.GameConfig.keys) {
    const row = document.createElement('div');
    row.className = 'keybind-row';
    
    const label = document.createElement('div');
    label.className = 'keybind-label';
    label.innerText = actionLabels[action] || action;
    
    const btn = document.createElement('button');
    btn.className = 'keybind-btn';
    btn.innerText = isListeningForKey === action ? 'PRESIONA TECLA...' : window.GameConfig.keys[action];
    
    if (isListeningForKey === action) {
      btn.classList.add('listening');
    }
    
    btn.onclick = () => {
      isListeningForKey = action;
      renderSettingsMenu();
    };
    
    row.appendChild(label);
    row.appendChild(btn);
    keybindsList.appendChild(row);
  }
}

btnSettings.onclick = () => {
  document.exitPointerLock();
  settingsModal.style.display = 'flex';
  renderSettingsMenu();
};

btnSettingsClose.onclick = () => {
  isListeningForKey = null;
  settingsModal.style.display = 'none';
  document.body.requestPointerLock();
};

btnSettingsReset.onclick = () => {
  isListeningForKey = null;
  localStorage.removeItem('jg_keyconfig');
  window.location.reload();
};
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
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ==========================================
// CHAT LOGIC
// ==========================================
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');

document.addEventListener('keydown', (e) => {
  if (e.code === 'Enter') {
    if (document.activeElement === chatInput) {
      if (chatInput.value.trim() === '') {
        chatInput.blur();
        if (!isMapMode && isLoggedIn) document.body.requestPointerLock();
      }
    } else if (isLoggedIn && !isMapMode && document.pointerLockElement === document.body) {
      document.exitPointerLock();
      chatInput.focus();
    }
  }
});

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const msg = chatInput.value.trim();
  if (msg.length > 0 && isLoggedIn) {
    socket.emit('chat_message', msg);
  }
  chatInput.value = '';
  chatInput.blur();
  
  if (!isMapMode) {
    document.body.requestPointerLock();
  }
});

socket.on('chat_message', (data) => {
  const li = document.createElement('li');
  const clanStr = data.clanId ? `<span class="chat-clan">[${data.clanId}]</span>` : '';
  li.innerHTML = `${clanStr}<span class="chat-author">${data.username}:</span> ${data.message}`;
  chatMessages.appendChild(li);
  
  chatMessages.scrollTop = chatMessages.scrollHeight;
  if (chatMessages.children.length > 50) {
    chatMessages.removeChild(chatMessages.firstChild);
  }
});

// Game loop
const clock = new THREE.Clock();
let lastNetworkTick = 0;

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  const time = clock.getElapsedTime();

  // Animate galaxy (always runs, invisible when not in map mode)
  galaxyBuilder.update(delta);
  // ALWAYS UPDATE PHYSICS AND ORBITS (even in map mode!)
  if (!isMapMode) {
    // Determine active keys
    const activeKeys = mobileController.isMobile ? mobileController.keys : keys;
    const isPointerLocked = document.pointerLockElement === document.body;

    // === Gravity Physics (MUST BE APPLIED BEFORE CAMERA UPDATES) ===
    if (spaceship.mode === 'FLIGHT') {
      let isInsideAnyGravityWell = false;
      
      // Planetary Gravity
      for (const p of planets) {
        const distToPlanet = spaceship.mesh.position.distanceTo(p.group.position);
        const gravityRadius = p.radius * 2.0; 
        
        if (distToPlanet < gravityRadius) {
          isInsideAnyGravityWell = true;
          
          // If we are close to the planet and moving very slowly, we probably want to land.
          // Let's reset canAutoAnchor so the hover mode catches us.
          if (distToPlanet < p.radius * 1.6 && spaceship.speed < 400 && !spaceship.canAutoAnchor) {
            spaceship.canAutoAnchor = true;
          }
          
          if (distToPlanet < p.radius * 1.5 && spaceship.canAutoAnchor) {
            spaceship.mode = 'HOVER';
            spaceship.hoverPlanet = p;
            break;
          }

          const pullDir = new THREE.Vector3().subVectors(p.group.position, spaceship.mesh.position).normalize();
          const gravityStrength = 800 * delta;
          spaceship.mesh.position.add(pullDir.multiplyScalar(gravityStrength));
        }
      }
      
      spaceship.inGravityWell = isInsideAnyGravityWell;
      
      if (!isInsideAnyGravityWell) {
        spaceship.canAutoAnchor = true;
      }

      // Black Hole Gravity
      const distToBH = spaceship.mesh.position.distanceTo(blackHoleGroup.position);
      if (distToBH < bhRadius * 20) { 
        const pullDir = new THREE.Vector3().subVectors(blackHoleGroup.position, spaceship.mesh.position).normalize();
        
        // Clamp the pull force so it doesn't snap instantly, creating a smooth but terrifying acceleration
        let pullForce = (Math.pow(bhRadius * 3 / Math.max(1000, distToBH), 2)) * 80000;
        pullForce = Math.min(pullForce, 8000000); 
        const bhGravityStrength = pullForce * delta; 
        
        spaceship.mesh.position.add(pullDir.multiplyScalar(bhGravityStrength));
        
        // Violent spin as you approach the event horizon!
        if (distToBH < bhRadius * 3) {
           spaceship.mesh.rotateZ(delta * (bhRadius * 3 / distToBH) * 2);
           spaceship.mesh.rotateX(delta * Math.random());
        }

        // Spaghettification Death
        if (distToBH < bhRadius * 1.02 && !spaceship.isDead) {
          spaceship.hp = 0;
          spaceship.isDead = true;
          
          const deathScreen = document.getElementById('death-screen');
          if (deathScreen) {
            document.exitPointerLock();
            deathScreen.style.display = 'block';
            deathScreen.style.pointerEvents = 'auto';
            deathScreen.innerHTML = '<span style="color:#ff00ff; text-shadow: 0 0 20px #ff00ff;">SPAGHETTIFIED</span><br><span style="font-size:16px;">Cruzaste el Horizonte de Sucesos. Fuiste aplastado hasta volverte energía pura.</span><br><br><button onclick="window.respawnPlayer()" style="padding:10px 20px; background:#ff00ff; color:#fff; border:none; cursor:pointer; pointer-events:auto;">REAPARECER</button>';
          }
        }
      }
    }

    // === Update Ship & Camera (After gravity moves the ship) ===
    if (isPointerLocked || mobileController.isMobile) {
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
  
    if (isMapMode && mapControls.enabled) {
      mapControls.update(); // Dampening for 3D map controls
    }

  // Sincronización Universal Mágica
  const universalTime = Date.now() / 1000;

  // Spin the accretion disks
  if (window.accretionDiskInner) window.accretionDiskInner.rotation.z -= 1.0 * delta;
  if (window.accretionDiskOuter) window.accretionDiskOuter.rotation.z -= 0.3 * delta;

  // Asteroid belt removed

  // ==========================================
  // Projectile Physics & Collision
  // ==========================================
  for (let i = lasers.length - 1; i >= 0; i--) {
    const laser = lasers[i];
    laser.life -= delta;
    if (laser.life <= 0) {
      scene.remove(laser.mesh);
      lasers.splice(i, 1);
      continue;
    }

    laser.mesh.position.addScaledVector(laser.velocity, delta);

    // Check collisions if it's our laser (green)
    if (laser.color === 0x00ff88) {
      for (const id in remotePlayers) {
        const rp = remotePlayers[id];
        // Lasers travel fast, use a forgiving radius (200 units)
        if (!rp.isDead && laser.mesh.position.distanceTo(rp.mesh.position) < 250) {
          // HIT!
          socket.emit('player_hit', id);

          // Remove laser
          scene.remove(laser.mesh);
          lasers.splice(i, 1);
          break;
        }
      }
    }
  }

  // ==========================================
  // Planet Orbits & Physics
  // ==========================================

  for (const p of planets) {
    // 1. Update Orbit
    const oldPos = p.group.position.clone();

    // Instead of using delta which desyncs clients, use absolute universal time
    const currentAngle = p.orbitAngleOffset + (p.orbitSpeed * universalTime);
    const incRad = p.inclination ? (p.inclination * Math.PI / 180) : 0;
    p.group.position.x = Math.cos(currentAngle) * p.orbitRadius;
    p.group.position.y = -Math.sin(currentAngle) * p.orbitRadius * Math.sin(incRad);
    p.group.position.z = Math.sin(currentAngle) * p.orbitRadius * Math.cos(incRad);

    // Rotación sobre su propio eje (Ciclo Día/Noche sincronizado)
    p.group.rotation.y = universalTime * 0.005;

    const deltaPos = p.group.position.clone().sub(oldPos);

    // Update hitbox position to match planet
    const hitbox = planetHitboxes.find(h => h.userData.planet === p);
    if (hitbox) hitbox.position.copy(p.group.position);

    // 2. Relative Physics: Inherit orbital velocity if inside gravity well or anchored!
    const distForDrag = spaceship.mesh.position.distanceTo(p.group.position);
    if ((spaceship.mode === 'HOVER' && spaceship.hoverPlanet === p) || distForDrag < p.radius * 2.0) {
      spaceship.mesh.position.add(deltaPos);
      spaceship.camera.position.add(deltaPos); // Prevent camera lagging behind the moving ship
    }

    // 3. Collision Detection
    const distToPlanet = spaceship.mesh.position.distanceTo(p.group.position);
    if (distToPlanet < p.radius + 1500) {
      const dirFromPlanet = new THREE.Vector3().subVectors(spaceship.mesh.position, p.group.position).normalize();
      
      // Convert dirFromPlanet to planet's local space
      const localDirFromPlanet = dirFromPlanet.clone().applyQuaternion(p.group.quaternion.clone().invert());
      const actualTerrainHeight = TerrainBuilder.getHeight(localDirFromPlanet, p.radius);

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
    
    renderScene.camera = camera;
    composer.render();
  } else {
    shipMarker.visible = true;

    // Update ship marker position to match spaceship
    shipMarker.position.copy(spaceship.mesh.position);

    // In map mode, LOD doesn't need high detail updates
    renderScene.camera = mapCamera;
    composer.render();
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
      const x = (targetPos.x * .5 + .5) * window.innerWidth;
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

// ==========================================
// Nav-Computer UI Logic
// ==========================================
const btnEngage = document.getElementById('btn-engage-autopilot');
const autopilotStatus = document.getElementById('autopilot-status');

btnEngage.addEventListener('click', () => {
  if (spaceship.autoTarget) {
    spaceship.autopilotEngaged = !spaceship.autopilotEngaged;
    if (spaceship.autopilotEngaged) {
      autopilotStatus.innerText = 'ENGAGED';
      autopilotStatus.className = 'autopilot-status engaged';
      btnEngage.innerText = 'DISENGAGE AUTOPILOT';
      
      // If we are in the map, auto-close the map so they see the flight!
      if (isMapMode) {
        if (galaxyGroup.visible) {
          scene.children.forEach(child => {
            if (child !== galaxyGroup && child.userData.wasVisible !== undefined) {
              child.visible = child.userData.wasVisible;
            }
          });
        }
        
        isMapMode = false;
        document.body.requestPointerLock();
        document.body.style.cursor = 'default';
        selectionRing.visible = false;
        mapControls.enabled = false;
        mapVisuals.visible = false;
        galaxyGroup.visible = false;
        document.getElementById('nav-computer').style.display = 'none';
        document.getElementById('map-mode-label').style.display = 'none';
        
        mapCamera.position.set(0, 250000000, 0);
        mapCamera.up.set(0, 0, -1);
        mapCamera.lookAt(0, 0, 0);
        mapControls.maxDistance = 150000000;
        mapControls.minDistance = 10000;
      }
      
    } else {
      autopilotStatus.innerText = 'STANDBY';
      autopilotStatus.className = 'autopilot-status';
      btnEngage.innerText = 'ENGAGE AUTOPILOT';
    }
  }
});

// Global selection function so raycaster can trigger it too
window.selectPlanetInNav = function(p) {
  spaceship.autoTarget = { type: 'planet', obj: p };
  btnEngage.disabled = false;
  
  // Update Enciclopedia Info Panel
  const infoPanel = document.getElementById('planet-info-panel');
  const infoTitle = document.getElementById('planet-info-title');
  const infoDesc = document.getElementById('planet-info-desc');
  
  if (infoPanel && infoTitle && infoDesc) {
    infoPanel.style.display = 'block';
    infoTitle.innerText = p.name || `Planeta`;
    infoDesc.innerText = p.desc || 'Datos desconocidos.';
  }

  // If already engaged, keep it engaged but switch target
  if (!spaceship.autopilotEngaged) {
    btnEngage.innerText = 'ENGAGE AUTOPILOT';
  }
  
  // Highlight in the list if possible
  document.querySelectorAll('.nav-section li').forEach(el => {
    el.classList.remove('selected');
    if (el.innerText.includes(p.name)) {
      el.classList.add('selected');
    }
  });
};

function updateNavComputer() {
  const planetsList = document.getElementById('nav-planets-list');
  const friendsList = document.getElementById('nav-friends-list');

  if (!planetsList || !friendsList) return;

  // Clear lists
  planetsList.innerHTML = '';
  friendsList.innerHTML = '';

  // Populate Planets
  planets.forEach((p, index) => {
    const li = document.createElement('li');
    li.innerText = p.name ? `Planeta: ${p.name}` : `Planeta Sector ${index + 1}`;
    li.addEventListener('click', () => {
      window.selectPlanetInNav(p);
    });
    planetsList.appendChild(li);
  });

  // Populate Friends
  for (const id in remotePlayers) {
    const li = document.createElement('li');
    li.innerText = `Piloto: ${id.substring(0, 4)}`;
    li.addEventListener('click', () => {
      document.querySelectorAll('.nav-section li').forEach(el => el.classList.remove('selected'));
      li.classList.add('selected');
      spaceship.autoTarget = { type: 'player', obj: remotePlayers[id] };
      btnEngage.disabled = false;

      if (!spaceship.autopilotEngaged) {
        btnEngage.innerText = 'ENGAGE AUTOPILOT';
      }
    });
    friendsList.appendChild(li);
  }

  if (Object.keys(remotePlayers).length === 0) {
    const li = document.createElement('li');
    li.innerText = 'Sin señal...';
    li.style.color = '#555';
    li.style.pointerEvents = 'none';
    friendsList.appendChild(li);
  }
  
  // Actualizar UI del Lock-On
  if (lockedTarget) {
    if (lockedTarget.isDead) {
      lockedTarget = null;
      lockOnUI.style.display = 'none';
    } else {
      const screenPos = lockedTarget.mesh.position.clone();
      const toTarget = new THREE.Vector3().subVectors(screenPos, camera.position).normalize();
      const cameraForward = new THREE.Vector3();
      camera.getWorldDirection(cameraForward);
      
      if (toTarget.dot(cameraForward) > 0) {
        screenPos.project(camera);
        const x = (screenPos.x *  0.5 + 0.5) * window.innerWidth;
        const y = (screenPos.y * -0.5 + 0.5) * window.innerHeight;
        lockOnUI.style.display = 'block';
        lockOnUI.style.left = `${x}px`;
        lockOnUI.style.top = `${y}px`;
      } else {
        lockOnUI.style.display = 'none';
      }
    }
  }
}

// Initial populate
updateNavComputer();

animate();
