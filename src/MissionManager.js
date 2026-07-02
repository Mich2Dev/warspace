import { CONFIG } from '../config.js';
import * as THREE from 'three';
import { recordMissionComplete } from './profile.js';
import { computeMissionCompletionReward, previewMissionReward } from './missionRewards.js';

const ZONE_LABELS = {
    Zona1: 'Zona 1 · Mantis de Asalto',
    Zona2: 'Zona 2 · Carroñero Elite',
    Zona3: 'Zona 3 · Comandante Pesado',
};

export class MissionManager {
    constructor(player, enemyManager) {
        this.player = player;
        this.enemyManager = enemyManager;

        this.currentSector = 1;
        this.activeMissionIndex = -1;
        this.nextMissionIndex = 0;
        this.selectedMissionIndex = 0;

        this.missions = [
            {
                id: 'tutorial_zona1',
                title: 'Asalto a la Zona 1',
                objective: 'Destruye 3 Mantis de Asalto (E1) en la Zona 1.',
                difficulty: 1,
                rewardBase: 220,
                rewardXp: 70,
                targetKills: 3,
                currentKills: 0,
                targetType: 'Zona1',
                targetZone: CONFIG.ZONES.ZONA1,
                storyComplete: 'Buen trabajo limpiando la Zona 1. Sigue las nuevas coordenadas hacia la Zona 2.',
                onStart: () => {
                    this.playTransmission('Comando Aegis', 'Piloto, el radar indica actividad hostil al noroeste. Dirígete a la Zona 1 (puntos rojos) y elimina las defensas exteriores.', '#ff0000');
                },
            },
            {
                id: 'scavenger_hunt',
                title: 'Nido de Carroñeros',
                objective: 'Destruye 5 Carroñeros Elite (E2) en la Zona 2.',
                difficulty: 2,
                rewardBase: 480,
                rewardXp: 130,
                targetKills: 5,
                currentKills: 0,
                targetType: 'Zona2',
                targetZone: CONFIG.ZONES.ZONA2,
                storyComplete: 'Estás llamando mucho la atención. El Comandante de la Zona 3 se dirige hacia ti.',
                onStart: () => {
                    setTimeout(() => {
                        this.playTransmission('Legión de Hierro', 'ADVERTENCIA: INTRUSO DETECTADO. ENVIANDO TROPAS AZULES.', '#00aaff');
                    }, 3000);
                },
            },
            {
                id: 'heavy_patrol',
                title: 'Fuerza Letal',
                objective: 'Destruye 2 Comandantes Pesados (E3) en la Zona 3.',
                difficulty: 3,
                rewardBase: 850,
                rewardXp: 220,
                targetKills: 2,
                currentKills: 0,
                targetType: 'Zona3',
                targetZone: CONFIG.ZONES.ZONA3,
                storyComplete: 'Increíble. Has asegurado todas las zonas. El sector está limpio.',
                onStart: () => {
                    this.playTransmission('Comando Aegis', 'Dirígete a la Zona 3 (morado). Ten cuidado, los Comandantes son letales.', '#aa00ff');
                },
            },
        ];

        this._wireMissionBoardUI();
        this._renderMissionBoard();
        this.updateUI();
    }

    navigateToMissionZone(mission = null) {
        const m = mission || this.missions[this.activeMissionIndex];
        if (!m?.targetZone || !this.player) return false;

        const env = this.enemyManager?.environment;
        const { x, z } = m.targetZone;
        const h = env ? env.getHeightAt(x, z) : 0;
        this.player.setNavDestination(new THREE.Vector3(x, h + 1.5, z));

        const log = document.getElementById('log-text');
        if (log) {
            log.innerHTML = `<span style="color:#aa88ff;">Rumbo a ${m.title} — sigue la flecha del radar</span>`;
        }
        return true;
    }

    ensureMissionZoneEnemies(mission = null) {
        const m = mission || this.missions[this.activeMissionIndex];
        if (!m?.targetType || !this.enemyManager?.ensureZoneUnits) return;
        this.enemyManager.ensureZoneUnits(m.targetType);
    }

    _initRunStats(m) {
        m.runStats = { validKills: 0, killCredits: 0, killXp: 0 };
    }

    startCurrentMission() {
        if (this.activeMissionIndex < 0 || this.activeMissionIndex >= this.missions.length) return;
        const m = this.missions[this.activeMissionIndex];
        this._initRunStats(m);
        if (m.onStart) m.onStart();
        this.updateUI();
    }

