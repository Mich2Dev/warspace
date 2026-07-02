/** Marcador 3D de destino de navegación — preview + destino, estilo configurable. */

import * as THREE from 'three';
import { getControlState } from './controlSettings.js';

export function pickGroundPoint(camera, ndc, environment) {
    if (!camera || !environment) return null;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);

    const origin = raycaster.ray.origin;
    const dir = raycaster.ray.direction;
    const maxDist = 12000;
    const step = 60;

    let prevT = 80;
    let prevAbove = true;

    for (let t = 80; t <= maxDist; t += step) {
        const px = origin.x + dir.x * t;
        const py = origin.y + dir.y * t;
        const pz = origin.z + dir.z * t;
        const h = environment.getHeightAt(px, pz);
        const above = py > h + 25;

        if (prevAbove && !above) {
            const blend = 0.5;
            const tMid = prevT + (t - prevT) * blend;
            const x = origin.x + dir.x * tMid;
            const z = origin.z + dir.z * tMid;
            const y = environment.getHeightAt(x, z);
            return new THREE.Vector3(x, y + 1.5, z);
        }

        prevT = t;
        prevAbove = above;
    }

    return null;
}

export class NavMarkerManager {
    constructor(scene) {
        this.scene = scene;
        this.root = new THREE.Group();
        this.root.name = 'nav-marker-root';
        scene.add(this.root);

        this.preview = this._buildMarker(0.55);
        this.destination = this._buildMarker(1);
        this.preview.visible = false;
        this.destination.visible = false;
        this.root.add(this.preview, this.destination);

        this._destPos = null;
        this._time = 0;
    }

    _buildMarker(opacityScale) {
        const g = new THREE.Group();

        const ring = new THREE.Mesh(
            new THREE.RingGeometry(14, 22, 48),
            new THREE.MeshBasicMaterial({
                color: 0xa8bcc8,
                transparent: true,
                opacity: 0.75 * opacityScale,
                side: THREE.DoubleSide,
                depthWrite: false,
            })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.renderOrder = 20;
        g.add(ring);

        const inner = new THREE.Mesh(
            new THREE.RingGeometry(4, 7, 24),
            new THREE.MeshBasicMaterial({
                color: 0xdce4ea,
                transparent: true,
                opacity: 0.9 * opacityScale,
                side: THREE.DoubleSide,
                depthWrite: false,
            })
        );
        inner.rotation.x = -Math.PI / 2;
        inner.renderOrder = 21;
        g.add(inner);

        const beam = new THREE.Mesh(
            new THREE.CylinderGeometry(0.4, 0.4, 55, 8, 1, true),
            new THREE.MeshBasicMaterial({
                color: 0xa8bcc8,
                transparent: true,
                opacity: 0.22 * opacityScale,
                side: THREE.DoubleSide,
                depthWrite: false,
            })
        );
        beam.position.y = 27;
        beam.renderOrder = 19;
        g.add(beam);

        const dot = new THREE.Mesh(
            new THREE.SphereGeometry(2.2, 12, 12),
            new THREE.MeshBasicMaterial({
                color: 0xdce4ea,
                transparent: true,
                opacity: 0.95 * opacityScale,
                depthWrite: false,
            })
        );
        dot.position.y = 3;
        dot.renderOrder = 22;
        g.add(dot);

        g.userData = { ring, inner, beam, dot };
        return g;
    }

    _applyStyle(group, style, colorHex) {
        const { ring, inner, beam, dot } = group.userData;
        const color = new THREE.Color(colorHex);

        ring.visible = style !== 'minimal';
        inner.visible = style !== 'beacon';
        beam.visible = style === 'beacon' || style === 'pulse';
        dot.visible = true;

        ring.material.color.copy(color);
        inner.material.color.copy(color).lerp(new THREE.Color(0xffffff), 0.35);
        beam.material.color.copy(color);
        dot.material.color.copy(color).lerp(new THREE.Color(0xffffff), 0.4);
    }

    setPreview(pos) {
        const cfg = getControlState();
        if (!cfg.showNavPreview || cfg.navMarkerStyle === 'off' || !pos) {
            this.preview.visible = false;
            return;
        }
        this.preview.position.copy(pos);
        this.preview.visible = true;
        this._applyStyle(this.preview, cfg.navMarkerStyle, cfg.navMarkerColor);
    }

    clearPreview() {
        this.preview.visible = false;
    }

    setDestination(pos) {
        const cfg = getControlState();
        if (!pos || cfg.navMarkerStyle === 'off') {
            this.clearDestination();
            return;
        }
        this._destPos = pos.clone();
        this.destination.position.copy(pos);
        this.destination.visible = true;
        this._applyStyle(this.destination, cfg.navMarkerStyle, cfg.navMarkerColor);
        this.preview.visible = false;
    }

    clearDestination() {
        this._destPos = null;
        this.destination.visible = false;
    }

    refreshStyles() {
        const cfg = getControlState();
        if (this.destination.visible && this._destPos) {
            this._applyStyle(this.destination, cfg.navMarkerStyle, cfg.navMarkerColor);
        }
        if (this.preview.visible) {
            this._applyStyle(this.preview, cfg.navMarkerStyle, cfg.navMarkerColor);
        }
    }

    update(delta) {
        this._time += delta;
        const cfg = getControlState();
        const pulse = cfg.navMarkerStyle === 'pulse' || cfg.navMarkerStyle === 'beacon';

        for (const g of [this.preview, this.destination]) {
            if (!g.visible) continue;
            const { ring, inner } = g.userData;
            if (pulse) {
                const s = 1 + Math.sin(this._time * 4.5) * 0.08;
                ring.scale.set(s, s, 1);
                inner.scale.set(1 + Math.sin(this._time * 6) * 0.12, 1 + Math.sin(this._time * 6) * 0.12, 1);
            } else {
                ring.scale.set(1, 1, 1);
                inner.scale.set(1, 1, 1);
            }
            g.rotation.y += delta * 0.6;
        }
    }
}
