import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TerrainBuilder } from './planet/TerrainBuilder.js';

/**
 * Toberas medidas sobre el casco real de nave1.glb, en unidades DEL MODELO
 * (sin escalar). Se multiplican por shipVisualScale, así las llamas siempre
 * salen por el escape aunque cambies el tamaño de la nave.
 * El morro apunta a -Z y el escape a +Z.
 */
const NOZZLES_MODEL_SPACE = [
  { pos: [-5.71, -0.83, 11.90], scale: 1.90 }, // Motor grande izquierdo
  { pos: [5.71, -0.83, 11.90], scale: 1.90 },  // Motor grande derecho
  { pos: [0.00, -0.48, 12.98], scale: 1.24 },  // Motor central
  { pos: [-1.48, 1.07, 11.31], scale: 0.67 },  // Auxiliar superior izquierdo
  { pos: [1.48, 1.07, 11.31], scale: 0.67 }    // Auxiliar superior derecho
];

export class Spaceship {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;

    // ====== TAMAÑO DE LA NAVE ======
    // Único número que controla el tamaño. Todo lo demás (toberas, llamas,
    // cámara y altura de vuelo estacionario) se deriva de aquí.
    this.shipVisualScale = 42;

    // Create ship container
    this.mesh = new THREE.Group();
    // Start at Z = 15000 so we are well outside the first planet (Radius 10000)
    this.mesh.position.set(0, 0, 15000);
    this.scene.add(this.mesh);
    this.headlightCooldown = 0;
    
    // Ship Health System
    this.maxHp = 100;
    this.hp = 100;
    this.isDead = false;
    this.lastDamageTime = 0;
    this.updateHealthUI();

    // Load custom GLB Model
    const loader = new GLTFLoader();
    loader.load('/nave1.glb', (gltf) => {
      const model = gltf.scene;
      model.scale.setScalar(this.shipVisualScale);
      // model.rotation.y = Math.PI; // Adjust if the model is backwards
      this.mesh.add(model);
    });
    
    // Headlights (Spotlights for Night Navigation)
    this.headlights = new THREE.Group();
    
    const createHeadlight = (xOffset) => {
        const spotLight = new THREE.SpotLight(0xffffff, 5); // Intense white light
        spotLight.position.set(xOffset, -1, 5); // slightly below and forward
        spotLight.angle = Math.PI / 6; // 30 degrees cone
        spotLight.penumbra = 0.5; // soft edges
        spotLight.decay = 1.5; // Realistic falloff
        spotLight.distance = 15000; // Far reach for massive planets
        
        // Target needs to be added to the scene or a parent, and pushed forward
        const target = new THREE.Object3D();
        target.position.set(xOffset, -5, 100);
        this.mesh.add(target);
        spotLight.target = target;
        
        return spotLight;
    };
    
    this.leftHeadlight = createHeadlight(-3);
    this.rightHeadlight = createHeadlight(3);
    this.headlights.add(this.leftHeadlight);
    this.headlights.add(this.rightHeadlight);
    
    // Start with headlights on
    this.headlightsActive = true;
    this.mesh.add(this.headlights);
    
    // --- Re-entry Plasma Shield ---
    // Make the cone openEnded (true) so the flat circular base is removed, preventing it from looking like a weird planet from behind.
    const shieldGeom = new THREE.ConeGeometry(10, 25, 32, 1, true);
    shieldGeom.rotateX(-Math.PI / 2); // Point tip forward along Z
    
    const shieldVert = `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        }
    `;
    const shieldFrag = `
        varying vec2 vUv;
        uniform float time;
        uniform float intensity;
        
        float hash(vec2 p) { return fract(1e4 * sin(17.0 * p.x + p.y * 0.1) * (0.1 + abs(sin(p.y * 13.0 + p.x)))); }
        float noise(vec2 x) {
            vec2 i = floor(x);
            vec2 f = fract(x);
            float a = hash(i);
            float b = hash(i + vec2(1.0, 0.0));
            float c = hash(i + vec2(0.0, 1.0));
            float d = hash(i + vec2(1.0, 1.0));
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        
        void main() {
            vec2 uv = vUv;
            uv.y -= time * 4.0; // Fast flowing plasma flowing backward
            
            float n = noise(uv * 10.0);
            float n2 = noise(uv * 20.0 + vec2(time));
            
            float fire = (n * 0.5 + n2 * 0.5);
            
            // Mask to concentrate fire at the tip (uv.y goes 0 to 1)
            float mask = smoothstep(0.1, 0.9, vUv.y);
            
            vec3 color = mix(vec3(1.0, 0.1, 0.0), vec3(1.0, 0.7, 0.1), fire);
            color = mix(color, vec3(0.5, 0.8, 1.0), smoothstep(0.8, 1.0, fire * mask)); // Blue hot core
            
            float alpha = fire * mask * intensity;
            gl_FragColor = vec4(color, alpha);
        }
    `;
    
