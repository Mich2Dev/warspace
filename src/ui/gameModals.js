import { closeModalById, toggleModalById } from './UiAnimator.js';
import { closeHangar } from '../hangar.js';

export function wireGameModals(game) {
    document.getElementById('close-mission-board')?.addEventListener('click', () => {
        game._closeModal('mission-board-modal');
    });
    document.getElementById('close-hangar')?.addEventListener('click', () => {
        closeHangar();
    });
}

export function toggleGameModal(_game, id) {
    toggleModalById(id);
}

export function closeGameModal(_game, id) {
    closeModalById(id);
}
