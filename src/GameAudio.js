/**
 * Softer procedural audio: ambient music pad + gentle space/atmo + smooth engine.
 * No external files. Unlocks after a user gesture.
 */
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.ambBus = null;
    this.musicBus = null;
    this.enabled = true;
    this._unlocked = false;
    this._ambStarted = false;

    this._spaceGain = null;
    this._atmoGain = null;
    this._engineGain = null;
    this._musicGain = null;
    this._engineOsc = null;
    this._engineOsc2 = null;
    this._engFilter = null;

    // Smoothed targets (avoid sudden blender jumps)
    this._engineLevelSmooth = 0.02;
    this._engineHzSmooth = 55;
    this._spaceLevelSmooth = 0.08;
    this._atmoLevelSmooth = 0.001;
    this._musicLevelSmooth = 0.08;

    // Real CC0 weapon recordings (Kenney) used as the body of the shot.
    // Synthesis remains only as a fallback while these load.
    this._laserBuffers = [];
    this._laserLoadStarted = false;
  }

  _ensure() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();

      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.85;
      this.sfxBus.connect(this.master);

      this.ambBus = this.ctx.createGain();
      this.ambBus.gain.value = 0.4;
      this.ambBus.connect(this.master);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.55;
      this.musicBus.connect(this.master);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    this._unlocked = true;
    return this.ctx;
  }

  unlock() {
    const ctx = this._ensure();
    if (!ctx) return;
    this._startAmbientLayers();
    this._loadWeaponSamples();
  }

  async _loadWeaponSamples() {
    if (this._laserLoadStarted || !this.ctx) return;
    this._laserLoadStarted = true;

    const urls = Array.from(
      { length: 5 },
      (_, i) => `/audio/laserLarge_${String(i).padStart(3, '0')}.ogg`
    );

    const decoded = await Promise.all(urls.map(async (url) => {
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const bytes = await response.arrayBuffer();
        return await this.ctx.decodeAudioData(bytes);
      } catch (_) {
        return null;
      }
    }));

    this._laserBuffers = decoded.filter(Boolean);
  }

  _makeNoiseBuffer(seconds = 1.2) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    // Brown-ish noise (softer than white — less "radio static")
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    return buffer;
  }

  _startAmbientLayers() {
    if (this._ambStarted || !this.ctx) return;
    this._ambStarted = true;
    const ctx = this.ctx;

    // --- Soft space bed (very quiet brown noise) ---
    this._spaceGain = ctx.createGain();
    this._spaceGain.gain.value = 0.0001;
    this._spaceGain.connect(this.ambBus);

    const spaceNoise = ctx.createBufferSource();
    spaceNoise.buffer = this._makeNoiseBuffer(1.5);
    spaceNoise.loop = true;
    const spaceLp = ctx.createBiquadFilter();
    spaceLp.type = 'lowpass';
    spaceLp.frequency.value = 180;
    spaceLp.Q.value = 0.3;
    spaceNoise.connect(spaceLp);
    spaceLp.connect(this._spaceGain);
    spaceNoise.start();

    // Deep soft sine bed (not sawtooth — no blender)
    const spaceDrone = ctx.createOscillator();
    spaceDrone.type = 'sine';
    spaceDrone.frequency.value = 48;
    const spaceDroneGain = ctx.createGain();
    spaceDroneGain.gain.value = 0.07;
    spaceDrone.connect(spaceDroneGain);
    spaceDroneGain.connect(this._spaceGain);
    spaceDrone.start();

    // --- Atmosphere: soft band of air ---
    this._atmoGain = ctx.createGain();
    this._atmoGain.gain.value = 0.0001;
    this._atmoGain.connect(this.ambBus);

    const atmoNoise = ctx.createBufferSource();
    atmoNoise.buffer = this._makeNoiseBuffer(1.2);
    atmoNoise.loop = true;
    const atmoBp = ctx.createBiquadFilter();
    atmoBp.type = 'bandpass';
    atmoBp.frequency.value = 650;
    atmoBp.Q.value = 0.35;
    const atmoLp = ctx.createBiquadFilter();
    atmoLp.type = 'lowpass';
    atmoLp.frequency.value = 1600;
    atmoNoise.connect(atmoBp);
    atmoBp.connect(atmoLp);
    atmoLp.connect(this._atmoGain);
    atmoNoise.start();

    // --- Engine: muted sine/triangle hum (smooth, not blender) ---
    this._engineGain = ctx.createGain();
    this._engineGain.gain.value = 0.0001;
    this._engineGain.connect(this.ambBus);

    this._engineOsc = ctx.createOscillator();
    this._engineOsc.type = 'sine';
    this._engineOsc.frequency.value = 55;
    this._engFilter = ctx.createBiquadFilter();
    this._engFilter.type = 'lowpass';
    this._engFilter.frequency.value = 220;
    this._engFilter.Q.value = 0.5;
    const engTone = ctx.createGain();
    engTone.gain.value = 0.22;
    this._engineOsc.connect(this._engFilter);
    this._engFilter.connect(engTone);
    engTone.connect(this._engineGain);
    this._engineOsc.start();

    this._engineOsc2 = ctx.createOscillator();
    this._engineOsc2.type = 'triangle';
    this._engineOsc2.frequency.value = 110;
    const eng2 = ctx.createGain();
    eng2.gain.value = 0.05;
    this._engineOsc2.connect(eng2);
    eng2.connect(this._engineGain);
    this._engineOsc2.start();

    // --- Ambient music: slow evolving pad (Am – F – C – G vibe in space) ---
    this._musicGain = ctx.createGain();
    this._musicGain.gain.value = 0.0001;
    this._musicGain.connect(this.musicBus);

    // Chord tones (A2, C3, E3, G3) — soft sines + slow LFO on volume
    const chordHz = [55.0, 65.41, 82.41, 98.0];
    this._musicOscs = [];
    chordHz.forEach((hz, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.value = 0.045 - i * 0.006;
      // Slight detune for warmth
      const detune = ctx.createOscillator();
      detune.type = 'sine';
      detune.frequency.value = hz * 1.002;
      const dg = ctx.createGain();
      dg.gain.value = 0.02;
      o.connect(g);
      g.connect(this._musicGain);
      detune.connect(dg);
      dg.connect(this._musicGain);
      o.start();
      detune.start();
      this._musicOscs.push({ o, g, detune, dg, baseHz: hz });
    });

    // Soft stereo-ish width via quiet high pad (no LFO fighting volume targets)
    const highPad = ctx.createOscillator();
    highPad.type = 'sine';
    highPad.frequency.value = 164.81; // E3
    const highPadGain = ctx.createGain();
    highPadGain.gain.value = 0.018;
    highPad.connect(highPadGain);
    highPadGain.connect(this._musicGain);
    highPad.start();

    // Second layer: higher soft notes that fade in/out
    this._melodyOsc = ctx.createOscillator();
    this._melodyOsc.type = 'sine';
    this._melodyOsc.frequency.value = 220;
    this._melodyGain = ctx.createGain();
    this._melodyGain.gain.value = 0.0001;
    this._melodyOsc.connect(this._melodyGain);
    this._melodyGain.connect(this._musicGain);
    this._melodyOsc.start();
    this._melodyNotes = [220.0, 246.94, 261.63, 196.0, 174.61, 220.0]; // A3 B3 C4 G3 F3 A3
    this._melodyIndex = 0;
    this._nextMelodyAt = ctx.currentTime + 4;

    this._scheduleMelody();
  }

  _scheduleMelody() {
    if (!this.ctx || !this._melodyOsc) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const note = this._melodyNotes[this._melodyIndex % this._melodyNotes.length];
    this._melodyIndex++;

    this._melodyOsc.frequency.setTargetAtTime(note, now, 0.8);
    this._melodyGain.gain.cancelScheduledValues(now);
    this._melodyGain.gain.setValueAtTime(0.0001, now);
    this._melodyGain.gain.linearRampToValueAtTime(0.035, now + 1.5);
    this._melodyGain.gain.linearRampToValueAtTime(0.0001, now + 5.5);

    this._nextMelodyAt = now + 7 + Math.random() * 3;
  }

  /**
   * @param {{ mode: string, speed: number, nearPlanet: boolean, landed: boolean, flameScale?: number }} state
   */
  updateAmbient(state = {}) {
    if (!this._ambStarted || !this.ctx) return;
    if (this.ctx.state === 'suspended') return;

    const mode = state.mode || 'FLIGHT';
    const speed = Math.abs(state.speed || 0);
    const nearPlanet = !!state.nearPlanet;
    const landed = !!state.landed;
    const flame = Math.max(0, state.flameScale ?? 0.3);

    const now = this.ctx.currentTime;

    // --- Target levels (gentle) ---
    let spaceTarget = nearPlanet ? 0.04 : 0.09;
    let atmoTarget = 0.0001;
    if (nearPlanet) {
      atmoTarget = landed ? 0.05 : (mode === 'HOVER' ? 0.07 : 0.04);
    }

    // Engine: mostly flame/speed but capped and heavily smoothed — no blender
    const speedNorm = Math.min(1, speed / 40000);
    const flameNorm = Math.min(1, flame / 3);
    let engineTarget = 0.015 + speedNorm * 0.06 + flameNorm * 0.05;
    if (landed) engineTarget = 0.028;
    if (mode === 'HOVER' && !landed) engineTarget = Math.max(engineTarget, 0.03);
    engineTarget = Math.min(0.09, engineTarget);

    const engineHzTarget = landed
      ? 52
      : 50 + speedNorm * 35 + flameNorm * 25; // stays low & smooth

    let musicTarget = nearPlanet ? (landed ? 0.11 : 0.09) : 0.13;

    // Smooth in JS so WebAudio isn't slammed with hard jumps
    const lerp = (a, b, t) => a + (b - a) * t;
    this._engineLevelSmooth = lerp(this._engineLevelSmooth, engineTarget, 0.08);
    this._engineHzSmooth = lerp(this._engineHzSmooth, engineHzTarget, 0.06);
    this._spaceLevelSmooth = lerp(this._spaceLevelSmooth, spaceTarget, 0.05);
    this._atmoLevelSmooth = lerp(this._atmoLevelSmooth, atmoTarget, 0.05);
    this._musicLevelSmooth = lerp(this._musicLevelSmooth, musicTarget, 0.04);

    this._spaceGain.gain.setTargetAtTime(this._spaceLevelSmooth, now, 0.5);
    this._atmoGain.gain.setTargetAtTime(this._atmoLevelSmooth, now, 0.5);
    this._engineGain.gain.setTargetAtTime(this._engineLevelSmooth, now, 0.45);
    this._musicGain.gain.setTargetAtTime(this._musicLevelSmooth, now, 0.8);

    if (this._engineOsc) {
      this._engineOsc.frequency.setTargetAtTime(this._engineHzSmooth, now, 0.4);
      this._engineOsc2.frequency.setTargetAtTime(this._engineHzSmooth * 2, now, 0.4);
    }
    if (this._engFilter) {
      this._engFilter.frequency.setTargetAtTime(180 + speedNorm * 120, now, 0.5);
    }

    if (now >= this._nextMelodyAt) {
      this._scheduleMelody();
    }
  }

  _playRecordedLaser(enemy) {
    if (!this._laserBuffers.length || !this.ctx) return false;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const output = this.sfxBus || this.master;
    const buffer = this._laserBuffers[Math.floor(Math.random() * this._laserBuffers.length)];

    // The recording is the main body. Small pitch/level variation avoids repetition.
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = (enemy ? 0.88 : 0.98) * (0.97 + Math.random() * 0.06);

    const bodyFilter = ctx.createBiquadFilter();
    bodyFilter.type = 'lowpass';
    bodyFilter.frequency.value = enemy ? 2600 : 4200;
    bodyFilter.Q.value = 0.35;

    const bodyGain = ctx.createGain();
    bodyGain.gain.value = enemy ? 0.38 : 0.58;

    // Compression glues the recording and synthetic sub without harsh clipping.
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 8;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;

    source.connect(bodyFilter);
    bodyFilter.connect(bodyGain);
    bodyGain.connect(compressor);

    // Sub layer gives cockpit weight without changing the sample's character.
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(enemy ? 62 : 74, now);
    sub.frequency.exponentialRampToValueAtTime(34, now + 0.18);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.exponentialRampToValueAtTime(enemy ? 0.16 : 0.24, now + 0.006);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    sub.connect(subGain);
    subGain.connect(compressor);

    // Short exterior reflection: delayed, filtered copy—not a dry click.
    const delay = ctx.createDelay(0.2);
    delay.delayTime.value = 0.055;
    const tailFilter = ctx.createBiquadFilter();
    tailFilter.type = 'lowpass';
    tailFilter.frequency.value = 1500;
    const tailGain = ctx.createGain();
    tailGain.gain.value = enemy ? 0.06 : 0.11;
    bodyGain.connect(delay);
    delay.connect(tailFilter);
    tailFilter.connect(tailGain);
    tailGain.connect(compressor);

    compressor.connect(output);
    source.start(now);
    sub.start(now);
    sub.stop(now + 0.22);
    return true;
  }

  /**
   * Pulse cannon — layered like real game SFX:
   * charge → transient → body boom → energy trail → metal ring → space slap.
   * Layers overlap and crossfade; nothing sits "dry" alone.
   */
  playLaserShot({ enemy = false } = {}) {
    const ctx = this._ensure();
    if (!ctx) return;
    this._startAmbientLayers();
    this._loadWeaponSamples();

    // Professional route: recorded CC0 body + restrained procedural support.
    if (this._playRecordedLaser(enemy)) return;

    const t0 = ctx.currentTime;
    const p = enemy ? 0.72 : 1.0;

    // Shared shot bus → light saturation feel → slap delay → master
    const shotBus = ctx.createGain();
    shotBus.gain.value = 0.9 * p;

    const tone = ctx.createWaveShaper();
    // Soft clip curve so layers glue together instead of sounding separate clicks
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 1.6);
    }
    tone.curve = curve;
    tone.oversample = '2x';

    const slapDelay = ctx.createDelay(0.2);
    slapDelay.delayTime.value = 0.028;
    const slapFb = ctx.createGain();
    slapFb.gain.value = 0.22;
    const slapFilter = ctx.createBiquadFilter();
    slapFilter.type = 'lowpass';
    slapFilter.frequency.value = 2200;
    const slapMix = ctx.createGain();
    slapMix.gain.value = 0.28;

    const dry = ctx.createGain();
    dry.gain.value = 0.85;

    shotBus.connect(tone);
    tone.connect(dry);
    dry.connect(this.sfxBus || this.master);

    tone.connect(slapFilter);
    slapFilter.connect(slapDelay);
    slapDelay.connect(slapFb);
    slapFb.connect(slapDelay);
    slapDelay.connect(slapMix);
    slapMix.connect(this.sfxBus || this.master);

    const noiseBurst = (duration, fillFn) => {
      const n = Math.max(1, Math.floor(ctx.sampleRate * duration));
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      fillFn(buf.getChannelData(0), n);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      return src;
    };

    // ========== A) Pre-charge (~40ms) — builds into the shot ==========
    const charge = noiseBurst(0.06, (data, n) => {
      let b = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const env = Math.pow(t, 1.4); // swell in
        const w = Math.random() * 2 - 1;
        b = (b + 0.03 * w) / 1.03;
        data[i] = (b * 1.8 + w * 0.25) * env;
      }
    });
    const chargeBp = ctx.createBiquadFilter();
    chargeBp.type = 'bandpass';
    chargeBp.frequency.setValueAtTime(700, t0);
    chargeBp.frequency.exponentialRampToValueAtTime(1600, t0 + 0.05);
    chargeBp.Q.value = 2.5;
    const chargeG = ctx.createGain();
    chargeG.gain.setValueAtTime(0.0001, t0);
    chargeG.gain.linearRampToValueAtTime(0.18, t0 + 0.04);
    chargeG.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
    charge.connect(chargeBp);
    chargeBp.connect(chargeG);
    chargeG.connect(shotBus);
    charge.start(t0);
    charge.stop(t0 + 0.08);

    // Soft rising tone under the charge (glue)
    const chargeTone = ctx.createOscillator();
    chargeTone.type = 'sine';
    chargeTone.frequency.setValueAtTime(180, t0);
    chargeTone.frequency.exponentialRampToValueAtTime(420, t0 + 0.05);
    const chargeToneG = ctx.createGain();
    chargeToneG.gain.setValueAtTime(0.0001, t0);
    chargeToneG.gain.linearRampToValueAtTime(0.1, t0 + 0.045);
    chargeToneG.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
    chargeTone.connect(chargeToneG);
    chargeToneG.connect(shotBus);
    chargeTone.start(t0);
    chargeTone.stop(t0 + 0.09);

    const fire = t0 + 0.045; // main hit sits after charge — overlap, not gap

    // ========== B) Transient / muzzle ==========
    const transient = noiseBurst(0.035, (data, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const env = Math.exp(-t * 22);
        data[i] = (Math.random() * 2 - 1) * env;
      }
    });
    const trHp = ctx.createBiquadFilter();
    trHp.type = 'highpass';
    trHp.frequency.value = 2500;
    const trG = ctx.createGain();
    trG.gain.setValueAtTime(0.0001, fire);
    trG.gain.linearRampToValueAtTime(0.32, fire + 0.002);
    trG.gain.exponentialRampToValueAtTime(0.0001, fire + 0.04);
    transient.connect(trHp);
    trHp.connect(trG);
    trG.connect(shotBus);
    transient.start(fire);
    transient.stop(fire + 0.045);

    // ========== C) Body boom (long, warm — the "cannon") ==========
    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(enemy ? 72 : 85, fire);
    boom.frequency.exponentialRampToValueAtTime(32, fire + 0.35);
    const boomG = ctx.createGain();
    boomG.gain.setValueAtTime(0.0001, fire);
    boomG.gain.linearRampToValueAtTime(0.5, fire + 0.008);
    boomG.gain.setValueAtTime(0.42, fire + 0.06);
    boomG.gain.exponentialRampToValueAtTime(0.0001, fire + 0.4);
    boom.connect(boomG);
    boomG.connect(shotBus);
    boom.start(fire);
    boom.stop(fire + 0.42);

    // Boom harmonic (adds body without cartoon whistle)
    const boom2 = ctx.createOscillator();
    boom2.type = 'triangle';
    boom2.frequency.setValueAtTime(enemy ? 110 : 130, fire);
    boom2.frequency.exponentialRampToValueAtTime(48, fire + 0.28);
    const boom2Lp = ctx.createBiquadFilter();
    boom2Lp.type = 'lowpass';
    boom2Lp.frequency.value = 500;
    const boom2G = ctx.createGain();
    boom2G.gain.setValueAtTime(0.0001, fire);
    boom2G.gain.linearRampToValueAtTime(0.2, fire + 0.01);
    boom2G.gain.exponentialRampToValueAtTime(0.0001, fire + 0.3);
    boom2.connect(boom2Lp);
    boom2Lp.connect(boom2G);
    boom2G.connect(shotBus);
    boom2.start(fire);
    boom2.stop(fire + 0.32);

    // ========== D) Energy trail (noise that blooms then fades — overlaps boom) ==========
    const trail = noiseBurst(0.28, (data, n) => {
      let b = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        // Attack + long soft tail
        const env = Math.min(1, t * 12) * Math.exp(-t * 3.2);
        const w = Math.random() * 2 - 1;
        b = (b + 0.045 * w) / 1.045;
        data[i] = (b * 2.4 + w * 0.2) * env;
      }
    });
    const trailBp = ctx.createBiquadFilter();
    trailBp.type = 'bandpass';
    trailBp.Q.value = 0.9;
    trailBp.frequency.setValueAtTime(1400, fire);
    trailBp.frequency.exponentialRampToValueAtTime(280, fire + 0.26);
    const trailLp = ctx.createBiquadFilter();
    trailLp.type = 'lowpass';
    trailLp.frequency.setValueAtTime(3200, fire);
    trailLp.frequency.exponentialRampToValueAtTime(700, fire + 0.26);
    const trailG = ctx.createGain();
    trailG.gain.setValueAtTime(0.0001, fire);
    trailG.gain.linearRampToValueAtTime(0.26, fire + 0.03);
    trailG.gain.setValueAtTime(0.18, fire + 0.1);
    trailG.gain.exponentialRampToValueAtTime(0.0001, fire + 0.28);
    trail.connect(trailBp);
    trailBp.connect(trailLp);
    trailLp.connect(trailG);
    trailG.connect(shotBus);
    trail.start(fire);
    trail.stop(fire + 0.3);

    // ========== E) Air displacement / whoosh (mid layer glue) ==========
    const whoosh = noiseBurst(0.2, (data, n) => {
      let b = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const env = Math.sin(Math.min(1, t * 2.2) * Math.PI * 0.5) * Math.exp(-t * 2.5);
        const w = Math.random() * 2 - 1;
        b = (b + 0.05 * w) / 1.05;
        data[i] = b * 3.0 * env;
      }
    });
    const whooshBp = ctx.createBiquadFilter();
    whooshBp.type = 'bandpass';
    whooshBp.frequency.setValueAtTime(600, fire);
    whooshBp.frequency.exponentialRampToValueAtTime(220, fire + 0.18);
    whooshBp.Q.value = 0.7;
    const whooshG = ctx.createGain();
    whooshG.gain.setValueAtTime(0.0001, fire);
    whooshG.gain.linearRampToValueAtTime(0.16, fire + 0.025);
    whooshG.gain.exponentialRampToValueAtTime(0.0001, fire + 0.2);
    whoosh.connect(whooshBp);
    whooshBp.connect(whooshG);
    whooshG.connect(shotBus);
    whoosh.start(fire);
    whoosh.stop(fire + 0.22);

    // ========== F) Damped metal ring (blends under trail, not a dry beep) ==========
    const ring = ctx.createOscillator();
    ring.type = 'sine';
    ring.frequency.setValueAtTime(enemy ? 640 : 760, fire + 0.01);
    ring.frequency.exponentialRampToValueAtTime(enemy ? 380 : 440, fire + 0.22);
    const ringG = ctx.createGain();
    ringG.gain.setValueAtTime(0.0001, fire + 0.01);
    ringG.gain.linearRampToValueAtTime(0.07, fire + 0.02);
    ringG.gain.exponentialRampToValueAtTime(0.0001, fire + 0.25);
    const ringLp = ctx.createBiquadFilter();
    ringLp.type = 'lowpass';
    ringLp.frequency.value = 1400;
    ring.connect(ringLp);
    ringLp.connect(ringG);
    ringG.connect(shotBus);
    ring.start(fire + 0.01);
    ring.stop(fire + 0.27);

    // ========== G) Low rumble bed under everything (makes it feel "designed") ==========
    const rumble = noiseBurst(0.35, (data, n) => {
      let b = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const env = Math.min(1, t * 8) * Math.exp(-t * 2.0);
        const w = Math.random() * 2 - 1;
        b = (b + 0.02 * w) / 1.02;
        data[i] = b * 4.0 * env;
      }
    });
    const rumbleLp = ctx.createBiquadFilter();
    rumbleLp.type = 'lowpass';
    rumbleLp.frequency.value = 160;
    const rumbleG = ctx.createGain();
    rumbleG.gain.setValueAtTime(0.0001, fire);
    rumbleG.gain.linearRampToValueAtTime(0.2, fire + 0.04);
    rumbleG.gain.exponentialRampToValueAtTime(0.0001, fire + 0.35);
    rumble.connect(rumbleLp);
    rumbleLp.connect(rumbleG);
    rumbleG.connect(shotBus);
    rumble.start(fire);
    rumble.stop(fire + 0.37);
  }
}

export const gameAudio = new GameAudio();
