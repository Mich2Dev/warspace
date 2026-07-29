import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TerrainBuilder } from './planet/TerrainBuilder.js';

/**
 * Third-person surface controller.
 * WASD move, Shift sprint, Space jump, mouse camera, wheel zoom, L/E board.
 */
export class SurfaceWalker {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.active = false;
    this.planet = null;
    this.ship = null;

    this.yaw = 0;          // órbita horizontal de la cámara (independiente del cuerpo)
    this.pitch = 0.28;     // elevación cómoda: personaje siempre en cuadro
    this.cameraDist = 240;
    this.walkSpeed = 88;   // paso más pausado / humano
    this.runSpeed = 165;
    this.strideWalk = 88;
    this.strideRun = 150;
    this.currentSpeed = 0;
    this.verticalOffset = 0;
    this.verticalVelocity = 0;
    this.grounded = true;
    this.jumpHeld = false;
    this.footOffset = 2;
    this.charHeight = 150;
    this._spawnLock = 0;
    this._camSnap = false;
    this._walkPhase = 0;
    this._savedFov = 75;
    this._faceYaw = 0; // hacia dónde mira / camina el personaje
    this._targetFaceYaw = 0;
    this._turnRate = 0; // rad/s suavizado, para inclinar el torso al girar
    this._headLookYaw = 0;
    this._headLookPitch = 0;
    this._idleLookYaw = 0;
    this._idleLookPitch = 0;
    this._idleLookTimer = 0;
    this._lean = 0;
    this._sideLean = 0;
    this._blockedKeys = Object.create(null); // teclas ya pulsadas al bajar → ignorar hasta soltar
    this._smoothUp = new THREE.Vector3(0, 1, 0);
    this._groundHeight = 0;
    this._heightReady = false;
    this._camBob = 0;
    this._suitMats = [];
    this._suitTime = 0;

    this._basisRight = new THREE.Vector3();
    this._basisFwd = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._moveDir = new THREE.Vector3(0, 0, -1);
    this._desiredDir = new THREE.Vector3();
    this._faceFwd = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._basisX = new THREE.Vector3();
    this._basisY = new THREE.Vector3();
    this._basisZ = new THREE.Vector3();
    this._orientMat = new THREE.Matrix4();
    this._worldPos = new THREE.Vector3();
    this._planetWorld = new THREE.Vector3();
    this._worldUp = new THREE.Vector3();
    this._localCam = new THREE.Vector3();
    this._moveAxis = new THREE.Vector3();

    this.root = new THREE.Group();
    this.visual = new THREE.Group();
    this.root.add(this.visual);
    this._loadCharacter();
    this.root.visible = false;
    this.root.frustumCulled = false;
    scene.add(this.root);

