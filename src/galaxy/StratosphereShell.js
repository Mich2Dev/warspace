import * as THREE from 'three';
import { createRealisticStarField } from './starField.js';

/**
 * Cielo de estratosfera — estrellas densas (el planeta real lo pinta UniverseWorld).
 */
export class StratosphereShell {
    constructor(scene) {
        this.group = new THREE.Group();
        this.group.name = 'stratosphere_shell';
        this.group.frustumCulled = false;
        this.group.visible = false;
        scene.add(this.group);

        this._intensity = 0;
        this._stars = createRealisticStarField({
            count: 5800,
            minR: 12000,
            maxR: 19500,
            seed: 17,
            twinkle: 0.28,
            renderOrder: -200,
        });
        this.group.add(this._stars.group);
    }

    setIntensity(t) {
        this._intensity = THREE.MathUtils.clamp(t, 0, 1);
        this.group.visible = this._intensity > 0.04;
        this._stars.setOpacity(0.4 + this._intensity * 0.6);
    }

    update(cameraPos, _agl, _planetRadius = 22000, time = 0) {
        if (this._intensity <= 0.04) return;

        this.group.position.copy(cameraPos);
        this._stars.update(time);
    }

    dispose() {
        this.group.parent?.remove(this.group);
        this._stars.dispose();
    }
}
