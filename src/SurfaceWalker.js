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

    this.yaw = 0;
    this.pitch = 0.22;
    this.cameraDist = 230;
    // Escala del mundo: 100 unidades ≈ 1 m para el piloto de 150 unidades.
    this.walkSpeed = 520;
    this.runSpeed = 1100;
    this.currentSpeed = 0;
    this.verticalOffset = 0;
    this.verticalVelocity = 0;
    this.grounded = true;
    this.jumpHeld = false;
    this._jumpBuffer = 0;
    this._coyote = 0;
    this.footOffset = 4;
    this.charHeight = 150;
    // Salto: impulso alto + gravedad fuerte = arco corto y natural
    this.jumpVelocity = 420;
    this.gravity = 980;
    this.fallGravity = 1400; // más pesado al caer
    this.jumpCutMul = 0.45; // soltar espacio corta el salto

    this._spawnLock = 0;
    this._camSnap = false;
    this._walkPhase = 0;
    this._savedFov = 75;
    this._faceYaw = 0; // hacia dónde mira / camina el personaje

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
    this._localDir = new THREE.Vector3(0, 1, 0);
    this._worldDir = new THREE.Vector3();
    this._invPlanetQ = new THREE.Quaternion();
    this._syncDelta = new THREE.Vector3();
    this._cameraQuat = new THREE.Quaternion();
    this._cameraMat = new THREE.Matrix4();
    this._basisAxis = new THREE.Vector3();

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
      '<b style="color:#00ffcc">A PIE — controles simples</b><br>' +
      '<span style="color:#fff">W</span> adelante · <span style="color:#fff">S</span> atrás · <span style="color:#fff">A/D</span> lados<br>' +
      '<span style="color:#fff">Ratón</span> girar · <span style="color:#fff">Shift</span> correr · <span style="color:#fff">Espacio</span> saltar<br>' +
      '<span style="color:#fff">E</span> o <span style="color:#fff">L</span> subir a la nave (acércate; ahora baja contigo)';
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

    const visorTint = new THREE.Color(0x0d4f74);
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

      const mat = obj.material;
      if (!mat) return;
      mat.envMapIntensity = 1.1;
      if (/visor/i.test(mat.name || '')) {
        mat.metalness = 1.0;
        mat.roughness = 0.06;
        mat.emissive = visorTint;
        mat.emissiveIntensity = 0.5;
      } else {
        mat.metalness = Math.min(mat.metalness ?? 0.2, 0.3);
        mat.roughness = 0.62;
      }
      mat.needsUpdate = true;
    });

    if (this.fallbackBody) {
      this.modelPivot.remove(this.fallbackBody);
      this.fallbackBody.traverse((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
      this.fallbackBody = null;
    }

    this.model = model;
    this.modelPivot.add(model);
    this._setupAnimations(gltf.animations);
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
      action.play();
      this.actions[name] = action;
    }
    // Walk y Run comparten fase para que los pasos no salten al mezclar.
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
      ? this._basisAxis.set(0, 1, 0)
      : this._basisAxis.set(1, 0, 0);
    this._basisRight.crossVectors(axis, up).normalize();
    this._basisFwd.crossVectors(up, this._basisRight).normalize();
  }

  exitShip(spaceship) {
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
      spaceship._landedLocalDir = null;

      this.currentSpeed = 0;
      this.verticalOffset = 0;
      this.verticalVelocity = 0;
      this.grounded = true;
      this.jumpHeld = false;
      this._spawnLock = 0.2;
      this._camSnap = true;

      const shipForward = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(spaceship.mesh.quaternion);
      const up = new THREE.Vector3()
        .subVectors(spaceship.mesh.position, this.planet.group.position)
        .normalize();
      this._buildTangentBasis(up);

      const spawn = spaceship.mesh.position.clone()
        .addScaledVector(shipForward, 180)
        .addScaledVector(up, 8);
      this._snapToSurface(spawn);

      const facing = shipForward.clone().projectOnPlane(up);
      if (facing.lengthSq() < 1e-6) facing.copy(this._basisFwd);
      else facing.normalize();
      this.yaw = Math.atan2(
        facing.dot(this._basisRight),
        facing.dot(this._basisFwd)
      );
      this._faceYaw = this.yaw;
      this._moveDir.copy(facing);
      this.pitch = 0.28;
      this.cameraDist = 230;
      this.root.visible = true;
      this.controlsPanel.style.display = 'block';
      this._setExplorationHud(true);

      this._savedFov = this.camera.fov || 75;
      this.camera.fov = 60;
      this.camera.updateProjectionMatrix();

      const status = document.getElementById('autopilot-status');
      if (status) status.innerText = 'A PIE · W adelante · ratón girar · E nave';
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
    this.root.visible = false;
    this.controlsPanel.style.display = 'none';
    this._setExplorationHud(false);
    this.planet = null;

    this.camera.fov = this._savedFov || 75;
    this.camera.updateProjectionMatrix();

    const status = document.getElementById('autopilot-status');
    if (status) status.innerText = 'LEVITACIÓN AUTO · mira arriba para despegar';
    this.ship = null;
  }

  tryToggle(spaceship) {
    if (this.active) {
      if (!this.ship) {
        this.active = false;
        if (spaceship) spaceship.onFoot = false;
        return;
      }
      if (this.root.position.distanceTo(this.ship.mesh.position) < 1100) {
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
      this.exitShip(spaceship);
    }
  }

  onMouseMove(dx, dy) {
    if (!this.active) return;
    // Mouse derecha = girar a la derecha (antes estaba al revés)
    this.yaw += dx * 0.0018;
    this._faceYaw = this.yaw;
    // Mouse arriba = mirar un poco más alto
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0012, 0.08, 0.55);
  }

  onScroll(deltaY) {
    if (!this.active) return;
    this.cameraDist = THREE.MathUtils.clamp(
      this.cameraDist + deltaY * 0.08,
      160,
      380
    );
  }

  /** Orienta el muñeco: -Z local = adelante (visor), +Y = arriba del planeta. */
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
    this.root.quaternion.setFromRotationMatrix(this._orientMat);
  }

  _terrainRadius(worldDirection) {
    const local = this._worldDir.copy(worldDirection)
      .applyQuaternion(this._invPlanetQ.copy(this.planet.group.quaternion).invert());
    return TerrainBuilder.getHeight(
      local,
      this.planet.radius,
      this.planet.biome,
      true
    );
  }

  _snapToSurface(approxWorldPos) {
    const worldDir = this._worldDir.copy(approxWorldPos)
      .sub(this.planet.group.position)
      .normalize();
    this._localDir.copy(worldDir)
      .applyQuaternion(this._invPlanetQ.copy(this.planet.group.quaternion).invert())
      .normalize();
    const height = TerrainBuilder.getHeight(
      this._localDir,
      this.planet.radius,
      this.planet.biome,
      true
    );
    worldDir.copy(this._localDir).applyQuaternion(this.planet.group.quaternion).normalize();
    this.root.position.copy(this.planet.group.position)
      .addScaledVector(worldDir, height + this.footOffset + this.verticalOffset);
    this._up.copy(worldDir);
  }

  /**
   * Reconstruye la posición desde coordenadas locales del planeta.
   * Así suelo, personaje, cámara y nave comparten exactamente la misma rotación.
   */
  syncToPlanetTransform() {
    if (!this.active || !this.planet) return;
    this._syncDelta.copy(this.root.position);
    const height = TerrainBuilder.getHeight(
      this._localDir,
      this.planet.radius,
      this.planet.biome,
      true
    );
    this._worldDir.copy(this._localDir)
      .applyQuaternion(this.planet.group.quaternion)
      .normalize();
    this.root.position.copy(this.planet.group.position)
      .addScaledVector(this._worldDir, height + this.footOffset + this.verticalOffset);
    this._up.copy(this._worldDir);
    this._syncDelta.subVectors(this.root.position, this._syncDelta);
    this.camera.position.add(this._syncDelta);
  }

  /** Quemadura según intensidad del magma bajo los pies. */
  _applyLavaHazard(dt) {
    if (!this.planet || this.planet.biome !== 'Lava') return;
    const ship = this.ship;
    if (!ship || typeof ship.applyLavaBurn !== 'function') return;
    const heat = TerrainBuilder.getLavaIntensity(
      this._localDir,
      this.planet.radius,
      this.planet.biome
    );
    if (heat <= 0.02) return;
    // En el aire encima del charco: menos, pero el calor sigue
    let exposure = heat;
    if (!this.grounded) {
      exposure *= this.verticalOffset > 80 ? 0.15 : 0.45;
    }
    ship.applyLavaBurn(exposure, dt);
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
    if (speed <= this.walkSpeed) {
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
      // En el aire no hay contacto con el suelo: casi congelamos la locomoción.
      wIdle = Math.max(wIdle, 0.35);
    }

    const blend = Math.min(1, dt * 9);
    this._applyWeight(this.actions.Idle, wIdle, blend);
    this._applyWeight(this.actions.Walk, wWalk, blend);
    this._applyWeight(this.actions.Run, wRun, blend);

    // Ajustar la cadencia al desplazamiento real evita el patinaje de pies.
    if (this.actions.Walk) {
      this.actions.Walk.timeScale = airborne
        ? 0.25
        : THREE.MathUtils.clamp(speed / this.walkSpeed, 0.55, 1.45);
    }
    if (this.actions.Run) {
      this.actions.Run.timeScale = airborne
        ? 0.25
        : THREE.MathUtils.clamp(speed / this.runSpeed, 0.6, 1.35);
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
    const leanTarget = airborne ? 0.12 : speedRatio * 0.2;
    this._lean = THREE.MathUtils.lerp(this._lean ?? 0, leanTarget, Math.min(1, dt * 6));

    const spine = this.bones.Spine;
    if (spine) this._rotateBone(spine, this._lean * 0.5);
    const spine1 = this.bones.Spine1;
    if (spine1) this._rotateBone(spine1, this._lean * 0.3);

    // La cabeza compensa la inclinación y sigue el ángulo de cámara.
    const head = this.bones.Head;
    if (head) {
      const look = THREE.MathUtils.clamp(0.26 - this.pitch, -0.3, 0.3);
      this._rotateBone(head, -this._lean * 0.8 + look * 0.5);
    }

    if (airborne) {
      const tuck = THREE.MathUtils.clamp(this.verticalVelocity / 150, -1, 1);
      this._rotateBone(this.bones.LeftUpLeg, -0.35 - tuck * 0.25);
      this._rotateBone(this.bones.RightUpLeg, -0.15 + tuck * 0.2);
      this._rotateBone(this.bones.LeftLeg, 0.55);
      this._rotateBone(this.bones.RightLeg, 0.3);
      this._rotateBone(this.bones.LeftArm, -0.3);
      this._rotateBone(this.bones.RightArm, -0.3);
    }

    // Respiración sutil cuando está quieto.
    if (!moving && this.bones.Spine2) {
      this._rotateBone(this.bones.Spine2, Math.sin(this._walkPhase * 1.6) * 0.02);
    }
  }

  _rotateBone(bone, angleX) {
    if (!bone || !angleX) return;
    this._boneQuat = this._boneQuat || new THREE.Quaternion();
    this._boneAxis = this._boneAxis || new THREE.Vector3(1, 0, 0);
    this._boneQuat.setFromAxisAngle(this._boneAxis, angleX);
    bone.quaternion.multiply(this._boneQuat);
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
    if (this._spawnLock > 0) this._spawnLock -= dt;

    // Anclaje exacto en espacio local; no acumula deriva con la rotación.
    this.syncToPlanetTransform();
    const up = this._up;
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
      if (keys.KeyW || keys.ArrowUp) z += 1;
      if (keys.KeyS || keys.ArrowDown) z -= 1;
      if (keys.KeyA || keys.ArrowLeft) x -= 1;
      if (keys.KeyD || keys.ArrowRight) x += 1;
    }

    const moving = x !== 0 || z !== 0;
    const running = moving && !!(keys.ShiftLeft || keys.ShiftRight);
    const targetSpeed = moving ? (running ? this.runSpeed : this.walkSpeed) : 0;
    this.currentSpeed = THREE.MathUtils.damp(
      this.currentSpeed,
      targetSpeed,
      targetSpeed > this.currentSpeed ? 14 : 16,
      dt
    );

    if (moving) {
      this._desiredDir.copy(this._fwd).multiplyScalar(z)
        .addScaledVector(this._right, x);
      if (this._desiredDir.lengthSq() > 1e-6) {
        this._desiredDir.normalize();
        this._moveDir.copy(this._desiredDir);
        const targetFaceYaw = Math.atan2(
          this._moveDir.dot(this._basisRight),
          this._moveDir.dot(this._basisFwd)
        );
        const turnDelta = Math.atan2(
          Math.sin(targetFaceYaw - this._faceYaw),
          Math.cos(targetFaceYaw - this._faceYaw)
        );
        this._faceYaw += turnDelta * (1 - Math.exp(-14 * dt));
      }
    }

    if (this.currentSpeed > 0.5 && this._moveDir.lengthSq() > 0.01) {
      this.root.position.addScaledVector(this._moveDir, this.currentSpeed * dt);
    }

    // Coyote time + buffer: el salto responde mejor
    if (this.grounded) this._coyote = 0.12;
    else this._coyote = Math.max(0, this._coyote - dt);

    const jumpPressed = !!keys.Space;
    if (jumpPressed && !this.jumpHeld) this._jumpBuffer = 0.12;
    this._jumpBuffer = Math.max(0, this._jumpBuffer - dt);

    if (this._jumpBuffer > 0 && this._coyote > 0 && this._spawnLock <= 0) {
      this.verticalVelocity = this.jumpVelocity;
      // Empujón adelante si ya te movías
      if (this.currentSpeed > 40) {
        this.root.position.addScaledVector(this._moveDir, Math.min(this.currentSpeed, 200) * 0.08);
      }
      this.grounded = false;
      this._coyote = 0;
      this._jumpBuffer = 0;
    }
    // Cortar salto al soltar espacio (arco más controlable)
    if (!jumpPressed && this.jumpHeld && !this.grounded && this.verticalVelocity > 0) {
      this.verticalVelocity *= this.jumpCutMul;
    }
    this.jumpHeld = jumpPressed;

    if (!this.grounded) {
      const g = this.verticalVelocity > 0 ? this.gravity : this.fallGravity;
      this.verticalVelocity -= g * dt;
      this.verticalOffset += this.verticalVelocity * dt;
      if (this.verticalOffset <= 0) {
        this.verticalOffset = 0;
        this.verticalVelocity = 0;
        this.grounded = true;
      }
    }

    this._snapToSurface(this.root.position);

    // Adelante del cuerpo = dirección de marcha (o mira si estás quieto)
    const faceCos = Math.cos(this._faceYaw);
    const faceSin = Math.sin(this._faceYaw);
    this._faceFwd.copy(this._basisFwd).multiplyScalar(faceCos)
      .addScaledVector(this._basisRight, faceSin);
    if (this._faceFwd.lengthSq() < 1e-6) this._faceFwd.copy(this._fwd);
    else this._faceFwd.normalize();

    this._orientCharacter(this._faceFwd, up);
    this._animatePilot(dt, moving, running);
    this._applyLavaHazard(dt);

    const targetFov = running ? 64 : (moving ? 61 : 60);
    const nextFov = THREE.MathUtils.damp(this.camera.fov, targetFov, 6, dt);
    if (Math.abs(nextFov - this.camera.fov) > 0.01) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }

    // Cámara detrás de la dirección de mirada, independiente del strafe.
    const headH = this.charHeight;
    this._camPos.copy(this.root.position)
      .addScaledVector(this._fwd, -this.cameraDist)
      .addScaledVector(up, headH * 0.55 + this.pitch * this.cameraDist * 0.85);

    const camAway = this._tmp.copy(this._camPos).sub(this.planet.group.position);
    if (camAway.lengthSq() > 1e-6) {
      camAway.normalize();
      const minRadius = this._terrainRadius(camAway) + 35;
      if (this._camPos.distanceTo(this.planet.group.position) < minRadius) {
        this._camPos.copy(this.planet.group.position).addScaledVector(camAway, minRadius);
      }
    }

    this._lookTarget.copy(this.root.position).addScaledVector(up, headH * 0.7);
    const targetQuaternion = this._cameraQuat.setFromRotationMatrix(
      this._cameraMat.lookAt(this._camPos, this._lookTarget, up)
    );

    if (this._camSnap) {
      this._camSnap = false;
      this.camera.position.copy(this._camPos);
      this.camera.quaternion.copy(targetQuaternion);
      return;
    }
    this.camera.position.lerp(this._camPos, Math.min(1, dt * 14));
    this.camera.quaternion.slerp(targetQuaternion, Math.min(1, dt * 14));
  }

  nearShip(maxDist = 500) {
    return !!this.ship &&
      this.root.position.distanceTo(this.ship.mesh.position) < maxDist;
  }
}
