import * as THREE from 'three';

/** Paleta compartida — todo combate usa estos tonos. */
export const COMBAT_PALETTE = {
    shield: { core: 0x44ddff, glow: 0x88eeff, flash: 0xccffff },
    hull: { core: 0xff3344, glow: 0xff6622, flash: 0xffaa44 },
    crit: { core: 0xff8800, glow: 0xffcc22, flash: 0xffffaa },
    kill: { core: 0xff2200, glow: 0xff5500, flash: 0xff9933 },
    energy: { core: 0x66ccff, glow: 0x44aaff, flash: 0xaaddff },
};

const ABILITY_COLORS = {
    repair: 0x66ee99,
    shield: COMBAT_PALETTE.shield.core,
    missile: 0xff7733,
    nitro: 0xffaa44,
    ion: 0xaa66ff,
    hit: COMBAT_PALETTE.hull.flash,
    kill: COMBAT_PALETTE.kill.core,
};

/**
 * Efectos efímeros Three.js — anillos, cascadas, cascos energéticos, sacudida.
 * API unificada: combatImpact() para feedback coherente escudo / casco / crítico.
 */
export class VfxManager {
    constructor(scene) {
        this.scene = scene;
        /** @type {Array<object>} */
        this._fx = [];
        this._shake = { intensity: 0, decay: 3.8 };
        this._lightPool = [];
        this._tmpDir = new THREE.Vector3();
        this._tmpPos = new THREE.Vector3();
        /** @type {WeakMap<object, object>} capas de ripple sobre esfera del escudo */
        this._shieldRippleLayers = new WeakMap();
        this._playerRepairFx = null;
        this._playerShieldFx = null;
        this._combatLoadLevel = 'light';
        this._combatCaps = null;
        this._maxTransientFx = 48;
    }

    setCombatLoad(level, caps) {
        this._combatLoadLevel = level || 'light';
        this._combatCaps = caps || null;
        if (caps?.maxVfx) this._maxTransientFx = caps.maxVfx;
    }

    _trimTransientFx() {
        const max = this._maxTransientFx ?? 48;
        const protectedTypes = new Set(['playerRepairField', 'playerSlowField', 'shieldRippleAnim']);
        while (this._fx.length >= max) {
            let idx = -1;
            for (let i = 0; i < this._fx.length; i++) {
                if (!protectedTypes.has(this._fx[i].type)) { idx = i; break; }
            }
            if (idx < 0) break;
            this._disposeFx(this._fx[idx]);
            this._fx.splice(idx, 1);
        }
    }

    /** Limpia VFX efímeros de combate (explosiones, sacudida, flashes) sin tocar habilidades del jugador. */
    clearTransientCombat() {
        this._shake.intensity = 0;
        for (let i = this._fx.length - 1; i >= 0; i--) {
            const fx = this._fx[i];
            if (fx.type === 'playerRepairField' || fx.type === 'playerSlowField') continue;
            if (fx.type === 'shieldRippleAnim') continue;
            this._disposeFx(fx);
            this._fx.splice(i, 1);
        }
    }

