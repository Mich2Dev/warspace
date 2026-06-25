export const CONFIG = {
    // Ajustes Visuales, Escalas y Tamaños de Selección (Círculos Rojos)
    VISUALS: {
        PLAYER_SCALE: 4.0, // Aumentado de 2.0 a 4.0 para que la nave sea mucho más visible
        PLAYER_ROTATION_Y: -Math.PI / 2,

        // Tamaños de Zona 1 (Los nuevos robots y su base)
        ZONA1_SCALE: 30.0, // Aumentado considerablemente
        ZONA1_RING_SIZE: 50,
        ZONA1_BOX_SIZE: 60,
        ZONA1_SPAWNER_RING: 60,
        ZONA1_SPAWNER_BOX: 150,
        ZONA1_BASE_SCALE: 10.0,

        // Tamaños de Zona 3 (Patrulla Móvil)
        ZONA3_SCALE: 12.0, // DUPLICADO (Antes 5) para que el Heavy Drone intimide
        ZONA3_RING_SIZE: 50,
        ZONA3_BOX_SIZE: 60,
        ZONA3_SPAWNER_RING: 80,
        ZONA3_SPAWNER_BOX: 200,
        ZONA3_BASE_SCALE: 5.0,

        // Tamaños de Bots Carroñeros (Zona 2)
        ZONA2_SCALE: 10.0,
        ZONA2_RING_SIZE: 40,
        ZONA2_BOX_SIZE: 50,
        ZONA2_SPAWNER_RING: 60,
        ZONA2_SPAWNER_BOX: 100,

        // Multiplicador de escala para las Colmenas (Spawners) en comparación a la nave normal
        SPAWNER_SCALE_MULTIPLIER: 1.5
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
        ZONA1_HP: 150,
        ZONA1_SPEED: 140, // Balanceado
        ZONA1_AGGRO_DIST: 1000,
        ZONA1_ATTACK_DIST: 400,
        ZONA1_FIRE_RATE: 1.5,
        ZONA1_DAMAGE: 12,

        // Enemigos Carroñeros (Zona 2) - Más rápidos pero frágiles
        ZONA2_LEVEL: 4,
        ZONA2_XP_DROP: 50,
        ZONA2_HP: 120,
        ZONA2_SPEED: 180, // Balanceado
        ZONA2_AGGRO_DIST: 1000, 
        ZONA2_ATTACK_DIST: 250,
        ZONA2_FIRE_RATE: 1.0,
        ZONA2_DAMAGE: 8,

        // Enemigos Escolta de Zona 3
        ZONA3_LEVEL: 6,
        ZONA3_XP_DROP: 100,
        ZONA3_HP: 180,
        ZONA3_SPEED: 250,
        ZONA3_AGGRO_DIST: 1200,
        ZONA3_ATTACK_DIST: 600,
        ZONA3_FIRE_RATE: 1.2,
        ZONA3_DAMAGE: 20
    },

    // ZONES: Zonas específicas para los Spawners en el Laberinto
    ZONES: {
        ZONA1: { x: -3000, z: 3000, radius: 2000 },
        ZONA2: { x: 3000, z: 0, radius: 2500 },
        ZONA3: { x: -4000, z: 0, radius: 2000 }
    },

    // Ajustes Visuales
    GRAPHICS: {
        BLOOM_INTENSITY: 0.6,
        BLOOM_THRESHOLD: 0.8,
        SUN_INTENSITY: 1.5,
        AMBIENT_INTENSITY: 1.2
    }
};
