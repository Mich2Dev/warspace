export class MobileController {
  constructor(spaceship) {
    this.ship = spaceship;
    this.keys = {};
    
    // Check if the device is a touch device
    this.isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    
    if (this.isMobile) {
      document.body.classList.add('mobile-mode');
      this.initUI();
      this.bindEvents();
    }
  }

  initUI() {
    const container = document.createElement('div');
    container.id = 'mobile-ui';
    container.innerHTML = `
      <div id="joy-left" class="joystick">
        <div class="knob"></div>
      </div>
      <div id="joy-right" class="joystick">
        <div class="knob"></div>
      </div>
      <div class="m-buttons">
        <div id="btn-map" class="m-btn">🗺️ Mapa</div>
        <div id="btn-anchor" class="m-btn">⚓ Superficie</div>
        <div id="btn-boost" class="m-btn boost-btn">🚀 TURBO</div>
      </div>
    `;
    document.body.appendChild(container);
    
    this.jL = { el: document.getElementById('joy-left'), knob: document.querySelector('#joy-left .knob'), touchId: null, ox: 0, oy: 0 };
    this.jR = { el: document.getElementById('joy-right'), knob: document.querySelector('#joy-right .knob'), touchId: null, ox: 0, oy: 0, lastX: 0, lastY: 0 };
  }

  simulateKeyPress(code) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: code }));
    setTimeout(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { code: code }));
    }, 100);
  }

  bindEvents() {
    // Prevent default scrolling and zooming on mobile
    document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

    const handleTouchStart = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        const target = document.elementFromPoint(t.clientX, t.clientY);
        if (!target) continue;
        
        // Buttons
        if (target.closest('#btn-map')) this.simulateKeyPress('KeyM');
        if (target.closest('#btn-anchor')) this.simulateKeyPress('Numpad5');
        if (target.closest('#btn-boost')) this.keys['ShiftLeft'] = true;

        // Joysticks
        if (target.closest('#joy-left') && this.jL.touchId === null) {
          this.jL.touchId = t.identifier;
          const rect = this.jL.el.getBoundingClientRect();
          this.jL.ox = rect.left + rect.width / 2;
          this.jL.oy = rect.top + rect.height / 2;
          this.updateJoystickLeft(t.clientX, t.clientY);
        }
        
        if (target.closest('#joy-right') && this.jR.touchId === null) {
          this.jR.touchId = t.identifier;
          const rect = this.jR.el.getBoundingClientRect();
          this.jR.ox = rect.left + rect.width / 2;
          this.jR.oy = rect.top + rect.height / 2;
          this.jR.lastX = t.clientX;
          this.jR.lastY = t.clientY;
        }
      }
    };

    const handleTouchMove = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        
        if (t.identifier === this.jL.touchId) {
          this.updateJoystickLeft(t.clientX, t.clientY);
        }
        
        if (t.identifier === this.jR.touchId) {
          // Camera movement is relative (like a mouse)
          const dx = t.clientX - this.jR.lastX;
          const dy = t.clientY - this.jR.lastY;
          this.jR.lastX = t.clientX;
          this.jR.lastY = t.clientY;
          
          // Inject into spaceship as if it was a mouse
          this.ship.onMouseMove(dx * 1.5, dy * 1.5);
          
          // Visual knob
          let nx = t.clientX - this.jR.ox;
          let ny = t.clientY - this.jR.oy;
          const dist = Math.sqrt(nx*nx + ny*ny);
          const maxDist = 40;
          if (dist > maxDist) {
            nx = (nx/dist)*maxDist; ny = (ny/dist)*maxDist;
          }
          this.jR.knob.style.transform = `translate(${nx}px, ${ny}px)`;
        }
      }
    };

    const handleTouchEnd = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        
        // Buttons
        const target = document.elementFromPoint(t.clientX, t.clientY);
        if (target && target.closest('#btn-boost')) this.keys['ShiftLeft'] = false;
        
        if (t.identifier === this.jL.touchId) {
          this.jL.touchId = null;
          this.jL.knob.style.transform = `translate(0px, 0px)`;
          this.keys['KeyW'] = false;
          this.keys['KeyS'] = false;
          this.keys['KeyA'] = false;
          this.keys['KeyD'] = false;
        }
        
        if (t.identifier === this.jR.touchId) {
          this.jR.touchId = null;
          this.jR.knob.style.transform = `translate(0px, 0px)`;
        }
      }
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: false });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchcancel', handleTouchEnd);
  }

  updateJoystickLeft(cx, cy) {
    let dx = cx - this.jL.ox;
    let dy = cy - this.jL.oy;
    
    const dist = Math.sqrt(dx*dx + dy*dy);
    const maxDist = 40;
    
    // Visual update
    let nx = dx, ny = dy;
    if (dist > maxDist) {
      nx = (dx/dist)*maxDist;
      ny = (dy/dist)*maxDist;
    }
    this.jL.knob.style.transform = `translate(${nx}px, ${ny}px)`;
    
    // Logic update (Map to W/S/A/D)
    this.keys['KeyW'] = dy < -10;
    this.keys['KeyS'] = dy > 10;
    this.keys['KeyA'] = dx < -10;
    this.keys['KeyD'] = dx > 10;
  }
}
