import * as THREE from 'three';
import { loadGalaxySystem } from './galaxyCatalog.js';
import { FlightControls } from './FlightControls.js';
import { UniverseWorld } from './UniverseWorld.js';
import { SpaceMinimap } from './SpaceMinimap.js';
import { resolveFullMove } from '../terrainRules.js';
import { clampPointToDisc, WORLD_MAP } from '../worldNav.js';
import { universePosToFlatMap } from './planetMapProjection.js';
import { computeShellVisuals, shellRemapReady } from './planetShellBlend.js';
import { AtmosphereFX } from './AtmosphereFX.js';
import { OrbitalDebris } from './OrbitalDebris.js';
import { StratosphereShell } from './StratosphereShell.js';

/**
 * Mundo continuo — superficie → vuelo → ascenso → órbita → reentrada.
 */
export class GalaxyDirector {
    constructor(opts) {
        this.scene = opts.scene;
        this.camera = opts.camera;
        this.environment = opts.environment;
        this.player = opts.player;
        this.controls = opts.controls;

        this.system = loadGalaxySystem();
        this.currentPlanetId = this.system.homePlanetId;

        /** @type {'surface'|'atmospheric'|'ascending'|'descending'|'universe'} */
        this.worldMode = 'surface';
        this.phase = 'surface';

        this._flightPitch = 0;
        this._currentAgl = 0;
        this._surfaceReturn = null;
        this._planetAnchor = null;

        this._landingPlanet = null;
        this._crossCooldown = 0;

        /** Transición suave mapa ↔ órbita (estilo NMS: atmósfera por altitud). */
        this.ASCEND_PRE_HAZE_AGL = 1400;
        this.ASCEND_START_AGL = 2200;
        this.ASCEND_END_AGL = 4800;
        /** Debajo de esto: límite circular del mapa (minimapa). */
        this.MAP_FLIGHT_BOUNDARY_AGL = 900;
        /** Arriba de esto: cielo espacial + planeta real abajo. */
        this.STRATOSPHERE_START_AGL = 4500;
        this.SHELL_TRANSITION_SEC = 5.8;
        this._shellProgress = 0;
        this._shellRemapped = false;
        this._descendPayload = null;
        this._preAscentBlendActive = false;
        this._surfaceVisualsClean = true;
        this._uniTick = 0;
        this._descendSkyFade = 1;
        this._reentryFadeActive = false;
        this._stratosphereBlend = 0;
        /** Histéresis — evita parpadeo al cruzar la estratosfera. */
        this._stratosphereViewActive = false;
        this.STRATOSPHERE_EXIT_AGL = 3200;
        /** 0 = solo mapa, 1 = solo esfera — nunca ambos a la vez. */
        this._planetHandoff = 0;
        this._wasStratosphereViewActive = false;

        this._vCenter = new THREE.Vector3();
        this._vRel = new THREE.Vector3();
        this._vInward = new THREE.Vector3();
        this._vNext = new THREE.Vector3();

        this._hudEl = null;
        this._hintEl = null;
        this._modeEl = null;
        this._sunDir = new THREE.Vector3(0.55, 0.42, -0.35).normalize();
        this._flight = new FlightControls(this.camera);
        this._spaceMinimap = new SpaceMinimap();
        this._universe = new UniverseWorld(this.scene, this.system, this._sunDir);
        this._atmosphereFX = new AtmosphereFX(this.scene);
        this._orbitalDebris = new OrbitalDebris(this.scene);
        this._stratosphereShell = new StratosphereShell(this.scene);

        /** Navegación espacial — planeta destino + autopiloto 3D. */
        this._spaceNavPlanetId = null;
        this._spaceAutopilot = false;
        this._vNavCenter = new THREE.Vector3();
        this._vNavDir = new THREE.Vector3();
        this._vNavSteer = new THREE.Vector3();

        /** Metros sobre terreno para salir al universo. */
        this.UNIVERSE_WARP_AGL = 3200;
        /** Altitud mínima para volver a superficie con Numpad5. */
        this.ATMOS_LAND_AGL = 150;
        /** Distancia máxima al planeta para reentrar con Numpad5 (universo). */
        this.REENTRY_MAX_DIST = 200000;
        /** Grosor de atmósfera — al cruzarla vuelves al mapa plano en esa zona. */
        this.PLANET_ATMO_SHELL = 9000;
        /** Distancia al centro donde el mapa plano toma el relevo. */
        this.PLANET_ATMO_CROSS = 3800;
        /** Distancia mínima al centro — no traspasar la esfera. */
        this.PLANET_SURFACE_MARGIN = 220;
    }

    initHud() {
        this._hudEl = document.getElementById('galaxy-hud');
        this._hintEl = document.getElementById('galaxy-target-hint');
        this._modeEl = document.getElementById('galaxy-mode-label');
        this._spaceMinimap.bindGalaxy(this);
    }

    _getPlanetNavCenter(body, out = new THREE.Vector3()) {
        body.getWorldPosition(out);
        if (body.def?.id === this.currentPlanetId
            && this.worldMode === 'atmospheric'
            && this._stratosphereViewActive) {
            const R = body.getRadius();
            const groundY = this.player.position.y - this._currentAgl;
            out.set(this.player.position.x, groundY - R, this.player.position.z);
        }
        return out;
    }

    getMinimapData() {
        if (!this.usesOrbitalMinimap()) return null;

        const playerPos = this.player.position;
        const planets = [];
        let homeDist = Infinity;
        let navDist = Infinity;
        let navName = null;

        for (const body of this._universe.getActivePlanetBodies()) {
            if (body.def?.enabled === false) continue;
            const center = this._getPlanetNavCenter(body, new THREE.Vector3());
            const isHome = body.def?.id === this.currentPlanetId;
            const dist = Math.max(0, playerPos.distanceTo(center) - body.getRadius());
            if (isHome) homeDist = dist;
            const id = body.def?.id;
            const selected = id === this._spaceNavPlanetId;
            if (selected) {
                navDist = dist;
                navName = body.def?.name ?? 'Planeta';
            }
            planets.push({
                id,
                name: body.def?.name ?? 'Planeta',
                center,
                radius: body.getRadius(),
                isHome,
                isTwin: !!body.def?.isTwin,
                dist,
                selected,
            });
        }

        return {
            forward: this._flight.forward.clone(),
            up: this._flight.up.clone(),
            planets,
            homeDist,
            homeName: this._universe.getHomePlanet()?.def?.name ?? 'Planeta',
            navPlanetId: this._spaceNavPlanetId,
            navDist,
            navName,
            spaceAutopilot: this._spaceAutopilot,
        };
    }