    update(delta) {
        if (this._shake.intensity > 0) {
            this._shake.intensity = Math.max(0, this._shake.intensity - this._shake.decay * delta);
        }

        for (let i = this._fx.length - 1; i >= 0; i--) {
            const fx = this._fx[i];

            if (fx.type === 'shieldRippleAnim') {
                if (!fx.playing) continue;
                fx.t += delta;
                const rippleLife = Math.min(1, fx.t / fx.duration);
                fx.uniforms.uRippleT.value = rippleLife;
                fx.uniforms.uTime.value += delta;
                if (rippleLife >= 1) {
                    fx.playing = false;
                    fx.t = 0;
                    fx.uniforms.uRippleT.value = 0;
                    fx.mesh.visible = false;
                }
                continue;
            }

            if (fx.type === 'playerSlowField') {
                if (!fx.target?.position) {
                    this._clearPlayerSlowField();
                    continue;
                }
                fx.t += delta;
                fx.sparkTimer += delta;
                const life = fx.t / fx.duration;
                if (life >= 1) {
                    this._clearPlayerSlowField();
                    continue;
                }
                if (fx.sparkTimer >= 0.5) {
                    fx.sparkTimer = 0;
                    const pos = fx.target.position.clone();
                    pos.y += 10;
                    this.hitSparks(pos, {
                        color: 0xaa55ff,
                        count: 5,
                        spread: 16,
                        size: 3.2,
                        duration: 0.38,
                    });
                }
                continue;
            }

            if (fx.type === 'playerRepairField') {
                const anchor = this._resolvePlayerAnchor(fx.player);
                if (!this._playerRepairFx || fx !== this._playerRepairFx || !anchor) {
                    this._clearPlayerRepairField();
                    continue;
                }
                fx.sparkTimer += delta;
                if (fx.sparkTimer >= (fx.intense ? 0.22 : 0.36)) {
                    fx.sparkTimer = 0;
                    this._risingSparks(anchor, 0x44ee99, fx.intense ? 9 : 5, {
                        size: 5,
                        spread: 13,
                        duration: 0.62,
                    });
                }
                continue;
            }

            fx.t += delta;
            const life = fx.t / fx.duration;

            if (life >= 1) {
                this._disposeFx(fx);
                this._fx.splice(i, 1);
                continue;
            }

            if (fx.type === 'scaleRing') {
                const ease = 1 - Math.pow(1 - life, 2.2);
                const s = fx.startScale + ease * fx.maxScale;
                fx.mesh.scale.setScalar(s);
                fx.mat.opacity = fx.startOpacity * (1 - life * life);
            } else if (fx.type === 'multiRing') {
                for (const ring of fx.rings) {
                    const local = Math.max(0, Math.min(1, (fx.t - ring.delay) / ring.duration));
                    if (local <= 0) continue;
                    const ease = 1 - Math.pow(1 - local, 2.4);
                    ring.mesh.scale.setScalar(ring.startScale + ease * ring.maxScale);
                    ring.mat.opacity = ring.startOpacity * (1 - local * local);
                }
            } else if (fx.type === 'expandShell') {
                const ease = 1 - Math.pow(1 - life, 1.85);
                const s = fx.startScale + ease * fx.maxScale;
                fx.mesh.scale.setScalar(s);
                fx.mat.opacity = fx.startOpacity * (1 - life) * (1 - life * 0.35);
                fx.mesh.rotation.y += delta * fx.spin;
                fx.mesh.rotation.x += delta * fx.spin * 0.55;
            } else if (fx.type === 'points') {
                const arr = fx.geo.attributes.position.array;
                for (let p = 0; p < fx.velocities.length; p++) {
                    arr[p * 3] += fx.velocities[p].x * delta;
                    arr[p * 3 + 1] += fx.velocities[p].y * delta;
                    arr[p * 3 + 2] += fx.velocities[p].z * delta;
                    fx.velocities[p].multiplyScalar(Math.max(0, 1 - 4.5 * delta));
                    fx.velocities[p].y -= 22 * delta;
                }
                fx.geo.attributes.position.needsUpdate = true;
                fx.mat.opacity = fx.startOpacity * (1 - life);
                fx.mat.size = fx.baseSize * (1 + life * 0.4);
            } else if (fx.type === 'flashMesh') {
                const pulse = Math.sin(life * Math.PI);
                fx.mesh.scale.setScalar(fx.baseScale * (0.6 + pulse * 0.9));
                fx.mat.opacity = fx.startOpacity * pulse;
            } else if (fx.type === 'pointLight') {
                fx.light.intensity = fx.peak * (1 - life);
            } else if (fx.type === 'beam') {
                const pulse = Math.sin(life * Math.PI);
                fx.mesh.scale.set(fx.width, fx.length * (0.4 + pulse * 0.6), fx.width);
                fx.mat.opacity = fx.startOpacity * pulse;
            }
        }
    }

