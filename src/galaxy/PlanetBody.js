import * as THREE from 'three';

/**
 * Planeta — superficie procedural, capa de nubes, atmósfera tipo Rayleigh en el limb.
 */
export class PlanetBody {
    constructor(def) {
        this.def = def;
        this.group = new THREE.Group();
        this.group.name = `planet_${def.id}`;

        const R = def.radius ?? 12000;
        this._radius = R;
        this._visualBlend = 1;
        const surfaceHex = new THREE.Color(def.surfaceColor ?? 0x448844);
        const atmoHex = new THREE.Color(def.atmosphereColor ?? 0x88ccff);
        const oceanHex = new THREE.Color(def.oceanColor ?? 0x1a4068);
        this._sunDir = new THREE.Vector3(0.55, 0.4, -0.3).normalize();

        const geo = new THREE.SphereGeometry(R, 72, 54);
        const mat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.9,
            metalness: 0.01,
            emissive: surfaceHex.clone().multiplyScalar(0.04),
            emissiveIntensity: 0.2,
        });

        mat.onBeforeCompile = (shader) => {
            shader.uniforms.uSurface = { value: surfaceHex };
            shader.uniforms.uOcean = { value: oceanHex };
            shader.uniforms.uAtmo = { value: atmoHex };
            shader.uniforms.uSunDir = { value: this._sunDir.clone() };
            shader.uniforms.uTime = { value: 0 };
            shader.vertexShader = `
                varying vec3 vWorldPos;
                varying vec3 vWorldNormal;
            ` + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace(
                '#include <worldpos_vertex>',
                `#include <worldpos_vertex>
                vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
                vWorldNormal = normalize(mat3(modelMatrix) * normal);`
            );
            shader.fragmentShader = `
                uniform vec3 uSurface;
                uniform vec3 uOcean;
                uniform vec3 uAtmo;
                uniform vec3 uSunDir;
                uniform float uTime;
                varying vec3 vWorldPos;
                varying vec3 vWorldNormal;

                float hash(vec3 p) {
                    p = fract(p * 0.3183099 + 0.1);
                    p *= 17.0;
                    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
                }
                float noise(vec3 p) {
                    vec3 i = floor(p);
                    vec3 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(
                        mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x),
                            mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                        mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
                            mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
                }
            ` + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <color_fragment>',
                `
                vec3 p = vWorldPos * 0.00035;
                float n1 = noise(p + vec3(0.0, uTime * 0.002, 0.0));
                float n2 = noise(p * 2.1 + vec3(1.7, 0.3, 2.1));
                float n3 = noise(p * 4.3 + vec3(uTime * 0.004, 0.0, 1.2));
                float land = smoothstep(0.38, 0.62, n1 * 0.55 + n2 * 0.3 + n3 * 0.15);

                vec3 viewDir = normalize(cameraPosition - vWorldPos);
                vec3 sunDir = normalize(uSunDir);
                float sunDot = max(0.0, dot(vWorldNormal, sunDir));
                float night = smoothstep(-0.08, 0.42, sunDot);

                vec3 deepOcean = uOcean * 0.55;
                vec3 shallow = mix(uOcean, uSurface, 0.35);
                vec3 baseCol = mix(deepOcean, shallow, smoothstep(0.0, 0.55, land));
                baseCol = mix(uSurface, baseCol, land);
                baseCol = mix(baseCol * 0.12, baseCol, night);

                float cities = smoothstep(0.52, 0.72, land) * (1.0 - night);
                cities *= noise(p * 8.0) * noise(p * 15.0 + 3.1);
                baseCol += vec3(1.0, 0.82, 0.45) * cities * 0.08 * (1.0 - sunDot);

                float spec = pow(max(0.0, dot(reflect(-viewDir, vWorldNormal), sunDir)), 72.0);
                float fresnel = pow(1.0 - max(0.0, dot(vWorldNormal, viewDir)), 3.0);

                diffuseColor.rgb = baseCol * (0.48 + sunDot * 0.65);
                diffuseColor.rgb += vec3(1.0, 0.95, 0.88) * spec * 0.35 * sunDot;
                diffuseColor.rgb += uAtmo * fresnel * 0.06 * sunDot;
                `
            );
            mat.userData.shader = shader;
        };

        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.frustumCulled = false;
        this.mesh.receiveShadow = false;
        this.mesh.castShadow = false;
        this.group.add(this.mesh);

        this._cloudMat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            uniforms: {
                uSunDir: { value: this._sunDir.clone() },
                uTime: { value: 0 },
                uOpacity: { value: 0.72 },
            },
            vertexShader: `
                varying vec3 vWorldPos;
                varying vec3 vWorldNormal;
                void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorldPos = wp.xyz;
                    vWorldNormal = normalize(mat3(modelMatrix) * normal);
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }
            `,
            fragmentShader: `
                uniform vec3 uSunDir;
                uniform float uTime;
                uniform float uOpacity;
                varying vec3 vWorldPos;
                varying vec3 vWorldNormal;
                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
                }
                float noise(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    float a = hash(i);
                    float b = hash(i + vec2(1.0, 0.0));
                    float c = hash(i + vec2(0.0, 1.0));
                    float d = hash(i + vec2(1.0, 1.0));
                    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
                }
                void main() {
                    vec2 uv = vWorldPos.xz * 0.00012 + vec2(uTime * 0.008, uTime * 0.005);
                    float c1 = noise(uv * 3.0);
                    float c2 = noise(uv * 6.5 + 2.1);
                    float c3 = noise(uv * 12.0 - uTime * 0.003);
                    float clouds = smoothstep(0.38, 0.72, c1 * 0.5 + c2 * 0.35 + c3 * 0.15);
                    float sun = max(0.0, dot(normalize(vWorldNormal), normalize(uSunDir)));
                    float shade = 0.55 + sun * 0.45;
                    vec3 col = mix(vec3(0.75, 0.82, 0.92), vec3(0.95, 0.98, 1.0), sun);
                    float a = clouds * uOpacity * shade;
                    if (a < 0.02) discard;
                    gl_FragColor = vec4(col, a);
                }
            `,
        });
        this._cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(R * 1.006, 64, 48), this._cloudMat);
        this._cloudMesh.frustumCulled = false;
        this._cloudMesh.renderOrder = 1;
        this.group.add(this._cloudMesh);

        const limbGeo = new THREE.SphereGeometry(R * 1.008, 72, 54);
        this._limbMat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
            uniforms: {
                uAtmo: { value: atmoHex },
                uSunDir: { value: this._sunDir.clone() },
                uIntensity: { value: 0.5 },
            },
            vertexShader: `
                varying vec3 vWorldNormal;
                varying vec3 vWorldPos;
                void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorldPos = wp.xyz;
                    vWorldNormal = normalize(mat3(modelMatrix) * normal);
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }
            `,
            fragmentShader: `
                uniform vec3 uAtmo;
                uniform vec3 uSunDir;
                uniform float uIntensity;
                varying vec3 vWorldNormal;
                varying vec3 vWorldPos;
                void main() {
                    vec3 viewDir = normalize(cameraPosition - vWorldPos);
                    float mu = max(0.0, dot(vWorldNormal, viewDir));
                    float rim = pow(1.0 - mu, 4.0);
                    float sun = max(0.0, dot(vWorldNormal, normalize(uSunDir)));
                    vec3 scatter = mix(uAtmo * 0.4, uAtmo * 1.2, sun);
                    scatter = mix(scatter, vec3(1.0, 0.92, 0.75), sun * 0.35);
                    float a = rim * uIntensity * (0.25 + sun * 0.75);
                    gl_FragColor = vec4(scatter, a);
                }
            `,
        });
        this._limbMesh = new THREE.Mesh(limbGeo, this._limbMat);
        this._limbMesh.frustumCulled = false;
        this._limbMesh.renderOrder = -1;
        this.group.add(this._limbMesh);

        const outerGeo = new THREE.SphereGeometry(R * 1.014, 48, 36);
        this._outerAtmoMat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
            uniforms: {
                uAtmo: { value: atmoHex },
                uIntensity: { value: 0.08 },
            },
            vertexShader: `
                varying vec3 vWorldNormal;
                varying vec3 vWorldPos;
                void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorldPos = wp.xyz;
                    vWorldNormal = normalize(mat3(modelMatrix) * normal);
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }
            `,
            fragmentShader: `
                uniform vec3 uAtmo;
                uniform float uIntensity;
                varying vec3 vWorldNormal;
                varying vec3 vWorldPos;
                void main() {
                    vec3 viewDir = normalize(cameraPosition - vWorldPos);
                    float rim = pow(1.0 - max(0.0, dot(vWorldNormal, viewDir)), 6.0);
                    gl_FragColor = vec4(uAtmo * 0.6, rim * uIntensity);
                }
            `,
        });
        this._outerAtmo = new THREE.Mesh(outerGeo, this._outerAtmoMat);
        this._outerAtmo.frustumCulled = false;
        this._outerAtmo.renderOrder = -2;
        this.group.add(this._outerAtmo);

        const pos = def.universePosition ?? def.spacePosition ?? { x: 0, y: 0, z: 0 };
        this.group.position.set(pos.x, pos.y, pos.z);
    }

    setSunDirection(dir) {
        if (!dir) return;
        this._sunDir.copy(dir).normalize();
        const sh = this.mesh.material?.userData?.shader;
        if (sh) sh.uniforms.uSunDir.value.copy(this._sunDir);
        if (this._limbMat) this._limbMat.uniforms.uSunDir.value.copy(this._sunDir);
        if (this._cloudMat) this._cloudMat.uniforms.uSunDir.value.copy(this._sunDir);
    }

    getWorldPosition(target = new THREE.Vector3()) {
        return this.group.getWorldPosition(target);
    }

    getRadius() {
        return this._radius;
    }

    distanceToPoint(point) {
        const c = this.getWorldPosition();
        return Math.max(0, point.distanceTo(c) - this.getRadius());
    }

    setVisualBlend(t) {
        this._visualBlend = THREE.MathUtils.clamp(t, 0, 1);
        this.group.visible = this._visualBlend > 0.002;
        this.mesh.material.opacity = this._visualBlend;
        this.mesh.material.transparent = this._visualBlend < 0.995;
        if (this._cloudMat) this._cloudMat.uniforms.uOpacity.value = 0.65 * this._visualBlend;
        if (this._limbMesh) this._limbMesh.visible = this._visualBlend > 0.002;
        if (this._outerAtmo) this._outerAtmo.visible = this._visualBlend > 0.002;
    }

    updateDistancePresentation(cameraPos) {
        if (this._visualBlend <= 0.002) return;

        const center = this.getWorldPosition();
        const dist = Math.max(cameraPos.distanceTo(center), this._radius * 1.005);
        const surfaceDist = Math.max(0, dist - this._radius);
        const ang = this._radius / dist;
        const farT = THREE.MathUtils.smoothstep(60000, 500000, surfaceDist);
        const closeT = THREE.MathUtils.smoothstep(120000, 6000, surfaceDist);

        const nearOp = this._visualBlend;
        const angularOp = THREE.MathUtils.clamp(0.42 + ang * 14, 0.4, 1);
        const starOp = THREE.MathUtils.clamp(0.4 + ang * 38, 0.36, 1);
        this.mesh.material.opacity = THREE.MathUtils.lerp(
            Math.max(nearOp, angularOp),
            Math.max(starOp * this._visualBlend, 0.36),
            farT,
        );
        this.mesh.material.transparent = this.mesh.material.opacity < 0.995;

        if (this._cloudMat) {
            const cloudOp = THREE.MathUtils.lerp(0.85, 0.35, farT) * closeT;
            this._cloudMat.uniforms.uOpacity.value = cloudOp * this._visualBlend;
        }

        if (this._limbMat) {
            const limbNear = 0.12 + ang * 0.85;
            const limbFar = Math.min(0.72, 0.22 + ang * 38);
            this._limbMat.uniforms.uIntensity.value = THREE.MathUtils.lerp(limbFar, limbNear, closeT);
            if (this._limbMesh) {
                this._limbMesh.visible = closeT < 0.92 || farT > 0.35;
            }
        }

        if (this._outerAtmoMat) {
            const outerFar = Math.min(0.42, 0.12 + ang * 22);
            this._outerAtmoMat.uniforms.uIntensity.value = outerFar;
            this._outerAtmo.visible = farT > 0.55 && closeT < 0.25;
        }
    }

    update(time) {
        const shader = this.mesh.material?.userData?.shader;
        if (shader) shader.uniforms.uTime.value = time;
        if (this._cloudMat) this._cloudMat.uniforms.uTime.value = time;
        this.mesh.rotation.y = time * 0.008;
        if (this._cloudMesh) this._cloudMesh.rotation.y = time * 0.012 + 0.4;
    }

    dispose() {
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
        this._cloudMesh?.geometry?.dispose();
        this._cloudMat?.dispose();
        this._limbMesh?.geometry?.dispose();
        this._limbMat?.dispose();
        this._outerAtmo?.geometry?.dispose();
        this._outerAtmoMat?.dispose();
    }
}
