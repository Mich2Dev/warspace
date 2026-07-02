import * as THREE from 'three';
import { PlanetBody } from './PlanetBody.js';
import { getActivePlanets } from './galaxyCatalog.js';
import { SpaceBackdrop } from './SpaceBackdrop.js';
import { flatMapToSphereDirection } from './planetMapProjection.js';

/**
 * Espacio 3D independiente del mapa plano del planeta.
 * El planeta home vive aquí como esfera en el vacío; el jugador entra por un "salto" al superar la atmósfera.
 */
export class UniverseWorld {
    constructor(scene, system, sunDir) {
        this.scene = scene;
        this.system = system;
        this._sunDir = sunDir.clone().normalize();

        this.group = new THREE.Group();
        this.group.name = 'universe_world';
        this.group.visible = false;
        scene.add(this.group);

        this._planets = new Map();
        this._backdrop = new SpaceBackdrop(scene);
        this._backdrop.group.visible = false;

        this._sunLight = new THREE.DirectionalLight(0xfff4e0, 1.85);
        this._sunLight.name = 'universe_sun';
        this._sunLight.position.copy(this._sunDir.clone().multiplyScalar(280000));
        this._sunLight.visible = false;
        scene.add(this._sunLight);

        this._active = false;
        this._stratosphereActive = false;
        this._stratosphereCenter = new THREE.Vector3();
        this._homePlanetId = system.homePlanetId;

        for (const def of getActivePlanets(system)) {
            const body = new PlanetBody(def);
            body.setSunDirection(this._sunDir);
            const pos = def.universePosition ?? def.spacePosition ?? { x: 0, y: 0, z: 0 };
            body.group.position.set(pos.x, pos.y, pos.z);
            this._planets.set(def.id, body);
            this.group.add(body.group);
        }
    }

    /** Bruma + estrellas + planeta real bajo la nave (mapa plano → esfera). */
    setStratosphereView(agl, cameraPos, time, entryBlend = 1) {
        const home = this.getHomePlanet();
        if (!home) return;

        const R = home.getRadius();
        const groundY = cameraPos.y - agl;
        const center = this._stratosphereCenter.set(cameraPos.x, groundY - R, cameraPos.z);
        const blend = THREE.MathUtils.clamp(entryBlend, 0, 1);

        const skyBlend = THREE.MathUtils.smoothstep(1200, 5500, agl) * blend;
        const planetBlend = THREE.MathUtils.smoothstep(400, 3800, agl) * blend;
        const realPlanetView = agl >= 2800 && blend > 0.2;

        this._stratosphereActive = blend > 0.04;
        this.group.visible = true;
        this._sunLight.visible = true;
        this._sunLight.intensity = 2.2;
        this._sunLight.position.copy(this._sunDir.clone().multiplyScalar(280000));

        if (!this._stratosphereAmb) {
            this._stratosphereAmb = new THREE.HemisphereLight(0x88aacc, 0x223344, 0.55);
            this.scene.add(this._stratosphereAmb);
        }
        this._stratosphereAmb.intensity = 0.35 + skyBlend * 0.45;
        this._stratosphereAmb.visible = true;

        home.group.visible = true;
        home.group.position.copy(center);
        home.setSunDirection(this._sunDir);
        home.setVisualBlend(Math.max(planetBlend, realPlanetView ? blend : 0.88 * blend));
        home.update(time);
        home.updateDistancePresentation(cameraPos);

        for (const body of this._planets.values()) {
            if (body === home) continue;
            body.setVisualBlend(0);
            body.group.visible = false;
        }

        this._backdrop.setSunDirection(this._sunDir);
        const spaceBlend = Math.min(1, (0.2 + skyBlend * 0.8) * blend);
        const atmoBlend = realPlanetView ? 0 : Math.min(0.08, skyBlend * 0.08) * (1 - blend * 0.65);
        this._backdrop.setBlends(spaceBlend, atmoBlend);
        this._backdrop.group.visible = true;
        this._backdrop.group.position.copy(cameraPos);
        this._backdrop.setPlanetDirection(cameraPos, center);
        this._backdrop.update(cameraPos, time);
    }

    clearStratosphereView(force = false) {
        if (!this._stratosphereActive && !force) return;
        this._stratosphereActive = false;
        if (this._stratosphereAmb) this._stratosphereAmb.visible = false;
        this._backdrop.setBlends(0, 0);
        this._backdrop.group.visible = false;
        for (const body of this._planets.values()) {
            body.setVisualBlend(0);
        }
        if (!this._active) {
            this.group.visible = false;
            this._sunLight.visible = false;
            for (const body of this._planets.values()) {
                body.setVisualBlend(0);
            }
        }
    }

    isStratosphereActive() {
        return this._stratosphereActive;
    }

    isActive() { return this._active; }

    /** @param {'light'|'full'} stage — light = solo bruma; full = estrellas + planeta */
    prepareEntryBlend(stage = 'full') {
        this._backdrop.setSunDirection(this._sunDir);
        this._backdrop.group.visible = true;

        if (stage === 'light') {
            this._backdrop.setBlends(0, 0.14);
            this.group.visible = false;
            this._sunLight.visible = false;
            for (const body of this._planets.values()) {
                body.setVisualBlend(0);
            }
            return;
        }

        if (this._active) return;
        this.group.visible = true;
        this._sunLight.visible = true;
        for (const body of this._planets.values()) {
            body.setVisualBlend(0);
        }
    }

