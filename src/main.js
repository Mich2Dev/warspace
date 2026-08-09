import './style.css';
import * as THREE from 'three';
import { Spaceship } from './Spaceship.js';
import { Planet } from './planet/Planet.js';
import { TerrainBuilder, globalTerrainUniforms } from './planet/TerrainBuilder.js';
import { io } from 'socket.io-client';
import { RemotePlayer } from './RemotePlayer.js';
import { MobileController } from './MobileController.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GalaxyBuilder } from './GalaxyBuilder.js';
import { Skybox } from './Skybox.js';
import { gameAudio } from './GameAudio.js';
import { SurfaceWalker } from './SurfaceWalker.js';
import { LavaDragonFaunaManager } from './fauna/LavaDragonFaunaManager.js';
import { PerformanceGovernor } from './PerformanceGovernor.js';

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
  surface: 'KeyN',
  land: 'KeyL'
};

window.GameConfig = JSON.parse(localStorage.getItem('jg_keyconfig')) || { keys: defaultKeys };
// Merge with defaults in case of missing keys
window.GameConfig.keys = { ...defaultKeys, ...window.GameConfig.keys };

// Setup basic scene
const scene = new THREE.Scene();
// No fog in deep space!
scene.fog = null;
const _deepSpaceColor = new THREE.Color(0x000000);
const _fogColor = new THREE.Color();
const _atmoBackground = new THREE.Color();
const _toxicFogTint = new THREE.Color(0x88ff44);
const _lavaFogTint = new THREE.Color(0xff4400);
const _atmoFog = new THREE.Fog(0x000000, 800, 70000);

// Add procedural galaxy background
const skybox = new Skybox(scene);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500000000); // 500 million bounds
const mapCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000000000); // 2 billion for galaxy map
mapCamera.position.set(0, 250000000, 0); // 45 million height to see massive orbits
// When looking straight down (-Y), we must change the UP vector to avoid mathematical singularity
mapCamera.up.set(0, 0, -1);
mapCamera.lookAt(0, 0, 0);

// Renderer — nitidez sin saturar GPU en pantallas HiDPI
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);

const performanceGovernor = new PerformanceGovernor(renderer);

// ==========================================
// Spark Particle System for Collisions
// ==========================================
const activeSparks = [];

// Create soft circular spark texture ONCE (caching to prevent massive lag)
const sparkCanvas = document.createElement('canvas');
sparkCanvas.width = 16; sparkCanvas.height = 16;
const sparkCtx = sparkCanvas.getContext('2d');
const sparkGrad = sparkCtx.createRadialGradient(8, 8, 0, 8, 8, 8);
sparkGrad.addColorStop(0, 'rgba(255, 200, 50, 1)');
sparkGrad.addColorStop(0.5, 'rgba(255, 100, 0, 0.8)');
sparkGrad.addColorStop(1, 'rgba(255, 50, 0, 0)');
sparkCtx.fillStyle = sparkGrad;
sparkCtx.fillRect(0, 0, 16, 16);
const globalSparkTexture = new THREE.CanvasTexture(sparkCanvas);

let lastSparkTime = 0;

window.createSparks = function(position, normal, intensity) {
    // Add cooldown to prevent spawning 60 meshes per second if scraping
    const now = Date.now();
    if (now - lastSparkTime < 250) return; // Wait 250ms before creating more sparks
    lastSparkTime = now;

    const sparkCount = Math.floor(Math.min(intensity * 0.5, 100)); // Up to 100 sparks
    if (sparkCount < 5) return;
    
    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array(sparkCount * 3);
    const vels = [];
    
    for (let i = 0; i < sparkCount; i++) {
        pos[i*3] = position.x;
        pos[i*3+1] = position.y;
        pos[i*3+2] = position.z;
        
        // Random velocity bursting mostly along the normal
        const vx = normal.x * (100 + Math.random() * 200) + (Math.random() - 0.5) * 200;
        const vy = normal.y * (100 + Math.random() * 200) + (Math.random() - 0.5) * 200;
        const vz = normal.z * (100 + Math.random() * 200) + (Math.random() - 0.5) * 200;
        vels.push(new THREE.Vector3(vx, vy, vz));
    }
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    
    const mat = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 15.0, // Big glowing sparks
        map: globalSparkTexture,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    
    const mesh = new THREE.Points(geom, mat);
    scene.add(mesh);
    
    activeSparks.push({ mesh, vels, life: 1.0 });
};

// OrbitControls para el mapa
const mapControls = new OrbitControls(mapCamera, renderer.domElement);
mapControls.enabled = false;
mapControls.enableDamping = true;
mapControls.maxDistance = 600000000; // Más allá de Neptuno (~300M)
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
// La Vía Láctea (~420k partículas) se crea solo al abrirla por primera vez.
const galaxyGroup = galaxyBuilder.galaxyGroup;
// El mapa galáctico cambia al modo "vista galáctica" donde la galaxia
// se posiciona para ver desde arriba. Escalarla para que llene la vista.
// Radio galáctico en Three.js units: ~50000 años luz * 0.15 = 7500 unidades de galaxia
// El sistema solar usa hasta ~150M unidades, así que escalamos la galaxia a ese tamaño.
const GALAXY_MAP_SCALE = 20000; // Factor para que la galaxia llene el mapa galáctico
galaxyGroup.scale.setScalar(GALAXY_MAP_SCALE);
galaxyGroup.visible = false; // Solo visible en modo mapa galáctico

// Local Surface Radar (2D; no segundo render 3D)
const minimapBorderEl = document.getElementById('minimap-border');
const surfaceRadarCanvas = document.createElement('canvas');
surfaceRadarCanvas.width = 250;
surfaceRadarCanvas.height = 250;
surfaceRadarCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:.9';
minimapBorderEl?.insertBefore(surfaceRadarCanvas, minimapBorderEl.firstChild);
const surfaceRadarCtx = surfaceRadarCanvas.getContext('2d');

let isMapMode = false;
// Ensure legacy lighting so PointLight doesn't decay to zero over 300,000 units
renderer.useLegacyLights = true;
if (renderer.useLegacyLights === undefined) {
  renderer.physicallyCorrectLights = false;
}
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(performanceGovernor.ratio);
document.getElementById('app').appendChild(renderer.domElement);

// Lighting (Realistic space lighting from the Sun)
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); // Aumentado para que el lado oscuro del planeta no sea negro intenso
scene.add(ambientLight);

// Luz de rebote: cielo claro arriba, rebote cálido verde/tierra abajo => mundo más vivo
const starlight = new THREE.HemisphereLight(0xbfd8ff, 0x3a5a34, 0.45);
scene.add(starlight);

// Visual Sun at Center (Reducido para que no ocupe todo el cielo)
const sunGeo = new THREE.SphereGeometry(2000000, 64, 64);
// Injecting color values > 1.0 to trigger massive bloom (HDR rendering)
const sunMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.0, 3.5, 2.5) }); 
const sunMesh = new THREE.Mesh(sunGeo, sunMat);
scene.add(sunMesh); // Add to SCENE so it's always visible, not just in the map!
const sunGlowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.0, 2.0, 0.0), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
const sunGlow = new THREE.Mesh(new THREE.SphereGeometry(2500000, 32, 32), sunGlowMat);
scene.add(sunGlow);