    /** Centro 3D del planeta destino espacial (null si no hay). */
    getSpaceNavCenter(out = new THREE.Vector3()) {
        if (!this._spaceNavPlanetId) return null;
        const body = this._universe.getPlanet(this._spaceNavPlanetId);
        if (!body) return null;
        return this._getPlanetNavCenter(body, out);
    }

    getSpaceNavInfo() {
        if (!this._spaceNavPlanetId || !this.player) return null;
        const body = this._universe.getPlanet(this._spaceNavPlanetId);
        if (!body) return null;
        const center = this.getSpaceNavCenter(this._vNavCenter);
        const dist = Math.max(0, this.player.position.distanceTo(center) - body.getRadius());
        const to = this._vNavDir.subVectors(center, this.player.position);
        if (to.lengthSq() < 1) return { id: body.def.id, name: body.def?.name, dist, bearing: 0 };
        to.normalize();
        const bearing = (Math.atan2(to.x, -to.z) * (180 / Math.PI) + 360) % 360;
        return {
            id: body.def.id,
            name: body.def?.name ?? 'Planeta',
            dist,
            bearing,
            autopilot: this._spaceAutopilot,
        };
    }

    _isOffWorldSpaceNav() {
        return !!(this._spaceNavPlanetId && this._spaceNavPlanetId !== this.currentPlanetId);
    }

    /** Tab en estratosfera/órbita — marca gemelo; no lanza ascenso ni gira la nave en el mapa. */
    onSpaceNavTabKey() {
        const twin = this._universe.getTwinPlanet();
        if (!twin) {
            this._flashHint('No hay planeta gemelo en este sistema');
            return;
        }
        const twinId = twin.def.id;
        const twinName = twin.def?.name ?? 'Gemelo';
        const inOrbit = this.worldMode === 'universe';

        if (this._spaceNavPlanetId !== twinId) {
            this.setSpaceNavPlanet(twinId, false);
            if (inOrbit) {
                this._flashHint(`${twinName} marcado · Tab otra vez = autopiloto · ~785 km`);
            } else {
                this._flashHint(`${twinName} marcado · Numpad8 = salir al espacio (2.2+ km)`);
            }
            return;
        }

        if (!inOrbit) {
            this._flashHint(`Destino ${twinName} · pulsa Numpad8 para ir al espacio`);
            return;
        }

        this._spaceAutopilot = !this._spaceAutopilot;
        this._flashHint(this._spaceAutopilot
            ? `${twinName} · autopiloto ON · WASD cancela`
            : `${twinName} · autopiloto OFF`);
    }

    setSpaceNavPlanet(planetId, enableAutopilot = false) {
        const body = this._universe.getPlanet(planetId);
        if (!body || body.def?.enabled === false) return false;
        this._spaceNavPlanetId = planetId;
        if (enableAutopilot && this.worldMode === 'universe') {
            this._spaceAutopilot = true;
        } else if (enableAutopilot) {
            this._spaceAutopilot = false;
        }
        const log = document.getElementById('log-text');
        if (log) {
            const ap = this._spaceAutopilot ? ' · autopiloto ON' : '';
            log.innerHTML = `<span style="color:#88ddff;">Destino: ${body.def?.name ?? 'Planeta'}${ap}</span>`;
        }
        return true;
    }

    clearSpaceNav() {
        this._spaceNavPlanetId = null;
        this._spaceAutopilot = false;
    }

    usesOrbitalMinimap() {
        if (this.worldMode === 'universe') return true;
        if (this.worldMode === 'atmospheric' && this._stratosphereViewActive) return true;
        if (this.worldMode === 'ascending' && this._shellRemapped) return true;
        if (this.worldMode === 'descending' && !this._shellRemapped) return true;
        return false;
    }

    showSurfaceHint() {
        this._updateHud('SUPERFICIE', 'WASD · Numpad8 = vuelo (ratón) · ↑ = subir morro · Numpad5 aterrizar');
        this.restoreSurfaceVisuals();
    }

    /** Restaura cielo día, terreno y apaga capas espaciales residuales. */
    restoreSurfaceVisuals() {
        const p = this.player?.position;
        this._finishReturnToPlanet(this.player.position, this.environment);
        this._preAscentBlendActive = false;
        this._surfaceVisualsClean = true;
        this._descendSkyFade = 1;
        this._reentryFadeActive = false;
        if (this.camera) {
            this.camera.far = 26000;
            this.camera.near = 0.8;
            this.camera.updateProjectionMatrix();
        }
    }

    /** Apaga espacio 3D y reactiva el mapa plano con terreno. */
    _finishReturnToPlanet(playerPos, environment) {
        if (!playerPos || !environment) return;
        this._stratosphereBlend = 0;
        this._stratosphereViewActive = false;
        this._planetHandoff = 0;
        this._wasStratosphereViewActive = false;
        this._universe.clearStratosphereView(true);
        this._universe.exit();
        this._atmosphereFX?.setIntensity?.(0);
        this._orbitalDebris?.setIntensity?.(0);
        this._stratosphereShell?.setIntensity?.(0);
        environment.finishPlanetaryReentry(this.scene, playerPos.x, playerPos.z);
        environment.releasePlanetShellView(this.scene);
    }

    isSpaceMode() { return this.worldMode === 'universe'; }
    isUniverseMode() { return this.worldMode === 'universe'; }
    isAtmosphericMode() { return this.worldMode === 'atmospheric'; }
    isFlightMode() {
        return this.worldMode === 'atmospheric'
            || this.worldMode === 'universe'
            || this.worldMode === 'ascending'
            || this.worldMode === 'descending';
    }
    isTransition() {
        return this.worldMode === 'ascending' || this.worldMode === 'descending';
    }
    blocksSurfaceSimulation() {
        if (this.worldMode === 'universe') return true;
        if (this.worldMode === 'ascending' && !this._shellRemapped) return true;
        if (this.worldMode === 'descending' && this._shellProgress < 0.48) return true;
        if (this._reentryFadeActive) return true;
        if (this.worldMode === 'atmospheric' && this._stratosphereViewActive && this._planetHandoff > 0.1) {
            return true;
        }
        return false;
    }
    blocksOrbitControls() {
        return this.isFlightMode();
    }
    checkAscensionTrigger() {}

    getAltitudeAgl() { return this._currentAgl; }

    usesFlightControls() { return this.isFlightMode(); }
    handlesCamera() { return this.isFlightMode(); }
    wantsPointerLock() { return this.handlesCamera(); }

