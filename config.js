export const CONFIG = {
    // Ajustes Visuales, Escalas y Tamaños de Selección (Círculos Rojos)
    VISUALS: {
        /** Naves jugador — heredado por todos los cascos (playerShipVisuals.js). */
        PLAYER_SHIP: {
            targetLength: 118,
            shieldBase: 3.2,
            rotationY: 0,
            fallbackScaleMul: 0.42,
        },
        PLAYER_SCALE: 4.8,
        PLAYER_ROTATION_Y: -Math.PI / 2,

        // E1 ligeros pero visibles; progresión suave E1 < E2 < E3
        ZONA1_SCALE: 24.0, // Aumentado
        ZONA1_RING_SIZE: 56,
        ZONA1_BOX_SIZE: 68,
        ZONA1_SPAWNER_RING: 58,
        ZONA1_SPAWNER_BOX: 135,
        ZONA1_BASE_SCALE: 11.0,

        ZONA3_SCALE: 21.0, // Aumentado
        ZONA3_RING_SIZE: 60,
        ZONA3_BOX_SIZE: 74,
        ZONA3_SPAWNER_RING: 74,
        ZONA3_SPAWNER_BOX: 178,
        ZONA3_BASE_SCALE: 12.0,

        ZONA2_SCALE: 18.0, // Aumentado
        ZONA2_RING_SIZE: 56,
        ZONA2_BOX_SIZE: 68,
        ZONA2_SPAWNER_RING: 60,
        ZONA2_SPAWNER_BOX: 115,

        BOSS_SCALE: 250.0,
        BOSS_RING_SIZE: 300,
        BOSS_BOX_SIZE: 450,

        SPAWNER_SCALE_MULTIPLIER: 1.35,

        /** Yerba — densidad global (hereda todos los chunks). Ajustes → Calidad también modifica. */
        GRASS: {
            carpetPoints: 24000,
            maxPerChunk: 14000,
            bladeWidth: 6.5,
            bladeHeight: 15,
        },
    },

    // Estadísticas de Combate
    COMBAT: {
        PLAYER_BASE_HP: 200,
        PLAYER_BASE_DAMAGE: 5,
        PLAYER_SPEED: 400,
        PLAYER_ATTACK_DIST: 2500, // Rango de disparo mucho más corto
        NITRO_SPEED_MULTIPLIER: 5.0,
        NITRO_ENERGY_COST: 15,

        // Droides de Zona 1 (E1) - Agresivos y rapidos
        ZONA1_LEVEL: 2,
        ZONA1_XP_DROP: 20,
        ZONA1_CR_DROP: 30,
        ZONA1_HP: 150,
        ZONA1_SPEED: 140, // Balanceado
        ZONA1_AGGRO_DIST: 920,
        ZONA1_ATTACK_DIST: 340,
        ZONA1_FIRE_RATE: 1.5,
        ZONA1_DAMAGE: 12,

        // Enemigos Carroñeros (Zona 2) - Más rápidos pero frágiles
        ZONA2_LEVEL: 4,
        ZONA2_XP_DROP: 50,
        ZONA2_CR_DROP: 60,
        ZONA2_HP: 120,
        ZONA2_SPEED: 180, // Balanceado
        ZONA2_AGGRO_DIST: 880,
        ZONA2_ATTACK_DIST: 320,
        ZONA2_FIRE_RATE: 1.0,
        ZONA2_DAMAGE: 8,

        // Enemigos Escolta de Zona 3
        ZONA3_LEVEL: 6,
        ZONA3_XP_DROP: 100,
        ZONA3_CR_DROP: 120,
        ZONA3_HP: 180,
        ZONA3_SPEED: 250,
        ZONA3_AGGRO_DIST: 980,
        ZONA3_ATTACK_DIST: 380,
        ZONA3_FIRE_RATE: 1.2,
        ZONA3_DAMAGE: 20,

        // World Boss
        BOSS_LEVEL: 10,
        BOSS_XP_DROP: 5000,
        BOSS_CR_DROP: 8000,
        BOSS_HP: 10000,
        BOSS_SPEED: 180,
        BOSS_AGGRO_DIST: 3500,
        BOSS_ATTACK_DIST: 800,
        BOSS_FIRE_RATE: 2.0,
        BOSS_DAMAGE: 45,

        // Invasion Event Line (separate from zone enemies)
        INVADER_ALPHA_LEVEL: 5,
        INVADER_ALPHA_XP_DROP: 45,
        INVADER_ALPHA_CR_DROP: 75,
        INVADER_ALPHA_HP: 185,
        INVADER_ALPHA_SPEED: 205,
        INVADER_ALPHA_AGGRO_DIST: 1500,
        INVADER_ALPHA_ATTACK_DIST: 520,
        INVADER_ALPHA_FIRE_RATE: 1.1,
        INVADER_ALPHA_DAMAGE: 18,

        INVADER_BETA_LEVEL: 6,
        INVADER_BETA_XP_DROP: 60,
        INVADER_BETA_CR_DROP: 95,
        INVADER_BETA_HP: 220,
        INVADER_BETA_SPEED: 235,
        INVADER_BETA_AGGRO_DIST: 1600,
        INVADER_BETA_ATTACK_DIST: 560,
        INVADER_BETA_FIRE_RATE: 1.0,
        INVADER_BETA_DAMAGE: 21,

        INVADER_GAMMA_LEVEL: 7,
        INVADER_GAMMA_XP_DROP: 85,
        INVADER_GAMMA_CR_DROP: 130,
        INVADER_GAMMA_HP: 290,
        INVADER_GAMMA_SPEED: 260,
        INVADER_GAMMA_AGGRO_DIST: 1700,
        INVADER_GAMMA_ATTACK_DIST: 650,
        INVADER_GAMMA_FIRE_RATE: 0.9,
        INVADER_GAMMA_DAMAGE: 28
    },

    // ZONES: Bases de colmena — sincronizadas con data/planet_01.json (syncSpawnerZonesFromPlanet)
    ZONES: {
        ZONA1: { x: -4200, z: 9600, radius: 3400, regionId: 'north_mantis' },
        ZONA2: { x: 9800, z: 600, radius: 3600, regionId: 'east_scavenger' },
        ZONA3: { x: -9800, z: -600, radius: 3500, regionId: 'west_command' }
    },

    // Ajustes Visuales
    GRAPHICS: {
        BLOOM_INTENSITY: 0.38,
        BLOOM_THRESHOLD: 0.9,
        SUN_INTENSITY: 1.38,
        AMBIENT_INTENSITY: 0.58,
        ENABLE_SHADOWS: false
    }
};
