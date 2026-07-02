# World Accessibility — Capa L2 (Navegación)

> Parte del stack técnico. **Índice general:** [`LAYERS.md`](LAYERS.md)

**Estado:** activo · **Dueño:** Maiko + dev  
**Código espejo:** `src/worldNav.js`, `src/terrainRules.js`, `src/hubSafe.js`

---

## Problema que esto resuelve

1. **Muros invisibles** — terreno plano en minimapa pero bloqueo en juego (cordilleras divisorias).
2. **Mapa infinito** — cruzar el borde generaba terreno/chunks forever.
3. **Bots inaccesibles** — spawns/patrullas fuera del disco o atrapados en montañas.

---

## Capas del mundo

| Capa | Archivo | Qué define |
|------|---------|------------|
| Disco jugable | `worldNav.js` | Radio 11500, clamp jugador 97.5%, spawns 94% |
| Corredores | `worldNav.js` → `getNavCorridorSegments()` | Rutas verdes transitables (ancho 1150m) |
| Cuencas de zona | `config.js` ZONES | Áreas alrededor de colmenas Z1/Z2/Z3 |
| Muros divisorios | `Environment._getPartitionWallHeight` | Anillos r≈2300, 4700, 7100 + **frontera r≈11500** |
| Colisión gameplay | `terrainRules.js` | Independiente del visual — estable al retocar arte |

---

## Reglas INNEGOCIABLES (no romper en futuros cambios)

### Jugador
- Movimiento usa `resolveFullMove()` (terreno + borde).
- Nunca sale del disco `playableRadius × playerClampScale`.
- Clic minimapa → `resolveNavDestination()` (snap al corredor si hace falta).

### Bots / spawns
- Todo spawn pasa `isPlayerReachablePoint(env, x, z)`.
- Sin fallback sin validar en `_findSpawnNear`.
- Patrullas tren: waypoints en `data/patrol_squads.json` **dentro del disco** (audit en build).
- Líder y miembros de tren usan `resolveEnemyMove()` + `clampPointToDisc()`.

### Terreno / chunks
- Chunks fuera del disco no se generan (`isChunkInsideWorld`).
- Fuera del disco: altura escala a precipicio (no plano infinito).

### Minimapa (lectura)
- **Verde** = corredor seguro
- **Anillos marrones** = cordilleras divisorias (pueden bloquear)
- **Anillo naranja** = precipicio de frontera
- **Anillo cyan** = límite del sector jugable
- **Oscuro fuera del cyan** = no transitable

---

## Flujo de trabajo (sincronía dev)

| Modo | Qué hacer |
|------|-----------|
| **diseño** | Proponer waypoints/regions en JSON; validar con audit |
| **implementa** | Tocar `worldNav` / `terrainRules` solo si falta capacidad |
| **revisión** | Probar: volar borde, clic minimapa fuera, matar y seguir tren |

Antes de mover enemigos: ¿región vs tren vs colmena? ¿Pasa `validate-patrol-waypoints`?

---

## Checklist manual (5 min)

- [ ] Volar al anillo cyan → mensaje "FRONTERA DEL SECTOR", no mundo infinito
- [ ] Intentar cruzar cordillera sin corredor → mensaje cordillera + bloqueo
- [ ] Clic minimapa en zona oscura → destino ajustado al corredor
- [ ] Observar tren 2 min → columna en ruta, no dispersos ni fuera del mapa
- [ ] `npm run build` pasa audit de waypoints

---

## Archivos relacionados

- `data/patrol_squads.json` — rutas de tren (3 patrullas)
- `data/planet_01.json` — regiones (centers deben estar en disco)
- `.cursor/rules/world-navigation.mdc` — regla persistente para el agente IA
- `.cursor/rules/project-layers.mdc` — índice capas L0–L7