    /** Numpad8 / ↑ — vuelo inmediato, ratón manda sin esperar. */
    onAscendKey(pointerLock) {
        if (this.isTransition()) return;
        if (this.worldMode === 'universe') {
            pointerLock?.enableFlightAim?.();
            pointerLock?.tryLock?.(this);
            return;
        }
        if (this.worldMode === 'atmospheric') {
            this._currentAgl = this._altAboveGround(this.player, this.environment);
            if (this._currentAgl >= this.ASCEND_START_AGL) {
                this._beginShellAscend(this.player, this.environment, pointerLock);
            } else {
                pointerLock?.enableFlightAim?.();
                pointerLock?.tryLock?.(this);
                this._flashHint(`Sube a ~${this.ASCEND_START_AGL} m y pulsa Numpad8 para ir al espacio`);
            }
            return;
        }
        this._enterAtmosphericFlight(pointerLock);
    }

    /** Numpad5 — aterrizar, reentrar al mapa, o cancelar ascenso al espacio. */
    onDescendKey(pointerLock) {
        if (this.worldMode === 'ascending' && !this._shellRemapped) {
            this._abortShellAscend(this.environment, pointerLock);
            return;
        }
        if (this.isTransition()) {
            this._flashHint('Espera a que termine la transición atmosférica');
            return;
        }
        if (this.worldMode === 'universe') {
            const body = this._landingPlanet?.body ?? this._universe.getHomePlanet();
            if (body) {
                this._crossToFlatMap(this.player, body, this.environment, pointerLock, true);
            } else {
                this._flashHint('Acércate al planeta');
            }
            return;
        }
        if (this.worldMode === 'atmospheric') {
            this._currentAgl = this._altAboveGround(this.player, this.environment);
            if (this._currentAgl <= this.ATMOS_LAND_AGL) {
                this._exitAtmosphericFlight(pointerLock);
            } else {
                this._flashHint(`Baja a ~${this.ATMOS_LAND_AGL} m para aterrizar (Numpad5)`);
            }
        }
    }

    _flashHint(msg) {
        const log = document.getElementById('log-text');
        if (log) log.innerHTML = `<span style="color:#a8c8e0;">${msg}</span>`;
        if (this._hintEl) this._hintEl.textContent = msg;
    }

    _enterAtmosphericFlight(pointerLock) {
        this._ensurePlanetAnchor(this.player, this.environment);
        this.worldMode = 'atmospheric';
        this.phase = 'climb';
        this._flightPitch = 0;
        this._flight.resetFromView(this.camera);
        this._flight.orientShip(this.player.mesh, this.player.position, 1);
        if (this.player.visualGroup) {
            this.player.visualGroup.rotation.x = 0;
            this.player.visualGroup.rotation.z = 0;
        }
        this._flight.updateCamera(this.camera, this.controls, this.player.position, 1, {
            dist: 240,
            lift: 60,
            camPosSmooth: 1,
            camRotSmooth: 1,
        });
        const h = this.environment?.getHeightAt(this.player.position.x, this.player.position.z) ?? 0;
        const minY = Math.max(h, 0) + (this.player.hoverHeight || 35);
        if (this.player.position.y < minY) {
            this.player.position.y = minY;
            this.player.mesh.position.copy(this.player.position);
        }
        this.player.velocity.set(0, 0, 0);
        const safe = clampPointToDisc(this.player.position.x, this.player.position.z, WORLD_MAP.playerClampScale);
        if (safe.clamped) {
            this.player.position.x = safe.x;
            this.player.position.z = safe.z;
            this.player.mesh.position.copy(this.player.position);
        }
        this._surfaceVisualsClean = false;
        this._reentryFadeActive = false;
        this._descendSkyFade = 1;
        this.environment?.setAscentPerfMode?.(true);
        this._universe?.exit?.();
        this.environment?.setAtmosphericFlightView?.(true);
        pointerLock?.enableFlightAim?.();
        pointerLock?.tryLock?.(this);
        window.__game?._syncGalaxyOrbitControls?.();
        this._updateHud('VUELO', 'Ratón manda · WASD · Numpad5 aterriza · Numpad8 arriba de 2.2 km = espacio');
        const log = document.getElementById('log-text');
        if (log) log.innerHTML = '<span style="color:#7fe4ff;">Modo vuelo — sube si quieres; el espacio solo con Numpad8</span>';
    }

    _exitAtmosphericFlight(pointerLock) {
        this.worldMode = 'surface';
        this.phase = 'surface';
        this._flightPitch = 0;
        this._flight._initialized = false;
        this.restoreSurfaceVisuals();
        pointerLock?.disableFlightAim?.();
        pointerLock?.unlock?.();
        window.__game?._syncGalaxyOrbitControls?.();
        this.controls?.update?.();
        const h = this.environment?.getHeightAt(this.player.position.x, this.player.position.z) ?? 0;
        this.player.position.y = Math.max(h, 0) + (this.player.hoverHeight || 35);
        this.player.velocity.set(0, 0, 0);
        this.player.mesh.position.copy(this.player.position);
        this.showSurfaceHint();
        const log = document.getElementById('log-text');
        if (log) log.innerHTML = '<span style="color:#7fe4ff;">Aterrizaje — modo superficie</span>';
    }

    _altAboveGround(player, environment) {
        const h = environment?.getHeightAt(player.position.x, player.position.z) ?? 0;
        return player.position.y - Math.max(h, 0);
    }

    _ensurePlanetAnchor(player, environment) {
        if (this._planetAnchor) return;
        const baseY = environment?.getHeightAt(player.position.x, player.position.z) ?? 0;
        this._planetAnchor = {
            x: player.position.x,
            z: player.position.z,
            baseY: Math.max(baseY, 0),
        };
    }

    _readPitchInput(player, delta) {
        const up = !!(player.keys?.arrowup || player.keys?.i);
        const down = !!(player.keys?.arrowdown || player.keys?.k);
        const dt = Math.min(delta, 0.05);
        if (up) this._flightPitch = Math.min(0.72, this._flightPitch + dt * 2.4);
        else if (down) this._flightPitch = Math.max(-0.28, this._flightPitch - dt * 2.4);
        else this._flightPitch *= 0.92;
    }

    updateFlight(delta, player, environment, controls, pointerLock) {
        if (!window.__game?._sessionActive || player.isDead) return;

        this._readPitchInput(player, delta);

        if (this.worldMode === 'universe') {
            this._crossCooldown = Math.max(0, this._crossCooldown - delta);
            this._updateUniverseFlight(delta, player, controls, pointerLock);
            this._enforceUniversePlanetShell(player, environment, pointerLock);
            this._universe.update(performance.now() * 0.001, player.position, this.camera);
            this._spaceMinimap.update(this, player);
            this._updateUniverseHud();
            this._updateLandingTarget(player);
            return;
        }

        if (this.worldMode === 'ascending') {
            this._tickShellAscend(delta, player, environment, controls, pointerLock);
            return;
        }

        if (this.worldMode === 'descending') {
            this._tickShellDescend(delta, player, environment, controls, pointerLock);
            return;
        }

        if (this.worldMode === 'atmospheric') {
            this._updateAtmosphericFlight(delta, player, environment, controls, pointerLock);
            return;
        }

        // ─── SUPERFICIE: solo WASD normal ───
        this._currentAgl = this._altAboveGround(player, environment);
        this.phase = 'surface';
        if (!this._surfaceVisualsClean) {
            this.restoreSurfaceVisuals();
        }
        this._updateSurfaceHud();
        this._spaceMinimap.update(this, player);
    }