// Real Sun Light emitting from the center
const sunLight = new THREE.PointLight(0xffffff, 5.0, 0); // Intense sunlight
scene.add(sunLight);

// ==========================================
// MULTIPLAYER NETWORK SETUP
// ==========================================
const socket = io();
const remotePlayers = {};
let isLoggedIn = false;

// ==========================================
// LOGIN LOGIC (auto-relogin for fast iteration)
// ==========================================
const LOGIN_SAVE_KEY = 'jg_saved_login';
let loginInFlight = false;

function doLogin(user, pass) {
  if (loginInFlight || isLoggedIn) return;
  const errorEl = document.getElementById('login-error');
  if (user.length < 3 || pass.length < 3) {
    errorEl.style.display = 'block';
    errorEl.innerText = "Usuario y contraseña deben tener al menos 3 caracteres.";
    return;
  }
  loginInFlight = true;
  errorEl.style.display = 'block';
  errorEl.innerText = "Conectando al servidor...";
  socket.emit('login', { username: user, password: pass });

  // Si el servidor no responde, no dejes el botón colgado para siempre
  clearTimeout(doLogin._timeout);
  doLogin._timeout = setTimeout(() => {
    if (loginInFlight && !isLoggedIn) {
      loginInFlight = false;
      errorEl.style.display = 'block';
      errorEl.innerText = "Sin respuesta del servidor. ¿Está corriendo start.bat / node server.js?";
    }
  }, 8000);
}

// Prefill + auto-login after full page reload / HMR reconnect
try {
  const saved = JSON.parse(localStorage.getItem(LOGIN_SAVE_KEY) || 'null');
  if (saved?.username && saved?.password) {
    document.getElementById('login-username').value = saved.username;
    document.getElementById('login-password').value = saved.password;
  }
} catch (_) {}

document.getElementById('btn-login').addEventListener('click', () => {
  gameAudio.unlock();
  const user = document.getElementById('login-username').value.trim();
  const pass = document.getElementById('login-password').value.trim();
  doLogin(user, pass);
});

// Enter key submits login
document.getElementById('login-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-login').click();
});

socket.on('connect', () => {
  if (isLoggedIn) return;
  try {
    const saved = JSON.parse(localStorage.getItem(LOGIN_SAVE_KEY) || 'null');
    if (saved?.username && saved?.password) {
      doLogin(saved.username, saved.password);
    }
  } catch (_) {}
});

socket.on('login_success', (playerData) => {
  isLoggedIn = true;
  loginInFlight = false;
  clearTimeout(doLogin._timeout);
  const user = document.getElementById('login-username').value.trim();
  const pass = document.getElementById('login-password').value.trim();
  if (user && pass) {
    localStorage.setItem(LOGIN_SAVE_KEY, JSON.stringify({ username: user, password: pass }));
  }
  document.getElementById('login-screen').style.display = 'none';
  document.querySelector('.ui').style.display = 'block';
  
  // Restaurar última posición, o cerca de Mercurio si no hay guardado
  spawnPlayer();
  
  // Provide a global function to respawn the player without reloading the page
  window.respawnPlayer = () => {
    document.getElementById('death-screen').style.display = 'none';
    spaceship.hp = 100;
    spaceship.isDead = false;
    spaceship.speed = 0;
    spaceship.autopilotEngaged = false;
    spaceship.autoTarget = null;
    
    spawnAtMercury();
    
    // Attempt to relock the pointer
    document.body.requestPointerLock();
  };
  
  // Restore HP if exists
  if (playerData.hp !== undefined) {
    spaceship.hp = playerData.hp;
  }
  
  // Enable flight controls
  document.body.requestPointerLock();
});

socket.on('login_failed', (data) => {
  loginInFlight = false;
  clearTimeout(doLogin._timeout);
  const errorEl = document.getElementById('login-error');
  errorEl.style.display = 'block';
  errorEl.innerText = data?.message || 'Error de login';
});

socket.on('login_error', (msg) => {
  loginInFlight = false;
  clearTimeout(doLogin._timeout);
  const errorEl = document.getElementById('login-error');
  errorEl.style.display = 'block';
  errorEl.innerText = typeof msg === 'string' ? msg : (msg?.message || 'Error');
});

