import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import GUI from 'lil-gui';

// Scene Setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 10, -40);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(20, 50, -20);
scene.add(dirLight);

// Grid Helper
const grid = new THREE.GridHelper(100, 100, 0x888888, 0x444444);
scene.add(grid);

// Load Model
let shipGroup = new THREE.Group();
scene.add(shipGroup);

const loader = new GLTFLoader();
loader.load('/nave1.glb', (gltf) => {
  const model = gltf.scene;
  // Compute bounding box and center the model just in case
  const box = new THREE.Box3().setFromObject(model);
  const center = new THREE.Vector3();
  box.getCenter(center);
  
  // Create an axes helper at the origin
  const axes = new THREE.AxesHelper(15);
  shipGroup.add(axes);
  
  shipGroup.add(model);
  
  // Setup Flames
  setupFlames();
});

let engineFlames = [];

function setupFlames() {
  const flameGeo = new THREE.ConeGeometry(1.3, 10, 8);
  flameGeo.translate(0, 5, 0); 
  flameGeo.rotateX(Math.PI / 2);
  
  const flameMat = new THREE.MeshBasicMaterial({ 
    color: 0xffaa00, 
    transparent: true, 
    opacity: 0.9, 
    blending: THREE.AdditiveBlending 
  });

  const state = {
    center_x: 0, center_y: 0.16, center_z: 11.55,
    inner_x: 1.56, inner_y: 2.14, inner_z: 13.5,
    outer_x: 5.26, outer_y: -0.58, outer_z: 13.5
  };

  const nozzleSettings = [
    { name: 'center', pos: new THREE.Vector3(state.center_x, state.center_y, state.center_z), scale: 1.8 },
    { name: 'innerL', pos: new THREE.Vector3(-state.inner_x, state.inner_y, state.inner_z), scale: 0.9 },
    { name: 'innerR', pos: new THREE.Vector3(state.inner_x, state.inner_y, state.inner_z), scale: 0.9 },
    { name: 'outerL', pos: new THREE.Vector3(-state.outer_x, state.outer_y, state.outer_z), scale: 2.1 },
    { name: 'outerR', pos: new THREE.Vector3(state.outer_x, state.outer_y, state.outer_z), scale: 2.1 }
  ];

  for (const setting of nozzleSettings) {
    const flame = new THREE.Mesh(flameGeo, flameMat.clone());
    flame.position.copy(setting.pos);
    flame.scale.setScalar(setting.scale);
    shipGroup.add(flame);
    engineFlames.push(flame);
  }

  // GUI
  const gui = new GUI({ title: 'Calibración de Turbinas' });
  
  const fCenter = gui.addFolder('Central');
  fCenter.add(state, 'center_x', -20, 20).onChange(v => engineFlames[0].position.x = v);
  fCenter.add(state, 'center_y', -20, 20).onChange(v => engineFlames[0].position.y = v);
  fCenter.add(state, 'center_z', 0, 30).onChange(v => engineFlames[0].position.z = v);
  
  const fInner = gui.addFolder('Interiores');
  fInner.add(state, 'inner_x', 0, 20).onChange(v => { engineFlames[1].position.x = -v; engineFlames[2].position.x = v; });
  fInner.add(state, 'inner_y', -20, 20).onChange(v => { engineFlames[1].position.y = v; engineFlames[2].position.y = v; });
  fInner.add(state, 'inner_z', 0, 30).onChange(v => { engineFlames[1].position.z = v; engineFlames[2].position.z = v; });
  
  const fOuter = gui.addFolder('Exteriores');
  fOuter.add(state, 'outer_x', 0, 20).onChange(v => { engineFlames[3].position.x = -v; engineFlames[4].position.x = v; });
  fOuter.add(state, 'outer_y', -20, 20).onChange(v => { engineFlames[3].position.y = v; engineFlames[4].position.y = v; });
  fOuter.add(state, 'outer_z', 0, 30).onChange(v => { engineFlames[3].position.z = v; engineFlames[4].position.z = v; });
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