    _updateAtmosphericFlight(delta, player, environment, controls, pointerLock) {
        const prevX = player.position.x;
        const prevZ = player.position.z;

        this._runFlightPhysics(delta, player, controls, pointerLock, {
            speed: 1600,
            nitroSpeed: 3200,
            camDist: 240,
            camLift: 60,
            atmospheric: true,
        });

        this._clampAtmosphericFlight(player, environment, prevX, prevZ);

        if (!this._reentryFadeActive) {
            this._updateHighAtmospherePresentation(this._currentAgl, player, delta);
        }

        this._spaceMinimap.update(this, player);
        this._updateAtmosphericHud();
        if (!this._stratosphereViewActive && !this._reentryFadeActive && this._planetHandoff < 0.06) {
            environment?.updateHighAltitudeFlight?.(this._currentAgl, this.scene);
        }
        if (this._reentryFadeActive) {
            this._tickDescendSkyFade(delta, environment);
        } else {
            const stratoOff = !this._stratosphereViewActive && this._planetHandoff < 0.03;
            if (stratoOff && this._wasStratosphereViewActive) {
                this._universe?.clearStratosphereView?.(true);
                this._stratosphereShell?.setIntensity?.(0);
                this._orbitalDebris?.setIntensity?.(0);
                environment?.releasePlanetShellView?.(this.scene, { restoreSky: true });
            }
            this._wasStratosphereViewActive = this._stratosphereViewActive;
        }
    }

    /** Cielo espacial + planeta 3D — histéresis real (entra ~4.5 km, sale ~3.2 km). */
    _updateHighAtmospherePresentation(agl, player, delta) {
        const START = this.STRATOSPHERE_START_AGL;
        const EXIT = this.STRATOSPHERE_EXIT_AGL;

        if (agl >= START) {
            this._stratosphereViewActive = true;
        } else if (agl < EXIT - 500) {
            this._stratosphereViewActive = false;
        }

        const enterFade = THREE.MathUtils.smoothstep(START - 700, START + 600, agl);
        const exitFade = THREE.MathUtils.smoothstep(EXIT - 700, EXIT + 150, agl);
        let planetT = Math.min(enterFade, exitFade);

        if (this._isOffWorldSpaceNav() && agl >= EXIT - 500) {
            planetT = Math.max(planetT, enterFade);
        }

        this._planetHandoff = planetT;

        if (!this._stratosphereViewActive || planetT < 0.02) {
            if (planetT > 0.02) {
                this.environment?.blendStratosphereEntry?.(planetT, agl, this.scene);
            } else {
                this.environment?.releasePlanetShellView?.(this.scene);
            }
            return;
        }

        this.environment?.setPlanetSphereView?.(true);
        this.environment?.setSurfaceFade?.(0);

        const skyT = THREE.MathUtils.smoothstep(this.STRATOSPHERE_START_AGL, 12000, agl);
        this._stratosphereBlend = skyT;
        const time = performance.now() * 0.001;
        const R = this._universe.getHomePlanet()?.getRadius?.() ?? 22000;

        const needFar = Math.min(900000, Math.max(80000, agl + R * 3.5 + 40000));
        if (this.camera) {
            this.camera.far = needFar;
            this.camera.near = 0.8;
            this.camera.updateProjectionMatrix();
        }

        if (planetT < 0.92) {
            this.environment?.blendStratosphereEntry?.(planetT, agl, this.scene);
        } else {
            this.environment?.applyStratosphereView?.(agl, this.scene);
        }
        this._universe.setStratosphereView(agl, player.position, time, planetT);

        this._stratosphereShell.setIntensity(skyT * planetT);
        this._stratosphereShell.update(player.position, agl, R, time);

        const hazeFx = Math.max(0, (1 - planetT) * 0.22) + skyT * 0.1;
        this._atmosphereFX.setIntensity(hazeFx);
        this._atmosphereFX.update(this.camera, delta);

        this._orbitalDebris.setIntensity(skyT * 0.65 * planetT);
        this._orbitalDebris.update(this.camera, delta);

        if (this.scene) {
            this.scene.fog = planetT > 0.75 ? null : new THREE.FogExp2(0x0a1428, 0.000003 * (1 - planetT));
            const bg = new THREE.Color(0x6a98c8).lerp(new THREE.Color(0x03050c), skyT * planetT);
            this.scene.background = bg;
        }
    }

    _abortShellAscend(environment, pointerLock) {
        this.worldMode = 'atmospheric';
        this.phase = 'climb';
        this._shellProgress = 0;
        this._shellRemapped = false;
        this._preAscentBlendActive = false;
        this._uniTick = 0;
        this._planetHandoff = 0;
        this._stratosphereViewActive = false;
        this._wasStratosphereViewActive = false;
        this._universe.exit();
        environment?.releasePlanetShellView?.(this.scene, { restoreSky: true });
        environment?.cancelShellTransition?.(this.scene);
        environment?.setAscentPerfMode?.(true);
        environment?.setAtmosphericFlightView?.(true);
        if (this.camera) {
            this.camera.far = 26000;
            this.camera.near = 0.8;
            this.camera.updateProjectionMatrix();
        }
        pointerLock?.enableFlightAim?.();
        this._updateAtmosphericHud();
        environment?.updateHighAltitudeFlight?.(this._currentAgl, this.scene);
    }

    _tickDescendSkyFade(delta, environment) {
        if (!this._reentryFadeActive || this._descendSkyFade >= 1) return;
        this._descendSkyFade = Math.min(1, this._descendSkyFade + delta / 5.2);
        const t = this._descendSkyFade;
        const ease = t * t * (3 - 2 * t);
        environment?.lerpSkyToSurface?.(t, this.scene);
        environment?.setSurfaceFade?.(ease);
        this._universe.setAscentBlends(0, 0);
        const spaceLeft = 1 - ease;
        this._atmosphereFX.setIntensity(spaceLeft * 0.65);
        this._atmosphereFX.update(this.camera, delta);
        this._uniTick++;
        if (this._uniTick % 2 === 0) {
            this._universe.updateBackdropOnly(performance.now() * 0.001, this.player.position);
        }
        if (t >= 1) {
            this._reentryFadeActive = false;
            this._atmosphereFX.setIntensity(0);
            this._finishReturnToPlanet(this.player.position, environment);
            this._surfaceVisualsClean = true;
        }
    }

