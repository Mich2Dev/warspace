import { EVENT_CONTRACTS, getEventContractById } from './eventCatalog.js';
import { getProfile, recordEventResult } from './profile.js';

export class EventBoard {
    constructor(eventDirector, player) {
        this.eventDirector = eventDirector;
        this.player = player;
        this.selectedIndex = 0;
        this.activeContractId = null;
        /** contractId -> timestamp when cooldown ends */
        this.cooldownUntil = {};
        this.pendingOfferId = null;
        this.radarTimer = 0;

        this.eventDirector.onEventFinished = (contractId, success) => this.onEventFinished(contractId, success);
        this.eventDirector.manualMode = true;

        this._wireUI();
        this.renderBoard();
        this._updateOfferBadge();
    }

    _wireUI() {
        document.getElementById('eb-accept-btn')?.addEventListener('click', () => this.acceptSelectedContract());
        document.getElementById('close-event-board')?.addEventListener('click', () => this.closeBoard());
    }

    update(delta) {
        if (this._isMpGuest()) return;
        if (!getProfile().prefs.radarOffers) return;
        if (this.eventDirector.activeEvent || this.pendingOfferId) return;

        this.radarTimer -= delta;
        if (this.radarTimer > 0) return;

        const available = EVENT_CONTRACTS.find(c => this.getContractState(c.id) === 'disponible');
        if (available) {
            this.pendingOfferId = available.id;
            this._updateOfferBadge();
            this._pulseOfferBanner(available);
        }
        this.radarTimer = 45;
    }

    _pulseOfferBanner(contract) {
        const banner = document.getElementById('event-offer-toast');
        if (!banner) return;
        banner.textContent = `Contrato listo: ${contract.title} — abre Eventos [E]`;
        banner.style.display = 'block';
        banner.classList.remove('show');
        void banner.offsetWidth;
        banner.classList.add('show');
        setTimeout(() => {
            banner.classList.remove('show');
            setTimeout(() => { banner.style.display = 'none'; }, 400);
        }, 4200);
    }