socket.on('connect_error', () => {
  if (loginInFlight && !isLoggedIn) {
    loginInFlight = false;
    clearTimeout(doLogin._timeout);
    const errorEl = document.getElementById('login-error');
    errorEl.style.display = 'block';
    errorEl.innerText = 'No se pudo conectar al servidor. Arranca start.bat.';
  }
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
    gameAudio.playLaserShot({ enemy: true });
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
let legacyStars = null;
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
  const material = new THREE.PointsMaterial({ color: 0x444444, size: 1, sizeAttenuation: false, transparent: true, opacity: 1 });
  legacyStars = new THREE.Points(geometry, material);
  scene.add(legacyStars);
}
// Skybox ya aporta 7.600 estrellas texturizadas. No crear otras 150.000
// duplicadas: consumían memoria y fill-rate durante todo el juego.

function setStarFieldOpacity(opacity) {
  const o = THREE.MathUtils.clamp(opacity, 0, 1);
  if (skybox) skybox.setOpacity(o);
  if (legacyStars) {
    legacyStars.material.opacity = o;
    legacyStars.visible = o > 0.02;
  }
}

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
// Black Hole Removed
// ==========================================
// Spaceship Initialization
// ==========================================

// Initialize Spaceship
const spaceship = new Spaceship(scene, camera);
const surfaceWalker = new SurfaceWalker(scene, camera);

// Iniciar Controles Móviles (Si está en celular)
const mobileController = new MobileController(spaceship);
// La posición real se fija con spawnAtEarth() cuando existan los planetas.

// Initialize Procedural Solar System (Hybrid Scale)
const planets = [];

const solarSystemData = [
  { name: "Mercurio", radius: 7600 * 25, distance: 30000000, color: 0x4a2218, speed: 0.0008, inclination: 7.00, biome: 'Lava', desc: "Planeta rocoso. Es el más pequeño y cercano al Sol." },
  { name: "Venus", radius: 19000 * 25, distance: 45000000, color: 0xe3bb76, speed: 0.0006, inclination: 3.39, biome: 'Toxic', desc: "Planeta rocoso. Atmósfera tóxica." },
  { name: "Tierra", radius: 20000 * 25, distance: 60000000, color: 0x2b82c9, speed: 0.0005, inclination: 0.00, biome: 'Terran', moons: [{ name: "Luna", radius: 5500 * 25, dist: 1000000, speed: 0.005, color: 0x888888, biome: 'Desert' }], desc: "Planeta rocoso. Nuestro hogar." },
  { name: "Marte", radius: 10600 * 25, distance: 80000000, color: 0xc1440e, speed: 0.0004, inclination: 1.85, biome: 'Desert', desc: "Planeta rocoso. El 'Planeta Rojo'." },
  { name: "Júpiter", radius: 223000 * 25, distance: 120000000, color: 0xd39c7e, speed: 0.0002, inclination: 1.30, biome: 'GasGiant', moons: [{ name: "Europa", radius: 4800 * 25, dist: 1500000, speed: 0.008, color: 0xaaffff, biome: 'Ice' }], desc: "Gigante gaseoso." },
  { name: "Saturno", radius: 188000 * 25, distance: 170000000, color: 0xead6b8, speed: 0.00015, inclination: 2.49, biome: 'GasGiant', hasRings: true, desc: "Gigante gaseoso. Sistema de anillos." },
  { name: "Urano", radius: 80000 * 25, distance: 230000000, color: 0x4b70dd, speed: 0.0001, inclination: 0.77, biome: 'Ice', hasRings: true, desc: "Gigante helado." },
  { name: "Neptuno", radius: 77000 * 25, distance: 300000000, color: 0x274687, speed: 0.00008, inclination: 1.77, biome: 'Ice', desc: "Gigante helado." }
];

solarSystemData.forEach((data, index) => {
  // Angle offset so they don't form a straight line. Earth is index 2. We subtract 2 so Earth starts at angle 0.
  const angle = (index - 2) * 2.5; 
  
  // Base position on XZ plane
  const basePos = new THREE.Vector3(Math.cos(angle) * data.distance, 0, Math.sin(angle) * data.distance);
  // Apply orbital inclination (rotate around X axis)
  basePos.applyAxisAngle(new THREE.Vector3(1, 0, 0), data.inclination * Math.PI / 180);
  const p = new Planet(scene, data.radius, basePos, data.color, data.biome, data.hasRings);
  p.name = data.name;
  p.desc = data.desc;
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
  
  // Add Moons
  if (data.moons) {
      p.moonsList = [];
      data.moons.forEach(m => {
          const moonPos = basePos.clone().add(new THREE.Vector3(m.dist, 0, 0));
          const moon = new Planet(scene, m.radius, moonPos, m.color, m.biome, false);
          moon.name = m.name;
          moon.orbitRadius = m.dist;
          moon.orbitSpeed = m.speed; // Fixed: use orbitSpeed for consistency
          moon.orbitalSpeed = m.speed; // Keep this just in case
          moon.orbitAngleOffset = Math.random() * Math.PI * 2; // Random start angle
          moon.inclination = 0; // Flat orbit relative to parent
          moon.parentPlanet = p;
          planets.push(moon);
          p.moonsList.push(moon);
      });
  }
});

// Fauna volcánica: LavaDragon en Mercurio
let lavaDragonFauna = null;
{
  const mercurio = planets.find(p => p.name === 'Mercurio' && p.biome === 'Lava');
  if (mercurio) {
    lavaDragonFauna = new LavaDragonFaunaManager(mercurio.group, mercurio.radius, mercurio.biome, 1);
    lavaDragonFauna.onPlayerHit = (amount) => {
      if (spaceship && typeof spaceship.takeDamage === 'function') {
        spaceship.takeDamage(amount);
      }
    };
  }
}

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

function formatDist(meters) {
  const abs = Math.abs(meters);
  if (abs >= 1e6) return (meters / 1e6).toFixed(1) + ' Mm';
  if (abs >= 1e3) return (meters / 1e3).toFixed(0) + ' km';
  return Math.round(meters) + ' m';
}

function updateLocationHud(closestPlanet, minDist) {
  const nearEl = document.getElementById('loc-near');
  const earthEl = document.getElementById('loc-earth');
  const hud = document.getElementById('location-hud');
  if (!nearEl || !earthEl || !hud) return;
  hud.style.display = isMapMode ? 'none' : 'block';

  if (closestPlanet) {
    const alt = minDist - closestPlanet.radius;
    const zone = alt < 0
      ? 'bajo superficie'
      : alt < closestPlanet.radius * 0.12
        ? 'atmósfera'
        : alt < closestPlanet.radius * 0.8
          ? 'órbita baja'
          : 'espacio cercano';
    nearEl.textContent = `Cerca: ${closestPlanet.name} · ${formatDist(alt)} (${zone})`;
  } else {
    nearEl.textContent = 'Cerca: espacio profundo';
  }

  const earth = planets.find(p => p.name === 'Tierra');
  if (earth) {
    const d = spaceship.mesh.position.distanceTo(earth.group.position) - earth.radius;
    earthEl.textContent = `Tierra: ${formatDist(d)}`;
  }
}

/** Siempre pone la nave cerca de Mercurio (órbita cercana), mirando al planeta. */
function spawnAtMercury() {
  const mercurio = planets.find(p => p.name === 'Mercurio');
  if (!mercurio) {
    spawnAtEarth();
    return;
  }
  const universalTime = Date.now() / 1000;
  const currentAngle = mercurio.orbitAngleOffset + (mercurio.orbitSpeed * universalTime);
  const incRad = mercurio.inclination ? (mercurio.inclination * Math.PI / 180) : 0;
  const mx = Math.cos(currentAngle) * mercurio.orbitRadius;
  const my = -Math.sin(currentAngle) * mercurio.orbitRadius * Math.sin(incRad);
  const mz = Math.sin(currentAngle) * mercurio.orbitRadius * Math.cos(incRad);
  const offset = mercurio.radius * 2.2;
  spaceship.mesh.position.set(mx + offset, my + mercurio.radius * 0.2, mz);
  spaceship.mesh.lookAt(mx, my, mz);
  spaceship.speed = 0;
  spaceship.mode = 'FLIGHT';
  spaceship.isLanded = false;
  spaceship.onFoot = false;
  spaceship.hoverPlanet = null;
  spaceship.yawAccumulator = 0;
  spaceship.pitchAccumulator = 0;
  saveShipPose();
}

const SHIP_POSE_KEY = 'jg_ship_pose_v2';

function saveShipPose() {
  try {
    const p = spaceship.mesh.position;
    localStorage.setItem(SHIP_POSE_KEY, JSON.stringify({
      x: p.x, y: p.y, z: p.z,
      yaw: spaceship.yawAccumulator || 0,
      pitch: spaceship.pitchAccumulator || 0,
      t: Date.now()
    }));
  } catch {}
}

function restoreShipPose() {
  try {
    const raw = JSON.parse(localStorage.getItem(SHIP_POSE_KEY) || 'null');
    if (!raw || !Number.isFinite(raw.x)) return false;
    spaceship.mesh.position.set(raw.x, raw.y, raw.z);
    spaceship.yawAccumulator = raw.yaw || 0;
    spaceship.pitchAccumulator = raw.pitch || 0;
    spaceship.speed = 0;
    spaceship.mode = 'FLIGHT';
    spaceship.isLanded = false;
    spaceship.onFoot = false;
    spaceship.hoverPlanet = null;
    return true;
  } catch {
    return false;
  }
}

/** Arranque: última pose solo si estás cerca de Mercurio; si no, respawn ahí. */
function spawnPlayer() {
  const mercurio = planets.find(p => p.name === 'Mercurio');
  const restored = restoreShipPose();
  if (!restored || !mercurio) {
    spawnAtMercury();
    return;
  }
  const d = spaceship.mesh.position.distanceTo(mercurio.group.position);
  // Pose guardada en el vacío / otro planeta → volver a Mercurio
  if (d > mercurio.radius * 6) {
    spawnAtMercury();
  }
}

/** Siempre pone la nave fuera de la Tierra (órbita cercana), mirando al planeta. */
function spawnAtEarth() {
  const earth = planets.find(p => p.name === 'Tierra');
  if (!earth) {
    spaceship.mesh.position.set(60000000 + 1250000, 0, 1250000);
    spaceship.mesh.lookAt(60000000, 0, 0);
    return;
  }
  const universalTime = Date.now() / 1000;
  const currentAngle = earth.orbitAngleOffset + (earth.orbitSpeed * universalTime);
  const incRad = earth.inclination ? (earth.inclination * Math.PI / 180) : 0;
  const ex = Math.cos(currentAngle) * earth.orbitRadius;
  const ey = -Math.sin(currentAngle) * earth.orbitRadius * Math.sin(incRad);
  const ez = Math.sin(currentAngle) * earth.orbitRadius * Math.cos(incRad);
  // A ~2.5 radios del centro: fuera de atmósfera, Tierra grande y visible
  const offset = earth.radius * 2.5;
  spaceship.mesh.position.set(ex + offset, ey + earth.radius * 0.15, ez);
  spaceship.mesh.lookAt(ex, ey, ez);
  spaceship.speed = 0;
  spaceship.mode = 'FLIGHT';
  spaceship.isLanded = false;
  spaceship.onFoot = false;
  spaceship.hoverPlanet = null;
  spaceship.yawAccumulator = 0;
  spaceship.pitchAccumulator = 0;
  saveShipPose();
}
window.spawnAtEarth = spawnAtEarth;
window.spawnAtMercury = spawnAtMercury;
window.spawnPlayer = spawnPlayer;
spawnPlayer(); // Arranque: última pose o Mercurio

const raycaster = new THREE.Raycaster();
// Reused for planet collision / camera clamp (creating Raycaster every frame was lagging hard)
const terrainRaycaster = new THREE.Raycaster();
const camTerrainRaycaster = new THREE.Raycaster();
const _rayStart = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _localDir = new THREE.Vector3();
const _quatInv = new THREE.Quaternion();
const _oldPlanetPos = new THREE.Vector3();
const _deltaPlanetPos = new THREE.Vector3();
const _planetSurfaceDir = new THREE.Vector3();
const _cameraSurfaceDir = new THREE.Vector3();
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
  // L / E: aterrizar y bajar a pie (más tolerante)
  if (e.code === window.GameConfig.keys.land || e.code === 'KeyE') {
    if (spaceship.mode === 'HOVER' || spaceship.onFoot || surfaceWalker.active) {
      if (surfaceWalker.active || spaceship.onFoot) {
        surfaceWalker.tryToggle(spaceship);
      } else if (spaceship.isLanded) {
        surfaceWalker.tryToggle(spaceship);
      } else if (e.code === window.GameConfig.keys.land) {
        spaceship.toggleLanding();
      } else if (e.code === 'KeyE' && spaceship.hoverPlanet) {
        // E en hover: aterriza y baja en un paso
        spaceship.toggleLanding();
        surfaceWalker.tryToggle(spaceship);
      }
    }
  }
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
      galaxyBuilder.build();
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
  const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5, 5) }); // HDR White
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  laserGroup.add(coreMesh);

  // 2. Glowing outer aura
  const glowGeo = new THREE.CylinderGeometry(250, 250, length, 8);
  glowGeo.rotateX(Math.PI / 2);
  const glowMat = new THREE.MeshBasicMaterial({ 
    color: new THREE.Color(colorHex).multiplyScalar(4.0), // HDR Neon Color
    transparent: true, 
    opacity: 1.0, 
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
  if (spaceship.onFoot || surfaceWalker.active) {
    lockedTarget = null;
    if (lockOnUI) lockOnUI.style.display = 'none';
    return;
  }
  
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
  if (spaceship.isDead || spaceship.mode !== 'FLIGHT' || spaceship.onFoot || surfaceWalker.active) return;
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
  gameAudio.playLaserShot({ enemy: false });
  
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
  surface: 'Anclaje de Superficie',
  land: 'Aterrizar / Despegar'
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
    if (surfaceWalker.active) {
      surfaceWalker.onMouseMove(e.movementX, e.movementY);
    } else {
      spaceship.onMouseMove(e.movementX, e.movementY);
    }
  }
});
document.addEventListener('wheel', (e) => {
  if (document.pointerLockElement === document.body) {
    if (surfaceWalker.active) surfaceWalker.onScroll(e.deltaY);
    else spaceship.onScroll(e.deltaY);
  }
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === document.body) {
    gameAudio.unlock();
  }
});