    addShake(amount = 0.35) {
        this._shake.intensity = Math.min(1.35, this._shake.intensity + amount);
    }

    getCameraShakeOffset() {
        const s = this._shake.intensity;
        if (s <= 0.01) return null;
        return {
            x: (Math.random() - 0.5) * 14 * s,
            y: (Math.random() - 0.5) * 9 * s,
            z: (Math.random() - 0.5) * 14 * s,
        };
    }

    /**
     * Feedback de combate unificado.
     * @param {'shield'|'hull'|'shieldBreak'|'crit'|'kill'} kind
     */
    combatImpact(position, kind = 'hull', opts = {}) {
        const pos = this._vec(position);
        const severity = Math.max(0.06, Math.min(1, opts.severity ?? 0.25));
        const amount = opts.amount ?? 20;

        switch (kind) {
            case 'shield':
                this._shieldImpact(pos, severity, amount, opts);
                break;
            case 'shieldBreak':
                this._shieldImpact(pos, severity, amount, opts);
                this._hullImpact(pos, Math.min(0.55, severity + 0.12), opts.hullLost ?? amount * 0.35);
                break;
            case 'crit':
                this._hullImpact(pos, Math.min(1, severity + 0.2), amount, COMBAT_PALETTE.crit);
                break;
            case 'kill':
                this._killBurst(pos, opts.scale ?? 1);
                break;
            case 'hull':
            default:
                this._hullImpact(pos, severity, amount);
                break;
        }
    }

    /**
     * Onda de energía que se propaga sobre la esfera del escudo (shader en la cúpula).
     */
    shieldSurfaceRipple(shellMesh, hitFromWorld, severity = 0.3) {
        if (!shellMesh?.isMesh) return;

        let layer = this._shieldRippleLayers.get(shellMesh);
        if (!layer) {
            layer = this._createShieldRippleLayer(shellMesh);
            this._shieldRippleLayers.set(shellMesh, layer);
        }

        const hitDir = this._tmpDir;
        if (hitFromWorld?.isVector3) {
            hitDir.copy(hitFromWorld);
            shellMesh.worldToLocal(hitDir);
        } else {
            hitDir.set(
                Math.random() - 0.5,
                Math.random() - 0.5,
                Math.random() - 0.5,
            );
        }
        if (hitDir.lengthSq() < 0.001) hitDir.set(0, 1, 0);
        hitDir.normalize();

        layer.uniforms.uHitDir.value.copy(hitDir);
        layer.uniforms.uRippleT.value = 0;
        layer.uniforms.uIntensity.value = 0.55 + severity * 0.45;
        layer.t = 0;
        layer.duration = 0.42 + severity * 0.14;
        layer.playing = true;
        layer.mesh.visible = true;
    }

    _createShieldRippleLayer(shellMesh) {
        const uniforms = {
            uHitDir: { value: new THREE.Vector3(0, 1, 0) },
            uRippleT: { value: 0 },
            uTime: { value: 0 },
            uIntensity: { value: 1 },
            uColor: { value: new THREE.Color(COMBAT_PALETTE.shield.flash) },
        };

        const mat = new THREE.ShaderMaterial({
            uniforms,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.FrontSide,
            vertexShader: `
                varying vec3 vObjNormal;
                void main() {
                    vObjNormal = normalize(normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uHitDir;
                uniform float uRippleT;
                uniform float uTime;
                uniform float uIntensity;
                uniform vec3 uColor;
                varying vec3 vObjNormal;

                void main() {
                    vec3 n = normalize(vObjNormal);
                    vec3 h = normalize(uHitDir);
                    float ang = acos(clamp(dot(n, h), -1.0, 1.0));

                    float front = uRippleT * 1.45;
                    float band1 = smoothstep(front - 0.11, front - 0.02, ang)
                        * (1.0 - smoothstep(front + 0.01, front + 0.13, ang));
                    float band2 = smoothstep(front - 0.26, front - 0.16, ang)
                        * (1.0 - smoothstep(front - 0.05, front + 0.05, ang));
                    float ripple = (band1 + band2 * 0.45) * (1.0 - uRippleT * 0.9);

                    float hotspot = exp(-ang * ang * 55.0) * (1.0 - uRippleT);
                    float fresnel = pow(1.0 - abs(dot(n, vec3(0.0, 0.0, 1.0))), 1.8);

                    float a = (ripple * 0.8 + hotspot * 0.95 + fresnel * ripple * 0.25) * uIntensity;
                    if (a < 0.015) discard;
                    gl_FragColor = vec4(uColor, clamp(a, 0.0, 0.92));
                }
            `,
        });

        const rippleMesh = new THREE.Mesh(shellMesh.geometry, mat);
        rippleMesh.scale.setScalar(1.015);
        rippleMesh.renderOrder = 10;
        rippleMesh.frustumCulled = false;
        rippleMesh.visible = false;
        shellMesh.add(rippleMesh);

        const fx = {
            type: 'shieldRippleAnim',
            mesh: rippleMesh,
            mat,
            uniforms,
            shellMesh,
            t: 0,
            duration: 0.5,
            playing: false,
        };
        this._fx.push(fx);
        return fx;
    }