    _updateOfferBadge() {
        const badge = document.getElementById('event-board-badge');
        if (!badge) return;
        const count = EVENT_CONTRACTS.filter(c => this.getContractState(c.id) === 'disponible').length;
        const hasOffer = this.pendingOfferId ? 1 : 0;
        const total = count + (this.pendingOfferId && count === 0 ? 1 : 0);
        if (total > 0) {
            badge.textContent = String(Math.max(count, hasOffer));
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }

    getContractState(contractId) {
        if (this.activeContractId === contractId) return 'en_curso';
        const until = this.cooldownUntil[contractId] || 0;
        if (Date.now() < until) return 'cooldown';
        const contract = getEventContractById(contractId);
        if (!contract) return 'bloqueado';
        const level = this.player?.level ?? 1;
        if (level < contract.minLevel) return 'bloqueado';
        return 'disponible';
    }

    _cooldownRemainingSec(contractId) {
        const ms = (this.cooldownUntil[contractId] || 0) - Date.now();
        return Math.max(0, Math.ceil(ms / 1000));
    }

    _isMpGuest() {
        const mp = window.__game?.multiplayerClient;
        return mp?.isOnline && !mp.isHost;
    }

    acceptSelectedContract() {
        if (this._isMpGuest()) {
            this._log('En la sala solo el HOST acepta contratos. Sigue el evento cuando el host lo inicie.', '#ffaa55');
            return;
        }
        if (this.eventDirector.activeEvent) {
            this._log('Ya hay un evento en curso. Terminalo antes de aceptar otro.', '#ffaa55');
            return;
        }

        const contract = EVENT_CONTRACTS[this.selectedIndex];
        if (!contract) return;

        const state = this.getContractState(contract.id);
        if (state === 'bloqueado') {
            this._log(`Requiere nivel ${contract.minLevel} o mas.`, '#ff6666');
            return;
        }
        if (state === 'cooldown') {
            this._log(`En espera ${this._cooldownRemainingSec(contract.id)}s.`, '#ffaa55');
            return;
        }
        if (state === 'en_curso') return;

        let started = false;
        switch (contract.type) {
            case 'invasion':
                started = this.eventDirector.startInvasionEvent({ contractId: contract.id });
                break;
            case 'distress':
                started = this.eventDirector.startDistressEvent({ contractId: contract.id });
                break;
            case 'miniBoss':
                started = this.eventDirector.startMiniBossEvent({ contractId: contract.id });
                break;
            default:
                break;
        }

        if (!started) {
            this._log('No se pudo iniciar el contrato.', '#ff6666');
            return;
        }

        this.activeContractId = contract.id;
        this.pendingOfferId = null;
        this._updateOfferBadge();
        this.renderBoard();
        this._log(`Contrato aceptado: ${contract.title}`, contract.color);
    }

    onEventFinished(contractId, success) {
        const contract = getEventContractById(contractId);
        if (contract) {
            this.cooldownUntil[contractId] = Date.now() + contract.cooldownSec * 1000;
        }
        this.activeContractId = null;
        recordEventResult(success);
        this.renderBoard();
        this._updateOfferBadge();
    }

    onRoomEventStart(contractId) {
        if (contractId) this.activeContractId = contractId;
        this.pendingOfferId = null;
        this.renderBoard();
        this._updateOfferBadge();
    }

    renderBoard() {
        const list = document.getElementById('event-list-container');
        const title = document.getElementById('eb-title');
        const desc = document.getElementById('eb-desc');
        const meta = document.getElementById('eb-meta');
        const acceptBtn = document.getElementById('eb-accept-btn');
        if (!list || !title || !desc || !acceptBtn) return;

        list.innerHTML = '';
        EVENT_CONTRACTS.forEach((c, idx) => {
            const state = this.getContractState(c.id);
            const slot = document.createElement('div');
            slot.className = 'inv-slot event-slot';
            if (idx === this.selectedIndex) slot.classList.add('active');
            if (state === 'disponible') slot.classList.add('event-ready');
            let stateLabel = state.toUpperCase().replace('_', ' ');
            if (state === 'cooldown') stateLabel = `${this._cooldownRemainingSec(c.id)}s`;
            slot.innerHTML = `
                <div class="slot-type" style="color:${c.color}">${stateLabel}</div>
                <div class="slot-name">${c.icon} ${c.shortLabel}</div>
            `;
            slot.addEventListener('click', () => {
                this.selectedIndex = idx;
                this.renderBoard();
            });
            list.appendChild(slot);
        });

        const c = EVENT_CONTRACTS[this.selectedIndex];
        const state = this.getContractState(c.id);
        title.textContent = c.title;
        desc.textContent = c.description;
        if (meta) {
            meta.textContent = `Nv.${c.minLevel}+ · Recompensa ~${c.rewardCredits} CR · ${c.objective}`;
        }

        acceptBtn.style.display = state === 'disponible' && !this.eventDirector.activeEvent ? 'inline-block' : 'none';
        acceptBtn.textContent = this._isMpGuest() ? 'SOLO HOST' : 'ACEPTAR CONTRATO';
        acceptBtn.disabled = this._isMpGuest();
        if (state === 'en_curso') acceptBtn.textContent = 'EVENTO EN CURSO';
        if (state === 'cooldown') acceptBtn.textContent = `EN ESPERA (${this._cooldownRemainingSec(c.id)}s)`;
        if (state === 'bloqueado') acceptBtn.textContent = 'BLOQUEADO';
    }

    openBoard() {
        this.renderBoard();
        const modal = document.getElementById('event-board-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        document.body.classList.add('modal-layer-open');
        requestAnimationFrame(() => modal.classList.add('modal-open'));
        this.pendingOfferId = null;
        this._updateOfferBadge();
    }

    closeBoard() {
        const modal = document.getElementById('event-board-modal');
        if (!modal) return;
        modal.classList.remove('modal-open');
        const finish = () => {
            modal.style.display = 'none';
            if (!document.querySelector('.game-modal.modal-open, .armory-modal.modal-open')) {
                document.body.classList.remove('modal-layer-open');
            }
        };
        modal.addEventListener('transitionend', finish, { once: true });
        setTimeout(finish, 280);
    }

    toggleBoard() {
        const modal = document.getElementById('event-board-modal');
        if (!modal) return;
        const open = modal.classList.contains('modal-open') || modal.style.display === 'flex';
        open ? this.closeBoard() : this.openBoard();
    }

    _log(msg, color = '#7fe4ff') {
        const log = document.getElementById('log-text');
        if (log) log.innerHTML = `<span style="color:${color};font-weight:bold;">${msg}</span>`;
    }
}