    /** Visuals de transición — mapa O esfera, nunca los dos. */
    _applyTransitionFrame(visuals, player, environment, ascending, delta = 0.016) {
        const agl = this._currentAgl;
        const R = this._universe.getHomePlanet()?.getRadius?.() ?? 22000;
        const time = performance.now() * 0.001;

        let spaceT;
        let useStratosphereCenter = false;

        if (ascending && !this._shellRemapped && agl >= this.STRATOSPHERE_START_AGL - 300) {
            const stratoBlend = Math.max(
                visuals.planetReveal,
                THREE.MathUtils.smoothstep(
                    this.STRATOSPHERE_START_AGL - 400,
                    this.STRATOSPHERE_START_AGL + 900,
                    agl,
                ),
            );
            this._universe.setStratosphereView(agl, player.position, time, stratoBlend);
            spaceT = stratoBlend * 0.9;
            useStratosphereCenter = true;
            if (stratoBlend > 0.06) {
                environment?.setPlanetSphereView?.(true);
            }
            const needFar = Math.min(900000, Math.max(80000, agl + R * 3.5 + 40000));
            if (this.camera) {
                this.camera.far = Math.max(this.camera.far, needFar);
                this.camera.updateProjectionMatrix();
            }
        } else if (ascending) {
            spaceT = this._shellRemapped ? visuals.planetReveal : Math.min(visuals.planetReveal, 0.28);
            if (!this._shellRemapped) {
                this._universe.prepareEntryBlend('light');
            }
        } else {
            spaceT = visuals.planetReveal;
        }

        if (!useStratosphereCenter) {
            environment?.setShellBlend?.(visuals, this.scene);
        } else if (visuals.surfaceFade > 0.05) {
            environment?.setSurfaceFade?.(0);
        }
        environment?.setTransitionVeil?.(visuals.veilStrength ?? 0);

        const atmoT = visuals.atmoHaze * (ascending ? 0.42 : 0.72);

        if (!useStratosphereCenter) {
            this._universe.setAscentBlends(spaceT, atmoT);
        }
        this._universe.setBackdropPosition(player.position);

        const fxIntensity = Math.max(visuals.atmoHaze, visuals.veilStrength * 0.6)
            * (ascending ? 0.5 : 0.88);
        this._atmosphereFX.setIntensity(fxIntensity);
        this._atmosphereFX.update(this.camera, delta);

        if (!useStratosphereCenter) {
            if (visuals.planetReveal > 0.06 && spaceT > 0.04) {
                environment?.setPlanetSphereView?.(true);
            } else if (visuals.surfaceFade > 0.08 && visuals.planetReveal <= 0.04) {
                environment?.releasePlanetShellView?.(this.scene);
            }
        }

        this._uniTick++;
        const updatePlanets = spaceT > 0.04 || useStratosphereCenter;
        if (!updatePlanets || this._uniTick % 2 === 0) {
            this._universe.update(time, player.position, this.camera);
        } else {
            this._universe.updateBackdropOnly(time, player.position);
        }

        const camLerp = ascending ? 0.14 : 0.1;
        this.camera.far = THREE.MathUtils.lerp(this.camera.far, visuals.cameraFar, camLerp);
        this.camera.near = THREE.MathUtils.lerp(this.camera.near, visuals.cameraNear, camLerp);
        this.camera.updateProjectionMatrix();
    }

    _shellProgressFromAltitude(agl) {
        return THREE.MathUtils.clamp(
            (agl - this.ASCEND_START_AGL) / (this.ASCEND_END_AGL - this.ASCEND_START_AGL),
            0,
            1,
        );
    }

    _syncAgl(player, environment) {
        if (this._shellRemapped && this._universe.isActive()) {
            const home = this._universe.getHomePlanet();
            if (home) {
                const c = home.getWorldPosition(this._vCenter);
                this._currentAgl = Math.max(0, player.position.distanceTo(c) - home.getRadius());
                return;
            }
        }
        this._currentAgl = this._altAboveGround(player, environment);
    }

    _beginShellAscend(player, environment, pointerLock) {
        this._ensurePlanetAnchor(player, environment);
        this.worldMode = 'ascending';
        this.phase = 'atmosphere';
        this._shellProgress = 0;
        this._shellRemapped = false;
        this._surfaceVisualsClean = false;
        this._uniTick = 0;
        this._universe.exit();
        this._preAscentBlendActive = false;
        environment?.setAscentPerfMode?.(true);
        this._updateHud('ATMÓSFERA', 'Rompiendo capa superior — sigue volando');
        const log = document.getElementById('log-text');
        if (log) {
            log.innerHTML = '<span style="color:#a8e8ff;">Ascenso — el cielo se oscurece, el planeta aparece abajo…</span>';
        }
    }

    _tickShellAscend(delta, player, environment, controls, pointerLock) {
        this._syncAgl(player, environment);

        this._shellProgress = Math.min(1, this._shellProgress + delta / this.SHELL_TRANSITION_SEC);

        const prevX = player.position.x;
        const prevZ = player.position.z;
        this._runFlightPhysics(delta, player, controls, pointerLock, {
            speed: 1500,
            nitroSpeed: 3000,
            camDist: THREE.MathUtils.lerp(240, 480, this._shellProgress),
            camLift: THREE.MathUtils.lerp(60, 95, this._shellProgress),
            atmospheric: !this._shellRemapped,
        });

        if (!this._shellRemapped) {
            this._clampAtmosphericFlight(player, environment, prevX, prevZ);
        } else {
            this._enforceUniversePlanetShell(player, environment, pointerLock);
        }

        const visuals = computeShellVisuals(this._shellProgress, true);
        this._surfaceVisualsClean = false;
        this._applyTransitionFrame(visuals, player, environment, true, delta);

        if (!this._shellRemapped && (
            shellRemapReady(this._shellProgress, visuals.atmoHaze)
            || this._shellProgress >= 0.56
        )) {
            this._remapPlayerToOrbit(player, environment);
            this._shellRemapped = true;
        }

        if (this._shellProgress >= 1) {
            this._completeShellAscend(environment, pointerLock);
        }

        this._spaceMinimap.update(this, player);
    }

    _remapPlayerToOrbit(player, environment) {
        environment?.setTransitionVeil?.(0.95);
        environment?.lockToOrbitView?.();
        const agl = Math.max(this._currentAgl, this.UNIVERSE_WARP_AGL);
        const visuals = computeShellVisuals(this._shellProgress, true);
        this._universe.enter(player, this._planetAnchor, {
            mapX: player.position.x,
            mapZ: player.position.z,
            agl,
            keepVelocity: true,
            keepScene: true,
            visualBlend: visuals.planetReveal,
        });
    }