    nextMission() {
        this.activeMissionIndex = -1;
        this.nextMissionIndex++;
        if (this.nextMissionIndex >= this.missions.length) this.nextMissionIndex = this.missions.length;
        this.selectedMissionIndex = Math.min(this.nextMissionIndex, this.missions.length - 1);
        this._renderMissionBoard();
        this.updateUI();
    }

    _enemyMatchesMission(m, enemyType, enemyName) {
        const type = (enemyType || '').toLowerCase();
        const name = (enemyName || '').toLowerCase();
        const target = (m.targetType || '').toLowerCase();
        return type.includes(target) || name.includes(target)
            || target.includes(type) || (target === 'boss' && type === 'boss');
    }

    _isMpGuest() {
        const mp = window.__game?.multiplayerClient;
        return mp?.isOnline && !mp.isHost;
    }

    _isMpHost() {
        const mp = window.__game?.multiplayerClient;
        return mp?.isOnline && mp.isHost;
    }

    onEnemyKilled(enemyType, enemyName, details = {}) {
        if (this._isMpGuest()) return;
        if (this.activeMissionIndex < 0 || this.activeMissionIndex >= this.missions.length) return;

        const m = this.missions[this.activeMissionIndex];
        if (!this._enemyMatchesMission(m, enemyType, enemyName)) return;

        m.currentKills++;
        if (!m.runStats) this._initRunStats(m);
        m.runStats.validKills++;
        if (details.crDrop) m.runStats.killCredits += details.crDrop;
        if (details.xpDrop) m.runStats.killXp += details.xpDrop;

        this._logKillProgress(m, enemyName, details);

        if (this._isMpHost()) {
            window.__game?.roomSync?.broadcastMissionKill(
                this.activeMissionIndex,
                m.currentKills,
                enemyType,
                enemyName,
                details,
            );
        }

        this.updateUI();
        this._renderMissionBoard();

        if (m.currentKills >= m.targetKills) {
            this._completeMission(m);
        }
    }

    _logKillProgress(m, enemyName, details) {
        const log = document.getElementById('log-text');
        if (!log) return;
        const tier = details.enemyTier ? ` · Nv.${details.enemyTier}` : '';
        const cr = details.crDrop ? ` +${details.crDrop} CR` : '';
        log.innerHTML = `<span style="color:#aaddff;">Objetivo: ${m.currentKills}/${m.targetKills}${cr}${tier}</span>`;
    }

    _completeMission(m) {
        const stats = m.runStats || { validKills: 0, killCredits: 0, killXp: 0 };
        const { credits, xp, diff } = computeMissionCompletionReward(m, this.currentSector);
        const totalCr = credits + stats.killCredits;

        if (this.player) {
            this.player.grantMissionReward(credits, xp);
            if (typeof this.player._pulseScreen === 'function') {
                this.player._pulseScreen('mission');
            }
        }

        recordMissionComplete(credits);

        const log = document.getElementById('log-text');
        if (log) {
            log.innerHTML = [
                `<span style="color:#44ffaa;font-weight:bold;font-size:1.05em;">✓ MISIÓN COMPLETADA — ${m.title}</span>`,
                `<br><span style="color:#ffdd88;">Bono: +${credits} CR · +${xp} XP · ${diff.label} ${diff.stars}</span>`,
                `<br><span style="color:#99bbcc;">Botín combate: ${stats.killCredits} CR · ${stats.validKills} bajas válidas</span>`,
                `<br><span style="color:#77aa99;">Total misión: ~${totalCr} CR</span>`,
            ].join('');
        }

        const story = m.storyComplete || 'Misión cumplida.';
        this.playTransmission(
            'Comando Aegis',
            `${story} Recompensa: +${credits} créditos y +${xp} XP (${diff.label}). Botín de campo: ${stats.killCredits} CR.`,
            '#44ffaa'
        );

        m.completed = true;
        m.lastReward = { credits, xp, stats, totalCr };

        if (this._isMpHost()) {
            window.__game?.roomSync?.broadcastMissionComplete(this.activeMissionIndex, this.nextMissionIndex + 1, {
                credits,
                xp,
            });
        }

        this.nextMission();
    }

