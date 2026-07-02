/** Ratón para vuelo — pointer lock o delta libre sobre el canvas. */

export class PointerLock {
    constructor(canvas) {
        this.canvas = canvas;
        this.locked = false;
        this.flightAimActive = false;
        this.dx = 0;
        this.dy = 0;
        this._lastClientX = null;
        this._lastClientY = null;

        this._onMove = (e) => {
            if (!this.locked && !this.flightAimActive) return;

            const mx = e.movementX ?? 0;
            const my = e.movementY ?? 0;

            if (this.locked && (mx !== 0 || my !== 0)) {
                this.dx += mx;
                this.dy += my;
                return;
            }

            if (!this.flightAimActive) return;

            const x = e.clientX;
            const y = e.clientY;
            if (this._lastClientX != null) {
                this.dx += x - this._lastClientX;
                this.dy += y - this._lastClientY;
            }
            this._lastClientX = x;
            this._lastClientY = y;
        };

        this._onChange = () => {
            this.locked = document.pointerLockElement === this.canvas;
            if (!this.locked && !this.flightAimActive) {
                this.dx = 0;
                this.dy = 0;
                this._lastClientX = null;
                this._lastClientY = null;
            }
            window.__game?._syncGalaxyOrbitControls?.();
        };

        document.addEventListener('mousemove', this._onMove);
        document.addEventListener('pointerlockchange', this._onChange);
    }

    wantsLock(galaxy) {
        return !!(galaxy?.wantsPointerLock?.());
    }

    enableFlightAim() {
        this.flightAimActive = true;
        this._lastClientX = null;
        this._lastClientY = null;
        window.__game?._syncGalaxyOrbitControls?.();
    }

    disableFlightAim() {
        this.flightAimActive = false;
        this.dx = 0;
        this.dy = 0;
        this._lastClientX = null;
        this._lastClientY = null;
        window.__game?._syncGalaxyOrbitControls?.();
    }

    tryLock(galaxy) {
        if (!this.wantsLock(galaxy) || this.locked) return;
        this.canvas.requestPointerLock?.();
    }

    consumeDelta() {
        const out = { dx: this.dx, dy: this.dy };
        this.dx = 0;
        this.dy = 0;
        return out;
    }

    unlock() {
        if (document.pointerLockElement) document.exitPointerLock?.();
    }

    dispose() {
        document.removeEventListener('mousemove', this._onMove);
        document.removeEventListener('pointerlockchange', this._onChange);
    }
}