    _shieldImpact(pos, severity, amount, opts = {}) {
        const pal = COMBAT_PALETTE.shield;

        if (opts.shieldShell?.isMesh) {
            this.shieldSurfaceRipple(opts.shieldShell, opts.hitFrom, severity);
            this.hitSparks(pos, {
                color: pal.flash,
                count: Math.round(3 + severity * 4),
                spread: 10 + severity * 8,
                size: 2.5 + severity * 1.5,
                duration: 0.22,
            });
            this.addShake(0.02 + severity * 0.035);
            return;
        }

        this.hitSparks(pos, {
            color: pal.flash,
            count: 4,
            spread: 12,
            size: 3,
            duration: 0.22,
        });
        this.addShake(0.025);
    }

    _hullImpact(pos, severity, amount, palette = COMBAT_PALETTE.hull) {
        this.hitSparks(pos, {
            color: palette.flash,
            count: severity < 0.25 ? 3 : Math.round(4 + severity * 5),
            spread: 10 + severity * 10,
            size: 2 + severity * 1.5,
            duration: 0.22,
        });
        this.addShake(0.02 + severity * 0.05);

        // Impactos fuertes: destello volumétrico 3D (no anillo plano en el mapa)
        if (severity >= 0.65) {
            this._volumeFlash(pos, palette.glow, {
                maxScale: 14 + severity * 16,
                duration: 0.2,
                opacity: 0.22,
                light: 2 + severity * 4,
            });
        }
        if (severity >= 0.85) {
            this._impactBeam(pos, palette.core, severity * 0.5);
            this.flashLight(pos, palette.glow, 3 + severity * 6, 0.16);
        }
    }

    /** Partículas que suben desde la nave — reparación / buffs (sin anillos en el suelo). */
    _risingSparks(position, color, count = 14, opts = {}) {
        const pos = this._vec(position);
        const spread = opts.spread ?? 18;
        const geo = new THREE.BufferGeometry();
        const arr = new Float32Array(count * 3);
        const velocities = [];
        for (let i = 0; i < count; i++) {
            arr[i * 3] = pos.x + (Math.random() - 0.5) * spread * 0.4;
            arr[i * 3 + 1] = pos.y + (Math.random() - 0.5) * 6;
            arr[i * 3 + 2] = pos.z + (Math.random() - 0.5) * spread * 0.4;
            velocities.push(new THREE.Vector3(
                (Math.random() - 0.5) * spread * 0.35,
                28 + Math.random() * 38,
                (Math.random() - 0.5) * spread * 0.35,
            ));
        }
        geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        const mat = new THREE.PointsMaterial({
            color,
            size: opts.size ?? 5,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
        });
        const pts = new THREE.Points(geo, mat);
        pts.frustumCulled = false;
        this.scene.add(pts);
        this._fx.push({
            type: 'points',
            mesh: pts,
            geo,
            mat,
            velocities,
            t: 0,
            duration: opts.duration ?? 0.55,
            startOpacity: 0.85,
            baseSize: opts.size ?? 5,
        });
    }

