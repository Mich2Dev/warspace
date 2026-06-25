import { CONFIG } from '../config.js';

export class MissionManager {
    constructor(player, enemyManager) {
        this.player = player;
        this.enemyManager = enemyManager;
        
        this.currentSector = 1;
        this.activeMissionIndex = 0;
        
        this.missions = [
            {
                id: 'tutorial_zona1',
                title: 'Asalto a la Zona 1',
                objective: 'Destruye 3 Assault Mantis (E1) en la Zona 1.',
                targetKills: 3,
                currentKills: 0,
                targetType: 'Zona1',
                targetZone: CONFIG.ZONES.ZONA1,
                onStart: () => {
                    this.playTransmission('Aegis Command', 'Piloto, el radar indica actividad hostil al noroeste. Dirígete a la Zona 1 (Puntos Rojos) y elimina las defensas exteriores.', '#ff0000');
                },
                onComplete: () => {
                    this.playTransmission('Aegis Command', 'Buen trabajo limpiando la Zona 1. Sigue las nuevas coordenadas hacia la Zona 2.', '#00ffcc');
                    this.nextMission();
                }
            },
            {
                id: 'scavenger_hunt',
                title: 'Nido de Carroñeros',
                objective: 'Destruye 5 Scavenger Elite (E2) en la Zona 2.',
                targetKills: 5,
                currentKills: 0,
                targetType: 'Zona2',   // tipo interno de los Scavengers
                targetZone: CONFIG.ZONES.ZONA2,
                onStart: () => {
                    setTimeout(() => {
                        this.playTransmission('Iron Legion', 'ADVERTENCIA: INTRUSO DETECTADO. ENVIANDO TROPAS AZULES.', '#00aaff');
                    }, 3000);
                },
                onComplete: () => {
                    this.playTransmission('Aegis Command', 'Estás llamando mucha la atención. El Comandante de la Zona 3 se dirige hacia ti.', '#00ffcc');
                    this.nextMission();
                }
            },
            {
                id: 'heavy_patrol',
                title: 'Fuerza Letal',
                objective: 'Destruye 2 Heavy Commanders (E3) en la Zona 3.',
                targetKills: 2,
                currentKills: 0,
                targetType: 'Zona3',   // tipo interno de Heavy Patrol
                targetZone: CONFIG.ZONES.ZONA3,
                onStart: () => {
                    this.playTransmission('Aegis Command', 'Dirígete a la Zona 3 (Morado). Ten cuidado, los Comandantes son letales.', '#aa00ff');
                },
                onComplete: () => {
                    this.playTransmission('Aegis Command', '¡Increíble! Has asegurado todas las Zonas. El sector está limpio.', '#00ffcc');
                }
            }
        ];

        this.updateUI();
        // Start first mission
        setTimeout(() => this.startCurrentMission(), 2000);
    }

    startCurrentMission() {
        if (this.activeMissionIndex < this.missions.length) {
            const m = this.missions[this.activeMissionIndex];
            document.getElementById('mission-panel').style.display = 'block';
            if (m.onStart) m.onStart();
            this.updateUI();
        }
    }

    nextMission() {
        this.activeMissionIndex++;
        if (this.activeMissionIndex < this.missions.length) {
            setTimeout(() => this.startCurrentMission(), 3000);
        }
    }

    onEnemyKilled(enemyType, enemyName) {
        if (this.activeMissionIndex >= this.missions.length) return;
        
        const m = this.missions[this.activeMissionIndex];
        const type = (enemyType || '').toLowerCase();
        const name = (enemyName || '').toLowerCase();
        const target = (m.targetType || '').toLowerCase();

        // Coincide si el tipo interno o el nombre del enemigo contiene el tipo objetivo
        const match = type.includes(target) || name.includes(target) ||
                      target.includes(type) || target === 'boss' && type === 'boss';
        
        if (match) {
            m.currentKills++;
            this.updateUI();
            
            if (m.currentKills >= m.targetKills) {
                if (m.onComplete) m.onComplete();
            }
        }
    }

    updateUI() {
        if (this.activeMissionIndex >= this.missions.length) return;
        
        const m = this.missions[this.activeMissionIndex];
        document.getElementById('mission-title').innerText = m.title;
        document.getElementById('mission-objective').innerText = `${m.objective} (${m.currentKills}/${m.targetKills})`;
        
        // Actualizar Minimapa Waypoint
        const waypoint = document.getElementById('minimap-waypoint');
        if (waypoint && m.targetZone) {
            waypoint.style.display = 'block';
            const pX = (m.targetZone.x + 12000) / 24000 * 200;
            const pZ = (m.targetZone.z + 12000) / 24000 * 200;
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
        
        nameEl.innerText = name;
        nameEl.style.color = color;
        panel.style.borderTop = `1px solid ${color}`;
        panel.style.borderBottom = `1px solid ${color}`;
        document.getElementById('transmission-avatar').style.borderColor = color;
        
        panel.style.display = 'flex';
        
        // Typewriter effect
        textEl.textContent = '';
        let i = 0;
        const speed = 40; // ms per char
        
        if (this.typeWriterInterval) clearInterval(this.typeWriterInterval);
        
        this.typeWriterInterval = setInterval(() => {
            if (i < text.length) {
                textEl.textContent += text.charAt(i);
                i++;
            } else {
                clearInterval(this.typeWriterInterval);
                // Hide after 5 seconds
                setTimeout(() => {
                    panel.style.display = 'none';
                }, 5000);
            }
        }, speed);
    }

    jumpToNextSector() {
        this.currentSector++;
        this.activeMissionIndex = 0;
        
        // Aumentar dificultad global en CONFIG
        CONFIG.COMBAT.ZONA1_HP = Math.floor(CONFIG.COMBAT.ZONA1_HP * 1.5);
        CONFIG.COMBAT.ZONA2_HP = Math.floor(CONFIG.COMBAT.ZONA2_HP * 1.5);
        CONFIG.COMBAT.ZONA3_HP = Math.floor(CONFIG.COMBAT.ZONA3_HP * 1.5);
        CONFIG.COMBAT.BOSS_HP = Math.floor(CONFIG.COMBAT.BOSS_HP * 1.5);
        
        // Resetear kills de misiones
        this.missions.forEach(m => m.currentKills = 0);
        
        // Efecto visual de salto
        const ui = document.getElementById('ui');
        ui.style.transition = 'box-shadow 0.1s, background-color 0.5s';
        ui.style.backgroundColor = 'white';
        
        setTimeout(() => {
            ui.style.transition = 'background-color 2s';
            ui.style.backgroundColor = 'transparent';
            
            // Reaparecer al jugador en inicio
            this.player.position.set(0, 50, 4000);
            this.player.hp = this.player.maxHp;
            this.player.updateUI();
            
            this.playTransmission('Aegis Command', `Salto completado. Bienvenido al Sector ${this.currentSector}. La Legión aquí es mucho más fuerte.`, '#aa00ff');
            this.startCurrentMission();
            
            // Opcional: Curar a los enemigos o respawnear
        }, 1000);
    }
}
