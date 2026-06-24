export const CONFIG = {
    // Ajustes Visuales, Escalas y Tamaños de Selección (Círculos Rojos)
    VISUALS: {
        PLAYER_SCALE: 2.0,
        PLAYER_ROTATION_Y: -Math.PI / 2,

        // Tamaños de Drones (Los bichos pequeños y sus colmenas)
        DRONE_SCALE: 10.0,
        DRONE_RING_SIZE: 100,
        DRONE_BOX_SIZE: 150,
        DRONE_SPAWNER_RING: 150,
        DRONE_SPAWNER_BOX: 200,

        // Tamaños de Fighters (Las naves crucero y sus bases)
        FIGHTER_SCALE: 4.0,
        FIGHTER_RING_SIZE: 150,
        FIGHTER_BOX_SIZE: 200,
        FIGHTER_SPAWNER_RING: 200,
        FIGHTER_SPAWNER_BOX: 250,

        // Tamaños de Zona 1 (Los nuevos robots y su base)
        ZONA1_SCALE: 20.0,
        ZONA1_RING_SIZE: 60,
        ZONA1_BOX_SIZE: 60,
        ZONA1_SPAWNER_RING: 100,
        ZONA1_SPAWNER_BOX: 250,
        ZONA1_BASE_SCALE: 10.0,

        // Tamaños de Bots Carroñeros (Zona 2)
        ZONA2_SCALE: 6.0,
        ZONA2_RING_SIZE: 60,
        ZONA2_BOX_SIZE: 80,
        ZONA2_SPAWNER_RING: 100,
        ZONA2_SPAWNER_BOX: 150,

        // Tamaños de Jefes (Boss / Mothership)
        BOSS_SCALE: 5.0,
        BOSS_RING_SIZE: 250,
        BOSS_BOX_SIZE: 350,
        BOSS_SPAWNER_RING: 300,
        BOSS_SPAWNER_BOX: 400,

        // Multiplicador de escala para las Colmenas (Spawners) en comparación a la nave normal
        SPAWNER_SCALE_MULTIPLIER: 1.5,

        // Escala estática especial para la gran Colmena (Drone Spawner)
        COLMENA_SCALE: 20.0
    },

    // Estadísticas de Combate
    COMBAT: {
        PLAYER_MAX_HP: 1000,
        PLAYER_SPEED: 400,
        NITRO_SPEED_MULTIPLIER: 2.5,
        NITRO_ENERGY_COST: 15,

        // Drones (Melee / Exploradores)
        DRONE_HP: 100,
        DRONE_SPEED: 100,
        DRONE_AGGRO_DIST: 600,
        DRONE_ATTACK_DIST: 400,
        DRONE_FIRE_RATE: 2.5,
        DRONE_DAMAGE: 5,

        // Fighters (Cazas Rápidos)
        FIGHTER_HP: 200,
        FIGHTER_SPEED: 100,
        FIGHTER_AGGRO_DIST: 800,
        FIGHTER_ATTACK_DIST: 600,
        FIGHTER_FIRE_RATE: 1.5,
        FIGHTER_DAMAGE: 10,

        // Droides de Zona 1 (enemi1) - Agresivos y rapidos
        ZONA1_HP: 150,
        ZONA1_SPEED: 200,
        ZONA1_AGGRO_DIST: 1500,
        ZONA1_ATTACK_DIST: 400,
        ZONA1_FIRE_RATE: 1.5,
        ZONA1_DAMAGE: 12,

        // Enemigos Carroñeros (Zona 2) - Más rápidos pero frágiles
        ZONA2_HP: 120,
        ZONA2_SPEED: 220,
        ZONA2_AGGRO_DIST: 1000, 
        ZONA2_ATTACK_DIST: 400,
        ZONA2_FIRE_RATE: 1.2,
        ZONA2_DAMAGE: 8,

        // Boss (Olympic Carrier)
        BOSS_HP: 10000,
        BOSS_SPEED: 80,
        BOSS_AGGRO_DIST: 1500,
        BOSS_ATTACK_DIST: 1000,
        BOSS_FIRE_RATE: 1.0,
        BOSS_DAMAGE: 20
    },

    // ZONES: Zonas específicas para los Spawners en el Laberinto
    ZONES: {
        DRONE: { x: 4000, z: -4000, radius: 1500 },
        FIGHTER: { x: -5000, z: -5000, radius: 2000 },
        BOSS: { x: 0, z: -9000, radius: 3000 },
        ZONA1: { x: -4000, z: 4000, radius: 2000 }, // Nueva zona al Suroeste
        ZONA2: { x: 4000, z: 4000, radius: 2500 }   // Zona de Carroñeros al Sureste
    },

    // Ajustes Visuales
    GRAPHICS: {
        BLOOM_INTENSITY: 0.6,
        BLOOM_THRESHOLD: 0.8,
        SUN_INTENSITY: 1.5,
        AMBIENT_INTENSITY: 1.2
    }
};