    /** Invitados: misión compartida de la sala (desde HOST). */
    applyRoomMission(p) {
        if (!p || this._isMpHost()) return;

        if (p.action === 'start') {
            if (typeof p.index !== 'number' || p.index < 0 || p.index >= this.missions.length) return;
            this.activeMissionIndex = p.index;
            this.nextMissionIndex = p.index;
            const m = this.missions[p.index];
            m.currentKills = 0;
            this._initRunStats(m);
            this._renderMissionBoard();
            this.updateUI();
            if (m.onStart) m.onStart();
            this.ensureMissionZoneEnemies(m);
            this.navigateToMissionZone(m);
            const log = document.getElementById('log-text');
            if (log) {
                log.innerHTML = `<span style="color:#7fe4ff;">Misión de sala iniciada: ${m.title}</span>`;
            }
            return;
        }

        if (p.action === 'sync') {
            if (typeof p.index !== 'number' || p.index < 0 || p.index >= this.missions.length) return;
            this.activeMissionIndex = p.index;
            this.nextMissionIndex = Math.min(p.index, this.nextMissionIndex);
            const m = this.missions[p.index];
            m.currentKills = p.currentKills ?? m.currentKills;
            if (!m.runStats) this._initRunStats(m);
            this._renderMissionBoard();
            this.updateUI();
            this.ensureMissionZoneEnemies(m);
            return;
        }

        if (p.action === 'kill') {
            if (p.index !== this.activeMissionIndex) return;
            const m = this.missions[this.activeMissionIndex];
            if (!m) return;
            m.currentKills = p.currentKills ?? m.currentKills + 1;
            if (!m.runStats) this._initRunStats(m);
            m.runStats.validKills++;
            const d = p.details || {};
            if (d.crDrop) {
                m.runStats.killCredits += d.crDrop;
                this.player?.gainCredits(d.crDrop, this.player.position);
            }
            if (d.xpDrop) {
                m.runStats.killXp += d.xpDrop;
                this.player?.gainXP(d.xpDrop);
            }
            this._logKillProgress(m, p.enemyName || '', d);
            this.updateUI();
            this._renderMissionBoard();
            return;
        }

        if (p.action === 'complete') {
            const m = this.missions[p.index];
            if (m) {
                m.currentKills = m.targetKills;
                m.completed = true;
            }
            if (p.reward && this.player) {
                this.player.grantMissionReward(p.reward.credits ?? 0, p.reward.xp ?? 0);
            }
            const log = document.getElementById('log-text');
            if (log && m) {
                log.innerHTML = `<span style="color:#44ffaa;font-weight:bold;">✓ MISIÓN DE SALA COMPLETADA — ${m.title}</span>`;
            }
            this.activeMissionIndex = -1;
            if (typeof p.nextIndex === 'number') {
                this.nextMissionIndex = Math.min(p.nextIndex, this.missions.length);
            } else {
                this.nextMissionIndex++;
            }
            this._renderMissionBoard();
            this.updateUI();
        }
    }

    updateUI() {
        const panel = document.getElementById('mission-panel');
        const waypoint = document.getElementById('minimap-waypoint');
        const goBtn = document.getElementById('mission-go-btn');

        if (this.activeMissionIndex < 0 || this.activeMissionIndex >= this.missions.length) {
            if (panel) panel.style.display = 'none';
            if (waypoint) waypoint.style.display = 'none';
            document.body.classList.remove('mission-active');
            return;
        }

        document.body.classList.add('mission-active');

        const m = this.missions[this.activeMissionIndex];
        const preview = previewMissionReward(m, this.currentSector);
        if (panel) panel.style.display = 'block';
        const titleEl = document.getElementById('mission-title');
        const objEl = document.getElementById('mission-objective');
        if (titleEl) titleEl.innerText = `${m.title} · ${preview.stars}`;
        if (objEl) {
            objEl.innerText = `${m.objective} (${m.currentKills}/${m.targetKills}) — Bono ~${preview.credits} CR`;
        }
        if (goBtn) goBtn.style.display = 'inline-block';

        if (waypoint && m.targetZone) {
            waypoint.style.display = 'block';
            const minimap = document.getElementById('minimap');
            const mapW = minimap ? minimap.clientWidth : 200;
            const mapH = minimap ? minimap.clientHeight : 200;
            const pX = (m.targetZone.x + 12000) / 24000 * mapW;
            const pZ = (m.targetZone.z + 12000) / 24000 * mapH;
            waypoint.style.left = `${pX}px`;
            waypoint.style.top = `${pZ}px`;
        } else if (waypoint) {
            waypoint.style.display = 'none';
        }
    }