    /** Destello volumétrico 3D — sustituto de anillos planos en el terreno. */
    _volumeFlash(position, color, opts = {}) {
        this._energyShell(position, color, {
            maxScale: opts.maxScale ?? 22,
            duration: opts.duration ?? 0.28,
            opacity: opts.opacity ?? 0.28,
            wireframe: opts.wireframe ?? false,
        });
        if (opts.light !== false) {
            this.flashLight(position, color, opts.light ?? 7, opts.duration ?? 0.25);
        }
    }

    _killBurst(pos, scale = 1) {
        const pal = COMBAT_PALETTE.kill;
        const s = Math.max(0.6, scale);
        this._volumeFlash(pos, pal.glow, { maxScale: 55 * s, duration: 0.55, opacity: 0.32, light: 18 });
        this._volumeFlash(pos, pal.core, { maxScale: 28 * s, duration: 0.38, opacity: 0.45, light: 0 });
        this.hitSparks(pos, {
            color: pal.flash,
            count: Math.round(35 * s),
            spread: 55 * s,
            size: 10 * s,
            duration: 0.75,
        });
        this.addShake(Math.min(0.75, 0.28 + s * 0.15));
    }

    /** Anillos concéntricos escalonados — ripple de escudo. */
    _rippleStack(position, color, opts = {}) {
        const pos = this._vec(position);
        const count = opts.rings ?? 3;
        const maxScale = opts.maxScale ?? 80;
        const duration = opts.duration ?? 0.45;
        const startOpacity = opts.startOpacity ?? 0.65;
        const rings = [];

        for (let i = 0; i < count; i++) {
            const inner = 8 + i * 3;
            const outer = inner + 7;
            const geo = new THREE.RingGeometry(inner, outer, 48);
            const mat = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: startOpacity,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
                depthWrite: false,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.rotation.x = Math.PI / 2;
            mesh.position.copy(pos);
            mesh.frustumCulled = false;
            this.scene.add(mesh);
            rings.push({
                mesh,
                mat,
                delay: i * 0.045,
                duration: duration * (0.85 + i * 0.08),
                maxScale: maxScale * (0.55 + i * 0.18),
                startScale: 0.2,
                startOpacity: startOpacity * (1 - i * 0.12),
            });
        }

        this._fx.push({
            type: 'multiRing',
            rings,
            t: 0,
            duration: duration + count * 0.05,
        });
    }

    /** Casco energético expandiéndose — icosaedro wireframe o sólido tenue. */
    _energyShell(position, color, opts = {}) {
        const pos = this._vec(position);
        const geo = new THREE.IcosahedronGeometry(1, opts.wireframe ? 1 : 0);
        const mat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: opts.opacity ?? 0.38,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            wireframe: !!opts.wireframe,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(pos);
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        this._fx.push({
            type: 'expandShell',
            mesh,
            mat,
            geo,
            t: 0,
            duration: opts.duration ?? 0.34,
            maxScale: opts.maxScale ?? 40,
            startScale: 0.15,
            startOpacity: opts.opacity ?? 0.38,
            spin: opts.wireframe ? 4.2 : 2.4,
        });
    }

