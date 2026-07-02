import { OrbitalMinimap3D } from './OrbitalMinimap3D.js';

/** Radar táctico — mapa 2D en superficie, cubo 3D en universo. */
export class SpaceMinimap {
    constructor() {
        this._el = null;
        this._label = null;
        this._cubeHost = null;
        this._orbLegend = null;
        this._cube3d = null;
        this._orbital = false;
        this._galaxy = null;
    }

    bindGalaxy(galaxy) {
        this._galaxy = galaxy;
        this._ensure();
        this._cube3d?.setPickHandler((planetId) => this._onPlanetPick(planetId));
    }

    _onPlanetPick(planetId) {
        const galaxy = this._galaxy;
        if (!galaxy?.setSpaceNavPlanet?.(planetId, false)) return;
        const body = galaxy._universe?.getPlanet?.(planetId);
        const name = body?.def?.name ?? 'Planeta';
        const inOrbit = galaxy.worldMode === 'universe';
        galaxy._flashHint?.(inOrbit
            ? `${name} marcado · Tab = autopiloto`
            : `${name} marcado · Numpad8 = espacio`);
    }

    _ensure() {
        if (this._el) return;
        this._el = document.getElementById('minimap');
        this._label = this._el?.querySelector('.minimap-label') ?? null;
        this._cubeHost = document.getElementById('minimap-cube3d');
        this._orbLegend = document.getElementById('minimap-orbital-legend');
        this._orbDistEl = document.getElementById('minimap-orbital-dist');
        if (this._cubeHost && !this._cube3d) {
            this._cube3d = new OrbitalMinimap3D(this._cubeHost);
            this._cube3d.setPickHandler((planetId) => this._onPlanetPick(planetId));
        }
    }

    /**
     * @param {import('./GalaxyDirector.js').GalaxyDirector | null} galaxy
     * @param {import('../Player.js').Player} player
     */
    update(galaxy, player) {
        this._ensure();
        if (!this._el) return;

        const orbital = !!galaxy?.usesOrbitalMinimap?.();

        if (orbital !== this._orbital) {
            this._setOrbitalMode(orbital);
        }

        if (orbital) {
            const data = galaxy?.getMinimapData?.();
            this._cube3d?.update(data, player.position);
            if (this._orbDistEl && data) {
                if (data.navPlanetId && data.navName != null) {
                    const km = (data.navDist ?? 0) / 1000;
                    const ap = data.spaceAutopilot ? ' · AP' : '';
                    this._orbDistEl.textContent = km < 1
                        ? `→ ${data.navName} · ${Math.round(data.navDist)} m${ap}`
                        : `→ ${data.navName} · ${km.toFixed(km < 100 ? 1 : 0)} km${ap}`;
                } else {
                    const km = (data.homeDist ?? 0) / 1000;
                    const name = data.homeName ?? 'Planeta';
                    this._orbDistEl.textContent = km < 1
                        ? `${name} · ${Math.round(data.homeDist)} m`
                        : `${name} · ${km.toFixed(km < 100 ? 1 : 0)} km`;
                }
            }
        }
    }

    _setOrbitalMode(orbital) {
        this._orbital = orbital;
        const hide2d = ['minimap-player', 'minimap-enemies', 'minimap-allies', 'minimap-waypoint'];
        const cardinals = this._el?.querySelectorAll('.minimap-cardinal, .minimap-tick');

        if (orbital) {
            this._el.classList.add('minimap-orbital');
            if (this._label) this._label.textContent = '3D';
            hide2d.forEach((id) => {
                const n = document.getElementById(id);
                if (n) n.style.display = 'none';
            });
            cardinals?.forEach((n) => { n.style.display = 'none'; });
            if (this._orbLegend) this._orbLegend.style.display = 'flex';
            this._cube3d?.setVisible(true);
        } else {
            this._el.classList.remove('minimap-orbital');
            if (this._label) this._label.textContent = 'TAC';
            hide2d.forEach((id) => {
                const n = document.getElementById(id);
                if (n) n.style.display = '';
            });
            cardinals?.forEach((n) => { n.style.display = ''; });
            if (this._orbLegend) this._orbLegend.style.display = 'none';
            this._cube3d?.setVisible(false);
        }
    }

    reset() {
        this._orbital = false;
        this._ensure();
        if (this._el) this._el.classList.remove('minimap-orbital');
        if (this._label) this._label.textContent = 'TAC';
        if (this._orbLegend) this._orbLegend.style.display = 'none';
        this._cube3d?.setVisible(false);
    }
}
