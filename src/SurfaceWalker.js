import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TerrainBuilder } from './planet/TerrainBuilder.js';
import { WeaponSystem } from './weapons/WeaponSystem.js';
import { GRIP_FINGERS } from './weapons/WeaponCatalog.js';
import { solveArmToTarget, weaponAxesFromMount } from './weapons/ArmIk.js';

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
    // pitch: 0 = horizontal; negativo = mirar al suelo; positivo = mirar arriba
    this.pitch = 0.05;
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
    this._aimDir = new THREE.Vector3(0, 0, -1);
    this._muzzleWorld = new THREE.Vector3();
    this.weapon = null;
    this.weaponMuzzle = null;
    this._muzzleFlash = null;
    this.weaponMount = null;
    this._recoil = 0;
    this._shotKick = 0;
    /** ADS: click derecho sostiene mira al ojo */
    this.adsHeld = false;
    this._ads = 0;
    /** Campo de tiro plano (minivista) — sin planeta esférico */
    this.rangeMode = false;
    this._basisAxis = new THREE.Vector3();
    this._negZ = new THREE.Vector3(0, 0, -1);
    this._localAim = new THREE.Vector3();
    this._invVisualMat = new THREE.Matrix4();
    this._aimMountQ = new THREE.Quaternion();
    this._gripQ = new THREE.Quaternion();
    this._gripFrom = new THREE.Quaternion();
    this._ikTargetR = new THREE.Vector3();
    this._ikTargetL = new THREE.Vector3();
    this._ikPoleR = new THREE.Vector3();
    this._ikPoleL = new THREE.Vector3();
    /** Movimiento vivo del arma (sync con pasos / giro) */
    this._weaponBob = 0;
    this._weaponLagYaw = 0;
    this._weaponLagPitch = 0;
    this._prevYaw = 0;
    this._prevPitch = 0.05;
    this.collisionRadius = 48;
    /** Callback opcional: (worldPos, radius) => void — empuja sólidamente vs fauna */
    this.onResolveCollision = null;
    /** @type {((payload: object) => void)|null} */
    this.onWeaponChange = null;

    this.weapons = new WeaponSystem({ charHeight: this.charHeight });
    this.weapons.onChange((payload) => {
      this.weapon = this.weapons.weaponRoot;
      this.weaponMuzzle = this.weapons.muzzle;
      this._muzzleFlash = this.weapons.muzzleFlash;
      if (typeof this.onWeaponChange === 'function') this.onWeaponChange(payload);
    });

    this.root = new THREE.Group();
    this.visual = new THREE.Group();
    this.root.add(this.visual);
    this.weaponMount = new THREE.Group();
    this.weaponMount.name = 'WeaponMount';
    this.visual.add(this.weaponMount);
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
      '<b style="color:#00ffcc">A PIE — controles</b><br>' +
      '<span style="color:#fff">W</span> adelante · <span style="color:#fff">S</span> atrás · <span style="color:#fff">A/D</span> lados<br>' +
      '<span style="color:#fff">Ratón</span> mirar · <span style="color:#fff">Click izq</span> disparar · <span style="color:#fff">Click der</span> apuntar<br>' +
      '<span style="color:#fff">1–8</span> armas · <span style="color:#fff">Q/R</span> cambiar · <span style="color:#fff">V</span> menú (Esc cierra)<br>' +
      '<span style="color:#fff">Shift</span> correr · <span style="color:#fff">Espacio</span> saltar · <span style="color:#fff">E/L</span> nave';
    document.body.appendChild(this.controlsPanel);
  }

  /** Click derecho: sostener = ADS (mira al ojo). */
  setAds(held) {
    this.adsHeld = !!held && this.active;
  }

  _syncAdsCrosshair(on) {
    const cross = document.getElementById('crosshair');
    if (!cross) return;
    cross.classList.toggle('ads', !!on);
    document.body.classList.toggle('ads-aiming', !!on);
  }

  _adsFovTarget() {
    const cat = this.weapons.getEquippedDef()?.category;
    if (cat === 'sniper') return 28;
    if (cat === 'pistol') return 46;
    if (cat === 'smg') return 40;
    if (cat === 'heavy') return 38;
    return 36;
  }

  _setExplorationHud(on) {
    const cross = document.getElementById('crosshair');
    const lock = document.getElementById('lock-on-ui');
    if (cross) {
      if (on) {
        cross.classList.add('on-foot');
        cross.style.display = 'block';
        cross.style.opacity = '1';
      } else {
        cross.classList.remove('on-foot', 'ads');
        cross.style.display = '';
        cross.style.opacity = '1';
      }
    }
    if (lock) lock.style.display = 'none';
    document.body.classList.toggle('exploring-on-foot', !!on);
    if (!on) {
      this.adsHeld = false;
      this._ads = 0;
      document.body.classList.remove('ads-aiming');
    }
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
    this._boneBind = this._boneBind || {};
    model.traverse((obj) => {
      if (obj.isBone) {
        const bare = obj.name.replace(/^mixamorig:?/i, '');
        this.bones[bare] = obj;
        this.bones[obj.name] = obj;
        this._boneBind[bare] = obj.quaternion.clone();
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
    this.weapons.equipDefault(this.weaponMount).catch((err) => {
      console.warn('[SurfaceWalker] equipDefault falló', err);
    });
  }

  /** Equipa arma por id (hotbar / menú). */
  equipWeapon(id) {
    return this.weapons.equip(id, this.weaponMount);
  }

  /** Equipa por slot 1..8 */
  equipWeaponSlot(slot) {
    return this.weapons.equipSlot(slot, this.weaponMount);
  }

  cycleWeapon(dir) {
    return this.weapons.cycle(dir, this.weaponMount);
  }

  getEquippedWeapon() {
    return this.weapons.getEquippedDef();
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
    // Clips completos: el mixer reinicia el torso cada frame.
    // (Solo piernas + _rotateBone acumulaba y aplastaba el mesh.)
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
      this.pitch = 0.05;
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

  /**
   * Minivista / campo de tiro: mismo personaje, armas, ADS y animaciones
   * que a pie en el planeta, sobre suelo plano Y-up.
   */
  enterFlatRange() {
    this.rangeMode = true;
    this.active = true;
    this.ship = null;
    this.planet = {
      group: new THREE.Group(),
      radius: 1e7,
      biome: 'Desert'
    };
    // Centro del “planeta” debajo: superficie ≈ y=0, up = +Y
    this.planet.group.position.set(0, -1e7, 0);
    this._localDir.set(0, 1, 0);
    this._up.set(0, 1, 0);
    this.root.position.set(0, this.footOffset, 0);
    this.yaw = 0;
    this._faceYaw = 0;
    this.pitch = 0.05;
    this.cameraDist = 230;
    this.currentSpeed = 0;
    this.verticalOffset = 0;
    this.verticalVelocity = 0;
    this.grounded = true;
    this._spawnLock = 0.15;
    this._camSnap = true;
    this.adsHeld = false;
    this._ads = 0;
    this.root.visible = true;
    this.controlsPanel.style.display = 'block';
    this._setExplorationHud(true);
    this._savedFov = this.camera.fov || 75;
    this.camera.fov = 60;
    this.camera.updateProjectionMatrix();
    this._buildTangentBasis(this._up);
    this._orientCharacter(this._fwd.set(0, 0, -1), this._up);
    return true;
  }

  exitFlatRange() {
    if (!this.rangeMode) return;
    this.rangeMode = false;
    this.active = false;
    this.setAds(false);
    this.root.visible = false;
    this.controlsPanel.style.display = 'none';
    this._setExplorationHud(false);
    this.planet = null;
    this.camera.fov = this._savedFov || 75;
    this.camera.updateProjectionMatrix();
  }

  boardShip() {
    if (this.rangeMode) {
      this.exitFlatRange();
      return;
    }
    if (!this.active && !this.ship) return;
    const ship = this.ship;
    this.active = false;
    this.setAds(false);
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
    // ADS: sensibilidad más baja (más preciso)
    const ads = this._ads || 0;
    const yawSens = THREE.MathUtils.lerp(0.002, 0.00085, ads);
    const pitchSens = THREE.MathUtils.lerp(0.0016, 0.0007, ads);
    this.yaw += dx * yawSens;
    this._faceYaw = this.yaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * pitchSens, -0.95, 0.62);
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
    if (this.rangeMode) {
      this.root.position.set(
        approxWorldPos.x,
        this.footOffset + this.verticalOffset,
        approxWorldPos.z
      );
      this._up.set(0, 1, 0);
      this._localDir.set(0, 1, 0);
      return;
    }
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
    if (this.rangeMode) {
      this.root.position.y = this.footOffset + this.verticalOffset;
      this._up.set(0, 1, 0);
      this._localDir.set(0, 1, 0);
      return;
    }
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
    // Mover el pose de cámara con el personaje (no solo camera.position suelto)
    this._camPos.add(this._syncDelta);
    this._lookTarget.add(this._syncDelta);
    this.applyCamera();
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
   * Mezcla Idle/Walk/Run (solo piernas) y capa de torso/arma sincronizada al paso.
   */
  _animatePilot(dt, moving, running) {
    if (!this.mixer) {
      this._walkPhase += dt * (moving ? (running ? 9 : 5.5) : 1.2);
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
      wIdle = Math.max(wIdle, 0.35);
    }

    const blend = Math.min(1, dt * 9);
    this._applyWeight(this.actions.Idle, wIdle, blend);
    this._applyWeight(this.actions.Walk, wWalk, blend);
    this._applyWeight(this.actions.Run, wRun, blend);

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

    // Fase del paso = clips reales (2 zancadas por ciclo Mixamo) → arma/torso sync.
    const loco = wRun >= wWalk ? this.actions.Run : this.actions.Walk;
    if (loco && loco.getEffectiveWeight() > 0.15 && !airborne) {
      const dur = Math.max(loco.getClip()?.duration || 1, 0.01);
      this._walkPhase = (loco.time / dur) * Math.PI * 4;
    } else {
      this._walkPhase += dt * (moving ? (running ? 9 : 5.5) : 1.35);
    }

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
  /** Recoil + flash al disparar. */
  notifyShot() {
    const def = this.weapons.getEquippedDef();
    const kick = def?.recoilKick ?? 1;
    this._recoil = kick;
    this._shotKick = kick;
    if (this._muzzleFlash) {
      this._muzzleFlash.visible = true;
      this._muzzleFlash.material.opacity = 1;
      this._muzzleFlash.scale.setScalar(1.2 + kick * 0.25);
    }
  }

  _applyBoneTouches(dt, moving, running, airborne) {
    const speedRatio = THREE.MathUtils.clamp(this.currentSpeed / this.runSpeed, 0, 1);
    const leanTarget = airborne ? 0.08 : speedRatio * (running ? 0.1 : 0.06);
    this._lean = THREE.MathUtils.lerp(this._lean ?? 0, leanTarget, Math.min(1, dt * 6));
    this._recoil = Math.max(0, (this._recoil || 0) - dt * 5.5);
    this._shotKick = Math.max(0, (this._shotKick || 0) - dt * 7);
    const recoil = this._recoil;
    const pitch = THREE.MathUtils.clamp(this.pitch, -0.95, 0.62);
    const ads = this._ads || 0;
    const ph = this._walkPhase;
    // Solo respiracion / pitch — sin twist Y/Z (eso se veia poseido).
    const breathe = Math.sin(ph * 0.5) * (moving ? 0.008 : 0.02) * (1 - ads * 0.6);
    const stepBob = moving && !airborne ? Math.sin(ph * 2) * (running ? 0.02 : 0.012) * (1 - ads) : 0;

    if (this._muzzleFlash?.visible) {
      this._muzzleFlash.material.opacity = Math.max(0, this._muzzleFlash.material.opacity - dt * 9);
      this._muzzleFlash.scale.multiplyScalar(1 + dt * 3.5);
      if (this._muzzleFlash.material.opacity <= 0.05) {
        this._muzzleFlash.visible = false;
        this._muzzleFlash.material.opacity = 0;
      }
    }

    this._rotateBone(this.bones.Spine, this._lean * 0.12 + pitch * 0.06 + breathe + stepBob);
    this._rotateBone(this.bones.Spine1, this._lean * 0.1 + pitch * 0.14 - recoil * 0.08 + breathe * 0.5);
    this._rotateBone(this.bones.Spine2, pitch * 0.12 - recoil * 0.06);
    this._rotateBone(this.bones.Neck, pitch * 0.1);
    this._rotateBone(this.bones.Head, -this._lean * 0.18 + pitch * 0.35);

    // Brazos: warm-start suave; el IK (two-bone + orientacion) manda.
    const hold = this.weapons.getHold();
    const twoHand = hold ? hold.twoHand !== false : true;
    const raise =
      THREE.MathUtils.lerp(-0.28, -0.55, ads) + pitch * 0.15 - recoil * 0.08;
    this._applyGripFromBind('RightShoulder', -0.02, 0.08, -0.04, 0.35);
    this._applyGripFromBind('RightArm', raise, 0.22, -0.08, 0.4);
    this._applyGripFromBind('RightForeArm', -0.25, 0.1, 0.06, 0.35);
    if (twoHand) {
      this._applyGripFromBind('LeftShoulder', -0.02, -0.08, 0.06, 0.35);
      this._applyGripFromBind('LeftArm', raise * 0.85 - 0.05, -0.28, 0.12, 0.4);
      this._applyGripFromBind('LeftForeArm', -0.35, -0.08, 0.1, 0.35);
    } else {
      const swing = Math.sin(ph) * (moving && !airborne ? 0.28 : 0.04) * (1 - ads * 0.6);
      this._applyGripFromBind('LeftShoulder', 0.05, -0.02, 0.08, 0.45);
      this._applyGripFromBind('LeftArm', 0.2 + swing * 0.4, -0.15, 0.18 + swing * 0.15, 0.55);
      this._applyGripFromBind('LeftForeArm', 0.1 + Math.abs(swing) * 0.12, 0, 0.06, 0.42);
    }

    for (const [boneName, angles] of Object.entries(GRIP_FINGERS)) {
      if (!twoHand && boneName.startsWith('Left')) continue;
      this._applyGripFromBind(boneName, angles[0], angles[1], angles[2], 0.85);
    }

    if (airborne) {
      const tuck = THREE.MathUtils.clamp(this.verticalVelocity / 150, -1, 1);
      this._rotateBone(this.bones.LeftUpLeg, -0.35 - tuck * 0.25);
      this._rotateBone(this.bones.RightUpLeg, -0.15 + tuck * 0.2);
      this._rotateBone(this.bones.LeftLeg, 0.55);
      this._rotateBone(this.bones.RightLeg, 0.3);
    }
  }

  /**
   * Manos → grips del arma (IK + orientación). Debe correr DESPUÉS de _alignWeaponMount.
   */
  _solveWeaponHandIk() {
    const markers = this.weapons.getGripMarkers();
    if (!markers?.gripR || !this.bones.RightHand || !this.model) return;

    this.model.updateMatrixWorld(true);
    this.weaponMount.updateWorldMatrix(true, true);

    markers.gripR.getWorldPosition(this._ikTargetR);
    markers.gripL.getWorldPosition(this._ikTargetL);

    const axes = weaponAxesFromMount(this.weaponMount);
    solveArmToTarget(this.bones, 'Right', this._ikTargetR, axes, 1);
    if (markers.twoHand !== false) {
      solveArmToTarget(this.bones, 'Left', this._ikTargetL, axes, 1);
    }
    this.model.updateMatrixWorld(true);
  }

  /**
   * Lag / bob del arma (tras mira). Debe ir antes de _alignWeaponMount.
   */
  _updateWeaponMotion(dt) {
    let dYaw = this.yaw - this._prevYaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const dPitch = this.pitch - this._prevPitch;
    this._prevYaw = this.yaw;
    this._prevPitch = this.pitch;

    // Lag suave al girar (sin sacudidas).
    this._weaponLagYaw = THREE.MathUtils.clamp(this._weaponLagYaw - dYaw * 0.35, -0.12, 0.12);
    this._weaponLagPitch = THREE.MathUtils.clamp(this._weaponLagPitch - dPitch * 0.25, -0.08, 0.08);
    this._weaponLagYaw = THREE.MathUtils.damp(this._weaponLagYaw, 0, 10, dt);
    this._weaponLagPitch = THREE.MathUtils.damp(this._weaponLagPitch, 0, 10, dt);

    const ads = this._ads || 0;
    const speedRatio = THREE.MathUtils.clamp(this.currentSpeed / this.runSpeed, 0, 1);
    const moving = this.currentSpeed > 12;
    let amp = !this.grounded ? 0.08 : moving ? 0.18 + speedRatio * 0.35 : 0.05;
    amp *= THREE.MathUtils.lerp(1, 0.08, ads);
    this._weaponBob = amp;
  }

  /**
   * Cañón = mira. Ancla el pistol-grip al hombro derecho (offsets en marco de mira)
   * para que ambos grips queden dentro del reach real del Mixamo (~50u).
   */
  _alignWeaponMount() {
    if (!this.weaponMount || !this.visual) return;
    const recoil = this._recoil || 0;
    const ads = this._ads || 0;
    const hip = this.weapons.getMount();
    const adsM = this.weapons.getAdsMount();
    const ph = this._walkPhase;
    const amp = this._weaponBob || 0;
    const bobX = Math.sin(ph) * amp * 1.1;
    const bobY = Math.sin(ph * 2) * amp * 1.4;
    const bobZ = Math.cos(ph * 2) * amp * 0.45;

    this.visual.updateWorldMatrix(true, false);
    this._invVisualMat.copy(this.visual.matrixWorld).invert();
    this._localAim.copy(this._aimDir).transformDirection(this._invVisualMat);
    if (this._localAim.lengthSq() < 1e-8) this._localAim.set(0, 0, -1);
    else this._localAim.normalize();
    this._aimMountQ.setFromUnitVectors(this._negZ, this._localAim);

    if (Math.abs(this._weaponLagYaw) > 1e-4 || Math.abs(this._weaponLagPitch) > 1e-4) {
      this._boneEuler = this._boneEuler || new THREE.Euler(0, 0, 0, 'XYZ');
      this._boneEuler.set(this._weaponLagPitch, this._weaponLagYaw * 0.5, 0);
      this._gripQ.setFromEuler(this._boneEuler);
      this._aimMountQ.multiply(this._gripQ);
    }
    this.weaponMount.quaternion.copy(this._aimMountQ);

    // Marco de mira en espacio visual
    this._wUp = this._wUp || new THREE.Vector3();
    this._wRight = this._wRight || new THREE.Vector3();
    this._wUp.set(0, 1, 0);
    this._wRight.crossVectors(this._wUp, this._localAim);
    if (this._wRight.lengthSq() < 1e-8) this._wRight.set(1, 0, 0);
    else this._wRight.normalize();
    this._wUp.crossVectors(this._localAim, this._wRight).normalize();

    // Ancla: hombro derecho (o pecho ADS)
    const shBone =
      ads > 0.55
        ? this.bones.Head || this.bones.Spine2 || this.bones.RightShoulder
        : this.bones.RightShoulder || this.bones.RightArm || this.bones.Spine2;
    this._anchor = this._anchor || new THREE.Vector3();
    if (shBone) {
      shBone.updateWorldMatrix(true, false);
      shBone.getWorldPosition(this._anchor);
      this._anchor.applyMatrix4(this._invVisualMat);
    } else {
      this._anchor.set(0, this.charHeight * 0.72, 0);
    }

    // Offsets catalog: x=lateral, y=drop abs→ relativo, z=forward depth
    // Hip: un poco a la derecha, abajo del hombro, adelante corto.
    const lat = THREE.MathUtils.lerp(
      hip.lateral ?? Math.max(6, (hip.x ?? 10) * 0.55),
      adsM.lateral ?? Math.max(3, (adsM.x ?? 5) * 0.45),
      ads
    );
    const drop = THREE.MathUtils.lerp(
      hip.drop ?? -28,
      adsM.drop ?? -12,
      ads
    );
    const fwd = THREE.MathUtils.lerp(
      hip.forward ?? 14,
      adsM.forward ?? 18,
      ads
    );

    this.weaponMount.position
      .copy(this._anchor)
      .addScaledVector(this._wRight, lat + bobX * 0.15 + recoil * 0.4)
      .addScaledVector(this._wUp, drop + bobY * 0.2 + recoil * 0.6)
      .addScaledVector(this._localAim, fwd + bobZ * 0.15 + recoil * (2.5 - ads));

    // Si el gripL quedaría fuera de alcance, acercar el arma al pecho.
    const markers = this.weapons.getGripMarkers?.();
    const leftSh = this.bones.LeftShoulder || this.bones.LeftArm;
    if (markers?.gripL && leftSh) {
      this.weaponMount.updateWorldMatrix(true, true);
      leftSh.getWorldPosition(this._ikTargetL);
      markers.gripL.getWorldPosition(this._ikTargetR); // temp reuse
      const dist = this._ikTargetL.distanceTo(this._ikTargetR);
      const maxComfort = 42; // ~0.84 * reach 50
      if (dist > maxComfort) {
        const pull = (dist - maxComfort) / dist;
        this.weaponMount.position.addScaledVector(this._localAim, -pull * 10);
        this.weaponMount.position.addScaledVector(this._wRight, -pull * 6);
      }
    }

    if (this.weapon) {
      this.weapon.position.set(0, 0, 0);
      this.weapon.rotation.set(0, 0, 0);
    }
  }

  /** Offset relativo encima del clip (después de mixer.update). */
  _rotateBone(bone, angleX, angleY = 0, angleZ = 0) {
    if (!bone) return;
    if (!angleX && !angleY && !angleZ) return;
    this._boneQuat = this._boneQuat || new THREE.Quaternion();
    this._boneEuler = this._boneEuler || new THREE.Euler(0, 0, 0, 'XYZ');
    this._boneEuler.set(angleX || 0, angleY || 0, angleZ || 0);
    this._boneQuat.setFromEuler(this._boneEuler);
    bone.quaternion.multiply(this._boneQuat);
  }

  /**
   * Pose de agarre estable: bind * euler, slerp encima del clip.
   * Evita el brazo “muerto” / columpiando del Walk/Run.
   */
  _applyGripFromBind(boneName, angleX, angleY = 0, angleZ = 0, weight = 0.92) {
    const bone = this.bones[boneName];
    if (!bone) return;
    this._boneEuler = this._boneEuler || new THREE.Euler(0, 0, 0, 'XYZ');
    this._boneEuler.set(angleX || 0, angleY || 0, angleZ || 0);
    this._gripQ.setFromEuler(this._boneEuler);
    const bind = this._boneBind?.[boneName];
    if (bind) {
      this._gripFrom.copy(bind).multiply(this._gripQ);
    } else {
      this._gripFrom.copy(bone.quaternion).multiply(this._gripQ);
    }
    bone.quaternion.slerp(this._gripFrom, weight);
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
      if (this.rangeMode) this.exitFlatRange();
      else this.boardShip();
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
    const running = moving && !!(keys.ShiftLeft || keys.ShiftRight) && this._ads < 0.35;
    // ADS: suavizar entrada/salida
    const adsTarget = this.adsHeld ? 1 : 0;
    this._ads = THREE.MathUtils.damp(this._ads, adsTarget, this.adsHeld ? 14 : 11, dt);
    this._syncAdsCrosshair(this._ads > 0.45);

    let targetSpeed = moving ? (running ? this.runSpeed : this.walkSpeed) : 0;
    if (this._ads > 0.05) {
      // Apuntando: más lento (no sprint)
      targetSpeed *= THREE.MathUtils.lerp(1, 0.55, this._ads);
    }
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
      }
    }
    // Shooter: el cuerpo mira hacia donde apuntas (cámara), no hacia el WASD
    {
      const turnDelta = Math.atan2(
        Math.sin(this.yaw - this._faceYaw),
        Math.cos(this.yaw - this._faceYaw)
      );
      this._faceYaw += turnDelta * (1 - Math.exp(-18 * dt));
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

    // Sólidos: no atravesar fauna
    if (typeof this.onResolveCollision === 'function') {
      this.onResolveCollision(this.root.position, this.collisionRadius);
      this._snapToSurface(this.root.position);
    }

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

    const ads = this._ads || 0;
    const hipFov = running ? 64 : (moving ? 61 : 60);
    const targetFov = THREE.MathUtils.lerp(hipFov, this._adsFovTarget(), ads);
    const nextFov = THREE.MathUtils.damp(this.camera.fov, targetFov, 10, dt);
    if (Math.abs(nextFov - this.camera.fov) > 0.01) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }

    // Cámara TPS / ADS: cruz = aimDir; en ADS casi sobre el ojo derecho.
    const headH = this.charHeight;
    const eyeH = THREE.MathUtils.lerp(headH * 0.72, headH * 0.78, ads);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    this._aimDir.copy(this._fwd).multiplyScalar(cp).addScaledVector(up, sp);
    if (this._aimDir.lengthSq() < 1e-8) this._aimDir.copy(this._fwd);
    else this._aimDir.normalize();

    this._updateWeaponMotion(dt);
    this._alignWeaponMount();
    this._solveWeaponHandIk();

    // ADS: acercar y zoom, pero seguir sobre el hombro (nunca meterse en el mesh).
    // hipDist≈230; adsDist≈95 + shoulder≈22 ≈ cámara fuera del torso.
    const hipDist = this.cameraDist;
    const adsDist = 95;
    const camDist = THREE.MathUtils.lerp(hipDist, adsDist, ads);
    const shoulder = THREE.MathUtils.lerp(36, 22, ads);
    // Kick de cámara al disparar (menos en ADS)
    const kick = (this._shotKick || 0) * THREE.MathUtils.lerp(14, 6, ads);
    this._camPos.copy(this.root.position)
      .addScaledVector(up, eyeH + kick * 0.15)
      .addScaledVector(this._aimDir, -camDist + kick * 0.35)
      .addScaledVector(this._right, shoulder);

    const camAway = this._tmp.copy(this._camPos).sub(this.planet.group.position);
    if (!this.rangeMode && camAway.lengthSq() > 1e-6) {
      camAway.normalize();
      const minRadius = this._terrainRadius(camAway) + 35;
      if (this._camPos.distanceTo(this.planet.group.position) < minRadius) {
        this._camPos.copy(this.planet.group.position).addScaledVector(camAway, minRadius);
      }
    }

    // Crítico: lookTarget = cam + aimDir → la cruz apunta exactamente a aimDir
    this._lookTarget.copy(this._camPos).addScaledVector(this._aimDir, 1200);

    this._cameraQuat.setFromRotationMatrix(
      this._cameraMat.lookAt(this._camPos, this._lookTarget, up)
    );

    this.applyCamera();
  }

  /** Aplica el pose de cámara del walker (llamar también tras sync/clip del planeta). */
  applyCamera() {
    if (!this.active) return;
    this.camera.position.copy(this._camPos);
    this.camera.quaternion.copy(this._cameraQuat);
    this.camera.updateMatrixWorld(true);
  }

  /**
   * Disparo alineado a la cruz: dirección = aimDir (yaw/pitch sobre el up del planeta).
   * Independiente de clips/sync que muevan la cámara después.
   */
  getAimRay(originOut, dirOut) {
    const up = this._up;
    const eyeH = this.charHeight * 0.72;
    dirOut.copy(this._aimDir.lengthSq() > 1e-8 ? this._aimDir : this._fwd).normalize();

    // Punto bajo la cruz (misma línea que usa la cámara)
    this._muzzleWorld.copy(this._camPos).addScaledVector(dirOut, 4000);

    let useMuzzle = false;
    if (this.weaponMuzzle && this.weapon?.parent) {
      this.weaponMuzzle.getWorldPosition(originOut);
      this._tmp.copy(originOut).sub(this._camPos);
      if (this._tmp.dot(dirOut) > 25) useMuzzle = true;
    }
    if (useMuzzle) {
      dirOut.copy(this._muzzleWorld).sub(originOut);
      if (dirOut.lengthSq() < 1e-6) dirOut.copy(this._aimDir);
      else dirOut.normalize();
    } else {
      originOut.copy(this._camPos).addScaledVector(dirOut, 40);
    }
    this.applyCamera();
    return dirOut;
  }

  nearShip(maxDist = 500) {
    return !!this.ship &&
      this.root.position.distanceTo(this.ship.mesh.position) < maxDist;
  }
}
