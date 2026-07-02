/** Re-export desde balance.js — una sola fuente de verdad. */
export {
    DIFFICULTY_MULT,
    sectorMultiplier,
    computeMissionCompletionReward,
    previewMissionReward,
    enemyThreatValue,
} from './balance.js';

export const ENEMY_TIER_CR = {
    ZONA1: 30,
    ZONA2: 60,
    ZONA3: 120,
    INVADER_ALPHA: 75,
    INVADER_BETA: 95,
    INVADER_GAMMA: 130,
};