    /** Solo mueve el cielo estelar — barato entre frames de transición. */
    updateBackdropOnly(time, cameraPos) {
        if (this._stratosphereActive) return;
        if (this._backdrop.getSpaceBlend() <= 0.02
            && this._backdrop.getAtmoBlend() <= 0.02) return;
        this._backdrop.group.position.copy(cameraPos);
        this._backdrop.update(cameraPos, time);
        const home = this.getHomePlanet();
        if (home) {
            this._backdrop.setPlanetDirection(cameraPos, home.getWorldPosition(new THREE.Vector3()));
        }
    }

    setBackdropPosition(cameraPos) {
        this._backdrop.group.position.copy(cameraPos);
    }

    /** Mezcla vacío estelar + bruma azul al ascender. */
    setAscentBlends(spaceT, atmoT) {
        this._backdrop.setBlends(
            THREE.MathUtils.clamp(spaceT, 0, 1),
            THREE.MathUtils.clamp(atmoT, 0, 1),
        );
        const bodyBlend = THREE.MathUtils.clamp(spaceT, 0, 1);
        if (bodyBlend > 0.004) {
            this.group.visible = true;
        }
        for (const body of this._planets.values()) {
            body.setVisualBlend(bodyBlend);
        }
    }

    /** @param {number} t 0..1 — cielo estelar + planeta */
    setEntryBlend(t) {
        this.setAscentBlends(t, Math.max(0, (1 - t) * 0.25));
    }

    /** Posiciona al jugador en el universo conservando velocidad y rumbo. */
    enter(player, anchor, opts = {}) {
        const home = this._planets.get(this._homePlanetId);
        if (!home) return;

        const R = home.getRadius();
        home.group.position.set(0, 0, 0);

        const mapX = opts.mapX ?? player.position.x ?? anchor?.x ?? 0;
        const mapZ = opts.mapZ ?? player.position.z ?? anchor?.z ?? 0;
        const agl = Math.max(opts.agl ?? 2800, 2800);
        const dir = flatMapToSphereDirection(mapX, mapZ);
        const shellDist = R + agl;
        player.position.copy(dir.multiplyScalar(shellDist));
        if (!opts.keepVelocity) player.velocity.set(0, 0, 0);
        player.mesh.position.copy(player.position);

        this._active = true;
        this.group.visible = true;
        this._sunLight.visible = true;
        this._backdrop.setSunDirection(this._sunDir);
        const blend = opts.visualBlend ?? 1;
        this._backdrop.setBlends(blend, 0);
        this._backdrop.group.visible = true;
        for (const body of this._planets.values()) {
            body.setVisualBlend(blend);
        }

        if (!opts.keepScene) {
            this.scene.background = null;
            this.scene.fog = null;
        }
        this._sunLight.position.copy(this._sunDir.clone().multiplyScalar(280000));
    }

    /** Oculta espacio con blend descendente. */
    setExitBlend(t) {
        const blend = THREE.MathUtils.clamp(1 - t, 0, 1);
        this._backdrop.setBlends(blend, 0);
        for (const body of this._planets.values()) {
            body.setVisualBlend(blend);
        }
        if (blend <= 0.02) {
            this.exit();
        }
    }

    /** Oculta planeta/esfera con fade — no cortar visible de golpe. */
    hidePlanetsOnly() {
        this._active = false;
        this._sunLight.visible = false;
        for (const body of this._planets.values()) {
            body.setVisualBlend(0);
        }
    }

    exit() {
        this._active = false;
        this._stratosphereActive = false;
        if (this._stratosphereAmb) this._stratosphereAmb.visible = false;
        this.group.visible = false;
        this._sunLight.visible = false;
        this._backdrop.setBlends(0, 0);
        this._backdrop.group.visible = false;
        for (const body of this._planets.values()) {
            body.setVisualBlend(0);
        }
    }

    getHomePlanet() {
        return this._planets.get(this._homePlanetId) ?? null;
    }

    getPlanet(id) {
        return this._planets.get(id) ?? null;
    }

    getPlanetCenter(planetId = this._homePlanetId) {
        const p = this._planets.get(planetId);
        return p ? p.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    }

    update(time, cameraPos, camera = null) {
        if (!this._active && this._backdrop.getSpaceBlend() <= 0.02
            && this._backdrop.getAtmoBlend() <= 0.02) return;

        this.updateBackdropOnly(time, cameraPos);

        if (!this._active) return;

        for (const body of this._planets.values()) {
            body.update(time);
            if (this._active || this._stratosphereActive) {
                body.updateDistancePresentation(cameraPos);
            }
        }
    }

    /** Distancia al planeta gemelo lejano (para HUD). */
    getTwinPlanet() {
        for (const [id, body] of this._planets) {
            if (id === this._homePlanetId) continue;
            if (body.def?.enabled === false) continue;
            return body;
        }
        return null;
    }

    findNearestPlanet(playerPos, excludeId) {
        let nearest = null;
        let nearestDist = Infinity;
        for (const [id, body] of this._planets) {
            if (id === excludeId) continue;
            const d = body.distanceToPoint(playerPos);
            if (d < nearestDist) {
                nearestDist = d;
                nearest = { id, body, dist: d, def: body.def };
            }
        }
        return nearest;
    }

    getActivePlanetBodies() {
        return [...this._planets.values()];
    }
}
