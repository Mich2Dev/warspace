/**
 * Ajusta la resolución interna solo cuando la carga se mantiene alta/baja.
 * No cambia geometría ni distancia de dibujado, por lo que evita popping.
 */
export class PerformanceGovernor {
  constructor(renderer, composer = null) {
    this.renderer = renderer;
    this.composer = composer;
    this.deviceRatio = window.devicePixelRatio || 1;
    this.maxRatio = Math.min(this.deviceRatio, 1.25);
    this.minRatio = Math.min(this.maxRatio, 0.7);
    this.ratio = this.maxRatio;
    this.samples = 0;
    this.totalMs = 0;
    this.cooldown = 0;
    this.apply();
  }

  update(delta) {
    if (document.hidden || !Number.isFinite(delta) || delta <= 0) return;
    this.cooldown = Math.max(0, this.cooldown - delta);
    this.samples++;
    this.totalMs += Math.min(delta * 1000, 100);

    // Evaluar cada ~2 s a 60 FPS; evita reaccionar a un único chunk.
    if (this.samples < 120 || this.cooldown > 0) return;
    const avgMs = this.totalMs / this.samples;
    this.samples = 0;
    this.totalMs = 0;

    if (avgMs > 22.5 && this.ratio > this.minRatio) {
      this.ratio = Math.max(this.minRatio, this.ratio - 0.12);
      this.apply();
      this.cooldown = 3;
    } else if (avgMs < 17.2 && this.ratio < this.maxRatio) {
      this.ratio = Math.min(this.maxRatio, this.ratio + 0.06);
      this.apply();
      this.cooldown = 6;
    }
  }

  apply() {
    this.renderer.setPixelRatio(this.ratio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.ratio);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  resize() {
    this.deviceRatio = window.devicePixelRatio || 1;
    this.maxRatio = Math.min(this.deviceRatio, 1.25);
    this.minRatio = Math.min(this.maxRatio, 0.7);
    this.ratio = Math.min(this.ratio, this.maxRatio);
    this.apply();
  }
}
