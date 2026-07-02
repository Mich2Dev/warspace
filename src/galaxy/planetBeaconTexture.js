import * as THREE from 'three';

let _tex = null;

/** Punto suave para planeta lejano — núcleo brillante visible a gran distancia. */
export function getPlanetBeaconTexture() {
    if (_tex) return _tex;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.15, 'rgba(220,240,255,0.95)');
    g.addColorStop(0.4, 'rgba(140,190,240,0.55)');
    g.addColorStop(0.72, 'rgba(60,120,200,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    _tex = new THREE.CanvasTexture(canvas);
    return _tex;
}