    _completeShellAscend(environment, pointerLock) {
        environment?.setTransitionVeil?.(0);
        environment?.lockToOrbitView?.();
        environment?.setAtmosphericFlightView?.(false);
        this.worldMode = 'universe';
        this.phase = 'orbit';
        this._shellProgress = 0;
        this._shellRemapped = false;
        this._uniTick = 0;
        this.scene.background = null;
        this.scene.fog = null;
        this._universe.setAscentBlends(1, 0);
        this.controls.maxDistance = 12000;
        if (this.camera) {
            this.camera.far = 520000;
            this.camera.near = 2;
            this.camera.updateProjectionMatrix();
        }
        pointerLock?.enableFlightAim?.();
        pointerLock?.tryLock?.(this);
        window.__game?._syncGalaxyOrbitControls?.();
        this._updateHud('ÓRBITA', 'Espacio — mismo vuelo, nueva escala');
        const log = document.getElementById('log-text');
        if (log) {
            log.innerHTML = '<span style="color:#7fe4ff;">Órbita — el planeta que ves es el mismo mundo</span>';
        }
    }

    _beginShellDescend(payload) {
        this._descendPayload = payload;
        this.worldMode = 'descending';
        this.phase = 'atmosphere';
        this._shellProgress = 0;
        this._shellRemapped = false;
        this._uniTick = 0;
        this.environment?.setAscentPerfMode?.(true);
        this.environment?.setTransitionVeil?.(0);
        this._updateHud('REENTRADA', 'Entrando en atmósfera — no sueltes el morro');
        const log = document.getElementById('log-text');
        if (log) {
            log.innerHTML = '<span style="color:#a8e8ff;">Descenso — bruma azul, el mapa reaparece bajo la nave…</span>';
        }
    }

    _tickShellDescend(delta, player, environment, controls, pointerLock) {
        this._shellProgress = Math.min(1, this._shellProgress + delta / this.SHELL_TRANSITION_SEC);

        const prevX = player.position.x;
        const prevZ = player.position.z;
        this._runFlightPhysics(delta, player, controls, pointerLock, {
            speed: 1300,
            nitroSpeed: 2800,
            camDist: THREE.MathUtils.lerp(480, 260, this._shellProgress),
            camLift: THREE.MathUtils.lerp(95, 62, this._shellProgress),
            drift: 0.992,
        });

        if (this._shellRemapped) {
            this._clampAtmosphericFlight(player, environment, prevX, prevZ);
        } else {
            this._enforceUniversePlanetShell(player, environment, pointerLock);
        }

        const visuals = computeShellVisuals(this._shellProgress, false);
        this._surfaceVisualsClean = false;
        this._applyTransitionFrame(visuals, player, environment, false, delta);

        if (!this._shellRemapped && this._descendPayload && (
            shellRemapReady(this._shellProgress, visuals.atmoHaze)
            || this._shellProgress >= 0.56
        )) {
            this._remapPlayerToMap(this._descendPayload);
            this._shellRemapped = true;
        }

        if (this._shellProgress >= 1) {
            this._completeShellDescend(environment, pointerLock);
        }

        this._spaceMinimap.update(this, player);
    }

    _remapPlayerToMap(payload) {
        const { player, mapped, entryY, vel, thrustFwd, environment } = payload;
        environment?.setTransitionVeil?.(0.95);
        environment?.releaseOrbitViewForDescent?.();
        this._universe.clearStratosphereView();
        player.position.set(mapped.x, entryY, mapped.z);
        player.velocity.copy(vel);
        player.mesh.position.copy(player.position);
        this._flight.setForwardDirection(thrustFwd);
        this._flight._initialized = true;
        this._flight.orientShip(player.mesh, player.position, 1);
        this._currentAgl = entryY - mapped.groundY;
    }

    _completeShellDescend(environment, pointerLock) {
        const payload = this._descendPayload;
        const player = this.player;
        if (payload) {
            this.currentPlanetId = payload.def.id;
        }
        environment?.setAtmosphericFlightView?.(true);
        this._surfaceVisualsClean = false;
        this._preAscentBlendActive = false;
        this._uniTick = 0;
        this.worldMode = 'atmospheric';
        this.phase = 'climb';
        this._shellProgress = 0;
        this._shellRemapped = false;
        this._descendPayload = null;
        this._flightPitch = 0;
        this._stratosphereViewActive = false;
        this._spaceMinimap.reset();
        this.controls.maxDistance = 1500;
        if (this.camera) {
            this.camera.far = 26000;
            this.camera.near = 0.8;
            this.camera.updateProjectionMatrix();
        }
        environment?.releasePlanetShellView?.(this.scene);
        environment?.setSurfaceFade?.(0);
        environment?.lerpSkyToSurface?.(0, this.scene);
        this._universe.clearStratosphereView(true);
        this._universe.setAscentBlends(0.45, 0.2);
        this._reentryFadeActive = true;
        this._descendSkyFade = 0;
        pointerLock?.enableFlightAim?.();
        pointerLock?.tryLock?.(this);
        window.__game?._syncGalaxyOrbitControls?.();
        this._updateHud('REENTRADA', 'Entrando al mapa — bruma y cielo día reaparecen…');
        const log = document.getElementById('log-text');
        if (log) {
            log.innerHTML = '<span style="color:#a8e8ff;">Reentrada — sigue volando, el terreno emerge bajo la nave…</span>';
        }
    }

    _updateAtmosphericHud() {
        if (this._reentryFadeActive) {
            const pct = Math.round(this._descendSkyFade * 100);
            this._updateHud('REENTRADA', `Bajando al mapa — bruma ${pct} % · sigue volando`);
            return;
        }
        const agl = Math.round(this._currentAgl);
        let hint;
        if (agl < this.MAP_FLIGHT_BOUNDARY_AGL) {
            hint = `Vuelo ${agl} m · Límite del mapa abajo · Numpad5 aterriza`;
        } else if (agl < this.STRATOSPHERE_START_AGL) {
            hint = `Vuelo ${agl} m — sube más para ver el planeta desde arriba`;
        } else if (agl < this.ASCEND_START_AGL) {
            hint = `Estratosfera ${(agl / 1000).toFixed(1)} km · Tab = marcar gemelo · Numpad8 = ir al espacio`;
        } else {
            hint = `Estratosfera ${(agl / 1000).toFixed(1)} km · Tab = gemelo · Numpad8 = espacio · en órbita Tab = autopiloto`;
        }
        this._updateHud(agl >= this.STRATOSPHERE_START_AGL ? 'ESTRATOSFERA' : 'VUELO', hint);
    }

