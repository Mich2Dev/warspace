import * as THREE from 'three';
import { createRealisticStarField } from './starField.js';
export class SpaceBackdrop {
    constructor(scene) {
        this.group = new THREE.Group();
        this.group.name = 'space_backdrop';
        this.group.renderOrder = -200;
        scene.add(this.group);

        this._spaceBlend = 0;
        this._atmoBlend = 0;
        this._sunDir = new THREE.Vector3(0.6, 0.35, -0.4).normalize();
        this._planetDir = new THREE.Vector3(0, -1, 0);

        this._buildSpaceSky();
        this._buildStarLayers();
        this._nearStars = createRealisticStarField({
            count: 3800,
            minR: 140000,
            maxR: 260000,
            seed: 91,
            twinkle: 0.18,
            renderOrder: -198,
        });
        this.group.add(this._nearStars.group);
        this._buildSunCorona();
        this._buildAtmoShell();
        this.group.visible = false;
    }

    _buildSpaceSky() {
        const geo = new THREE.SphereGeometry(380000, 32, 16);
        this._skyMat = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
            uniforms: {
                uSunDir: { value: this._sunDir.clone() },
                uBlend: { value: 0 },
            },
            vertexShader: `
                varying vec3 vDir;
                void main() {
                    vDir = normalize(position);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    gl_Position.z = gl_Position.w * 0.9998;
                }
            `,
            fragmentShader: `
                uniform vec3 uSunDir;
                uniform float uBlend;
                varying vec3 vDir;

                float hash(vec3 p) {
                    p = fract(p * 0.1031);
                    p += dot(p, p.yzx + 33.33);
                    return fract((p.x + p.y) * p.z);
                }

                float noise(vec3 p) {
                    vec3 i = floor(p);
                    vec3 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(
                        mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                            mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                        mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
                }

                void main() {
                    vec3 dir = normalize(vDir);
                    vec3 col = vec3(0.0015, 0.002, 0.008);

                    float n1 = noise(dir * 2.8 + vec3(0.2, 0.7, 0.1));
                    float n2 = noise(dir * 5.5 + vec3(1.3, 0.4, 2.1));
                    col += vec3(0.06, 0.02, 0.10) * pow(n1, 3.0) * 0.18;
                    col += vec3(0.02, 0.05, 0.10) * pow(n2, 4.0) * 0.12;

                    float h = hash(floor(dir * 820.0));
                    float star = smoothstep(0.988, 1.0, h);
                    float star2 = smoothstep(0.994, 1.0, hash(floor(dir * 1400.0 + 7.0)));
                    float star3 = smoothstep(0.9975, 1.0, hash(floor(dir * 2200.0 + 13.0)));
                    col += vec3(0.92, 0.95, 1.0) * star * 1.1;
                    col += vec3(1.0, 0.98, 0.92) * star2 * 1.6;
                    col += vec3(1.0, 0.92, 0.78) * star3 * 2.2;

                    float sun = max(0.0, dot(dir, uSunDir));
                    col += vec3(1.0, 0.92, 0.75) * pow(sun, 220.0) * 3.5;
                    col += vec3(1.0, 0.65, 0.25) * pow(sun, 14.0) * 0.16;
                    col += vec3(0.25, 0.35, 0.65) * pow(sun, 4.0) * 0.05;

                    col = col / (col + vec3(0.04));
                    col = pow(col, vec3(0.95));
                    col *= uBlend;
                    gl_FragColor = vec4(col, uBlend);
                }
            `,
            transparent: true,
        });
        this._sky = new THREE.Mesh(geo, this._skyMat);
        this._sky.frustumCulled = false;
        this.group.add(this._sky);
    }

    _buildStarLayers() {
        const mkStars = (count, spread, sizeBase) => {
            const pos = new Float32Array(count * 3);
            const col = new Float32Array(count * 3);
            const sizes = new Float32Array(count);
            for (let i = 0; i < count; i++) {
                const u = Math.random();
                const v = Math.random();
                const theta = 2 * Math.PI * u;
                const phi = Math.acos(2 * v - 1);
                const r = spread * (0.85 + Math.random() * 0.15);
                pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
                pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
                pos[i * 3 + 2] = r * Math.cos(phi);
                const tint = Math.random();
                col[i * 3] = 0.75 + tint * 0.25;
                col[i * 3 + 1] = 0.8 + Math.random() * 0.2;
                col[i * 3 + 2] = 0.95 + Math.random() * 0.05;
                sizes[i] = sizeBase * (0.6 + Math.random() * 1.4);
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
            geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
            const mat = new THREE.ShaderMaterial({
                transparent: true,
                depthWrite: false,
                fog: false,
                blending: THREE.AdditiveBlending,
                uniforms: { uOpacity: { value: 0 } },
                vertexShader: `
                    attribute float size;
                    attribute vec3 color;
                    varying vec3 vColor;
                    void main() {
                        vColor = color;
                        vec4 mv = modelViewMatrix * vec4(position, 1.0);
                        gl_PointSize = size * (380.0 / max(-mv.z, 1.0));
                        gl_PointSize = clamp(gl_PointSize, 0.4, 6.0);
                        gl_Position = projectionMatrix * mv;
                    }
                `,
                fragmentShader: `
                    uniform float uOpacity;
                    varying vec3 vColor;
                    void main() {
                        vec2 uv = gl_PointCoord - 0.5;
                        float d = length(uv);
                        float core = 1.0 - smoothstep(0.0, 0.15, d);
                        float glow = 1.0 - smoothstep(0.08, 0.5, d);
                        float a = (core + glow * 0.35) * uOpacity;
                        if (a < 0.02) discard;
                        gl_FragColor = vec4(vColor * (1.0 + glow * 0.4), a);
                    }
                `,
            });
            const pts = new THREE.Points(geo, mat);
            pts.frustumCulled = false;
            pts.renderOrder = -195;
            return pts;
        };

        this._starsNear = mkStars(2800, 120000, 2.8);
        this._starsFar = mkStars(5200, 280000, 1.6);
        this.group.add(this._starsNear, this._starsFar);
    }

    _buildSunCorona() {
        const geo = new THREE.SphereGeometry(18000, 32, 32);
        this._sunMat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            fog: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
                uOpacity: { value: 0 },
            },
            vertexShader: `
                varying vec3 vLocal;
                void main() {
                    vLocal = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uOpacity;
                varying vec3 vLocal;
                void main() {
                    float d = length(vLocal) / 18000.0;
                    float core = 1.0 - smoothstep(0.0, 0.35, d);
                    float corona = pow(max(0.0, 1.0 - d), 1.8);
                    vec3 col = mix(vec3(1.0, 0.55, 0.15), vec3(1.0, 0.92, 0.7), core);
                    float a = (core * 0.85 + corona * 0.35) * uOpacity;
                    gl_FragColor = vec4(col, a);
                }
            `,
        });
        this._sun = new THREE.Mesh(geo, this._sunMat);
        this._sun.frustumCulled = false;
        this._sun.renderOrder = -180;
        this.group.add(this._sun);
    }

    /** Bruma atmosférica al despegar — cielo azul → negro. */
    _buildAtmoShell() {
        const geo = new THREE.SphereGeometry(65000, 24, 12);
        this._atmoMat = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
            fog: false,
            uniforms: {
                uAtmoBlend: { value: 0 },
                uPlanetDir: { value: this._planetDir.clone() },
            },
            vertexShader: `
                varying vec3 vDir;
                void main() {
                    vDir = normalize(position);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    gl_Position.z = gl_Position.w * 0.9995;
                }
            `,
            fragmentShader: `
                uniform float uAtmoBlend;
                uniform vec3 uPlanetDir;
                varying vec3 vDir;

                void main() {
                    vec3 dir = normalize(vDir);
                    float towardPlanet = max(0.0, dot(dir, normalize(-uPlanetDir)));
                    float horizon = pow(max(0.0, 1.0 - abs(dir.y)), 2.5);
                    float up = max(0.0, dir.y);

                    vec3 lowAtmo = vec3(0.35, 0.62, 0.95);
                    vec3 highAtmo = vec3(0.08, 0.14, 0.32);
                    vec3 space = vec3(0.01, 0.02, 0.06);

                    vec3 col = mix(lowAtmo, highAtmo, up * 0.85);
                    col = mix(col, space, smoothstep(0.35, 0.95, up));

                    float scatter = horizon * 0.45 + towardPlanet * 0.55;
                    float alpha = uAtmoBlend * scatter * (0.35 + (1.0 - up) * 0.45);
                    alpha *= smoothstep(0.0, 0.15, uAtmoBlend) * (1.0 - smoothstep(0.88, 1.0, uAtmoBlend));

                    gl_FragColor = vec4(col, alpha);
                }
            `,
        });
        this._atmoShell = new THREE.Mesh(geo, this._atmoMat);
        this._atmoShell.frustumCulled = false;
        this._atmoShell.renderOrder = -190;
        this.group.add(this._atmoShell);
    }

    setSunDirection(dir) {
        if (dir) this._sunDir.copy(dir).normalize();
        this._skyMat.uniforms.uSunDir.value.copy(this._sunDir);
    }

    setPlanetDirection(fromCamera, planetCenter) {
        this._planetDir.copy(planetCenter).sub(fromCamera).normalize();
        this._atmoMat.uniforms.uPlanetDir.value.copy(this._planetDir);
    }

    setBlends(spaceBlend, atmoBlend) {
        this._spaceBlend = THREE.MathUtils.clamp(spaceBlend, 0, 1);
        this._atmoBlend = THREE.MathUtils.clamp(atmoBlend, 0, 1);
    }

    getSpaceBlend() {
        return this._spaceBlend;
    }

    getAtmoBlend() {
        return this._atmoBlend;
    }

    update(cameraPos, time) {
        const active = this._spaceBlend > 0.02 || this._atmoBlend > 0.02;
        this.group.position.copy(cameraPos);
        this.group.visible = active;

        this._skyMat.uniforms.uBlend.value = this._spaceBlend;
        this._nearStars.setOpacity(this._spaceBlend * 0.92);
        this._nearStars.update(time);
        this._starsNear.material.uniforms.uOpacity.value = this._spaceBlend * 0.95;
        this._starsFar.material.uniforms.uOpacity.value = this._spaceBlend * 0.7;
        this._sunMat.uniforms.uOpacity.value = this._spaceBlend * 0.85;
        this._atmoMat.uniforms.uAtmoBlend.value = this._atmoBlend;

        const sunPos = this._sunDir.clone().multiplyScalar(240000);
        this._sun.position.copy(sunPos);

        this._atmoShell.visible = this._atmoBlend > 0.04;
        this._sky.visible = this._spaceBlend > 0.05;
        this._starsNear.visible = this._spaceBlend > 0.06;
        this._starsFar.visible = this._spaceBlend > 0.1;
        this._sun.visible = this._spaceBlend > 0.15;

        this._starsNear.rotation.y = time * 0.003;
        this._starsFar.rotation.y = time * 0.0015;
    }

    dispose() {
        this.group.parent?.remove(this.group);
        for (const m of [this._sky, this._starsNear, this._starsFar, this._sun, this._atmoShell]) {
            m.geometry?.dispose();
            m.material?.dispose();
        }
        this._nearStars?.dispose?.();
    }
}