    this.shieldUniforms = {
        time: { value: 0 },
        intensity: { value: 0 }
    };
    
    const shieldMat = new THREE.ShaderMaterial({
        vertexShader: shieldVert,
        fragmentShader: shieldFrag,
        uniforms: this.shieldUniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    
    this.plasmaShield = new THREE.Mesh(shieldGeom, shieldMat);
    this.plasmaShield.position.set(0, 0, 5); // Shift forward to cover cockpit
    this.plasmaShield.visible = false;
    this.mesh.add(this.plasmaShield);
    
    // Exhaust: solo partículas (glow suave). Sin conos geométricos.
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    gradient.addColorStop(0.12, 'rgba(255, 250, 230, 1.0)');
    gradient.addColorStop(0.35, 'rgba(140, 220, 255, 0.7)');
    gradient.addColorStop(0.65, 'rgba(50, 140, 255, 0.28)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);

    const particleTexture = new THREE.CanvasTexture(canvas);
    const particleMat = new THREE.SpriteMaterial({
      map: particleTexture,
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    });

    this.engineParticles = [];
    this._freeParticles = [];
    // 96 sprites bastan para una estela densa; 220 podían convertirse en
    // cientos de draw calls transparentes durante el turbo.
    for (let i = 0; i < 96; i++) {
      const sprite = new THREE.Sprite(particleMat.clone());
      sprite.visible = false;
      sprite.frustumCulled = false;
      const slot = {
        mesh: sprite,
        life: 0,
        maxLife: 0,
        velocity: new THREE.Vector3(),
        baseScale: 1
      };
      this.engineParticles.push(slot);
      this._freeParticles.push(slot);
    }

    // Toberas en espacio de modelo × escala; un poco más atrás (+Z) para
    // que el plasma nazca fuera del casco y no quede enterrado.
    const s = this.shipVisualScale;
    this.nozzleSettings = NOZZLES_MODEL_SPACE.map(n => ({
      pos: new THREE.Vector3(n.pos[0] * s, n.pos[1] * s, n.pos[2] * s + s * 0.35),
      scale: n.scale * s
    }));
    
    // Add a glowing point light to the engine (Disabled to prevent ghost flashes when camera swings)
    // this.engineLight = new THREE.PointLight(0x00aaff, 4, 150 * 2.5);
    // this.engineLight.position.set(0, -15, 50);
    // this.mesh.add(this.engineLight);
    
    // Velocidades: W = crucero jugable; Shift/hiper = viaje.
    // Antes W llegaba a 250k y regeneraba terreno/hierba → lag.
    this.speed = 0;
    this.maxSpeed = 90000;
    this.cruiseMaxSpeed = 14000;
    this.acceleration = 9000;
    this.rotationSpeed = 2.0; // rad/sec
    
    // We attach a dummy object for the camera to follow
    this.cameraBoom = new THREE.Object3D();
    this.mesh.add(this.cameraBoom);
    // La cámara se aleja en proporción al tamaño de la nave
    this.cameraDistance = this.shipVisualScale * 13.3;
    this.cameraBoom.position.set(0, this.shipVisualScale * 3.8, this.cameraDistance);
    
    // Mouse input accumulators
    this.pitchAccumulator = 0;
    this.yawAccumulator = 0;
    
    this.mode = 'FLIGHT'; // 'FLIGHT' or 'HOVER'
    this.isLanded = false;
    this.hoverPlanet = null; // Planet data for anchoring
    this.hoverHeightOffset = this.shipVisualScale * 6; // Planeo en hover activo
    this.landedHoverOffset = this.shipVisualScale * 3.6; // Levitación baja: se puede subir a pie
    this.boardHoverOffset = this.shipVisualScale * 2.8; // Aún más baja con piloto fuera
    this.canAutoAnchor = true; // Prevents re-anchoring immediately after takeoff
    this._hoverBobPhase = 0;
    this._landedLocalDir = null;
    this._currentLandedAlt = this.landedHoverOffset;
    this._anchorInvQ = new THREE.Quaternion();
    this._anchorWorldUp = new THREE.Vector3();
    this._anchorTarget = new THREE.Vector3();
    this._anchorDelta = new THREE.Vector3();
    this._anchorOldPos = new THREE.Vector3();
    this.onFoot = false; // SurfaceWalker owns camera/movement when true

    // Halo de levitación bajo la nave (piloto automático manteniendo altura)
    const hoverCanvas = document.createElement('canvas');
    hoverCanvas.width = 128;
    hoverCanvas.height = 128;
    const hctx = hoverCanvas.getContext('2d');
    const hgrad = hctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    hgrad.addColorStop(0, 'rgba(120, 220, 255, 0.95)');
    hgrad.addColorStop(0.35, 'rgba(40, 160, 255, 0.45)');
    hgrad.addColorStop(1, 'rgba(0, 40, 80, 0)');
    hctx.fillStyle = hgrad;
    hctx.fillRect(0, 0, 128, 128);
    const hoverTex = new THREE.CanvasTexture(hoverCanvas);
    this.hoverPad = new THREE.Mesh(
      new THREE.CircleGeometry(18, 32),
      new THREE.MeshBasicMaterial({
        map: hoverTex,
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    this.hoverPad.rotation.x = -Math.PI / 2;
    this.hoverPad.position.set(0, -8, 5);
    this.hoverPad.visible = false;
    this.mesh.add(this.hoverPad);
    
    // Autopilot
    this.autoTarget = null; // { type: 'planet'|'player', obj: Ref }
    this.autopilotEngaged = false;
    this.inGravityWell = false; // Tracks if we are inside planetary gravity
    
    // Combat
    this.hp = 100;
    this.isDead = false;
    
    // Ensure the entire ship ignores frustum culling so it never disappears!
    this.mesh.traverse((child) => {
        if (child.isMesh || child.isSprite) {
            child.frustumCulled = false;
        }
    });
  }

  onMouseMove(movementX, movementY) {
    const mouseSensitivity = 0.002;
    
    this.yawAccumulator -= movementX * mouseSensitivity;
    this.pitchAccumulator -= movementY * mouseSensitivity;
  }

  onScroll(deltaY) {
    // Zoom sensitivity (much faster now)
    this.cameraDistance += deltaY * 0.15;
    // Limit how close or far the camera can go (Allow extreme zoom out up to 3000)
    this.cameraDistance = Math.max(10, Math.min(this.cameraDistance, 3000));
    // Update the boom position (keeping the height offset roughly proportional or static)
    this.cameraBoom.position.z = this.cameraDistance;
    this.cameraBoom.position.y = this.cameraDistance * 0.25; 
  }

  takeDamage(amount) {
      if (this.isDead) return;
      
      // Invincibility frames (0.5s) to prevent instant death from scraping
      const now = Date.now();
      if (now - this.lastDamageTime < 500) return;
      this.lastDamageTime = now;
      
      this.hp -= amount;
      if (this.hp < 0) this.hp = 0;
      
      this.updateHealthUI();
      
      const overlay = document.getElementById('damage-overlay');
      if (overlay) {
          overlay.style.opacity = '1';
          setTimeout(() => { overlay.style.opacity = '0'; }, 300);
      }
      
      if (this.hp <= 0) {
          this.die();
      }
  }
  
  updateHealthUI() {
      const fill = document.getElementById('health-fill');
      const text = document.getElementById('health-text');
      if (fill && text) {
          const pct = (this.hp / this.maxHp) * 100;
          fill.style.width = pct + '%';
          text.innerText = 'HP: ' + Math.ceil(this.hp);
          
          if (pct < 30) {
              fill.style.backgroundColor = '#ff0000';
          } else if (pct < 60) {
              fill.style.backgroundColor = '#ffaa00';
          } else {
              fill.style.backgroundColor = '#00ffcc';
          }
      }
  }
  
  die() {
      this.isDead = true;
      this.speed = 0;
      this.mesh.visible = false;
      
      // Massive explosion
      if (window.createSparks) {
          window.createSparks(this.mesh.position, new THREE.Vector3(0,1,0), 2000);
      }
      
      const deathScreen = document.getElementById('death-screen');
      if (deathScreen) deathScreen.style.display = 'flex';
      
      setTimeout(() => this.respawn(), 3000);
  }
  
  respawn() {
      this.hp = this.maxHp;
      this.isDead = false;
      this.mesh.visible = true;
      this.updateHealthUI();
      
      // Siempre cerca de la Tierra (nunca junto al Sol)
      if (typeof window.spawnAtEarth === 'function') {
        window.spawnAtEarth();
      } else {
        this.mesh.position.set(60000000 + 1250000, 80000, 0);
        this.mesh.lookAt(60000000, 0, 0);
      }
      this.speed = 0;
      this.yawAccumulator = 0;
      this.pitchAccumulator = 0;
      
      const deathScreen = document.getElementById('death-screen');
      if (deathScreen) deathScreen.style.display = 'none';
  }

  update(delta, keys) {
    if (this.isDead) return;
    if (this.onFoot) {
      // Ship stays in levitation; walker handles camera + movement
      if (this.mode === 'HOVER' && this.isLanded) {
        this.updateLanded(delta, {});
      }
      return;
    }
    if (this.mode === 'FLIGHT') {
      this.updateFlight(delta, keys);
    } else if (this.mode === 'HOVER') {
      if (!this.isLanded) {
        this.updateHover(delta, keys);
        if (this.hoverPad) {
          this.hoverPad.visible = false;
          this.hoverPad.material.opacity = 0;
        }
      } else {
        this.updateLanded(delta, keys);
      }
    }
    
    // Toggle Headlights
    if (this.headlightCooldown > 0) this.headlightCooldown -= delta;
    if (keys['h'] && this.headlightCooldown <= 0) {
        this.headlightsActive = !this.headlightsActive;
        this.headlights.visible = this.headlightsActive;
        this.headlightCooldown = 0.5; // Half second cooldown
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

    // Shift abre el campo de visión como un golpe de aceleración perceptible.
    const shiftHeld = !!keys[window.GameConfig.keys.hyperdrive];
    const targetFov = this.mode === 'FLIGHT' && shiftHeld ? 82 : 75;
    const nextFov = THREE.MathUtils.damp(this.camera.fov, targetFov, shiftHeld ? 9 : 5, delta);
    if (Math.abs(nextFov - this.camera.fov) > 0.01) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
    
    // Smooth camera lookat
    // We need the actual world UP vector of the ship, not the default (0,1,0)
    const shipWorldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.mesh.quaternion).normalize();
    
    const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(this.camera.position, idealLookAt, shipWorldUp)
    );
    this.camera.quaternion.slerp(targetQuaternion, 0.2); // Smooth turning
    
  }

  updateFlight(delta, keys) {
    // Engine visual defaults
    let targetFlameScale = 0.35; // Idle: brasa mínima (menos GPU en espacio)
    let targetFlameColor = 0x3a9fff;
    let currentMaxSpeed = this.cruiseMaxSpeed;
    
    // Disengage autopilot if user manually steers or throttles
    const conf = window.GameConfig.keys;
    if (this.autopilotEngaged && (keys[conf.forward] || keys[conf.backward] || keys[conf.rollLeft] || keys[conf.rollRight])) {
      this.autopilotEngaged = false;
      const statusUI = document.getElementById('autopilot-status');
      if (statusUI) {
        statusUI.innerText = 'STANDBY';
        statusUI.className = 'autopilot-status';
      }
    }
    
    if (this.autopilotEngaged && this.autoTarget) {
      // Autopilot Logic
      let targetPos = new THREE.Vector3();
      let isPlayer = this.autoTarget.type === 'player';
      
      if (this.autoTarget.type === 'planet') {
        const planetCenter = this.autoTarget.obj.group.position;
        const dirToPlanet = new THREE.Vector3().subVectors(planetCenter, this.mesh.position).normalize();
        // Target is High Orbit (Radius + 20000 units above surface)
        const orbitRadius = this.autoTarget.obj.radius + 20000;
        targetPos.copy(planetCenter).sub(dirToPlanet.multiplyScalar(orbitRadius));
      } else if (isPlayer) {
        if (!this._lastFriendPos) {
            this._lastFriendPos = this.autoTarget.obj.mesh.position.clone();
            this._smoothedFriendVel = new THREE.Vector3();
            this._formationForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.autoTarget.obj.mesh.quaternion);
        }
        
        const safeDelta = delta > 0 ? delta : 0.016;
        // Medimos la velocidad LINEAL del amigo (ignorando si rota sobre sí mismo)
        const rawFriendVel = new THREE.Vector3().subVectors(this.autoTarget.obj.mesh.position, this._lastFriendPos).divideScalar(safeDelta);
        this._lastFriendPos.copy(this.autoTarget.obj.mesh.position);
        
        // Suavizado EMA para la velocidad del amigo
        this._smoothedFriendVel.lerp(rawFriendVel, 10.0 * safeDelta); 
        
        // Actualizar el vector frontal de formación SÓLO si la nave amiga se está moviendo.
        if (this._smoothedFriendVel.lengthSq() > 10.0) {
            this._formationForward.copy(this._smoothedFriendVel).normalize();
        }
        
        // Evitar el error de lookAt (NaNs) cuando se mira exactamente hacia arriba o abajo
        const upVector = new THREE.Vector3(0, 1, 0);
        if (Math.abs(this._formationForward.y) > 0.99) {
            upVector.set(0, 0, 1);
        }
        
        // Construimos la rotación de formación basada en el vector de movimiento real
        const lookMatrix = new THREE.Matrix4();
        lookMatrix.lookAt(new THREE.Vector3(0,0,0), this._formationForward, upVector);
        const formationQuat = new THREE.Quaternion().setFromRotationMatrix(lookMatrix);
        
        // Apuntar atrás y a la derecha de la nave amiga para volar en formación
        // X=40 (derecha), Y=15 (arriba), Z=60 (atrás, asumiendo -Z frontal)
        const formationOffset = new THREE.Vector3(40, 15, 60).applyQuaternion(formationQuat);
        targetPos.copy(this.autoTarget.obj.mesh.position).add(formationOffset);
      } 
      
      const positionError = new THREE.Vector3().subVectors(targetPos, this.mesh.position);
      const dist = positionError.length();
      
      // Usar la velocidad suavizada si existe (para naves), de lo contrario 0 (para planetas)
      const feedForwardVel = this._smoothedFriendVel || new THREE.Vector3(0, 0, 0);
      
      // Controlador PD con Kp más suave. 
      // Kp bajo (0.8) hace que la nave no pegue acelerones violentos si el offset salta de golpe.
      const kP = 0.8; 
      const desiredVelocity = positionError.clone().multiplyScalar(kP).add(feedForwardVel);
      const desiredSpeed = desiredVelocity.length();
      
      if (desiredSpeed > 1.0) {
          // Apuntar directamente hacia el vector de velocidad deseado.
          // Al llegar al punto (Error=0), desiredVelocity = Velocidad del amigo.
          // Por lo tanto, nos alinearemos solos de forma natural, sin forzar slerp de rotaciones.
          const lookTarget = this.mesh.position.clone().add(desiredVelocity);
          const lookMatrix = new THREE.Matrix4();
          lookMatrix.lookAt(this.mesh.position, lookTarget, this.mesh.up);
          const targetQuat = new THREE.Quaternion().setFromRotationMatrix(lookMatrix);
          
          const turnRate = dist < 200 ? 6.0 : 3.0;
          this.mesh.quaternion.slerp(targetQuat, turnRate * delta);
          
          this.speed = THREE.MathUtils.lerp(this.speed, desiredSpeed, delta * 3.0);
      } else {
          this.speed = THREE.MathUtils.lerp(this.speed, 0, delta * 4.0);
      }
      
      targetFlameScale = this.speed > 800 ? 1.5 : (this.speed > 50 ? 1.0 : 0.2);
      targetFlameColor = this.speed > 800 ? 0xffaa00 : 0x00ffff;
      
      // Reset accumulators so manual mouse doesn't jerk the ship upon disengage
      this.yawAccumulator = 0;
      this.pitchAccumulator = 0;
      
    } else {
      // Manual Thrust
      const conf = window.GameConfig.keys;
      
      if (keys[conf.forward]) {
        this.speed += this.acceleration * delta;
        targetFlameScale = 1.55; // Crucero: chorro claro
        targetFlameColor = 0x55e0ff;
      } else if (keys[conf.backward]) {
        this.speed -= this.acceleration * delta;
        targetFlameScale = 0.0;
      } else {
        this.speed *= 0.98; // Drag
      }
      
      if (keys[conf.hyperdrive]) {
        if (this.inGravityWell) {
          // Shift conserva fuerza cerca de planetas, pero con límite seguro
          // para no disparar la generación de terreno.
          this.speed += this.acceleration * 18 * delta;
          targetFlameScale = 3.2;
          targetFlameColor = 0xff44ff; 
          currentMaxSpeed = this.maxSpeed * 3;
        } else {
          this.speed += this.acceleration * 120 * delta;
          targetFlameScale = 3.6;
          targetFlameColor = 0xff44ff; 
          currentMaxSpeed = this.maxSpeed * 9;
        }
      } else if (keys[conf.boost]) {
        this.speed += this.acceleration * 5 * delta;
        // Shift: claramente más fuerte que W (más largo, denso y caliente)
        targetFlameScale = 2.45;
        targetFlameColor = 0xffaa33;
        currentMaxSpeed = this.maxSpeed * 1.6;
      }
      
      // Apply accumulated mouse rotations
      this.mesh.rotateY(this.yawAccumulator);
      this.mesh.rotateX(this.pitchAccumulator);
      
      // Dampen mouse movement (friction) so it doesn't spin forever
      this.yawAccumulator *= 0.5;
      this.pitchAccumulator *= 0.5;
      
      // Roll
      if (keys[conf.rollLeft]) {
        this.mesh.rotateZ(this.rotationSpeed * delta);
      }
      if (keys[conf.rollRight]) {
        this.mesh.rotateZ(-this.rotationSpeed * delta);
      }
    }
    
    // Move forward
    this.mesh.translateZ(-this.speed * delta);
    
    // Update shield time
    if (this.shieldUniforms) {
        this.shieldUniforms.time.value += 0.016; // Approx 60fps delta
    }

    // Clamp speed
    this.speed = Math.max(-this.maxSpeed * 0.2, Math.min(this.speed, currentMaxSpeed));
    
    // Save for network telemetry
    this.flameScale = targetFlameScale;
    
    this.updateParticles(delta, targetFlameScale, targetFlameColor);
  }

  updateParticles(delta, targetFlameScale, targetFlameColor) {
    // Tiers claros: idle < W < Space < Shift.
    const thrust = Math.min(Math.max(targetFlameScale, 0), 3.6);
    if (thrust > 0.02) {
      const es = this.shipVisualScale / 9.5;
      const bursts = Math.max(1, Math.min(4, Math.floor(1 + thrust * 1.25)));
      for (let i = 0; i < bursts; i++) {
        const p = this._freeParticles.pop();
        if (!p) break;

        const nozzle = this.nozzleSettings[Math.floor(Math.random() * this.nozzleSettings.length)];
        p.mesh.position.copy(nozzle.pos);
        p.mesh.position.x += (Math.random() - 0.5) * nozzle.scale * 0.2;
        p.mesh.position.y += (Math.random() - 0.5) * nozzle.scale * 0.2;

        if (p.mesh.parent !== this.mesh) this.mesh.add(p.mesh);
        p.mesh.visible = true;
        p.life = 0.2 + Math.random() * 0.16 + thrust * 0.09;
        p.maxLife = p.life;

        p.velocity.set(
          (Math.random() - 0.5) * (4 + thrust) * es,
          (Math.random() - 0.5) * (4 + thrust) * es,
          (32 + Math.random() * 16 + thrust * 48) * es
        );

        const sizeMul = Math.min(1.12, 0.5 + thrust * 0.2);
        p.baseScale = nozzle.scale * sizeMul;
        p.mesh.material.color.setHex(targetFlameColor);
        p.mesh.material.opacity = Math.min(1, 0.75 + thrust * 0.08);
      }
    }

    for (const p of this.engineParticles) {
      if (p.life <= 0) continue;
      p.life -= delta;
      p.mesh.position.addScaledVector(p.velocity, delta);

      const lifeRatio = Math.max(0, p.life / p.maxLife);
      const scale = p.baseScale * (0.5 + lifeRatio * 0.75);
      p.mesh.scale.set(scale, scale, scale);
      p.mesh.material.opacity = lifeRatio * Math.min(1, 0.7 + lifeRatio * 0.3);

      if (p.life <= 0) {
        p.mesh.visible = false;
        this.mesh.remove(p.mesh);
        this._freeParticles.push(p);
      }
    }
  }

  toggleLanding() {
    if (this.mode !== 'HOVER') return;
    if (this.onFoot) return;
    
    // Solo aterrizar con L. Despegar = mirar arriba estando aterrizado / en hover.
    // (Antes L alternaba y, con el pitch del ratón, te lanzaba a speed 1000.)
    if (this.isLanded) return;

    this.isLanded = true;
    this.speed = 0;
    this.pitchAccumulator = 0;
    this.yawAccumulator = 0;
    this._landedLocalDir = null; // se captura en el primer updateLanded
    
    const statusUI = document.getElementById('autopilot-status');
    if (statusUI) {
        statusUI.innerText = 'LEVITACIÓN AUTO  ·  [L] o [E] bajar a pie';
        statusUI.className = 'autopilot-status';
    }
  }

  /** Despegue controlado desde levitación (sin el bug del acelerón). */
  requestTakeoff(toFlight = false) {
    if (this.onFoot || this.mode !== 'HOVER') return;
    this.isLanded = false;
    this._landedLocalDir = null;
    this.pitchAccumulator = 0;
    if (this.hoverPad) {
      this.hoverPad.visible = false;
      this.hoverPad.material.opacity = 0;
    }
    if (toFlight) {
      this.mode = 'FLIGHT';
      this.hoverPlanet = null;
      this.canAutoAnchor = false;
      this.speed = Math.max(this.speed, 350); // suave, no 1000
    }
    const statusUI = document.getElementById('autopilot-status');
    if (statusUI) {
      statusUI.innerText = toFlight ? 'DESPEGUE' : 'HOVER';
      statusUI.className = 'autopilot-status';
    }
  }

  updateLanded(delta, keys) {
    // Estacionamiento estable en coordenadas locales del planeta.
    if (!this.hoverPlanet) return;

    if (!this._landedLocalDir) {
      this._landedLocalDir = new THREE.Vector3()
        .subVectors(this.mesh.position, this.hoverPlanet.group.position)
        .normalize()
        .applyQuaternion(this._anchorInvQ.copy(this.hoverPlanet.group.quaternion).invert());
    }

    this._hoverBobPhase += delta * 1.1;
    // Con el piloto a pie, la nave baja para poder volver a subir
    const baseAlt = this.onFoot ? this.boardHoverOffset : this.landedHoverOffset;
    const bob = Math.sin(this._hoverBobPhase) * (this.onFoot ? 0.4 : 1.0);
    this._currentLandedAlt = THREE.MathUtils.damp(
      this._currentLandedAlt || baseAlt,
      baseAlt + bob,
      this.onFoot ? 3.5 : 6,
      delta
    );
    this.syncLandedToPlanetTransform();
    const surfaceNormal = this._anchorWorldUp;

    // Alineación con el terreno
    const upVector = surfaceNormal;
    const shipForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.mesh.quaternion);
    const right = new THREE.Vector3().crossVectors(shipForward, upVector).normalize();
    const correctedForward = new THREE.Vector3().crossVectors(upVector, right).normalize();
    const targetRotation = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), correctedForward, upVector);
    this.mesh.quaternion.slerp(new THREE.Quaternion().setFromRotationMatrix(targetRotation), 0.1);

    // Efecto visual: halo suave (menos “sucio” / bloom)
    if (this.hoverPad) {
      if (this.onFoot) {
        this.hoverPad.visible = false;
        this.hoverPad.material.opacity = 0;
      } else {
        this.hoverPad.visible = true;
        const pulse = 0.18 + 0.08 * Math.sin(this._hoverBobPhase * 1.4);
        this.hoverPad.material.opacity = pulse;
        this.hoverPad.scale.set(1, 1, 1);
      }
    }
    this.flameScale = this.onFoot ? 0.12 : (0.32 + 0.08 * Math.sin(this._hoverBobPhase * 2.0));
    this.updateParticles(delta, this.flameScale, 0x44ccff);

    // Mirar arriba = despegar a hover (luego sigue tirando para salir a espacio)
    if (this.pitchAccumulator > 0.08) {
      this.requestTakeoff(false);
      this.pitchAccumulator = 0;
      return;
    }

    const statusUI = document.getElementById('autopilot-status');
    if (statusUI && !statusUI.innerText.includes('A PIE') && !statusUI.innerText.includes('bajar a pie')) {
      statusUI.innerText = 'LEVITACIÓN AUTO  ·  [L]/[E] a pie  ·  mira arriba para despegar';
      statusUI.className = 'autopilot-status';
    }
  }

