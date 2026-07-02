import * as THREE from 'three';
import { getControlState } from '../controlSettings.js';
import { resolveNavDestination } from '../worldNav.js';

export const playerCameraNavMethods = {
_isManualMovementInput() {
        const mi = this.mobileInput;
        if (Math.abs(mi.x) > 0.08 || Math.abs(mi.z) > 0.08) return true;
        return !!(this.keys.w || this.keys.a || this.keys.s || this.keys.d);
    },

_shouldChaseCameraMove(cfg) {
        if (this._isManualMovementInput()) return true;
        return !!(cfg.chaseCameraOnAutopilot && this.autoPilot && this.velocity.lengthSq() > 0.5);
    },

requestCameraRecenter() {
        const behind = this._getShipForward().multiplyScalar(-1);
        const currentOffset = new THREE.Vector3().subVectors(this.camera.position, this.position);
        const dist = Math.max(80, Math.hypot(currentOffset.x, currentOffset.z) || 400);
        const height = Math.max(30, currentOffset.y || 150);

        this._cameraRecenterFrom = this.camera.position.clone();
        this._cameraRecenterGoal = this.position.clone()
            .add(behind.multiplyScalar(dist))
            .add(new THREE.Vector3(0, height, 0));
        this._cameraRecenterT = 0;
        this._cameraManualIdle = 0;
    },

markCameraManualOverride() {
        const cfg = getControlState();
        this._cameraManualIdle = cfg.chaseCameraResumeDelay ?? 2.0;
        this._cameraRecenterT = 1;
        this._cameraRecenterFrom = null;
        this._cameraRecenterGoal = null;
    },

_updateCameraManualIdle(delta) {
        if (this.keys['rightClick'] || this._mobileCameraDrag) {
            this.markCameraManualOverride();
            return;
        }
        if (this._cameraManualIdle > 0) {
            this._cameraManualIdle = Math.max(0, this._cameraManualIdle - delta);
        }
    },

_updateChaseCamera(delta) {
        const cfg = getControlState();
        if (!cfg.chaseCameraAuto) return;
        if (this._cameraRecenterT < 1) return;
        if (this._cameraManualIdle > 0) return;
        if (!this._shouldChaseCameraMove(cfg)) return;

        const currentOffset = new THREE.Vector3().subVectors(this.camera.position, this.position);
        const height = Math.max(30, currentOffset.y || 150);
        const dist = Math.max(80, Math.hypot(currentOffset.x, currentOffset.z) || 400);
        const behind = this._getShipForward().clone().multiplyScalar(-1);
        const ideal = this.position.clone()
            .add(behind.multiplyScalar(dist))
            .add(new THREE.Vector3(0, height, 0));

        const smooth = 2.8 * (cfg.chaseCameraSmoothness ?? 1);
        this.camera.position.lerp(ideal, Math.min(1, delta * smooth));

        const flat = new THREE.Vector3().subVectors(this.camera.position, this.position);
        flat.y = 0;
        if (flat.lengthSq() > 0.001) flat.normalize();
        else flat.copy(behind);

        this.camera.position.set(
            this.position.x + flat.x * dist,
            this.position.y + height,
            this.position.z + flat.z * dist
        );
    },

_updateCameraRecenter(delta) {
        if (this._cameraRecenterT >= 1 || !this._cameraRecenterFrom || !this._cameraRecenterGoal) return;

        this._cameraRecenterT = Math.min(1, this._cameraRecenterT + delta / this._cameraRecenterDuration);
        const t = 1 - Math.pow(1 - this._cameraRecenterT, 3);
        this.camera.position.lerpVectors(this._cameraRecenterFrom, this._cameraRecenterGoal, t);
    },

activateAutoPilot(targetOrManager) {
        if (targetOrManager instanceof THREE.Vector3) {
            this.setNavDestination(targetOrManager);
            return;
        }

        // Buscar objetivo más cercano (Tab) — en MP prioriza jugadores remotos
        const enemyManager = targetOrManager;
        const mp = window.__game?.multiplayerClient;
        const rp = window.__game?.remotePlayers;

        let closest = null;
        let minDist = Infinity;

        if (mp?.isOnline && rp) {
            closest = rp.findClosestTargetable(this.position);
            if (closest) {
                minDist = this.position.distanceTo(rp._resolveRemoteEntry(closest.userData.playerId)?.display || closest.position);
            }
        }

        if (!closest && enemyManager?.enemies?.length) {
            for (const enemy of enemyManager.enemies) {
                if ((enemy.userData?.hp ?? 0) <= 0) continue;
                if (enemy.userData?.syncGhost && mp?.isOnline) continue;
                const dist = this.position.distanceTo(enemy.position);
                if (dist < minDist) {
                    minDist = dist;
                    closest = enemy;
                }
            }
        }

        if (closest) {
            this.setTarget(closest);
            this.navTarget = null;
            this.autoPilot = true;
            const log = document.getElementById('log-text');
            if (log && closest.userData?.isRemotePlayer) {
                log.innerHTML = `<span style="color:#ff8899;font-weight:bold;">OBJETIVO: ${closest.userData.name || 'Piloto'}</span>`;
            }
        }
    },

setNavDestination(worldPos) {
        if (!worldPos) return;
        const env = window.__game?.environment;
        const resolved = resolveNavDestination(env, worldPos.x, worldPos.z);
        this.navTarget = new THREE.Vector3(resolved.x, resolved.y, resolved.z);
        this.autoPilot = true;
        this._updateNavHud();
        if (this.navMarker) this.navMarker.setDestination(this.navTarget);
        if (resolved.wasSnapped) {
            const log = document.getElementById('log-text');
            if (log) {
                log.innerHTML = '<span style="color:#88aacc;">Destino ajustado al corredor más cercano</span>';
            }
        }
    },

clearNavDestination() {
        this.navTarget = null;
        if (this.autoPilot && !this.target) this.autoPilot = false;
        this._updateNavHud();
        if (this.navMarker) this.navMarker.clearDestination();
    },

_updateNavHud() {
        const el = document.getElementById('nav-target');
        if (!el) return;
        const targetName = this.target?.userData?.name;
        if (this.navTarget && targetName) {
            const dx = this.navTarget.x - this.position.x;
            const dz = this.navTarget.z - this.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const distText = dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
            el.textContent = `Rumbo ${distText} · Combate: ${targetName}`;
        } else if (this.navTarget) {
            const dx = this.navTarget.x - this.position.x;
            const dz = this.navTarget.z - this.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const distText = dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
            el.textContent = `Destino a ${distText} · WASD cancela`;
        } else if (targetName) {
            el.textContent = `Combate: ${targetName} · Esc limpia`;
        } else {
            el.textContent = 'Clic mapa mover · Clic enemigo apuntar · C recentrar cámara';
        }
    },
};
