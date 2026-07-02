import * as THREE from 'three';

/**
 * Vuelo 3D — el ratón define el morro; W impulsa hacia thrustForward.
 */
export class FlightControls {
    constructor(camera) {
        this.camera = camera;
        this.forward = new THREE.Vector3(0, 0, -1);
        this.thrustForward = new THREE.Vector3(0, 0, -1);
        this.right = new THREE.Vector3(1, 0, 0);
        this.up = new THREE.Vector3(0, 1, 0);
        this._worldUp = new THREE.Vector3(0, 1, 0);
        this._yaw = 0;
        this._pitch = 0;
        this._initialized = false;
        this._helper = new THREE.Object3D();
        this._lookMatrix = new THREE.Matrix4();
        this._viewDir = new THREE.Vector3();
        this._camRight = new THREE.Vector3();
        this._camUp = new THREE.Vector3();
        this._desiredCamPos = new THREE.Vector3();
        this._lookTarget = new THREE.Vector3();
        this._desiredCamQuat = new THREE.Quaternion();
    }

    resetFromCamera() {
        this.camera.getWorldDirection(this._viewDir);
        this.setForwardDirection(this._viewDir);
    }

    /** Hacia dónde mira la cámara (centro de pantalla). */
    resetFromView(camera) {
        camera.getWorldDirection(this._viewDir);
        this.setForwardDirection(this._viewDir);
    }

    resetFromShip(mesh) {
        if (!mesh) return;
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(mesh.quaternion);
        if (fwd.lengthSq() < 1e-6) return;
        this.setForwardDirection(fwd);
    }

    clampPitch(min, max) {
        this._pitch = THREE.MathUtils.clamp(this._pitch, min, max);
        this._applyAimVectors();
    }

    setForwardDirection(dir) {
        const d = dir.clone();
        if (d.lengthSq() < 1e-6) return;
        d.normalize();
        this._pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
        this._yaw = Math.atan2(d.x, -d.z);
        this._initialized = true;
        this._applyAimVectors();
    }

    updateAim(delta, opts = {}) {
        if (!this._initialized) {
            if (opts.camera) this.resetFromView(opts.camera);
            else if (opts.mesh) this.resetFromShip(opts.mesh);
        }

        const aimActive = !!(opts.aimActive ?? opts.pointerLocked);
        const sens = opts.sensitivity ?? 0.0032;
        const mdx = opts.dx ?? 0;
        const mdy = opts.dy ?? 0;

        if (aimActive && (mdx !== 0 || mdy !== 0)) {
            this._yaw += mdx * sens;
            this._pitch -= mdy * sens;
            this._pitch = THREE.MathUtils.clamp(this._pitch, -1.05, 1.05);
        }

        const kbPitch = opts.keyboardPitch ?? 0;
        if (opts.pitchKeys || kbPitch > 0.08) {
            const target = THREE.MathUtils.clamp(0.22 + kbPitch * 0.55, -0.35, 1.05);
            this._pitch += (target - this._pitch) * Math.min(1, delta * 3.5);
        }

        this._applyAimVectors();
    }

    _applyAimVectors() {
        const cp = Math.cos(this._pitch);
        this.thrustForward.set(
            Math.sin(this._yaw) * cp,
            Math.sin(this._pitch),
            -Math.cos(this._yaw) * cp,
        ).normalize();
        this.forward.copy(this.thrustForward);

        this.right.crossVectors(this.thrustForward, this._worldUp);
        if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
        else this.right.normalize();
        this.up.crossVectors(this.right, this.thrustForward).normalize();
    }

    orientShip(mesh, playerPos, delta) {
        if (!mesh) return;
        const target = playerPos.clone().add(this.thrustForward);
        this._lookMatrix.lookAt(playerPos, target, this._worldUp);
        this._helper.quaternion.setFromRotationMatrix(this._lookMatrix);

        const t = delta >= 1 ? 1 : Math.min(1, delta * 16);
        mesh.quaternion.slerp(this._helper.quaternion, t);
    }

    updateCamera(camera, controls, playerPos, delta, opts = {}) {
        const dist = opts.dist ?? 260;
        const lift = opts.lift ?? 55;
        const posSmooth = Math.min(1, delta * (opts.camPosSmooth ?? 7));
        const rotSmooth = Math.min(1, delta * (opts.camRotSmooth ?? 6.5));

        const fwd = this.thrustForward;
        this._camRight.crossVectors(fwd, this._worldUp);
        if (this._camRight.lengthSq() < 1e-6) this._camRight.set(1, 0, 0);
        else this._camRight.normalize();
        this._camUp.crossVectors(this._camRight, fwd).normalize();

        this._desiredCamPos.copy(playerPos)
            .addScaledVector(fwd, -dist)
            .addScaledVector(this._camUp, lift);
        this._lookTarget.copy(playerPos).addScaledVector(fwd, 500);

        camera.position.lerp(this._desiredCamPos, posSmooth);

        this._lookMatrix.lookAt(camera.position, this._lookTarget, this._camUp);
        this._desiredCamQuat.setFromRotationMatrix(this._lookMatrix);
        camera.quaternion.slerp(this._desiredCamQuat, rotSmooth);

        if (controls) {
            controls.target.copy(this._lookTarget);
        }
    }

    buildMoveInput(player, speed, delta) {
        const move = new THREE.Vector3();
        const fwd = this.thrustForward;
        const right = new THREE.Vector3().crossVectors(fwd, this._worldUp);
        if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
        else right.normalize();

        if (player.keys?.w) move.add(fwd);
        if (player.keys?.s) move.sub(fwd);
        if (player.keys?.a) move.sub(right);
        if (player.keys?.d) move.add(right);

        if (move.lengthSq() < 0.01) return null;
        return move.normalize().multiplyScalar(speed * delta);
    }
}