    this.controlsPanel = document.createElement('div');
    Object.assign(this.controlsPanel.style, {
      display: 'none',
      position: 'fixed',
      left: '18px',
      bottom: '22px',
      zIndex: '80',
      padding: '10px 14px',
      border: '1px solid rgba(0,255,220,.55)',
      borderRadius: '6px',
      background: 'rgba(0,18,28,.72)',
      color: '#bfffee',
      font: '12px monospace',
      lineHeight: '1.7',
      pointerEvents: 'none',
      backdropFilter: 'blur(4px)'
    });
    this.controlsPanel.innerHTML =
      '<b style="color:#00ffcc">A PIE — exploración</b><br>' +
      '<span style="color:#fff">W</span> adelante · <span style="color:#fff">S</span> atrás · <span style="color:#fff">A/D</span> lados<br>' +
      '<span style="color:#fff">Ratón</span> orbitar (360°) · <span style="color:#fff">Rueda</span> zoom<br>' +
      '<span style="color:#fff">Shift</span> correr · <span style="color:#fff">Espacio</span> saltar<br>' +
      '<span style="color:#fff">E</span> o <span style="color:#fff">L</span> subir a la nave (acércate)';
    document.body.appendChild(this.controlsPanel);
  }

  _setExplorationHud(on) {
    const cross = document.getElementById('crosshair');
    const lock = document.getElementById('lock-on-ui');
    if (cross) {
      if (on) {
        cross.classList.add('on-foot');
        cross.style.display = 'none';
      } else {
        cross.classList.remove('on-foot');
        cross.style.display = '';
        cross.style.opacity = '1';
      }
    }
    if (lock) lock.style.display = 'none';
    document.body.classList.toggle('exploring-on-foot', !!on);
  }

  /**
   * Carga el personaje rigueado (malla con esqueleto Mixamo, texturas PBR y
   * clips Idle/Walk/Run). Mientras llega el GLB se muestra un cuerpo simple.
   */
  _loadCharacter() {
    this.mixer = null;
    this.actions = {};
    this.bones = {};
    this.model = null;
    this.modelPivot = new THREE.Group();
    this.visual.add(this.modelPivot);

    this.fallbackBody = this._buildFallbackBody();
    this.modelPivot.add(this.fallbackBody);
    this._buildContactShadow();

    new GLTFLoader().load(
      '/models/astronaut.glb',
      (gltf) => {
        try {
          this._onCharacterLoaded(gltf);
        } catch (err) {
          console.error('[SurfaceWalker] fallo al montar el personaje', err);
        }
      },
      undefined,
      (err) => console.warn('[SurfaceWalker] modelo no disponible, uso cuerpo simple', err)
    );
  }

  _onCharacterLoaded(gltf) {
    const model = gltf.scene;
    model.updateMatrixWorld(true);

    // Auto-ajuste: el GLB viene en metros, el mundo del planeta es gigante.
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const fit = this.charHeight / Math.max(size.y, 1e-4);
    model.scale.multiplyScalar(fit);
    model.position.y = -box.min.y * fit;

    const visorTint = new THREE.Color(0x146a9a);
    const seenSkeletons = new Set();
    model.traverse((obj) => {
      if (obj.isBone) {
        this.bones[obj.name.replace('mixamorig:', '')] = obj;
        return;
      }
      if (!obj.isMesh && !obj.isSkinnedMesh) return;
      // El bounding box de bind pose no sigue a la animación ni al mundo
      // gigante: sin esto la malla desaparece al salir del frustum.
      obj.frustumCulled = false;
      obj.castShadow = false;
      obj.receiveShadow = false;

      if (obj.isSkinnedMesh) {
        if (seenSkeletons.has(obj.skeleton)) obj.skeleton = obj.skeleton.clone();
        seenSkeletons.add(obj.skeleton);
        this._rebaseSkeleton(obj);
      }

      this._polishMaterial(obj);
    });

    if (this.fallbackBody) {
      this.modelPivot.remove(this.fallbackBody);
      this.fallbackBody.traverse((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
      this.fallbackBody = null;
    }

    // Luz barata (1 sola): PointLight dobles + Physical pegaban el FPS a pie.
    if (!this.fillLight) {
      this.fillLight = new THREE.HemisphereLight(0xd8ecff, 0x2a3a28, 0.85);
      this.root.add(this.fillLight);
    }
    if (this.rimLight) {
      this.root.remove(this.rimLight);
      this.rimLight.dispose?.();
      this.rimLight = null;
    }

    this._suitMats = [];
    this.model = model;
    this.modelPivot.add(model);
    this._setupAnimations(gltf.animations);
  }

  /** Texturas nítidas + traje legible sin hundir el FPS. */
  _polishMaterial(obj) {
    const src = obj.material;
    if (!src) return;

    const colorMaps = new Set([src.map, src.emissiveMap].filter(Boolean));
    const maps = [src.map, src.normalMap, src.roughnessMap, src.metalnessMap, src.emissiveMap, src.aoMap];
    for (const map of maps) {
      if (!map) continue;
      map.anisotropy = 4;
      if (colorMaps.has(map)) map.colorSpace = THREE.SRGBColorSpace;
      map.needsUpdate = true;
    }

    const isVisor = /visor/i.test(src.name || '') || /visor/i.test(obj.name || '');
    if (isVisor) {
      const visor = new THREE.MeshStandardMaterial({
        map: src.map || null,
        color: src.color ? src.color.clone() : new THREE.Color(0x0a2030),
        metalness: 1.0,
        roughness: 0.08,
        emissive: new THREE.Color(0x1a88c8),
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0.9,
        envMapIntensity: 1.2,
        side: THREE.FrontSide
      });
      if (visor.map) visor.map.colorSpace = THREE.SRGBColorSpace;
      this._enchantSuitShader(visor, true);
      obj.material = visor;
      src.dispose?.();
      return;
    }

    const suit = new THREE.MeshStandardMaterial({
      map: src.map || null,
      normalMap: src.normalMap || null,
      aoMap: src.aoMap || null,
      color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
      metalness: 0.32,
      roughness: 0.48,
      envMapIntensity: 1.1,
      side: THREE.FrontSide
    });
    if (suit.map) suit.map.colorSpace = THREE.SRGBColorSpace;
    this._enchantSuitShader(suit, false);
    obj.material = suit;
    src.dispose?.();
  }

  /** Fresnel barato (sin clearcoat/sheen ni noise pesado). */
  _enchantSuitShader(mat, isVisor) {
    mat.userData.suit = {
      uTime: { value: 0 },
      uSpeed: { value: 0 },
      uRim: { value: isVisor ? 1.1 : 0.55 }
    };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = mat.userData.suit.uTime;
      shader.uniforms.uSpeed = mat.userData.suit.uSpeed;
      shader.uniforms.uRim = mat.userData.suit.uRim;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uTime;\nuniform float uSpeed;\nuniform float uRim;'
        )
        .replace(
          '#include <opaque_fragment>',
          [
            'float fres = pow(1.0 - max(dot(normalize(normal), normalize(vViewPosition)), 0.0), 3.0);',
            'outgoingLight += vec3(0.2, 0.65, 1.0) * fres * uRim * (0.45 + uSpeed * 0.35);',
            '#include <opaque_fragment>'
          ].join('\n')
        );
    };
    mat.customProgramCacheKey = () => 'suit-rim-v3' + (isVisor ? '-v' : '');
    this._suitMats.push(mat);
  }

  /**
   * ANTI-TEMBLOR: three.js sube las matrices de huesos a la GPU en
   * coordenadas de mundo. Parado en un planeta a ~6e7 unidades del origen,
   * el float32 de la GPU tiene pasos de varias unidades y el cuerpo entero
   * vibra y se despedaza. Aquí recalculamos cada matriz de hueso en CPU
   * (float64) relativa a la malla, para que a la GPU solo lleguen números
   * pequeños. Verificado A/B en pilot_preview a 6e7 unidades.
   */
  _rebaseSkeleton(mesh) {
    const bind0 = mesh.bindMatrix.clone(); // espacio de bind original
    mesh.bindMode = 'detached';
    mesh.bindMatrix.identity();
    mesh.bindMatrixInverse.identity();
    const invMesh = new THREE.Matrix4();
    const offset = new THREE.Matrix4();
    mesh.skeleton.update = function () {
      invMesh.copy(mesh.matrixWorld).invert();
      for (let i = 0; i < this.bones.length; i++) {
        offset.multiplyMatrices(this.bones[i].matrixWorld, this.boneInverses[i]);
        offset.premultiply(invMesh);
        offset.multiply(bind0);
        offset.toArray(this.boneMatrices, i * 16);
      }
      if (this.boneTexture !== null) this.boneTexture.needsUpdate = true;
    };
  }

  _setupAnimations(clips) {
    if (!clips?.length || !this.model) return;
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const name of ['Idle', 'Walk', 'Run']) {
      const clip = THREE.AnimationClip.findByName(clips, name);
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.enabled = true;
      action.setEffectiveWeight(name === 'Idle' ? 1 : 0);
      // Fundidos largos: el cambio Idle↔Walk↔Run deja de sentirse a saltos.
      action.setEffectiveTimeScale(1);
      action.play();
      this.actions[name] = action;
    }
    if (this.actions.Walk && this.actions.Run) {
      this.actions.Run.time = this.actions.Walk.time;
    }
  }

  /** Cuerpo neutro por si el GLB no está disponible. */
  _buildFallbackBody() {
    const group = new THREE.Group();
    const suit = new THREE.MeshStandardMaterial({
      color: 0x3f4c5a,
      roughness: 0.7,
      metalness: 0.15
    });
    const h = this.charHeight;
    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(h * 0.11, h * 0.34, 6, 16),
      suit
    );
    torso.position.y = h * 0.62;
    const head = new THREE.Mesh(new THREE.SphereGeometry(h * 0.085, 18, 14), suit);
    head.position.y = h * 0.92;
    const legs = new THREE.Mesh(
      new THREE.CapsuleGeometry(h * 0.09, h * 0.32, 6, 14),
      suit
    );
    legs.position.y = h * 0.25;
    for (const m of [torso, head, legs]) {
      m.frustumCulled = false;
      group.add(m);
    }
    return group;
  }

  /**
   * Sombra de contacto: sin shadow map, esta mancha suave es lo que hace que
   * el personaje se sienta apoyado en el suelo y no flotando.
   */
  _buildContactShadow() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.22)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(this.charHeight * 0.62, this.charHeight * 0.62),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        opacity: 0.85
      })
    );
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.y = 1.5;
    this.contactShadow.frustumCulled = false;
    this.contactShadow.renderOrder = -1;
    this.root.add(this.contactShadow);
  }

  _buildTangentBasis(up) {
    const axis = Math.abs(up.x) > 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
    this._basisRight.crossVectors(axis, up).normalize();
    this._basisFwd.crossVectors(up, this._basisRight).normalize();
  }

  exitShip(spaceship, keysHeld = null) {
    try {
      if (!spaceship?.hoverPlanet) return false;
      // Si aún no está en levitación, aterriza primero
      if (!spaceship.isLanded) {
        spaceship.isLanded = true;
        spaceship.speed = 0;
        spaceship.pitchAccumulator = 0;
      }

      this.active = true;
      this.ship = spaceship;
      this.planet = spaceship.hoverPlanet;
      spaceship.onFoot = true;
      spaceship.mode = 'HOVER';
      spaceship.speed = 0;
      spaceship.pitchAccumulator = 0;
      spaceship.yawAccumulator = 0;

      this.currentSpeed = 0;
      this.verticalOffset = 0;
      this.verticalVelocity = 0;
      this.grounded = true;
      this.jumpHeld = false;
      this._spawnLock = 0.25;
      this._camSnap = true;
      this._turnRate = 0;
      this._moveDir.set(0, 0, 0);
      this._armInputGate(keysHeld);

      const shipForward = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(spaceship.mesh.quaternion);
      const up = new THREE.Vector3()
        .subVectors(spaceship.mesh.position, this.planet.group.position)
        .normalize();

      // Hijo del planeta → órbita/spin heredados. Matriz al día antes de worldToLocal.
      if (this.root.parent !== this.planet.group) {
        if (this.root.parent) this.root.parent.remove(this.root);
        this.planet.group.add(this.root);
      }
      this.planet.group.updateMatrixWorld(true);

      // Spawn al costado de la nave, proyectado al suelo (no debajo ni dentro del casco).
      const side = new THREE.Vector3().crossVectors(shipForward, up).normalize();
      const spawnWorld = spaceship.mesh.position.clone()
        .addScaledVector(side, 900)
        .addScaledVector(shipForward, 200)
        .addScaledVector(up, 40);
      const spawnLocal = spawnWorld.clone();
      this.planet.group.worldToLocal(spawnLocal);
      if (spawnLocal.lengthSq() < 1e-6) {
        // Fallback: justo bajo la nave en espacio local
        spawnLocal.copy(up).applyQuaternion(this.planet.group.quaternion.clone().invert())
          .multiplyScalar(this.planet.radius + 100);
      }

      this.root.position.copy(spawnLocal);
      this.root.quaternion.identity();
      this._heightReady = false;
      this._followSurface(spawnLocal, 1 / 60, true);

      // Si el follow falló (NaN), recuperar
      if (!Number.isFinite(this.root.position.x)) {
        const dir = up.clone().applyQuaternion(this.planet.group.quaternion.clone().invert()).normalize();
        this.root.position.copy(dir).multiplyScalar(this.planet.radius + this.footOffset + 50);
        this._smoothUp.copy(dir);
        this._up.copy(dir);
        this._groundHeight = this.root.position.length();
        this._heightReady = true;
      }

      // Bases tangentes en espacio LOCAL del planeta (origen = centro).
      this._buildTangentBasis(this._up);
      const facingLocal = shipForward.clone().applyQuaternion(
        this.planet.group.quaternion.clone().invert()
      ).projectOnPlane(this._up);
      if (facingLocal.lengthSq() < 1e-6) facingLocal.copy(this._basisFwd);
      else facingLocal.normalize();

      this.yaw = Math.atan2(
        facingLocal.dot(this._basisRight),
        facingLocal.dot(this._basisFwd)
      );
      this._faceYaw = this.yaw;
      this._targetFaceYaw = this.yaw;
      this._turnRate = 0;
      this._moveDir.copy(facingLocal);
      this.pitch = 0.28;
      this.cameraDist = 240;
      this.root.visible = true;
      this.controlsPanel.style.display = 'block';
      this._setExplorationHud(true);

      this._savedFov = this.camera.fov || 75;
      this.camera.fov = 60;
      this.camera.updateProjectionMatrix();

      // Re-asegura el pointer lock: al pulsar E a veces se suelta y quedabas sin control.
      if (typeof document !== 'undefined' && document.pointerLockElement !== document.body) {
        document.body.requestPointerLock?.();
      }

      const status = document.getElementById('autopilot-status');
      if (status) status.innerText = 'A PIE · ratón orbitar · W mover · E nave';
      return true;
    } catch (err) {
      console.error('[SurfaceWalker] exitShip failed', err);
      this.active = false;
      if (spaceship) spaceship.onFoot = false;
      return false;
    }
  }

  boardShip() {
    if (!this.active && !this.ship) return;
    const ship = this.ship;
    this.active = false;
    if (ship) {
      ship.onFoot = false;
      ship.pitchAccumulator = 0;
      ship.speed = 0;
    }
    // Despegar del planeta: volver a la escena en coords de mundo
    if (this.root.parent && this.root.parent !== this.scene) {
      this.root.getWorldPosition(this._worldPos);
      this.root.parent.remove(this.root);
      this.scene.add(this.root);
      this.root.position.copy(this._worldPos);
      this.root.quaternion.identity();
    }
    this.root.visible = false;
    this.controlsPanel.style.display = 'none';
    this._setExplorationHud(false);
    this.planet = null;
    this._heightReady = false;

    this.camera.fov = this._savedFov || 75;
    this.camera.updateProjectionMatrix();

    const status = document.getElementById('autopilot-status');
    if (status) status.innerText = 'LEVITACIÓN AUTO · mira arriba para despegar';
    this.ship = null;
  }

  _armInputGate(keysHeld) {
    this._blockedKeys = Object.create(null);
    const watch = [
      'KeyW', 'KeyA', 'KeyS', 'KeyD',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'ShiftLeft', 'ShiftRight', 'Space'
    ];
    // Solo bloquea lo que YA estaba pulsado (p.ej. W de la nave).
    if (!keysHeld) return;
    for (const code of watch) {
      if (keysHeld[code]) this._blockedKeys[code] = true;
    }
  }

  _keyDown(keys, code) {
    if (this._spawnLock > 0) return false;
    if (this._blockedKeys[code]) {
      if (!keys?.[code]) delete this._blockedKeys[code];
      return false;
    }
    return !!keys?.[code];
  }

  tryToggle(spaceship, keysHeld = null) {
    if (this.active) {
      if (!this.ship) {
        this.active = false;
        if (spaceship) spaceship.onFoot = false;
        return;
      }
      if (this.getWorldPosition(this._worldPos).distanceTo(this.ship.mesh.position) < 1400) {
        this.boardShip();
      } else {
        const status = document.getElementById('autopilot-status');
        if (status) status.innerText = 'ACÉRCATE A LA NAVE · E para subir';
      }
      return;
    }
    // Recuperar estado roto: onFoot sin walker activo
    if (spaceship?.onFoot && !this.active) {
      spaceship.onFoot = false;
    }
    if (spaceship?.mode === 'HOVER' && spaceship.hoverPlanet) {
      this.exitShip(spaceship, keysHeld);
    }
  }

  onMouseMove(dx, dy) {
    if (!this.active) return;
    // Órbita suave; límites pensados para no perder al personaje de cuadro.
    this.yaw += dx * 0.0016;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0011, -0.05, 0.85);
  }

  onScroll(deltaY) {
    if (!this.active) return;
    this.cameraDist = THREE.MathUtils.clamp(
      this.cameraDist + deltaY * 0.08,
      160,
      420
    );
  }

  /** Orienta el muñeco con up suavizado (evita tirones en pendientes). */
  _orientCharacter(forward, up) {
    if (forward.lengthSq() < 1e-8) return;
    this._basisZ.copy(forward).normalize().multiplyScalar(-1); // local +Z = espalda
    this._basisX.crossVectors(up, this._basisZ);
    if (this._basisX.lengthSq() < 1e-8) {
      this._basisX.crossVectors(this._basisRight, this._basisZ);
    }
    this._basisX.normalize();
    this._basisY.crossVectors(this._basisZ, this._basisX).normalize();
    this._orientMat.makeBasis(this._basisX, this._basisY, this._basisZ);
    this._orientQuat = this._orientQuat || new THREE.Quaternion();
    this._orientQuat.setFromRotationMatrix(this._orientMat);
    this.root.quaternion.slerp(this._orientQuat, 0.14);
  }

  /** Posición mundo del piloto (root vive en espacio local del planeta). */
  getWorldPosition(out = this._worldPos) {
    return this.root.getWorldPosition(out);
  }

  _terrainRadius(localDirection) {
    return TerrainBuilder.getHeight(
      localDirection.clone().normalize(),
      this.planet.radius,
      this.planet.biome,
      true
    );
  }

  /**
   * Espacio LOCAL del planeta (centro = origen). Al ser hijo de planet.group,
   * órbita y spin se heredan solos: ya no “resbala” el suelo.
   */
  _followSurface(approxLocalPos, dt, hard = false) {
    const localDir = approxLocalPos.clone().normalize();
    const height = this._terrainRadius(localDir);
    const targetRadius = height + this.footOffset + this.verticalOffset;

    if (!this._heightReady || hard) {
      this._groundHeight = targetRadius;
      this._heightReady = true;
      this._smoothUp.copy(localDir);
    } else {
      const gap = targetRadius - this._groundHeight;
      const follow = gap > 0 ? 10 : 16;
      this._groundHeight += gap * (1 - Math.exp(-follow * dt));
      this._smoothUp.lerp(localDir, 1 - Math.exp(-8 * dt)).normalize();
    }

    this.root.position.copy(this._smoothUp).multiplyScalar(this._groundHeight);
    this._up.copy(this._smoothUp);
  }

  /** Avanza en arco sobre la esfera en espacio local. */
  _moveOnSphere(dir, distance) {
    if (distance < 1e-6 || dir.lengthSq() < 1e-8) return;
    const rel = this.root.position.clone();
    const radius = Math.max(rel.length(), 1);
    const upN = this._tmp.copy(rel).normalize();
    const tangent = dir.clone().projectOnPlane(upN);
    if (tangent.lengthSq() < 1e-8) return;
    tangent.normalize();
    this._moveAxis.crossVectors(upN, tangent).normalize();
    rel.applyAxisAngle(this._moveAxis, distance / radius);
    this.root.position.copy(rel);
  }

  /**
   * Mezcla Idle/Walk/Run por velocidad real y añade matices encima de los
   * clips (inclinación de torso, cabeza estabilizada, piernas en el salto).
   */
  _animatePilot(dt, moving, running) {
    this._walkPhase += dt * (moving ? (running ? 9 : 5.5) : 1.2);

    if (!this.mixer) {
      if (this.fallbackBody) {
        const bob = moving ? Math.abs(Math.sin(this._walkPhase * 2)) * 2.5 : 0;
        this.fallbackBody.position.y = bob;
      }
      this._updateContactShadow(dt, moving);
      return;
    }

    const speed = this.currentSpeed;
    let wIdle = 0;
    let wWalk = 0;
    let wRun = 0;
    if (speed <= this.walkSpeed * 0.15) {
      wIdle = 1;
    } else if (speed <= this.walkSpeed) {
      wWalk = THREE.MathUtils.clamp(speed / this.walkSpeed, 0, 1);
      wIdle = 1 - wWalk;
    } else {
      wRun = THREE.MathUtils.clamp(
        (speed - this.walkSpeed) / Math.max(this.runSpeed - this.walkSpeed, 1),
        0,
        1
      );
      wWalk = 1 - wRun;
    }

    const airborne = !this.grounded;
    if (airborne) {
      wIdle = Math.max(wIdle, 0.45);
      wWalk *= 0.35;
      wRun *= 0.35;
    }

    // Blend muy suave → Idle↔Walk↔Run sin saltos de pose.
    const blend = Math.min(1, dt * 2.4);
    this._applyWeight(this.actions.Idle, wIdle, blend);
    this._applyWeight(this.actions.Walk, wWalk, blend);
    this._applyWeight(this.actions.Run, wRun, blend);

    if (this.actions.Walk) {
      // Cadencia ≈ distancia / zancada, con suavizado para no “tic-tac”.
      const walkScale = airborne
        ? 0.15
        : THREE.MathUtils.clamp(0.75 + (speed / Math.max(this.strideWalk, 1)) * 0.35, 0.7, 1.15);
      this.actions.Walk.timeScale = THREE.MathUtils.lerp(
        this.actions.Walk.timeScale || 1,
        walkScale,
        Math.min(1, dt * 5)
      );
    }
    if (this.actions.Run) {
      const runScale = airborne
        ? 0.15
        : THREE.MathUtils.clamp(0.8 + (speed / Math.max(this.strideRun, 1)) * 0.3, 0.75, 1.2);
      this.actions.Run.timeScale = THREE.MathUtils.lerp(
        this.actions.Run.timeScale || 1,
        runScale,
        Math.min(1, dt * 5)
      );
    }
    // Mantener fase entre Walk y Run.
    if (this.actions.Walk && this.actions.Run && this.actions.Run.getEffectiveWeight() > 0.05) {
      const walkDur = this.actions.Walk.getClip().duration;
      const runDur = this.actions.Run.getClip().duration;
      if (walkDur > 0 && runDur > 0) {
        this.actions.Run.time = (this.actions.Walk.time / walkDur) * runDur;
      }
    }

    this.mixer.update(dt);
    this._applyBoneTouches(dt, moving, running, airborne);
    this._updateContactShadow(dt, moving);
  }

  _applyWeight(action, target, blend) {
    if (!action) return;
    const current = action.getEffectiveWeight();
    const weight = THREE.MathUtils.lerp(current, target, blend);
    action.setEffectiveWeight(weight);
    action.enabled = weight > 0.001;
  }

  /** Retoques encima del clip, aplicados después de mixer.update(). */
  _applyBoneTouches(dt, moving, running, airborne) {
    const speedRatio = THREE.MathUtils.clamp(this.currentSpeed / this.runSpeed, 0, 1);
    const leanTarget = airborne ? 0.08 : speedRatio * (running ? 0.14 : 0.09);
    this._lean = THREE.MathUtils.lerp(this._lean ?? 0, leanTarget, Math.min(1, dt * 3.2));

    // Inclinación lateral al girar (peso del cuerpo, no caricatura).
    const sideTarget = THREE.MathUtils.clamp(-(this._turnRate || 0) * 0.06, -0.12, 0.12);
    this._sideLean = THREE.MathUtils.lerp(this._sideLean ?? 0, sideTarget, Math.min(1, dt * 4));

    const spine = this.bones.Spine;
    if (spine) {
      this._rotateBone(spine, this._lean * 0.4);
      this._rotateBoneZ(spine, this._sideLean * 0.65);
    }
    const spine1 = this.bones.Spine1;
    if (spine1) {
      this._rotateBone(spine1, this._lean * 0.25);
      this._rotateBoneZ(spine1, this._sideLean * 0.4);
    }
    const hips = this.bones.Hips;
    if (hips && moving && this.grounded) {
      // Ligero balanceo de cadera al caminar.
      this._rotateBoneZ(hips, Math.sin(this._walkPhase) * 0.035 * (1 - speedRatio * 0.3));
    }

    const head = this.bones.Head;
    if (head) {
      const camPitch = THREE.MathUtils.clamp(0.1 - this.pitch * 0.12, -0.15, 0.2);
      this._rotateBone(
        head,
        -this._lean * 0.45 + camPitch + (this._headLookPitch || 0) + (this._idleLookPitch || 0)
      );
      this._rotateBoneY(head, (this._headLookYaw || 0) + (this._idleLookYaw || 0));
    }
    const neck = this.bones.Neck;
    if (neck) {
      this._rotateBoneY(neck, ((this._headLookYaw || 0) + (this._idleLookYaw || 0)) * 0.35);
      this._rotateBoneZ(neck, this._sideLean * 0.2);
    }

    if (airborne) {
      const tuck = THREE.MathUtils.clamp(this.verticalVelocity / 150, -1, 1);
      this._rotateBone(this.bones.LeftUpLeg, -0.22 - tuck * 0.15);
      this._rotateBone(this.bones.RightUpLeg, -0.1 + tuck * 0.12);
      this._rotateBone(this.bones.LeftLeg, 0.35);
      this._rotateBone(this.bones.RightLeg, 0.22);
      this._rotateBone(this.bones.LeftArm, -0.2);
      this._rotateBone(this.bones.RightArm, -0.2);
    }

    // Idle vivo: respiración + balanceo + brazos suaves.
    if (!moving || speedRatio < 0.08) {
      const breath = Math.sin(this._walkPhase * 1.35);
      if (this.bones.Spine2) this._rotateBone(this.bones.Spine2, breath * 0.022);
      if (this.bones.Hips) this._rotateBoneZ(this.bones.Hips, Math.sin(this._walkPhase * 0.55) * 0.02);
      if (this.bones.LeftArm) this._rotateBone(this.bones.LeftArm, Math.sin(this._walkPhase * 0.75) * 0.03);
      if (this.bones.RightArm) this._rotateBone(this.bones.RightArm, Math.sin(this._walkPhase * 0.75 + 1.1) * 0.03);
    } else if (this.grounded) {
      // Balanceo de brazos opuesto a las piernas (refuerzo natural sobre el clip).
      const armSwing = Math.sin(this._walkPhase) * (running ? 0.08 : 0.05);
      if (this.bones.LeftArm) this._rotateBone(this.bones.LeftArm, armSwing);
      if (this.bones.RightArm) this._rotateBone(this.bones.RightArm, -armSwing);
    }
  }

  _rotateBone(bone, angleX) {
    if (!bone || !angleX) return;
    this._boneQuat = this._boneQuat || new THREE.Quaternion();
    this._boneAxis = this._boneAxis || new THREE.Vector3(1, 0, 0);
    this._boneQuat.setFromAxisAngle(this._boneAxis, angleX);
    bone.quaternion.multiply(this._boneQuat);
  }

  _rotateBoneY(bone, angleY) {
    if (!bone || !angleY) return;
    this._boneQuat = this._boneQuat || new THREE.Quaternion();
    this._boneAxisY = this._boneAxisY || new THREE.Vector3(0, 1, 0);
    this._boneQuat.setFromAxisAngle(this._boneAxisY, angleY);
    bone.quaternion.multiply(this._boneQuat);
  }

  _rotateBoneZ(bone, angleZ) {
    if (!bone || !angleZ) return;
    this._boneQuat = this._boneQuat || new THREE.Quaternion();
    this._boneAxisZ = this._boneAxisZ || new THREE.Vector3(0, 0, 1);
    this._boneQuat.setFromAxisAngle(this._boneAxisZ, angleZ);
    bone.quaternion.multiply(this._boneQuat);
  }

  /** Normaliza un ángulo al rango (-π, π]. */
  _wrapAngle(a) {
    const tau = Math.PI * 2;
    a = ((a + Math.PI) % tau + tau) % tau - Math.PI;
    return a;
  }

  /** Interpola yaw por el camino más corto. */
  _dampAngle(current, target, lambda, dt) {
    const delta = this._wrapAngle(target - current);
    return current + delta * (1 - Math.exp(-lambda * dt));
  }

  _updateContactShadow(dt, moving) {
    if (!this.contactShadow) return;
    const lift = Math.max(0, this.verticalOffset);
    const fade = THREE.MathUtils.clamp(1 - lift / (this.charHeight * 0.9), 0.12, 1);
    const spread = 1 + lift / (this.charHeight * 1.4);
    this.contactShadow.material.opacity = 0.85 * fade;
    this.contactShadow.scale.setScalar(spread * (moving ? 1.05 : 1));
    // El root sube al saltar; la sombra debe quedarse pegada al terreno.
    this.contactShadow.position.y = 1.5 - lift;
  }

  update(delta, keys) {
    if (!this.active || !this.planet) return;
    try {
      this._updateInner(delta, keys);
    } catch (err) {
      console.error('[SurfaceWalker] update failed', err);
      this.boardShip();
    }
  }

  _updateInner(delta, keys) {
    const dt = Math.min(delta, 0.05);
    if (this._spawnLock > 0) {
      this._spawnLock -= dt;
      if (this._spawnLock <= 0) {
        // Al terminar el lock, limpia teclas fantasma por si quedaron atrapadas.
        for (const code of Object.keys(this._blockedKeys)) {
          if (!keys?.[code]) delete this._blockedKeys[code];
        }
      }
    }

    // Root es hijo de planet.group → up local = dirección radial
    if (this.root.position.lengthSq() < 1e-4) {
      // Evita quedarse “pegado” en el centro del planeta
      this.root.position.set(0, this.planet.radius + 50, 0);
      this._heightReady = false;
    }
    const up = this.root.position.clone().normalize();
    this._up.copy(up);
    this._buildTangentBasis(up);

    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    this._fwd.copy(this._basisFwd).multiplyScalar(cos)
      .addScaledVector(this._basisRight, sin).normalize();
    this._right.copy(this._basisRight).multiplyScalar(cos)
      .addScaledVector(this._basisFwd, -sin).normalize();

    let x = 0;
    let z = 0;
    if (this._spawnLock <= 0) {
      if (this._keyDown(keys, 'KeyW') || this._keyDown(keys, 'ArrowUp')) z += 1;
      if (this._keyDown(keys, 'KeyS') || this._keyDown(keys, 'ArrowDown')) z -= 1;
      if (this._keyDown(keys, 'KeyA') || this._keyDown(keys, 'ArrowLeft')) x -= 1;
      if (this._keyDown(keys, 'KeyD') || this._keyDown(keys, 'ArrowRight')) x += 1;
    }

    const moving = x !== 0 || z !== 0;
    const running = moving && (
      this._keyDown(keys, 'ShiftLeft') || this._keyDown(keys, 'ShiftRight')
    );

    if (moving) {
      this._desiredDir.copy(this._fwd).multiplyScalar(z)
        .addScaledVector(this._right, x);
      if (this._desiredDir.lengthSq() > 1e-6) {
        this._desiredDir.normalize();
        this._targetFaceYaw = Math.atan2(
          this._desiredDir.dot(this._basisRight),
          this._desiredDir.dot(this._basisFwd)
        );
      }
    }

    // Giro suave: nunca salta al ángulo deseado de golpe.
    const prevFace = this._faceYaw;
    const turnLambda = running ? 4.8 : (moving ? 3.4 : 2.4);
    this._faceYaw = this._dampAngle(this._faceYaw, this._targetFaceYaw, turnLambda, dt);
    const turnDelta = this._wrapAngle(this._faceYaw - prevFace);
    this._turnRate = THREE.MathUtils.lerp(this._turnRate || 0, turnDelta / Math.max(dt, 1e-4), Math.min(1, dt * 6));

    // Adelante real del cuerpo (después del giro amortiguado).
    const faceCos = Math.cos(this._faceYaw);
    const faceSin = Math.sin(this._faceYaw);
    this._faceFwd.copy(this._basisFwd).multiplyScalar(faceCos)
      .addScaledVector(this._basisRight, faceSin);
    if (this._faceFwd.lengthSq() < 1e-6) this._faceFwd.copy(this._fwd);
    else this._faceFwd.normalize();

    // Si el giro es cerrado, frena: parece que pivota en vez de patinar.
    const turnError = Math.abs(this._wrapAngle(this._targetFaceYaw - this._faceYaw));
    const turnSlow = moving
      ? THREE.MathUtils.clamp(1 - turnError / Math.PI, 0.32, 1)
      : 1;
    const targetSpeed = moving
      ? (running ? this.runSpeed : this.walkSpeed) * turnSlow
      : 0;
    // Arranque lento, frenado más rápido (peso humano).
    const accel = targetSpeed > this.currentSpeed ? 2.4 : 4.8;
    this.currentSpeed = THREE.MathUtils.lerp(
      this.currentSpeed,
      targetSpeed,
      Math.min(1, dt * accel)
    );

    if (this.currentSpeed > 0.5) {
      // Arco sobre la esfera + dirección de mirada → ya no “pata de pato” en el globo.
      this._moveDir.copy(this._faceFwd);
      this._moveOnSphere(this._moveDir, this.currentSpeed * dt);
    }

    const jumpPressed = this._keyDown(keys, 'Space');
    if (jumpPressed && !this.jumpHeld && this.grounded && this._spawnLock <= 0) {
      this.verticalVelocity = 145;
      this.grounded = false;
    }
    this.jumpHeld = jumpPressed;
    if (!this.grounded) {
      this.verticalVelocity -= 280 * dt;
      this.verticalOffset += this.verticalVelocity * dt;
      if (this.verticalOffset <= 0) {
        this.verticalOffset = 0;
        this.verticalVelocity = 0;
        this.grounded = true;
      }
    }

    this._followSurface(this.root.position, dt, false);

    this._orientCharacter(this._faceFwd, this._up);

    // Cámara en MUNDO: offset local → world (el root gira con el planeta).
    const headH = this.charHeight;
    const elev = this.pitch;
    const horiz = this.cameraDist * Math.cos(elev);
    const lift = this.cameraDist * Math.sin(elev);
    const bobTarget = (moving && this.grounded)
      ? Math.sin(this._walkPhase * 2) * (running ? 4.5 : 2.6)
      : 0;
    this._camBob = THREE.MathUtils.lerp(this._camBob || 0, bobTarget, Math.min(1, dt * 8));

    this._localCam.copy(this.root.position)
      .addScaledVector(this._fwd, -horiz)
      .addScaledVector(this._up, headH * 0.62 + lift + this._camBob);
    this._camPos.copy(this._localCam);
    this.planet.group.localToWorld(this._camPos);

    this.planet.group.getWorldPosition(this._planetWorld);
    this._worldUp.copy(this._camPos).sub(this._planetWorld).normalize();
    const minRadius = this._terrainRadius(
      this._worldUp.clone().applyQuaternion(this.planet.group.quaternion.clone().invert())
    ) + 50;
    const camDistFromCenter = this._camPos.distanceTo(this._planetWorld);
    if (camDistFromCenter < minRadius) {
      this._camPos.copy(this._planetWorld).addScaledVector(this._worldUp, minRadius);
    }

    // Mira al pecho/cabeza para mantener al piloto centrado en pantalla.
    this._lookTarget.copy(this.root.position)
      .addScaledVector(this._up, headH * 0.55);
    this.planet.group.localToWorld(this._lookTarget);

    this.getWorldPosition(this._worldPos);
    this._updateHeadLook(moving, dt);
    this._animatePilot(dt, moving, running);
    this._updateSuitMagic(dt);

    const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(this._camPos, this._lookTarget, this._worldUp)
    );

    if (this._camSnap) {
      this._camSnap = false;
      this.camera.position.copy(this._camPos);
      this.camera.quaternion.copy(targetQuaternion);
      return;
    }
    // Cámara más “pegajosa” al cuerpo → menos se te escapa del cuadro.
    this.camera.position.lerp(this._camPos, Math.min(1, dt * 12));
    this.camera.quaternion.slerp(targetQuaternion, Math.min(1, dt * 11));
  }

  _updateSuitMagic(dt) {
    this._suitTime = (this._suitTime || 0) + dt;
    const speedN = THREE.MathUtils.clamp(this.currentSpeed / this.runSpeed, 0, 1);
    for (const mat of this._suitMats) {
      if (!mat.userData.suit) continue;
      mat.userData.suit.uTime.value = this._suitTime;
      mat.userData.suit.uSpeed.value = speedN;
    }
  }

  /** Cabeza: mira la cámara de cerca; si no, deambula con naturalidad. */
  _updateHeadLook(moving, dt) {
    if (!this.bones.Head && !this.bones.Neck) return;
    let targetYaw = 0;
    let targetPitch = 0;

    // Mirada errante en idle (cada ~2.5–4 s elige un punto nuevo).
    this._idleLookTimer = (this._idleLookTimer || 0) - dt;
    if (this._idleLookTimer <= 0) {
      this._idleLookTimer = 2.4 + Math.random() * 2.2;
      this._idleLookTargetYaw = (Math.random() - 0.5) * 0.7;
      this._idleLookTargetPitch = (Math.random() - 0.5) * 0.25;
    }
    const idleAmt = moving ? 0 : 1;
    this._idleLookYaw = THREE.MathUtils.lerp(
      this._idleLookYaw || 0,
      (this._idleLookTargetYaw || 0) * idleAmt,
      Math.min(1, dt * 1.6)
    );
    this._idleLookPitch = THREE.MathUtils.lerp(
      this._idleLookPitch || 0,
      (this._idleLookTargetPitch || 0) * idleAmt,
      Math.min(1, dt * 1.6)
    );

    if (!moving && this.grounded) {
      // Cámara está en mundo; pasar a local del planeta para comparar con el cuerpo.
      this._tmp.copy(this._camPos);
      this.planet.group.worldToLocal(this._tmp);
      this._tmp.sub(this.root.position);
      this._basisX.crossVectors(this._up, this._faceFwd);
      if (this._basisX.lengthSq() > 1e-8 && this._tmp.lengthSq() > 1e-6) {
        this._basisX.normalize();
        const side = this._tmp.dot(this._basisX);
        const fwd = this._tmp.dot(this._faceFwd);
        // Solo mira a cámara si está más o menos delante / a un costado cercano.
        const ang = Math.atan2(side, -fwd);
        if (Math.abs(ang) < 1.35) {
          targetYaw = THREE.MathUtils.clamp(ang * 0.55, -0.55, 0.55);
          const upDot = this._tmp.dot(this._up) / this._tmp.length();
          targetPitch = THREE.MathUtils.clamp(upDot * 0.3, -0.22, 0.3);
        }
      }
    }
    this._headLookYaw = THREE.MathUtils.lerp(this._headLookYaw || 0, targetYaw, Math.min(1, dt * 3.2));
    this._headLookPitch = THREE.MathUtils.lerp(this._headLookPitch || 0, targetPitch, Math.min(1, dt * 3.2));
  }

  nearShip(maxDist = 1400) {
    if (!this.ship) return false;
    return this.getWorldPosition(this._worldPos)
      .distanceTo(this.ship.mesh.position) < maxDist;
  }
}
