/**
 * Animaciones DOM del HUD — modales, popups, barras.
 * Usar CSS cuando baste; este helper unifica el patrón rAF repetido.
 * (Opcional futuro: anime.js solo aquí, no en Three.js)
 */

import { onMobilePanelOpen } from '../uiLayout.js';

const MODAL_SELECTOR = '.game-modal.modal-open, .armory-modal.modal-open';

export function isModalOpen(modalEl) {
    if (!modalEl) return false;
    return modalEl.classList.contains('modal-open')
        || (modalEl.style.display !== 'none' && modalEl.style.display !== '');
}

function syncModalLayer() {
    if (!document.querySelector(MODAL_SELECTOR)) {
        document.body.classList.remove('modal-layer-open');
    }
}

export function openModal(modalEl) {
    if (!modalEl) return;
    modalEl.style.display = 'flex';
    document.body.classList.add('modal-layer-open');
    onMobilePanelOpen();
    requestAnimationFrame(() => modalEl.classList.add('modal-open'));
}

export function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.remove('modal-open');
    const finish = () => {
        modalEl.style.display = 'none';
        syncModalLayer();
    };
    modalEl.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 280);
}

export function toggleModal(modalEl) {
    if (!modalEl) return;
    isModalOpen(modalEl) ? closeModal(modalEl) : openModal(modalEl);
}

export function openModalById(id) {
    openModal(document.getElementById(id));
}

export function closeModalById(id) {
    closeModal(document.getElementById(id));
}

export function toggleModalById(id) {
    toggleModal(document.getElementById(id));
}

/** Anima un número en pantalla (HP, CR, etc.). */
export function animateNumber(el, from, to, durationMs = 400, formatter = (n) => String(Math.round(n))) {
    if (!el) return;
    const t0 = performance.now();
    const tick = (now) => {
        const t = Math.min(1, (now - t0) / durationMs);
        const eased = 1 - (1 - t) ** 3;
        el.textContent = formatter(from + (to - from) * eased);
        if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

/** Popup flotante genérico (+cr, +HP). */
export function floatPopup(el, text, opts = {}) {
    if (!el) return;
    clearTimeout(el._floatTimeout);
    el.textContent = text;
    el.className = `credit-popup${opts.big ? ' big' : opts.med ? ' med' : ''}`;
    if (opts.color) el.style.color = opts.color;
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
    el._floatTimeout = setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(-10px)';
        el.style.color = '';
    }, opts.durationMs ?? 900);
}