    playTransmission(name, text, color) {
        const panel = document.getElementById('transmission-panel');
        const nameEl = document.getElementById('transmission-name');
        const textEl = document.getElementById('transmission-text');
        if (!panel || !nameEl || !textEl) return;

        nameEl.innerText = name;
        nameEl.style.color = color;
        panel.style.borderTop = `1px solid ${color}`;
        panel.style.borderBottom = `1px solid ${color}`;
        const avatar = document.getElementById('transmission-avatar');
        if (avatar) avatar.style.borderColor = color;

        panel.style.display = 'flex';

        textEl.textContent = '';
        let i = 0;
        const speed = 40;

        if (this.typeWriterInterval) clearInterval(this.typeWriterInterval);

        this.typeWriterInterval = setInterval(() => {
            if (i < text.length) {
                textEl.textContent += text.charAt(i);
                i++;
            } else {
                clearInterval(this.typeWriterInterval);
                setTimeout(() => {
                    panel.style.display = 'none';
                }, 7000);
            }
        }, speed);
    }

    jumpToNextSector() {
        this.currentSector++;
        this.activeMissionIndex = -1;
        this.nextMissionIndex = 0;
        this.selectedMissionIndex = 0;

        ['ZONA1_HP', 'ZONA2_HP', 'ZONA3_HP'].forEach((key) => {
            if (typeof CONFIG.COMBAT[key] === 'number') {
                CONFIG.COMBAT[key] = Math.floor(CONFIG.COMBAT[key] * 1.5);
            }
        });

        this.missions.forEach((m) => {
            m.currentKills = 0;
            m.completed = false;
        });

        const ui = document.getElementById('ui');
        if (ui) {
            ui.style.transition = 'box-shadow 0.1s, background-color 0.5s';
            ui.style.backgroundColor = 'white';
        }

        setTimeout(() => {
            if (ui) {
                ui.style.transition = 'background-color 2s';
                ui.style.backgroundColor = 'transparent';
            }

            this.player.position.set(0, 50, 4000);
            this.player.hp = this.player.maxHp;
            this.player.updateUI();

            this.playTransmission('Comando Aegis', `Salto completado. Bienvenido al sector ${this.currentSector}. La Legión aquí es mucho más fuerte. Acepta una nueva misión para continuar.`, '#aa00ff');
            this._renderMissionBoard();
            this.updateUI();
        }, 1000);
    }