    _updateUniverseFlight(delta, player, controls, pointerLock) {
        this.phase = 'orbit';
        this._runFlightPhysics(delta, player, controls, pointerLock, {
            speed: 1100,
            nitroSpeed: 2600,
            camDist: 520,
            camLift: 105,
            camPosSmooth: 5.5,
            camRotSmooth: 5,
            drift: 0.992,
        });
    }

    _runFlightPhysics(delta, player, controls, pointerLock, opts) {
        const pitchKeys = !!(player.keys?.arrowup || player.keys?.i);
        const look = pointerLock?.consumeDelta?.() ?? { dx: 0, dy: 0 };
        const aimActive = !!(pointerLock?.locked || pointerLock?.flightAimActive);

        this._flight.updateAim(delta, {
            dx: look.dx,
            dy: look.dy,
            aimActive,
            keyboardPitch: this._flightPitch,
            pitchKeys,
            playerPos: player.position,
            camera: this.camera,
            controls,
            mesh: player.mesh,
        });
        this._flight.orientShip(player.mesh, player.position, delta);

        if (opts.atmospheric && this._currentAgl < 400) {
            this._flight.clampPitch(-0.1, 1.05);
        }

        const manualFlight = !!(player.keys?.a || player.keys?.d || player.keys?.s);
        if (manualFlight && this._spaceAutopilot) {
            this._spaceAutopilot = false;
        }

        const spaceThrust = this._applySpaceNavAutopilot(delta, player, manualFlight);

        const nitro = !!(player.keys?.shift && player.energy > 0);
        const speed = nitro ? opts.nitroSpeed : opts.speed;
        let deltaMove = this._flight.buildMoveInput(player, speed, delta);
        if (!deltaMove && spaceThrust) {
            deltaMove = this._flight.thrustForward.clone().multiplyScalar(speed * delta);
        }
        if (deltaMove) {
            player.position.add(deltaMove);
            player.velocity.copy(deltaMove.clone().multiplyScalar(1 / Math.max(delta, 0.001)));
        } else {
            player.velocity.multiplyScalar(opts.drift ?? 0.9);
        }
        player.mesh.position.copy(player.position);

        this._flight.updateCamera(this.camera, controls, player.position, delta, {
            dist: opts.camDist,
            lift: opts.camLift,
            camPosSmooth: opts.camPosSmooth ?? 7,
            camRotSmooth: opts.camRotSmooth ?? 6.5,
        });
    }

    _clampAtmosphericFlight(player, environment, prevX, prevZ) {
        if (!environment) return;
        this.phase = 'climb';

        const hover = player.hoverHeight || 35;
        const offWorld = this._isOffWorldSpaceNav();
        let groundY;
        if (offWorld && this._planetAnchor) {
            groundY = this._planetAnchor.baseY;
        } else {
            groundY = Math.max(environment.getHeightAt(player.position.x, player.position.z), 0);
        }
        const minY = groundY + hover;
        if (player.position.y < minY) {
            player.position.y = minY;
            if (player.velocity.y < 0) player.velocity.y = 0;
        }

        this._currentAgl = player.position.y - groundY;
        const skipMapDisc = offWorld
            || this._stratosphereViewActive
            || this._currentAgl >= this.MAP_FLIGHT_BOUNDARY_AGL
            || this._spaceAutopilot
            || this.worldMode === 'ascending'
            || this.worldMode === 'descending';

        if (!skipMapDisc) {
            const resolved = resolveFullMove(
                environment,
                prevX,
                prevZ,
                player.position.x,
                player.position.z,
                player.position.y,
            );
            if (resolved.blocked) {
                if (resolved.boundary) player._showWorldBoundaryHint?.();
                if (Math.abs(resolved.x - player.position.x) < 0.5) player.velocity.x = 0;
                if (Math.abs(resolved.z - player.position.z) < 0.5) player.velocity.z = 0;
            }
            player.position.x = resolved.x;
            player.position.z = resolved.z;

            const safe = clampPointToDisc(
                player.position.x,
                player.position.z,
                WORLD_MAP.playerClampScale,
            );
            if (safe.clamped) {
                player.position.x = safe.x;
                player.position.z = safe.z;
                player.velocity.x = 0;
                player.velocity.z = 0;
                player._showWorldBoundaryHint?.();
            }
        }

        this._currentAgl = player.position.y - groundY;
    }

    _updateLandingTarget(player) {
        if (this.worldMode !== 'universe') {
            this._landingPlanet = null;
            return;
        }
        const nearest = this._universe.findNearestPlanet(player.position, this.currentPlanetId);
        const home = this._universe.getHomePlanet();
        const homeDist = home ? home.distanceToPoint(player.position) : Infinity;
        if (homeDist < this.REENTRY_MAX_DIST) {
            this._landingPlanet = { id: this.currentPlanetId, body: home, dist: homeDist, def: home.def };
        } else {
            this._landingPlanet = nearest && nearest.dist < 22000 ? nearest : null;
        }
    }

    _updateSurfaceHud() {
        this._updateHud('SUPERFICIE', 'WASD · Numpad8/↑ = vuelo al instante (ratón manda)');
    }

    _applySpaceNavAutopilot(delta, player, manualOverride) {
        if (!this._spaceAutopilot || !this._spaceNavPlanetId || manualOverride) return false;

        const canFly = this.worldMode === 'universe'
            || (this.worldMode === 'ascending' && this._shellRemapped);
        if (!canFly) return false;

        const body = this._universe.getPlanet(this._spaceNavPlanetId);
        if (!body) return false;

        const center = this.getSpaceNavCenter(this._vNavCenter);
        const to = this._vNavDir.subVectors(center, player.position);
        const dist = to.length();
        const stopDist = body.getRadius() + 1200;
        if (dist <= stopDist) {
            this._spaceAutopilot = false;
            const log = document.getElementById('log-text');
            if (log) log.innerHTML = `<span style="color:#88ffaa;">Llegada a ${body.def?.name ?? 'planeta'}</span>`;
            return false;
        }

        const desired = to.normalize();
        this._vNavSteer.copy(this._flight.thrustForward).lerp(desired, Math.min(1, delta * 2.8));
        this._flight.setForwardDirection(this._vNavSteer);
        return true;
    }