// Resize handler
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  mapCamera.aspect = window.innerWidth / window.innerHeight;
  mapCamera.updateProjectionMatrix();
  performanceGovernor.resize();
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
let lastAmbientAudioTick = 0;
let lastHudTick = 0;
let lastLocalMapRender = 0;
const _localMapForward = new THREE.Vector3();
const _radarPlayerLocal = new THREE.Vector3();
const _radarUp = new THREE.Vector3();
const _radarFwd = new THREE.Vector3();
const _radarRight = new THREE.Vector3();
const _radarDelta = new THREE.Vector3();
const _radarWorld = new THREE.Vector3();
const _radarInv = new THREE.Matrix4();
const RADAR_RANGE = 4500; // metros de superficie cubiertos por el círculo
const DRAGON_GUIDE_MIN_DIST = 2800; // letrero en pantalla solo si está más lejos
const DRAGON_RADAR_LABEL_DIST = 900; // en radar: nombre solo lejos; distancia siempre

function animate() {
  requestAnimationFrame(animate);

  const frameDelta = clock.getDelta();
  performanceGovernor.update(frameDelta);
  // Evita saltos de física/LOD después de una pausa o frame muy pesado.
  const delta = Math.min(frameDelta, 0.05);
  const time = clock.getElapsedTime();

  // Guardar posición cada ~2s para no perder el progreso al recargar
  if (!animate._poseAcc) animate._poseAcc = 0;
  animate._poseAcc += delta;
  if (animate._poseAcc > 2) {
    animate._poseAcc = 0;
    if (!spaceship.isDead) saveShipPose();
  }
  
  // Update Global Terrain Shader Time for procedural water and lava
  globalTerrainUniforms.time.value = time;

  if (galaxyGroup.visible) galaxyBuilder.update(delta);
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


    }

    // === Update Ship & Camera (After gravity moves the ship) ===
    // Si el estado a pie quedó a medias, recuperar la nave
    if (spaceship.onFoot && !surfaceWalker.active) {
      spaceship.onFoot = false;
    }
    if (isPointerLocked || mobileController.isMobile) {
      spaceship.update(delta, activeKeys);
      if (surfaceWalker.active) {
        surfaceWalker.update(delta, activeKeys);
      }
    } else {
      spaceship.update(delta, {});
      if (surfaceWalker.active) {
        surfaceWalker.update(delta, {});
      }
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

  let shieldHeat = 0; // Accumulates heat if inside atmospheres

  for (const p of planets) {
    // 1. Update Orbit
    _oldPlanetPos.copy(p.group.position);

    // Instead of using delta which desyncs clients, use absolute universal time
    const currentAngle = p.orbitAngleOffset + (p.orbitSpeed * universalTime);
    const incRad = p.inclination * Math.PI / 180;
    
    if (p.parentPlanet) {
        // This is a moon! Orbit its parent.
        const parentPos = p.parentPlanet.group.position;
        const moonAngle = time * p.orbitalSpeed;
        p.group.position.x = parentPos.x + Math.cos(moonAngle) * p.orbitRadius;
        p.group.position.y = parentPos.y;
        p.group.position.z = parentPos.z + Math.sin(moonAngle) * p.orbitRadius;
    } else {
        // Orbit the sun
        p.group.position.x = Math.cos(currentAngle) * p.orbitRadius;
        p.group.position.y = -Math.sin(currentAngle) * p.orbitRadius * Math.sin(incRad);
        p.group.position.z = Math.sin(currentAngle) * p.orbitRadius * Math.cos(incRad);
    }

    // Rotación sobre su propio eje (Ciclo Día/Noche sincronizado)
    p.group.rotation.y = universalTime * 0.005;

    const deltaPos = _deltaPlanetPos.subVectors(p.group.position, _oldPlanetPos);

    // Update hitbox position to match planet
    const hitbox = planetHitboxes.find(h => h.userData.planet === p);
    if (hitbox) hitbox.position.copy(p.group.position);
    
    // 2. Asteroid Ring Collisions (solo cerca — updateMatrixWorld es caro)
    if (p.rings && p.rings.userData.collisionData &&
        spaceship.mesh.position.distanceToSquared(p.group.position) < (p.radius * 3.2) ** 2) {
        p.group.updateMatrixWorld(true);
        
        const shipWorldPos = new THREE.Vector3();
        spaceship.mesh.getWorldPosition(shipWorldPos);
        
        const ringsInverseMatrix = new THREE.Matrix4().copy(p.rings.matrixWorld).invert();
        const shipLocalPos = shipWorldPos.clone().applyMatrix4(ringsInverseMatrix);
        
        // Broadphase: Check if we are within the ring bounds
        if (Math.abs(shipLocalPos.y) < p.radius * 0.15) { // Vertical bound
             const shipDist2D = Math.sqrt(shipLocalPos.x*shipLocalPos.x + shipLocalPos.z*shipLocalPos.z);
             if (shipDist2D > p.radius * 1.1 && shipDist2D < p.radius * 2.7) { // Radial bounds
                  const collisionData = p.rings.userData.collisionData;
                  for (let i = 0; i < collisionData.length; i++) {
                       const ast = collisionData[i];
                       const dx = shipLocalPos.x - ast.x;
                       const dy = shipLocalPos.y - ast.y;
                       const dz = shipLocalPos.z - ast.z;
                       const distSq = dx*dx + dy*dy + dz*dz;
                       
                       const hitRadius = ast.radius + 20; // 20 units for spaceship size buffer
                       
                       if (distSq < hitRadius * hitRadius) {
                            // COLLISION!
                            const dist = Math.sqrt(distSq);
                            // Vector pointing from asteroid center to ship
                            const normal = new THREE.Vector3(dx, dy, dz).normalize();
                            normal.transformDirection(p.rings.matrixWorld);
                            
                            // 1. Geometric Separation (Anti-Tunneling)
                            // Push the ship outside the asteroid immediately so it doesn't get stuck
                            const penetrationDepth = hitRadius - dist;
                            spaceship.mesh.position.add(normal.clone().multiplyScalar(penetrationDepth + 10));
                            
                            // 2. Physics Bounce
                            const impactForce = Math.min(Math.abs(spaceship.speed) * 0.5 + 50, 400); // Heavy thump
                            spaceship.velocity.copy(normal.clone().multiplyScalar(impactForce));
                            spaceship.speed = Math.max(-200, -Math.abs(spaceship.speed) * 0.5); // Bounce back, don't stop dead entirely
                            
                            // 3. Visual Feedback (Zero Lag)
                            // Instead of creating a new WebGL Light (which causes lag), we flash the screen red via DOM
                            let flash = document.getElementById('damage-flash');
                            if (!flash) {
                                flash = document.createElement('div');
                                flash.id = 'damage-flash';
                                flash.style.position = 'absolute';
                                flash.style.top = '0'; flash.style.left = '0';
                                flash.style.width = '100%'; flash.style.height = '100%';
                                flash.style.backgroundColor = 'rgba(255, 0, 0, 0.5)';
                                flash.style.pointerEvents = 'none';
                                flash.style.zIndex = '9999';
                                flash.style.transition = 'opacity 0.5s ease-out';
                                document.body.appendChild(flash);
                            }
                            flash.style.opacity = '1';
                            setTimeout(() => { flash.style.opacity = '0'; }, 50);
                            // 4. Spark Particle Effect
                            window.createSparks(spaceship.mesh.position.clone().add(normal.clone().multiplyScalar(5)), normal, impactForce);
                            
                            // Break out after first collision to prevent multiple hits in one frame
                            break;
                       }
                  }
             }
        }
    }

    // 2. Relative Physics: Inherit orbital velocity if inside gravity well or anchored!
    const distForDrag = spaceship.mesh.position.distanceTo(p.group.position);
    if (spaceship.mode === 'HOVER' && spaceship.hoverPlanet === p && spaceship.isLanded) {
      spaceship.syncLandedToPlanetTransform();
    } else if ((spaceship.mode === 'HOVER' && spaceship.hoverPlanet === p) || distForDrag < p.radius * 2.0) {
      spaceship.mesh.position.add(deltaPos);
      spaceship.camera.position.add(deltaPos); // Prevent camera lagging behind the moving ship
    }
    // Personaje y nave usan la misma coordenada local: no se separan ni son
    // arrastrados por la superficie al rotar/orbitar el planeta.
    if (surfaceWalker.active && surfaceWalker.planet === p) {
      surfaceWalker.syncToPlanetTransform();
    }

    // 3. Collision Detection — prefer cheap math; raycast only when very close to surface
    const distToPlanet = spaceship.mesh.position.distanceTo(p.group.position);
    if (distToPlanet < p.radius * 1.25) {
      const dirFromPlanet = _planetSurfaceDir.subVectors(spaceship.mesh.position, p.group.position).normalize();
      _quatInv.copy(p.group.quaternion).invert();
      _localDir.copy(dirFromPlanet).applyQuaternion(_quatInv);

      let actualTerrainHeight = TerrainBuilder.getHeight(_localDir, p.radius, p.biome, true);
      const approxAlt = distToPlanet - actualTerrainHeight;

      // El raycast contra millones de polígonos fue eliminado por causar lag extremo.
      // Confiamos 100% en la matemática instantánea (actualTerrainHeight) que es suficientemente precisa.
      
      // Clearance mínimo: evita meter la nave en el mesh.
      // OJO: en levitación (isLanded) NO tocamos la posición — updateLanded es el único dueño
      // de la altura; si dos sistemas la corrigen a la vez, la nave tiembla.
      if (spaceship.mode === 'FLIGHT') {
        const shipClearance = 55;
        if (distToPlanet < actualTerrainHeight + shipClearance) {
            const overlap = (actualTerrainHeight + shipClearance) - distToPlanet;
            spaceship.mesh.position.add(dirFromPlanet.clone().multiplyScalar(overlap * 5.0 * delta));
            
            // Freno suave sin rebote
            spaceship.speed = Math.max(0, spaceship.speed * 0.5); 
        }
      } else if (spaceship.mode === 'HOVER' && !spaceship.isLanded) {
        // Red de seguridad SOLO si se hunde de verdad (updateHover ya mantiene los 90)
        const shipClearance = 40;
        if (distToPlanet < actualTerrainHeight + shipClearance) {
            spaceship.mesh.position.copy(p.group.position).add(dirFromPlanet.multiplyScalar(actualTerrainHeight + spaceship.hoverHeightOffset));
        }
      }
    }
    
    // FIX CAMERA CLIPPING — margen amplio + elevar boom si hace falta
    const cameraDist = spaceship.camera.position.distanceTo(p.group.position);
    if (cameraDist < p.radius * 1.35) {
       const dirFromPlanetToCamera = _cameraSurfaceDir.subVectors(spaceship.camera.position, p.group.position).normalize();
       _quatInv.copy(p.group.quaternion).invert();
       _localDir.copy(dirFromPlanetToCamera).applyQuaternion(_quatInv);

       let cameraTerrainHeight = TerrainBuilder.getHeight(_localDir, p.radius, p.biome, true);
       const camClearance = 160; // margen amplio: no atraviesa piso ni lomas cercanas
       
       if (cameraDist < cameraTerrainHeight + camClearance) {
           const safePosition = p.group.position.clone().add(
             dirFromPlanetToCamera.clone().multiplyScalar(cameraTerrainHeight + camClearance)
           );
           spaceship.camera.position.copy(safePosition);
       }
    }
    
    // 4. Atmospheric Re-entry Friction
    const atmosphereLimit = p.radius * 1.18; // Match visual ATMO_SHELL (peaks ~6% stay deep inside)
    if (distToPlanet < atmosphereLimit && distToPlanet > p.radius) {
        // Depth is 0 at edge of atmosphere, 1 at the ground
        const depth = 1.0 - ((distToPlanet - p.radius) / (atmosphereLimit - p.radius));
        // Make plasma peak in the upper-mid atmosphere and fade near the ground
        const plasmaFactor = Math.sin(depth * Math.PI); 
        const speedRatio = Math.abs(spaceship.speed) / 30000.0; // Velocidad AAA: Solo te incendias si superas los 30,000 (Caída orbital real)
        if (speedRatio > 0.3 && plasmaFactor > 0) {
            const heat = (speedRatio - 0.3) * plasmaFactor * 3.0;
            if (heat > shieldHeat) shieldHeat = heat;
        }
    }
  }
  
  // Apply Re-entry Shield visual effect and camera shake
  if (spaceship.shieldUniforms) {
      spaceship.shieldUniforms.intensity.value = THREE.MathUtils.lerp(
          spaceship.shieldUniforms.intensity.value, 
          Math.min(shieldHeat, 2.0), 
          0.1
      );
      
      const currentHeat = spaceship.shieldUniforms.intensity.value;
      if (currentHeat > 0.05) {
          spaceship.plasmaShield.visible = true;
          // Camera shake removed based on user feedback
      } else {
          spaceship.plasmaShield.visible = false;
      }
  }
  
  // Update Galaxy Skybox
  skybox.update(universalTime);
  
  // Update Sparks
  for (let i = activeSparks.length - 1; i >= 0; i--) {
      const sparkObj = activeSparks[i];
      sparkObj.life -= delta * 1.5; // Sparks live for about 0.6 seconds
      
      if (sparkObj.life <= 0) {
          scene.remove(sparkObj.mesh);
          sparkObj.mesh.geometry.dispose();
          sparkObj.mesh.material.dispose();
          // NO NOT dispose globalSparkTexture
          activeSparks.splice(i, 1);
      } else {
          const positions = sparkObj.mesh.geometry.attributes.position.array;
          for (let p = 0; p < sparkObj.vels.length; p++) {
              positions[p*3] += sparkObj.vels[p].x * delta;
              positions[p*3+1] += sparkObj.vels[p].y * delta;
              positions[p*3+2] += sparkObj.vels[p].z * delta;
              
              // Drag
              sparkObj.vels[p].multiplyScalar(0.95);
          }
          sparkObj.mesh.geometry.attributes.position.needsUpdate = true;
          sparkObj.mesh.material.opacity = sparkObj.life;
      }
  }

  // Polvo espacial: no actualizar 2000 puntos/frame si esta oculto
  if (spaceDust.visible) {
    const positions = spaceDust.geometry.attributes.position.array;
    const shipPos = spaceship.mesh.position;
    let dustUpdated = false;
    for (let i = 0; i < 2000; i++) {
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      if (Math.abs(px - shipPos.x) > 2000) { positions[i * 3] = shipPos.x + Math.sign(shipPos.x - px) * 2000; dustUpdated = true; }
      if (Math.abs(py - shipPos.y) > 2000) { positions[i * 3 + 1] = shipPos.y + Math.sign(shipPos.y - py) * 2000; dustUpdated = true; }
      if (Math.abs(pz - shipPos.z) > 2000) { positions[i * 3 + 2] = shipPos.z + Math.sign(shipPos.z - pz) * 2000; dustUpdated = true; }
    }
    if (dustUpdated) spaceDust.geometry.attributes.position.needsUpdate = true;
  }

  // Stretch dust particles into lines based on ship speed and direction
  // This gives the Star Wars hyperspace effect!
  // Desactivado por completo por petición del usuario (Opción C)
  spaceDust.visible = false;

  if (!isMapMode) {
    shipMarker.visible = false;
    
    // Update planet quadtree LOD and Atmosphere based on camera position
    let closestPlanet = null;
    let minDist = Infinity;
    
    planets.forEach(p => {
      // Pass both position (for proximity LOD) and speed (for Velocity-Based LOD)
      p.update(spaceship.mesh.position, spaceship.speed, delta);
      
      const d = spaceship.mesh.position.distanceTo(p.group.position);
      if (d < minDist) {
          minDist = d;
          closestPlanet = p;
      }
    });

    if (lavaDragonFauna) {
      const focusPos = (surfaceWalker.active && surfaceWalker.root)
        ? surfaceWalker.root.position
        : spaceship.mesh.position;
      lavaDragonFauna.update(focusPos, spaceship.speed, delta);
    }
    
    // Atmósfera solo cerca de la superficie. En órbita / espacio: cielo negro
    // y sin niebla para que se vean los demás planetas a lo lejos.
    let inDeepSpace = true;
    if (closestPlanet) {
        const alt = minDist - closestPlanet.radius;
        const atmLimit = closestPlanet.radius * 0.12; // ~60k en Tierra
        inDeepSpace = alt >= atmLimit;
        
        if (alt < atmLimit && alt > -closestPlanet.radius * 0.05) {
            const t = THREE.MathUtils.clamp(Math.max(0, alt) / atmLimit, 0.0, 1.0);
            const blend = 1.0 - t * t;
            const isLava = closestPlanet.biome === 'Lava';

            const fogColor = _fogColor.setHex(closestPlanet.color).multiplyScalar(0.7);
            if (closestPlanet.biome === 'Terran') fogColor.setHex(0x6eb6ff);
            if (closestPlanet.biome === 'Toxic') fogColor.lerp(_toxicFogTint, 0.25);
            if (isLava) {
              // Bruma oscura / ceniza — no cielo rojo solido
              fogColor.setRGB(0.07, 0.035, 0.025).lerp(_lavaFogTint, 0.18);
            }

            const fogNear = THREE.MathUtils.lerp(
              closestPlanet.radius * (isLava ? 0.04 : 0.15),
              isLava ? 400 : 800,
              blend
            );
            const fogFar = THREE.MathUtils.lerp(
              closestPlanet.radius * (isLava ? 0.55 : 1.6),
              isLava ? 28000 : 70000,
              blend
            );

            _atmoFog.color.copy(fogColor);
            _atmoFog.near = fogNear;
            _atmoFog.far = fogFar;
            scene.fog = _atmoFog;

            if (isLava) {
              // Cielo casi negro con tinte calido; estrellas visibles
              scene.background = _atmoBackground.setRGB(0.02, 0.01, 0.008);
              setStarFieldOpacity(THREE.MathUtils.lerp(0.55, 0.2, blend));
              ambientLight.intensity = 0.28;
              ambientLight.color.setHex(0xffaa88);
              starlight.intensity = 0.22;
              starlight.color.setHex(0xffc8a0);
              sunLight.intensity = 6.2;
              sunLight.color.setHex(0xffe0c0);
              renderer.toneMappingExposure = 1.05;
            } else {
              scene.background = _atmoBackground.copy(fogColor).multiplyScalar(0.85 + blend * 0.15);
              setStarFieldOpacity(1.0 - blend);
              ambientLight.intensity = 0.55;
              ambientLight.color.setHex(0xffffff);
              starlight.intensity = 0.5;
              starlight.color.setHex(0xbfd8ff);
              sunLight.intensity = 5.0;
              sunLight.color.setHex(0xffffff);
              renderer.toneMappingExposure = 1.15;
            }
        } else {
            scene.fog = null;
            scene.background = _deepSpaceColor;
            setStarFieldOpacity(1.0);
            ambientLight.intensity = 0.48;
            ambientLight.color.setHex(0xffffff);
            starlight.intensity = 0.42;
            starlight.color.setHex(0xc8dcff);
            sunLight.intensity = 5.5;
            sunLight.color.setHex(0xffffff);
            renderer.toneMappingExposure = 1.15;
        }
    } else {
        scene.fog = null;
        scene.background = _deepSpaceColor;
        setStarFieldOpacity(1.0);
        ambientLight.intensity = 0.48;
        ambientLight.color.setHex(0xffffff);
        starlight.intensity = 0.42;
        sunLight.intensity = 5.5;
        sunLight.color.setHex(0xffffff);
        renderer.toneMappingExposure = 1.15;
    }

    // El texto DOM no necesita refrescarse a 60 Hz.
    if (time - lastHudTick > 0.2) {
      lastHudTick = time;
      updateLocationHud(closestPlanet, minDist);
    }

    // Ambiente sonoro (throttle ~5Hz — no saturar el audio thread)
    if (time - lastAmbientAudioTick > 0.2) {
      lastAmbientAudioTick = time;
      const nearPlanet = !!(closestPlanet && (minDist - closestPlanet.radius) < closestPlanet.radius * 0.08);
      const altAudio = closestPlanet ? (minDist - closestPlanet.radius) : 0;
      gameAudio.updateAmbient({
        mode: spaceship.mode,
        speed: spaceship.speed,
        nearPlanet,
        landed: !!spaceship.isLanded,
        onFoot: !!spaceship.onFoot,
        flameScale: spaceship.flameScale || 0,
        biome: closestPlanet?.biome || 'Terran',
        altitude: altAudio,
        weather: 0
      });
    }

    // El bloom fullscreen se activaba justo al entrar en la atmósfera y
    // duplicaba el coste de render cuando el LOD también estaba cargando.
    // Los materiales emisivos siguen brillando con tone mapping sin bloquear.
    renderer.render(scene, camera);
  } else {
    shipMarker.visible = true;

    // Update ship marker position to match spaceship
    shipMarker.position.copy(spaceship.mesh.position);

    renderer.render(scene, mapCamera);
  }

  // HUD Local Surface Minimap (hover o a pie)
  const showSurfaceRadar = !isMapMode
    && spaceship.hoverPlanet
    && (spaceship.mode === 'HOVER' || spaceship.onFoot || surfaceWalker.active);

  if (showSurfaceRadar) {
    if (minimapBorderEl) minimapBorderEl.style.display = 'block';

    // Radar 2D persistente: evita renderizar toda la escena por segunda vez.
    if (time - lastLocalMapRender > 0.1) {
      lastLocalMapRender = time;
      if (surfaceWalker.active) {
        _localMapForward.copy(surfaceWalker._fwd);
      } else {
        _localMapForward.set(0, 0, -1).applyQuaternion(spaceship.mesh.quaternion).normalize();
      }
      if (surfaceRadarCtx) {
        const ctx = surfaceRadarCtx;
        const W = 250;
        const cx = 125;
        const cy = 125;
        ctx.clearRect(0, 0, W, W);
        ctx.fillStyle = 'rgba(0, 18, 28, 0.92)';
        ctx.fillRect(0, 0, W, W);
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.28)';
        ctx.lineWidth = 1;
        for (const r of [42, 82, 120]) {
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(cx, 5); ctx.lineTo(cx, 245);
        ctx.moveTo(5, cy); ctx.lineTo(245, cy);
        ctx.stroke();

        // Rumbo-arriba: flecha fija; el mundo gira alrededor
        ctx.save();
        ctx.translate(cx, cy);
        ctx.fillStyle = '#7ffcff';
        ctx.beginPath();
        ctx.moveTo(0, -32);
        ctx.lineTo(11, 14);
        ctx.lineTo(0, 8);
        ctx.lineTo(-11, 14);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // Serpiente de lava en Mercurio
        const hp = spaceship.hoverPlanet;
        if (lavaDragonFauna && hp?.biome === 'Lava' && hp?.name === 'Mercurio') {
          const focusPos = (surfaceWalker.active && surfaceWalker.root)
            ? surfaceWalker.root.position
            : spaceship.mesh.position;
          _radarPlayerLocal.copy(focusPos);
          hp.group.worldToLocal(_radarPlayerLocal);
          _radarUp.copy(_radarPlayerLocal).normalize();

          _radarInv.copy(hp.group.matrixWorld).invert();
          _radarFwd.copy(_localMapForward).transformDirection(_radarInv);
          _radarFwd.addScaledVector(_radarUp, -_radarFwd.dot(_radarUp));
          if (_radarFwd.lengthSq() < 1e-8) {
            _radarFwd.set(0, 0, -1).transformDirection(_radarInv);
            _radarFwd.addScaledVector(_radarUp, -_radarFwd.dot(_radarUp));
          }
          _radarFwd.normalize();
          _radarRight.crossVectors(_radarFwd, _radarUp).normalize();

          const markers = lavaDragonFauna.getRadarMarkers();
          const pulse = 0.55 + 0.45 * Math.sin(time * 6);
          for (const m of markers) {
            _radarDelta.copy(m.local).sub(_radarPlayerLocal);
            _radarDelta.addScaledVector(_radarUp, -_radarDelta.dot(_radarUp));
            const dist = _radarDelta.length();
            const east = _radarDelta.dot(_radarRight);
            const north = _radarDelta.dot(_radarFwd);
            let px = cx + (east / RADAR_RANGE) * 120;
            let py = cy - (north / RADAR_RANGE) * 120;
            const dx = px - cx;
            const dy = py - cy;
            const rMax = 118;
            const r2 = dx * dx + dy * dy;
            let onEdge = false;
            if (r2 > rMax * rMax) {
              const r = Math.sqrt(r2) || 1;
              px = cx + (dx / r) * rMax;
              py = cy + (dy / r) * rMax;
              onEdge = true;
            }

            const col = m.submerged
              ? `rgba(255,160,70,${0.45 + pulse * 0.35})`
              : `rgba(255,70,30,${0.85 + pulse * 0.15})`;
            ctx.fillStyle = col;
            ctx.strokeStyle = '#ffe0a0';
            ctx.lineWidth = 2;
            ctx.beginPath();
            const markR = onEdge ? 9 : (dist < 600 ? 11 : 8);
            if (onEdge) {
              const ang = Math.atan2(dy, dx);
              ctx.save();
              ctx.translate(px, py);
              ctx.rotate(ang);
              ctx.moveTo(12, 0);
              ctx.lineTo(-7, 8);
              ctx.lineTo(-7, -8);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
              ctx.restore();
            } else {
              ctx.moveTo(px, py - markR);
              ctx.lineTo(px + markR * 0.85, py);
              ctx.lineTo(px, py + markR);
              ctx.lineTo(px - markR * 0.85, py);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
              // Anillo para que no se pierda cerca del centro
              ctx.beginPath();
              ctx.arc(px, py, markR + 5, 0, Math.PI * 2);
              ctx.strokeStyle = `rgba(255,180,80,${0.35 + pulse * 0.25})`;
              ctx.lineWidth = 1.5;
              ctx.stroke();
            }

            // Distancia SIEMPRE (para guiarte); nombre solo si no está encima)
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ffddaa';
            ctx.font = 'bold 11px monospace';
            ctx.fillText(`${Math.round(dist)}m`, px, py + markR + 14);
            if (dist >= DRAGON_RADAR_LABEL_DIST) {
              ctx.fillStyle = '#ffb080';
              ctx.font = 'bold 10px monospace';
              const label = m.submerged ? 'SERPIENTE ↓' : 'SERPIENTE';
              ctx.fillText(label, px, py - markR - 8);
            }
          }
        }
      }
    }
  } else {
    if (minimapBorderEl) minimapBorderEl.style.display = 'none';
  }

  // Guía en pantalla: solo lejos (cerca ya la ves)
  {
    const dragonMarker = document.getElementById('dragon-marker');
    const dragonDistEl = document.getElementById('dragon-distance');
    const hp = spaceship.hoverPlanet;
    const guideOk = !isMapMode
      && lavaDragonFauna
      && hp?.biome === 'Lava'
      && hp?.name === 'Mercurio'
      && (spaceship.mode === 'HOVER' || spaceship.onFoot || surfaceWalker.active);

    let shown = false;
    if (guideOk && dragonMarker) {
      const markers = lavaDragonFauna.getRadarMarkers();
      if (markers.length) {
        const m = markers[0];
        _radarWorld.copy(m.local);
        hp.group.localToWorld(_radarWorld);
        const focusPos = (surfaceWalker.active && surfaceWalker.root)
          ? surfaceWalker.root.position
          : spaceship.mesh.position;
        // Distancia sobre superficie (igual que el radar), no 3D cruda
        _radarPlayerLocal.copy(focusPos);
        hp.group.worldToLocal(_radarPlayerLocal);
        _radarUp.copy(_radarPlayerLocal).normalize();
        _radarDelta.copy(m.local).sub(_radarPlayerLocal);
        _radarDelta.addScaledVector(_radarUp, -_radarDelta.dot(_radarUp));
        const dist = _radarDelta.length();

        if (dist >= DRAGON_GUIDE_MIN_DIST) {
          if (dragonDistEl) {
            dragonDistEl.innerText = m.submerged
              ? `${Math.round(dist)}m · bajo lava`
              : `${Math.round(dist)}m`;
          }

          const ndc = _radarWorld.clone().project(camera);
          const behind = ndc.z > 1;
          let x = (ndc.x * 0.5 + 0.5) * window.innerWidth;
          let y = (ndc.y * -0.5 + 0.5) * window.innerHeight;
          const pad = 36;
          if (behind || x < pad || x > window.innerWidth - pad || y < pad || y > window.innerHeight - pad) {
            const cx = window.innerWidth * 0.5;
            const cy = window.innerHeight * 0.5;
            let dx = ndc.x;
            let dy = -ndc.y;
            if (behind) { dx = -dx; dy = -dy; }
            const len = Math.hypot(dx, dy) || 1;
            dx /= len; dy /= len;
            const rx = (window.innerWidth * 0.5) - pad;
            const ry = (window.innerHeight * 0.5) - pad;
            const scale = Math.min(rx / Math.abs(dx || 1e-6), ry / Math.abs(dy || 1e-6));
            x = cx + dx * scale;
            y = cy + dy * scale;
          }
          dragonMarker.style.display = 'block';
          dragonMarker.style.left = `${x}px`;
          dragonMarker.style.top = `${y}px`;
          shown = true;
        }
      }
    }
    if (dragonMarker && !shown) dragonMarker.style.display = 'none';
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

window.addEventListener('beforeunload', () => {
  if (!spaceship.isDead) saveShipPose();
});

animate();
