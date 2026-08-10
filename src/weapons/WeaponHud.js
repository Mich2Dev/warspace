import { listWeapons } from './WeaponCatalog.js';

/**
 * Hotbar + menú radial simple de armas a pie.
 * Estilo glass coherente con el HUD existente.
 */
export class WeaponHud {
  /**
   * @param {{
   *   getWalker: () => import('../SurfaceWalker.js').SurfaceWalker | null,
   *   isActive: () => boolean
   * }} opts
   */
  constructor(opts) {
    this.getWalker = opts.getWalker;
    this.isActive = opts.isActive;
    this.menuOpen = false;

    this.hotbar = document.createElement('div');
    this.hotbar.id = 'weapon-hotbar';
    this.hotbar.innerHTML = '<div class="wh-slots"></div><div class="wh-name"></div>';
    document.body.appendChild(this.hotbar);

    this.menu = document.createElement('div');
    this.menu.id = 'weapon-menu';
    this.menu.innerHTML = `
      <div class="wm-panel">
        <div class="wm-title">ARSENAL</div>
        <div class="wm-grid"></div>
        <div class="wm-hint">1–8 seleccionar · Q/R ciclar · V cerrar · Click disparar</div>
      </div>`;
    document.body.appendChild(this.menu);

    this._slotsEl = this.hotbar.querySelector('.wh-slots');
    this._nameEl = this.hotbar.querySelector('.wh-name');
    this._gridEl = this.menu.querySelector('.wm-grid');

    this._build();
    this.hide();
  }

  _build() {
    const weapons = listWeapons();
    this._slotsEl.innerHTML = '';
    this._gridEl.innerHTML = '';
    for (const w of weapons) {
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'wh-slot';
      slot.dataset.id = w.id;
      slot.dataset.slot = String(w.slot);
      slot.innerHTML = `<span class="wh-num">${w.slot}</span><span class="wh-cat">${w.category}</span>`;
      slot.title = w.name;
      slot.addEventListener('click', (e) => {
        e.preventDefault();
        this._equip(w.id);
      });
      this._slotsEl.appendChild(slot);

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'wm-card';
      card.dataset.id = w.id;
      card.innerHTML = `
        <div class="wm-slot">SLOT ${w.slot}</div>
        <div class="wm-name">${w.name}</div>
        <div class="wm-meta">${w.category} · dmg ${w.damage} · ${w.fireRateMs}ms</div>
        <div class="wm-blurb">${w.blurb || ''}</div>`;
      card.addEventListener('click', (e) => {
        e.preventDefault();
        this._equip(w.id);
        this.setMenuOpen(false);
      });
      this._gridEl.appendChild(card);
    }
  }

  _equip(id) {
    const walker = this.getWalker();
    if (!walker?.active) return;
    walker.equipWeapon(id);
  }

  sync(payload) {
    const id = payload?.equippedId || null;
    const def = payload?.def || null;
    this._slotsEl.querySelectorAll('.wh-slot').forEach((el) => {
      el.classList.toggle('active', el.dataset.id === id);
    });
    this._gridEl.querySelectorAll('.wm-card').forEach((el) => {
      el.classList.toggle('active', el.dataset.id === id);
    });
    this._nameEl.textContent = def
      ? `${def.name} · ${def.blurb || def.category}`
      : '';
  }

  show() {
    if (!this.isActive()) return;
    this.hotbar.classList.add('visible');
  }

  hide() {
    this.hotbar.classList.remove('visible');
    this.setMenuOpen(false);
  }

  setMenuOpen(open) {
    this.menuOpen = !!open;
    this.menu.classList.toggle('visible', this.menuOpen);
    if (this.menuOpen) {
      if (document.pointerLockElement) document.exitPointerLock();
    } else if (this.isActive()) {
      // Re-capturar mira al cerrar
      try { document.body.requestPointerLock?.(); } catch (_) {}
    }
  }

  toggleMenu() {
    if (!this.isActive()) return;
    this.setMenuOpen(!this.menuOpen);
  }
}