    _updateUniverseHud() {
        const home = this._universe.getHomePlanet();
        const homeDist = home ? home.distanceToPoint(this.player.position) : Infinity;
        const distKm = homeDist / 1000;

        this._updateHud('ÓRBITA', 'Espacio — Tab / clic minimapa = destino · autopiloto con Tab');
        if (!this._hintEl) return;

        const nav = this.getSpaceNavInfo();
        if (nav) {
            const km = nav.dist >= 1000 ? `${(nav.dist / 1000).toFixed(1)} km` : `${Math.round(nav.dist)} m`;
            if (nav.autopilot) {
                this._hintEl.textContent = `→ ${nav.name} · ${km} · autopiloto · WASD cancela`;
            } else {
                this._hintEl.textContent = `→ ${nav.name} · ${km} · Tab = autopiloto · WASD cancela`;
            }
            return;
        }

        if (this._landingPlanet && this._landingPlanet.dist < this.REENTRY_MAX_DIST) {
            const km = (this._landingPlanet.dist / 1000).toFixed(1);
            this._hintEl.textContent = `${this._landingPlanet.def.name} · ${km} km de la superficie — vuela hacia él para reentrar al mapa · Numpad5 cerca`;
        } else if (home && distKm < 500) {
            this._hintEl.textContent = `${home.def?.name ?? 'Planeta'} · ${distKm.toFixed(0)} km del centro · Tab o clic minimapa cyan = gemelo`;
        } else if (home) {
            const twin = this._universe.getTwinPlanet();
            const twinDist = twin ? twin.distanceToPoint(this.player.position) / 1000 : 0;
            if (twin && twinDist < 900) {
                this._hintEl.textContent = `${home.def?.name ?? 'Home'} · ${distKm.toFixed(0)} km · Gemelo ${twin.def?.name ?? 'lejano'} · ${twinDist.toFixed(0)} km — Tab para ir`;
            } else {
                this._hintEl.textContent = `${home.def?.name ?? 'Planeta'} · ${distKm.toFixed(0)} km — minimapa 3D · verde = home · cyan = gemelo · clic destino`;
            }
        } else {
            this._hintEl.textContent = 'Vuela hacia el planeta — al tocar la atmósfera vuelves al mapa';
        }
    }

    _planetShellDist(player, planetBody) {
        const center = planetBody.getWorldPosition(this._vCenter);
        const dist = player.position.distanceTo(center);
        return { center, dist, R: planetBody.getRadius() };
    }

    /** Planeta cuya atmósfera estamos cruzando (el más cercano). */
    _resolveReentryPlanet(player) {
        const nearest = this._universe.findNearestPlanet(player.position, null);
        if (!nearest?.body) return this._universe.getHomePlanet();

        if (this._isOffWorldSpaceNav()) {
            const navBody = this._universe.getPlanet(this._spaceNavPlanetId);
            if (navBody && nearest.id === this._spaceNavPlanetId) return navBody;
            const home = this._universe.getHomePlanet();
            if (navBody && nearest.body !== home) return navBody;
        }

        return nearest.body;
    }

    _enforceUniversePlanetShell(player, environment, pointerLock) {
        if (this.worldMode === 'ascending' && !this._shellRemapped) return;
        if (this.worldMode === 'descending' && this._shellRemapped) return;

        const body = this._resolveReentryPlanet(player);
        if (!body) return;

        const { center, dist, R } = this._planetShellDist(player, body);
        const minDist = R + this.PLANET_SURFACE_MARGIN;
        const crossDist = R + this.PLANET_ATMO_CROSS;

        this._vInward.copy(center).sub(player.position);
        if (this._vInward.lengthSq() < 1) this._vInward.set(0, 1, 0);
        this._vInward.normalize();

        if (dist < crossDist) {
            if (this.worldMode === 'universe') {
                const inwardVel = player.velocity.dot(this._vInward);
                if (inwardVel > 60 || dist < R + 1200) {
                    this._crossToFlatMap(player, body, environment, pointerLock, false);
                }
            }
            return;
        }

        if (dist < minDist) {
            this._vRel.copy(player.position).sub(center);
            if (this._vRel.lengthSq() < 1) this._vRel.set(0, 1, 0);
            this._vRel.setLength(minDist);
            player.position.copy(center).add(this._vRel);
            player.mesh.position.copy(player.position);
            const inwardVel = player.velocity.dot(this._vInward);
            if (inwardVel > 0) {
                player.velocity.addScaledVector(this._vInward, -inwardVel);
            }
        }
    }

    /**
     * Cruce natural esfera → mapa plano. El jugador sigue volando; solo cambia el "escenario".
     * @param {boolean} force — Numpad5 ignora distancia si estás cerca
     */
    _crossToFlatMap(player, planetBody, environment, pointerLock, force = false) {
        if (this.worldMode !== 'universe' || this._crossCooldown > 0 || this.isTransition()) return;

        const { center, dist, R } = this._planetShellDist(player, planetBody);
        const crossDist = R + this.PLANET_ATMO_CROSS;
        const maxForceDist = R + this.PLANET_ATMO_SHELL;

        if (!force && dist > crossDist) return;
        if (force && dist > maxForceDist) {
            this._flashHint('Más cerca del planeta para entrar al mapa');
            return;
        }

        const mapped = universePosToFlatMap(player.position, center, environment);
        const def = planetBody.def;
        const agl = THREE.MathUtils.clamp(dist - R, 500, 5500);
        const entryY = mapped.groundY + agl;

        const outward = this._vRel.copy(player.position).sub(center).normalize();
        const vel = player.velocity.clone();
        const outwardSpd = vel.dot(outward);
        vel.addScaledVector(outward, -outwardSpd);
        if (vel.length() > 2400) vel.setLength(2400);
        if (vel.lengthSq() < 400) {
            vel.copy(this._flight.thrustForward).multiplyScalar(1200);
            vel.addScaledVector(outward, -vel.dot(outward));
        }

        const fwd = this._flight.thrustForward.clone();
        fwd.addScaledVector(outward, -fwd.dot(outward));
        const thrustFwd = fwd.lengthSq() > 0.02
            ? fwd
            : (vel.lengthSq() > 1 ? vel.clone().normalize() : new THREE.Vector3(0, -0.15, -1));

        this._beginShellDescend({
            player,
            planetBody,
            environment,
            pointerLock,
            def,
            mapped,
            entryY,
            vel,
            thrustFwd,
        });
        this._crossCooldown = 2.5;
    }

    _updateHud(title, hint) {
        if (this._hudEl) {
            const show = this.worldMode !== 'surface' || this._currentAgl > 80;
            this._hudEl.style.display = show ? 'flex' : 'none';
        }
        if (this._modeEl) this._modeEl.textContent = title;
        if (this._hintEl && hint) this._hintEl.textContent = hint;
    }

    update(delta) {
        if (this.worldMode === 'universe' && this.player?.keys?.f) {
            this.player.keys.f = false;
            const body = this._landingPlanet?.body ?? this._universe.getHomePlanet();
            if (body) {
                this._crossToFlatMap(this.player, body, this.environment, window.__game?._pointerLock, true);
            }
        }
    }
}