  syncLandedToPlanetTransform() {
    if (!this.isLanded || !this.hoverPlanet || !this._landedLocalDir) return;
    this._anchorOldPos.copy(this.mesh.position);
    const terrainHeight = TerrainBuilder.getHeight(
      this._landedLocalDir,
      this.hoverPlanet.radius,
      this.hoverPlanet.biome,
      true
    );
    this._anchorWorldUp.copy(this._landedLocalDir)
      .applyQuaternion(this.hoverPlanet.group.quaternion)
      .normalize();
    this._anchorTarget.copy(this.hoverPlanet.group.position)
      .addScaledVector(this._anchorWorldUp, terrainHeight + this._currentLandedAlt);
    this.mesh.position.copy(this._anchorTarget);

    // La cámara conserva exactamente la misma separación al co-rotar.
    this._anchorDelta.subVectors(this.mesh.position, this._anchorOldPos);
    if (!this.onFoot) this.camera.position.add(this._anchorDelta);
  }

  updateHover(delta, keys) {
    if (!this.hoverPlanet) return;
    
    const conf = window.GameConfig.keys;
    
    // Mirar arriba con fuerza = salir a espacio (velocidad moderada)
    if (this.pitchAccumulator > 0.08) {
      this.requestTakeoff(true);
      return; 
    }
    
    // --- Anchor Ship to Rotating Planet ---
    // El planeta gira a 0.005 * universalTime, por lo que su delta de rotación es 0.005 * delta.
    // Esto asegura que la nave rote con el planeta y el terreno no se mueva como una cinta de correr.
    const planetRotDelta = 0.005 * delta;
    this.mesh.position.sub(this.hoverPlanet.group.position);
    this.mesh.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), planetRotDelta);
    this.mesh.position.add(this.hoverPlanet.group.position);
    this.mesh.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), planetRotDelta);
    
    // Apply mouse rotations
    this.mesh.rotateY(this.yawAccumulator);
    this.mesh.rotateX(this.pitchAccumulator);
    
    // Dampen mouse movement
    this.yawAccumulator *= 0.5;
    this.pitchAccumulator *= 0.5;
    
    // Roll (Atmosphere has more air resistance, slower roll)
    if (keys[conf.rollLeft]) {
      this.mesh.rotateZ((this.rotationSpeed * 0.8) * delta);
    }
    if (keys[conf.rollRight]) {
      this.mesh.rotateZ((-this.rotationSpeed * 0.8) * delta);
    }
    
    // Hover / Atmospheric speed logic
    let currentMaxSpeed = this.maxSpeed * 0.2; // Slower in atmosphere
    let targetFlameScale = (this.speed > 0) ? (this.speed / currentMaxSpeed) * 1.5 : 0.1;
    let targetFlameColor = 0x00ffff;
    
    if (keys[conf.hyperdrive]) {
      this.speed += this.acceleration * 8 * delta;
      currentMaxSpeed = this.maxSpeed * 3;
      targetFlameScale = 2.5;
      targetFlameColor = 0xff44ff;
    } else if (keys[conf.boost]) {
      this.speed += this.acceleration * 4 * delta;
      currentMaxSpeed = this.maxSpeed;
      targetFlameScale = 2.3;
      targetFlameColor = 0xffaa33;
    } else if (keys[conf.forward]) {
      this.speed += this.acceleration * 2 * delta;
    } else if (keys[conf.backward]) {
      this.speed -= this.acceleration * 2 * delta;
    } else {
      // Air friction
      this.speed = THREE.MathUtils.lerp(this.speed, 0, delta * 1.5);
    }
    
    this.speed = Math.max(-currentMaxSpeed * 0.2, Math.min(this.speed, currentMaxSpeed));
    this.flameScale = targetFlameScale;
    this.updateParticles(delta, targetFlameScale, targetFlameColor);
    
    // Move forward locally
    this.mesh.translateZ(-this.speed * delta);
    
    // --- Atmospheric Gravity & Terrain Collision ---
    const pCenter = this.mesh.position.clone();
    const toCore = new THREE.Vector3().subVectors(pCenter, this.hoverPlanet.group.position).normalize();
    
    // Muestreo de altura procedural para el centro
    const invQuat = this.hoverPlanet.group.quaternion.clone().invert();
    const localDir = new THREE.Vector3().subVectors(this.mesh.position, this.hoverPlanet.group.position).normalize().applyQuaternion(invQuat);
    const terrainHeight = TerrainBuilder.getHeight(localDir, this.hoverPlanet.radius, this.hoverPlanet.biome, true);
    
    const targetDist = terrainHeight + this.hoverHeightOffset;
    const currentDist = this.mesh.position.distanceTo(this.hoverPlanet.group.position);
    
    // Gentle Gravity Pull (Solo se aplica si estamos flotando muy alto, evita que la nave rebote/tiemble al aterrizar)
    if (currentDist > targetDist + 1.0) {
        this.mesh.position.add(toCore.clone().multiplyScalar(-600 * delta));
    }
    
    // Si la nave está a punto de estrellarse (por debajo del offset de planeo)
    if (currentDist < targetDist) {
      // Repulsive force to keep it above ground
      const targetPosition = this.hoverPlanet.group.position.clone().add(toCore.clone().multiplyScalar(targetDist));
      this.mesh.position.copy(targetPosition);
      
      // Auto-level the ship slightly so it doesn't nosedive directly into the dirt
      const currentForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.mesh.quaternion).normalize();
      
      // Multi-Raycast para inclinar con el terreno solo si estamos rozando el suelo
      const offsetDist = 200; 
      const shipForwardVec = new THREE.Vector3(0, 0, -1).applyQuaternion(this.mesh.quaternion).normalize();
      const shipRightVec = new THREE.Vector3(1, 0, 0).applyQuaternion(this.mesh.quaternion).normalize();
      
      const pForward = this.mesh.position.clone().add(shipForwardVec.clone().multiplyScalar(offsetDist));
      const pRight = this.mesh.position.clone().add(shipRightVec.clone().multiplyScalar(offsetDist));
      
      const hForward = TerrainBuilder.getHeight(new THREE.Vector3().subVectors(pForward, this.hoverPlanet.group.position).normalize().applyQuaternion(invQuat), this.hoverPlanet.radius, this.hoverPlanet.biome, true);
      const hRight = TerrainBuilder.getHeight(new THREE.Vector3().subVectors(pRight, this.hoverPlanet.group.position).normalize().applyQuaternion(invQuat), this.hoverPlanet.radius, this.hoverPlanet.biome, true);
      
      const wCenter = this.hoverPlanet.group.position.clone().add(new THREE.Vector3().subVectors(this.mesh.position, this.hoverPlanet.group.position).normalize().multiplyScalar(terrainHeight));
      const wForward = this.hoverPlanet.group.position.clone().add(new THREE.Vector3().subVectors(pForward, this.hoverPlanet.group.position).normalize().multiplyScalar(hForward));
      const wRight = this.hoverPlanet.group.position.clone().add(new THREE.Vector3().subVectors(pRight, this.hoverPlanet.group.position).normalize().multiplyScalar(hRight));
      
      const v1 = new THREE.Vector3().subVectors(wForward, wCenter);
      const v2 = new THREE.Vector3().subVectors(wRight, wCenter);
      let terrainNormal = new THREE.Vector3().crossVectors(v2, v1).normalize();
      if (terrainNormal.dot(toCore) < 0) terrainNormal.negate();
      if (terrainNormal.lengthSq() < 0.1 || isNaN(terrainNormal.x)) terrainNormal = toCore;
      
      // Level the ship with the terrain normal
      let right = new THREE.Vector3().crossVectors(currentForward, terrainNormal);
      if (right.lengthSq() < 0.001) {
        const fallbackDir = new THREE.Vector3(1, 0, 0).applyQuaternion(this.mesh.quaternion).normalize();
        right.crossVectors(fallbackDir, terrainNormal);
      }
      right.normalize();
      
      const trueForward = new THREE.Vector3().crossVectors(terrainNormal, right).normalize();
      const matrix = new THREE.Matrix4().makeBasis(right, terrainNormal, trueForward.negate());
      
      const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
      // Fuerte slerp para enderezar la nave y evitar que cabecee contra el suelo
      this.mesh.quaternion.slerp(targetQuaternion, delta * 8.0);
    }
  }

  handleCollision(surfaceNormal, targetDistance, planetCenter) {
    // 1. Force the ship position to sit exactly on the surface of the planet
    const targetPosition = planetCenter.clone().add(surfaceNormal.clone().multiplyScalar(targetDistance));
    this.mesh.position.copy(targetPosition);
    
    // 2. Kill the speed gracefully (No bouncy/violent collisions)
    this.speed = Math.max(0, this.speed * 0.5); // Frena, pero no rebota en dirección inversa
  }

}
