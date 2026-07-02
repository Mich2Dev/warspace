import * as THREE from 'three';

/**
 * Campo estelar denso y creíble — capas de brillo, color y tamaño variados.
 * Pensado para cielos cercanos (estratosfera) y fondo espacial.
 */
export function createRealisticStarField(opts = {}) {
    const count = opts.count ?? 5200;
    const minR = opts.minR ?? 11000;
    const maxR = opts.maxR ?? 19000;
    const seed = opts.seed ?? 42;

    const group = new THREE.Group();
    group.name = opts.name ?? 'realistic_stars';
    group.frustumCulled = false;

    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const bright = new Float32Array(count);
    const tint = new Float32Array(count);

    let s = seed | 0;
    const rnd = () => {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    for (let i = 0; i < count; i++) {
        const u = rnd();
        const v = rnd();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        const r = minR + rnd() * (maxR - minR);
        pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        pos[i * 3 + 2] = r * Math.cos(phi);

        const band = Math.abs(pos[i * 3 + 1]) / r;
        const inBand = band < 0.22 ? 1.35 : 1.0;
        const roll = rnd();
        if (roll > 0.992) {
            size[i] = 3.2 + rnd() * 2.8;
            bright[i] = 1.0;
        } else if (roll > 0.94) {
            size[i] = 1.6 + rnd() * 1.4;
            bright[i] = 0.72;
        } else {
            size[i] = 0.45 + rnd() * 0.95;
            bright[i] = 0.22 + rnd() * 0.38;
        }
        size[i] *= inBand;

        const tc = rnd();
        tint[i] = tc < 0.12 ? 0.0 : tc < 0.22 ? 0.35 : tc < 0.88 ? 0.55 : tc < 0.96 ? 0.75 : 1.0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
    geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));

    const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
            uOpacity: { value: 1 },
            uTime: { value: 0 },
            uTwinkle: { value: opts.twinkle ?? 0.35 },
        },
        vertexShader: `
            attribute float aSize;
            attribute float aBright;
            attribute float aTint;
            uniform float uTime;
            uniform float uTwinkle;
            varying float vBright;
            varying float vTint;
            varying float vTw;
            void main() {
                vBright = aBright;
                vTint = aTint;
                float tw = sin(uTime * (2.0 + aBright * 5.0) + position.x * 0.002 + position.z * 0.003);
                vTw = 1.0 + tw * uTwinkle * aBright;
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                float ps = aSize * vTw * (420.0 / max(-mv.z, 120.0));
                gl_PointSize = clamp(ps, 0.35, 7.5);
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: `
            uniform float uOpacity;
            varying float vBright;
            varying float vTint;
            varying float vTw;
            void main() {
                vec2 uv = gl_PointCoord - 0.5;
                float d = length(uv);
                float core = 1.0 - smoothstep(0.0, 0.12, d);
                float halo = 1.0 - smoothstep(0.05, 0.48, d);
                float a = (core * 0.95 + halo * 0.28) * vBright * vTw * uOpacity;
                if (a < 0.008) discard;
                vec3 col = mix(vec3(0.78, 0.86, 1.0), vec3(1.0, 0.96, 0.88), vTint);
                col = mix(col, vec3(1.0, 0.82, 0.65), step(0.9, vTint) * 0.6);
                col *= 0.65 + vBright * 0.85;
                gl_FragColor = vec4(col, a);
            }
        `,
    });

    const points = new THREE.Points(geo, mat);
    points.renderOrder = opts.renderOrder ?? -200;
    points.frustumCulled = false;
    group.add(points);

    const nebulaGeo = new THREE.SphereGeometry((minR + maxR) * 0.52, 32, 20);
    const nebulaMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        transparent: true,
        uniforms: { uOpacity: { value: 0.55 } },
        vertexShader: `
            varying vec3 vDir;
            void main() {
                vDir = normalize(position);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uOpacity;
            varying vec3 vDir;
            float hash(vec3 p) {
                return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
            }
            void main() {
                vec3 dir = normalize(vDir);
                float band = exp(-pow(abs(dir.y) / 0.38, 2.0));
                float n = hash(floor(dir * 180.0));
                vec3 col = mix(vec3(0.008, 0.012, 0.035), vec3(0.04, 0.025, 0.08), band);
                col += vec3(0.02, 0.03, 0.06) * n * band;
                float a = (0.35 + band * 0.55) * uOpacity;
                gl_FragColor = vec4(col, a);
            }
        `,
    });
    const nebula = new THREE.Mesh(nebulaGeo, nebulaMat);
    nebula.renderOrder = -220;
    group.add(nebula);

    return {
        group,
        points,
        nebula,
        material: mat,
        nebulaMaterial: nebulaMat,
        setOpacity(t) {
            const o = THREE.MathUtils.clamp(t, 0, 1);
            mat.uniforms.uOpacity.value = o;
            nebulaMat.uniforms.uOpacity.value = o * 0.65;
            group.visible = o > 0.02;
        },
        update(time) {
            mat.uniforms.uTime.value = time;
        },
        dispose() {
            geo.dispose();
            mat.dispose();
            nebulaGeo.dispose();
            nebulaMat.dispose();
        },
    };
}