    _wireMissionBoardUI() {
        const acceptBtn = document.getElementById('mb-accept-btn');
        const navBtn = document.getElementById('mb-nav-btn');
        const goBtn = document.getElementById('mission-go-btn');

        if (acceptBtn) {
            acceptBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.acceptSelectedMission();
            });
        }
        if (navBtn) {
            navBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const m = this.missions[this.selectedMissionIndex];
                if (m) this.navigateToMissionZone(m);
            });
        }
        if (goBtn) {
            goBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.navigateToMissionZone();
            });
        }
    }

    acceptSelectedMission() {
        if (this._isMpGuest()) {
            this.playTransmission(
                'Sistema',
                'En la sala solo el HOST acepta misiones. El progreso se comparte cuando el host inicie una.',
                '#ffaa55',
            );
            return;
        }
        if (this.activeMissionIndex >= 0) {
            this.playTransmission('Sistema', 'Ya tienes una misión activa. Complétala antes de aceptar otra.', '#ffaa55');
            return;
        }
        if (this.selectedMissionIndex !== this.nextMissionIndex) {
            this.playTransmission('Sistema', 'Esa misión aún no está disponible en la historia.', '#ff6666');
            return;
        }
        if (this.nextMissionIndex >= this.missions.length) {
            this.playTransmission('Comando Aegis', 'No hay más misiones principales disponibles por ahora.', '#7fe4ff');
            return;
        }

        this.activeMissionIndex = this.nextMissionIndex;
        const m = this.missions[this.activeMissionIndex];
        m.currentKills = 0;
        this._initRunStats(m);
        this._renderMissionBoard();
        this.startCurrentMission();
        this.ensureMissionZoneEnemies(m);
        this.navigateToMissionZone(m);

        const preview = previewMissionReward(m, this.currentSector);
        const log = document.getElementById('log-text');
        if (log) {
            log.innerHTML = `<span style="color:#7fe4ff;">Misión aceptada: ${m.title} — Bono ~${preview.credits} CR · ${preview.label}</span>`;
        }

        if (this._isMpHost()) {
            window.__game?.roomSync?.broadcastMissionStart(this.activeMissionIndex);
        }
    }

    _getMissionState(index) {
        if (index < this.nextMissionIndex) return 'completada';
        if (index === this.activeMissionIndex) return 'activa';
        if (index === this.nextMissionIndex) return 'disponible';
        return 'bloqueada';
    }

    _renderMissionBoard() {
        const list = document.getElementById('mission-list-container');
        const title = document.getElementById('mb-title');
        const desc = document.getElementById('mb-desc');
        const objective = document.getElementById('mb-objective');
        const acceptBtn = document.getElementById('mb-accept-btn');
        const navBtn = document.getElementById('mb-nav-btn');
        const sectorBadge = document.getElementById('mb-sector-badge');
        const stateBadge = document.getElementById('mb-state-badge');
        const meta = document.getElementById('mb-meta');
        const rewards = document.getElementById('mb-rewards');
        const progressWrap = document.getElementById('mb-progress-wrap');
        const progressFill = document.getElementById('mb-progress-fill');
        const progressLabel = document.getElementById('mb-progress-label');
        if (!list || !title || !desc || !objective || !acceptBtn) return;

        if (sectorBadge) sectorBadge.textContent = `Sector ${this.currentSector}`;

        list.innerHTML = '';
        this.missions.forEach((m, idx) => {
            const state = this._getMissionState(idx);
            const preview = previewMissionReward(m, this.currentSector);
            const slot = document.createElement('div');
            slot.className = 'mission-card';
            if (idx === this.selectedMissionIndex) slot.classList.add('active');
            slot.innerHTML = `
                <div class="slot-type">${state} · ${preview.stars}</div>
                <div class="slot-name">${m.title}</div>
            `;
            slot.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectedMissionIndex = idx;
                this._renderMissionBoard();
            });
            list.appendChild(slot);
        });

        const m = this.missions[this.selectedMissionIndex];
        const state = this._getMissionState(this.selectedMissionIndex);
        const preview = m ? previewMissionReward(m, this.currentSector) : null;

        title.textContent = m?.title || 'Misiones';
        desc.textContent = m?.objective || 'Sin descripción';

        if (stateBadge) {
            stateBadge.textContent = state;
            stateBadge.className = `mission-state-badge ${state}`;
        }

        if (meta) {
            meta.innerHTML = m ? [
                `<span class="mission-meta-chip">${ZONE_LABELS[m.targetType] || m.targetType}</span>`,
                `<span class="mission-meta-chip">Dificultad ${m.difficulty}</span>`,
                `<span class="mission-meta-chip">${m.targetKills} bajas</span>`,
            ].join('') : '';
        }

        if (rewards) {
            rewards.innerHTML = m && preview ? [
                `<span class="mission-reward-chip">+${preview.credits} CR</span>`,
                `<span class="mission-reward-chip">+${preview.xp} XP</span>`,
                `<span class="mission-reward-chip">${preview.label}</span>`,
            ].join('') : '';
            if (m?.lastReward && state === 'completada') {
                rewards.innerHTML += `<span class="mission-reward-chip">Ganado ${m.lastReward.credits} CR</span>`;
            }
        }

        if (progressWrap && progressFill && progressLabel && m) {
            const pct = m.targetKills > 0 ? (m.currentKills / m.targetKills) * 100 : 0;
            const showProgress = state === 'activa' || (state === 'completada' && m.currentKills > 0);
            progressWrap.hidden = !showProgress;
            progressFill.style.width = `${Math.min(100, pct)}%`;
            progressLabel.textContent = `${m.currentKills}/${m.targetKills}`;
        }

        if (state === 'bloqueada') {
            objective.textContent = 'Completa la misión anterior para desbloquear este contrato.';
        } else if (state === 'completada' && m?.storyComplete) {
            objective.textContent = m.storyComplete;
        } else if (state === 'activa') {
            objective.textContent = 'Misión en curso — destruye los objetivos en la zona indicada.';
        } else {
            objective.textContent = 'Acepta el contrato para marcar la zona en el mapa.';
        }

        if (state === 'disponible' && this.activeMissionIndex < 0) {
            acceptBtn.style.display = 'inline-block';
            acceptBtn.textContent = this._isMpGuest() ? 'Solo HOST' : 'Aceptar misión';
            acceptBtn.disabled = this._isMpGuest();
        } else if (state === 'activa') {
            acceptBtn.style.display = 'inline-block';
            acceptBtn.textContent = 'En curso';
            acceptBtn.disabled = true;
        } else if (state === 'completada') {
            acceptBtn.style.display = 'inline-block';
            acceptBtn.textContent = 'Completada ✓';
            acceptBtn.disabled = true;
        } else {
            acceptBtn.style.display = 'inline-block';
            acceptBtn.textContent = 'Bloqueada';
            acceptBtn.disabled = true;
        }

        if (navBtn) {
            navBtn.style.display = m?.targetZone ? 'inline-block' : 'none';
            navBtn.disabled = !m?.targetZone;
        }
    }
}
