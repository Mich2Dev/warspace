import * as THREE from 'three';

const _skyDay = new THREE.Color(0xe2ecf4);
const _skySpace = new THREE.Color(0x060a14);
const _zenithDay = new THREE.Color(0x4a7ab5);
const _zenithSpace = new THREE.Color(0x020408);
const _horizon = new THREE.Color();
const _zenith = new THREE.Color();

export function shellEase(t) {
    const x = THREE.MathUtils.clamp(t, 0, 1);
    return x * x * x * (x * (x * 6 - 15) + 10);
}

export function shellRemapReady(progress, atmoHaze) {
    return progress >= 0.38 && atmoHaze >= 0.22;
}

export function computeShellVisuals(progress, ascending = true) {
    const t = shellEase(progress);

    let surfaceFade;
    let planetReveal;
    let spaceBlend;

    if (ascending) {
        surfaceFade = t < 0.5
            ? 1 - THREE.MathUtils.smoothstep(0.02, 0.46, t)
            : 0;
        planetReveal = t > 0.46
            ? THREE.MathUtils.smoothstep(0.46, 0.9, t)
            : 0;
        spaceBlend = planetReveal;
    } else {
        planetReveal = t < 0.52
            ? 1 - THREE.MathUtils.smoothstep(0.02, 0.5, t)
            : 0;
        surfaceFade = t > 0.54
            ? THREE.MathUtils.smoothstep(0.54, 0.94, t)
            : 0;
        spaceBlend = planetReveal;
    }

    const phase = ascending ? t : (1 - t);
    const atmoHaze = Math.pow(Math.sin(phase * Math.PI), 0.55) * 0.96;
    const handoffCenter = 0.48;
    const veilStrength = Math.exp(-Math.pow((t - handoffCenter) / 0.14, 2)) * 0.82;

    const skyT = Math.max(spaceBlend, atmoHaze * 0.42);
    _horizon.copy(_skyDay).lerp(_skySpace, skyT);
    _zenith.copy(_zenithDay).lerp(_zenithSpace, skyT);

    const visibility = THREE.MathUtils.lerp(4500, 950, atmoHaze);
    const fogDensity = THREE.MathUtils.clamp(2.6 / (visibility * visibility), 0.000004, 0.000028);

    const cameraFar = THREE.MathUtils.lerp(26000, 520000, shellEase(spaceBlend));
    const cameraNear = THREE.MathUtils.lerp(0.8, 2.0, shellEase(spaceBlend));

    return {
        t,
        surfaceFade,
        spaceBlend,
        planetReveal,
        atmoHaze,
        veilStrength,
        horizon: _horizon.clone(),
        zenith: _zenith.clone(),
        fogDensity,
        cameraFar,
        cameraNear,
        skyAerial: shellEase(spaceBlend) * 0.78 + atmoHaze * 0.22,
    };
}