    /** Rayo de impacto breve — dirección aleatoria desde el punto de golpe. */
    _impactBeam(position, color, severity) {
        const pos = this._vec(position);
        const len = 18 + severity * 42;
        const geo = new THREE.CylinderGeometry(0.8 + severity * 1.2, 2.5 + severity * 2, len, 6, 1, true);
        const mat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.75,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(pos);
        mesh.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI,
        );
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        this._fx.push({
            type: 'beam',
            mesh,
            mat,
            geo,
            t: 0,
            duration: 0.14 + severity * 0.08,
            width: 1,
            length: len,
            startOpacity: 0.75,
        });
    }

    shockwave(position, opts = {}) {
        const pos = this._vec(position);
        const color = opts.color ?? COMBAT_PALETTE.hull.glow;
        const maxScale = opts.maxScale ?? 110;
        const duration = opts.duration ?? 0.52;

        const geo = new THREE.RingGeometry(10, 18, 56);
        const mat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.62,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.copy(pos);
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        this._fx.push({
            type: 'scaleRing',
            mesh,
            mat,
            geo,
            t: 0,
            duration,
            maxScale,
            startScale: 0.25,
            startOpacity: 0.62,
        });

        if (opts.light !== 0) {
            this.flashLight(pos, color, opts.light ?? 14, duration * 0.85);
        }
    }

    hitSparks(position, opts = {}) {
        const pos = this._vec(position);
        const mul = this._combatCaps?.vfxSparkMul ?? 1;
        const color = opts.color ?? ABILITY_COLORS.hit;
        const count = Math.max(2, Math.round((opts.count ?? 18) * mul));
        const spread = opts.spread ?? 55;

        this._trimTransientFx();

        const geo = new THREE.BufferGeometry();
        const arr = new Float32Array(count * 3);
        const velocities = [];
        for (let i = 0; i < count; i++) {
            arr[i * 3] = pos.x;
            arr[i * 3 + 1] = pos.y;
            arr[i * 3 + 2] = pos.z;
            velocities.push(new THREE.Vector3(
                (Math.random() - 0.5) * spread,
                Math.random() * spread * 0.6 + 10,
                (Math.random() - 0.5) * spread,
            ));
        }
        geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        const mat = new THREE.PointsMaterial({
            color,
            size: opts.size ?? 10,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
        });
        const pts = new THREE.Points(geo, mat);
        pts.frustumCulled = false;
        this.scene.add(pts);
        this._fx.push({
            type: 'points',
            mesh: pts,
            geo,
            mat,
            velocities,
            t: 0,
            duration: opts.duration ?? 0.45,
            startOpacity: 0.9,
            baseSize: opts.size ?? 10,
        });
    }

    muzzleFlash(position, direction, color = 0x88ddff) {
        const pos = this._vec(position);
        const dir = direction?.clone?.() || new THREE.Vector3(0, 0, -1);
        if (dir.lengthSq() > 0.001) dir.normalize();
        pos.addScaledVector(dir, 8);

        const geo = new THREE.SphereGeometry(4, 10, 10);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(pos);
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        this._fx.push({
            type: 'flashMesh',
            mesh,
            mat,
            geo,
            t: 0,
            duration: 0.12,
            baseScale: 1,
            startOpacity: 0.95,
        });

        this.hitSparks(pos, { color, count: 6, spread: 28, size: 6, duration: 0.22 });
    }

    /** Habilidades del jugador — VFX 3D pegados a la nave, sin ondas en el terreno. */
    abilityBurst(position, kind = 'repair') {
        const pos = this._vec(position);
        const color = ABILITY_COLORS[kind] ?? ABILITY_COLORS.repair;

        switch (kind) {
            case 'shield':
                this.shieldActivate(pos);
                break;
            case 'missile':
                this._volumeFlash(pos, color, { maxScale: 10, duration: 0.14, opacity: 0.45, light: 9 });
                this.hitSparks(pos, { color, count: 8, spread: 16, size: 4.5, duration: 0.22 });
                break;
            case 'nitro':
                this.hitSparks(pos, { color, count: 14, spread: 22, size: 5, duration: 0.28 });
                this.flashLight(pos, color, 8, 0.2);
                break;
            case 'ion':
                this.hitSparks(pos, { color: 0xaa66ff, count: 10, spread: 12, size: 4, duration: 0.3 });
                this._volumeFlash(pos, 0x8844ff, { maxScale: 18, duration: 0.24, opacity: 0.18, light: 5 });
                break;
            case 'repair':
            default:
                this.repairBurst(pos, 0);
                break;
        }
    }

    /** Reparación — chispas verdes visibles + destello breve. */
    repairBurst(position, healAmount = 0) {
        const pos = this._vec(position);
        const color = 0x44ee99;
        const count = Math.min(24, 12 + Math.round((healAmount || 0) * 0.06));
        this._risingSparks(pos, color, count, { size: 6.5, spread: 18, duration: 0.75 });
        this.hitSparks(pos, { color, count: 10, spread: 14, size: 4, duration: 0.35 });
        this.flashLight(pos, color, 7, 0.35);
    }

    /** Activación de escudo — anillos cyan que se expanden (distinto del reparador). */
    shieldActivate(position) {
        const pos = this._vec(position);
        const pal = COMBAT_PALETTE.shield;
        this._rippleStack(pos, pal.core, {
            rings: 2,
            maxScale: 52,
            duration: 0.4,
            startOpacity: 0.5,
        });
        this.hitSparks(pos, { color: pal.glow, count: 10, spread: 12, size: 3, duration: 0.32 });
        this.flashLight(pos, pal.core, 5, 0.2);
    }

    ionPulse(position, opts = {}) {
        const pos = this._vec(position);
        if (opts.subtle) {
            this.hitSparks(pos, { color: 0x44ffff, count: 8, spread: 14, size: 3.5, duration: 0.28 });
            this.flashLight(pos, 0x44ffff, 4, 0.18);
            return;
        }
        this.abilityBurst(pos, 'ion');
    }

    /** Rastro de propulsores durante embestida E2. */
    chargeTrail(position, color = 0x00ddff) {
        if (this._combatLoadLevel && this._combatLoadLevel !== 'light') return;
        const pos = this._vec(position);
        this.hitSparks(pos, {
            color,
            count: 4,
            spread: 14,
            size: 6,
            duration: 0.22,
        });
        this.flashLight(pos, color, 5, 0.1);
    }

    /** Burst al iniciar carga dura E2 — chispas 3D, sin ripple en el suelo. */
    chargeBurst(position, color = 0x00ddff) {
        if (this._combatLoadLevel && this._combatLoadLevel !== 'light') return;
        const pos = this._vec(position);
        this._volumeFlash(pos, color, { maxScale: 16, duration: 0.22, opacity: 0.3, light: 8 });
        this.hitSparks(pos, { color: 0xffffff, count: 12, spread: 24, size: 5, duration: 0.4 });
        this.addShake(0.14);
    }

    /** Debuff iónico — chispas púrpuras, sin esfera envolvente. */
    playerSlowField(target, duration = 3.5) {
        if (!target) return;
        const root = target.mesh || target;
        if (!root?.position) return;

        if (this._playerSlowFx) {
            this._playerSlowFx.duration = Math.max(this._playerSlowFx.duration, duration);
            this._playerSlowFx.t = 0;
            this._playerSlowFx.target = root;
            return;
        }

        this._playerSlowFx = {
            type: 'playerSlowField',
            target: root,
            t: 0,
            duration,
            sparkTimer: 0,
        };
        this._fx.push(this._playerSlowFx);
    }

    _clearPlayerSlowField() {
        if (!this._playerSlowFx) return;
        const idx = this._fx.indexOf(this._playerSlowFx);
        if (idx >= 0) this._fx.splice(idx, 1);
        this._playerSlowFx = null;
    }

    /** Chispas verdes mientras la nave se repara — sin burbuja envolvente. */
    setPlayerRepairActive(player, active, mode = 'passive') {
        if (!active || !this._resolvePlayerAnchor(player)) {
            this._clearPlayerRepairField();
            return;
        }
        const intense = mode === 'active';
        if (this._playerRepairFx) {
            this._playerRepairFx.player = player;
            this._playerRepairFx.intense = intense;
            return;
        }
        this._startPlayerRepairField(player, intense);
    }

    _startPlayerRepairField(player, intense) {
        const anchor = this._resolvePlayerAnchor(player);
        if (anchor) {
            this._risingSparks(anchor, 0x44ee99, intense ? 12 : 8, {
                size: 6,
                spread: 16,
                duration: 0.7,
            });
        }
        this._playerRepairFx = {
            type: 'playerRepairField',
            player,
            intense,
            sparkTimer: intense ? 0.22 : 0.36,
        };
        this._fx.push(this._playerRepairFx);
    }

    _clearPlayerRepairField() {
        if (!this._playerRepairFx) return;
        const idx = this._fx.indexOf(this._playerRepairFx);
        if (idx >= 0) this._fx.splice(idx, 1);
        this._playerRepairFx = null;
    }

    /** Escudo del jugador vive en Player.shieldMesh — limpiar duplicados legacy. */
    clearPlayerShieldField() {
        this._clearPlayerShieldField();
    }

    _clearPlayerShieldField() {
        if (!this._playerShieldFx) return;
        const idx = this._fx.indexOf(this._playerShieldFx);
        if (idx >= 0) this._fx.splice(idx, 1);
        const fx = this._playerShieldFx;
        if (fx.light) {
            fx.light.intensity = 0;
            this._lightPool.push(fx.light);
        }
        if (fx.group) {
            this.scene.remove(fx.group);
            fx.shell?.geometry?.dispose?.();
            fx.core?.geometry?.dispose?.();
            fx.ring?.geometry?.dispose?.();
            fx.shellMat?.dispose?.();
            fx.coreMat?.dispose?.();
            fx.ringMat?.dispose?.();
        }
        this._playerShieldFx = null;
    }

    _resolvePlayerAnchor(player) {
        if (!player) return null;
        const meshPos = player.mesh?.position;
        if (meshPos) return meshPos;
        const pos = player.position;
        return pos?.isVector3 ? pos : null;
    }

    flashLight(position, color = 0xffaa44, intensity = 12, duration = 0.35) {
        let light = this._lightPool.pop();
        if (!light) {
            light = new THREE.PointLight(color, 0, 420, 2);
            this.scene.add(light);
        }
        light.color.set(color);
        light.position.copy(this._vec(position));
        light.intensity = intensity;
        this._fx.push({
            type: 'pointLight',
            light,
            t: 0,
            duration,
            peak: intensity,
        });
    }

    /** Refuerzo sobre explosiones de partículas — solo volumen 3D, sin anillos en el suelo. */
    boostExplosion(position, scale = 1) {
        const pos = this._vec(position);
        const s = Math.max(0.15, scale);
        if (s < 0.55) return;

        const pal = s >= 3 ? COMBAT_PALETTE.kill : s >= 1 ? COMBAT_PALETTE.hull : COMBAT_PALETTE.crit;
        this.hitSparks(pos, {
            color: pal.flash,
            count: Math.round(6 + s * 5),
            spread: 18 + s * 12,
            size: 4 + s * 2,
            duration: 0.35 + s * 0.08,
        });
        this._volumeFlash(pos, pal.glow, {
            maxScale: Math.min(48, 10 + s * 12),
            duration: 0.22 + s * 0.06,
            opacity: 0.2 + Math.min(s * 0.06, 0.2),
            light: Math.min(16, 4 + s * 3),
        });
        if (s >= 2) this.addShake(Math.min(0.45, 0.08 + s * 0.06));
    }

    _vec(v) {
        if (v?.isVector3) return v.clone();
        return new THREE.Vector3(v?.x ?? 0, v?.y ?? 0, v?.z ?? 0);
    }

    _disposeFx(fx) {
        if (fx.type === 'shieldRippleAnim') return;
        if (fx.type === 'pointLight') {
            fx.light.intensity = 0;
            this._lightPool.push(fx.light);
            return;
        }
        if (fx.type === 'multiRing') {
            for (const ring of fx.rings) {
                this.scene.remove(ring.mesh);
                ring.mesh.geometry?.dispose?.();
                ring.mat?.dispose?.();
            }
            return;
        }
        if (fx.mesh) this.scene.remove(fx.mesh);
        fx.geo?.dispose?.();
        fx.mat?.dispose?.();
    }
}
