import * as THREE from 'three';

/**
 * Reentrada / ascenso — partículas de hielo, vapor y calor con shader suave.
 */
export class AtmosphereFX {
    constructor(scene) {
        this.group = new THREE.Group();
        this.group.name = 'atmosphere_fx';
        this.group.frustumCulled = false;
        this.group.visible = false;
        scene.add(this.group);

        this._count = 520;
        this._intensity = 0;
        this._positions = new Float32Array(this._count * 3);
        this._sizes = new Float32Array(this._count);
        this._alphas = new Float32Array(this._count);
        this._velocities = [];

        for (let i = 0; i < this._count; i++) {
            this._respawn(i, true);
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(this._positions, 3));
        geo.setAttribute('aSize', new THREE.BufferAttribute(this._sizes, 1));
        geo.setAttribute('aAlpha', new THREE.BufferAttribute(this._alphas, 1));

        this._mat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
                uOpacity: { value: 0.6 },
                uWarmth: { value: 0 },
            },
            vertexShader: `
                attribute float aSize;
                attribute float aAlpha;
                uniform float uOpacity;
                varying float vAlpha;
                void main() {
                    vAlpha = aAlpha * uOpacity;
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = aSize * (280.0 / max(10.0, -mv.z));
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: `
                uniform float uWarmth;
                varying float vAlpha;
                void main() {
                    vec2 uv = gl_PointCoord - 0.5;
                    float d = length(uv);
                    float core = smoothstep(0.5, 0.0, d);
                    float soft = smoothstep(0.5, 0.15, d);
                    vec3 cool = vec3(0.75, 0.88, 1.0);
                    vec3 warm = vec3(1.0, 0.72, 0.38);
                    vec3 col = mix(cool, warm, uWarmth);
                    float a = soft * core * vAlpha;
                    if (a < 0.01) discard;
                    gl_FragColor = vec4(col, a);
                }
            `,
        });

        this._points = new THREE.Points(geo, this._mat);
        this._points.frustumCulled = false;
        this._points.renderOrder = 60;
        this.group.add(this._points);

        const veilGeo = new THREE.PlaneGeometry(14000, 14000);
        this._veilMat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            uniforms: {
                uOpacity: { value: 0 },
                uWarmth: { value: 0 },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uOpacity;
                uniform float uWarmth;
                varying vec2 vUv;
                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
                }
                void main() {
                    vec2 uv = vUv * 4.0;
                    float n = hash(floor(uv)) * 0.5 + hash(floor(uv * 2.3 + 1.7)) * 0.5;
                    float edge = smoothstep(0.15, 0.85, vUv.y);
                    vec3 cool = vec3(0.55, 0.72, 0.92);
                    vec3 warm = vec3(0.95, 0.55, 0.28);
                    vec3 col = mix(cool, warm, uWarmth);
                    float a = uOpacity * edge * (0.35 + n * 0.25);
                    gl_FragColor = vec4(col, a);
                }
            `,
        });
        this._veil = new THREE.Mesh(veilGeo, this._veilMat);
        this._veil.frustumCulled = false;
        this._veil.renderOrder = 55;
        this.group.add(this._veil);
    }

    _respawn(i, scatter) {
        const spread = scatter ? 3200 : 1800;
        this._positions[i * 3] = (Math.random() - 0.5) * spread;
        this._positions[i * 3 + 1] = (Math.random() - 0.5) * spread * 0.28;
        this._positions[i * 3 + 2] = -600 - Math.random() * 4800;
        this._velocities[i] = 700 + Math.random() * 2400;
        this._sizes[i] = 4 + Math.random() * 22;
        this._alphas[i] = 0.15 + Math.random() * 0.65;
    }

    setIntensity(t) {
        this._intensity = THREE.MathUtils.clamp(t, 0, 1);
        this.group.visible = this._intensity > 0.03;
        this._mat.uniforms.uOpacity.value = 0.2 + this._intensity * 0.65;
        this._mat.uniforms.uWarmth.value = Math.pow(this._intensity, 1.4) * 0.55;
        this._veilMat.uniforms.uOpacity.value = this._intensity * 0.28;
        this._veilMat.uniforms.uWarmth.value = Math.pow(this._intensity, 1.2) * 0.4;
    }

    update(camera, delta) {
        if (this._intensity <= 0.03 || !camera) return;

        this.group.position.copy(camera.position);
        this.group.quaternion.copy(camera.quaternion);

        const pos = this._points.geometry.attributes.position;
        const dt = Math.min(delta, 0.05);
        const speedMul = 1 + this._intensity * 2.8;

        for (let i = 0; i < this._count; i++) {
            pos.array[i * 3 + 2] += this._velocities[i] * dt * speedMul;
            if (pos.array[i * 3 + 2] > 350) {
                this._respawn(i, false);
            }
        }
        pos.needsUpdate = true;

        this._veil.position.z = -900 - this._intensity * 1100;
        this._veil.rotation.z += dt * 0.05;
    }

    dispose() {
        this.group.parent?.remove(this.group);
        this._points.geometry.dispose();
        this._mat.dispose();
        this._veil.geometry.dispose();
        this._veilMat.dispose();
    }
}
