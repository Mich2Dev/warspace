# WarSpace — Capas técnicas (índice maestro)

**Para qué sirve:** cuando toques terreno, bots, combate o mapa, saber **qué capa es**, **qué archivos son la verdad**, y **qué no romper**.

**Regla de oro:** cambios visuales ≠ cambios de gameplay. Si cambias el relieve bonito, la capa de navegación (`terrainRules` + `worldNav`) debe seguir igual salvo que **decidas** cambiar gameplay.

---

## Mapa rápido (de abajo arriba)

```
┌─────────────────────────────────────────────────────────┐
│  L7  UI / DOM          index.html, style.css, modales │
├─────────────────────────────────────────────────────────┤
│  L6  Gameplay loop     game.js — orquesta todo/frame   │
├─────────────────────────────────────────────────────────┤
│  L5  Contenido         data/*.json, config.js, balance │
├─────────────────────────────────────────────────────────┤
│  L4  Sistemas juego    misiones, eventos, economía, MP │
├─────────────────────────────────────────────────────────┤
│  L3  Mundo hostil      enemigos, patrullas, spawners   │
├─────────────────────────────────────────────────────────┤
│  L2  Navegación ★      worldNav + terrainRules + hub   │
├─────────────────────────────────────────────────────────┤
│  L1  Terreno visual    Environment.js (altura, chunks) │
├─────────────────────────────────────────────────────────┤
│  L0  Render / VFX      Three.js, VfxManager, shaders   │
└─────────────────────────────────────────────────────────┘
         ★ = capa estable — leer antes de mover bots/mapas
```

**Dependencia crítica:** L1 (visual) alimenta L2 (colisión) vía `getHeightAt()` y `getPartitionWallHeight()`.  
Si cambias la forma de las montañas en L1, **revisar L2** in-game (bloqueo, corredores, spawns).

---

## L2 — Navegación y accesibilidad ★

> Detalle completo: [`WORLD_ACCESSIBILITY.md`](WORLD_ACCESSIBILITY.md)  
> Regla IA: `.cursor/rules/world-navigation.mdc`

| Qué responde | Archivo | Estable? |
|--------------|---------|----------|
| ¿Dónde termina el mapa? | `src/worldNav.js` → `WORLD_MAP` | Sí |
| ¿Qué rutas son transitables? | `src/worldNav.js` → `getNavCorridorSegments()` | Sí |
| ¿Puede el jugador/bot estar aquí? | `worldNav.isPlayerReachablePoint()` | Sí |
| ¿El movimiento se bloquea? | `src/terrainRules.js` → `resolveFullMove()` | Sí |
| Hub seguro (no combate) | `src/hubSafe.js` | Sí |
| Rutas de tren | `data/patrol_squads.json` + audit build | Sí |

### Flujo de movimiento (jugador)

```
Player.update()
  → resolveFullMove(env, from, to, flightY)     // terrainRules.js
       ├─ resolveTerrainMove()                  // muros, cordilleras, corredores
       └─ clampPointToDisc()                    // borde del sector
  → clampPointToDisc()                          // red de seguridad
```

### Flujo de spawn (bot)

```
coordenada deseada
  → clampPointToDisc / snapToNavPoint           // worldNav.js
  → isPlayerReachablePoint / isAccessibleSpawnPoint
  → resolveEnemyMove() en patrullas             // terrainRules.js
```

### Qué puedes cambiar sin romper gameplay

| Cambio | Capa | Riesgo |
|--------|------|--------|
| Color del terreno, hierba, cielo | L1 | Bajo |
| Altura visual de una colina | L1 | Medio — revisar si L2 sigue bloqueando bien |
| Ancho de corredor jugable | L2 | Alto — tocar `NAV_CORRIDOR_WIDTH` en worldNav **y** terrainRules |
| Waypoint de patrulla | L5 + L2 | Alto — debe pasar `validate-patrol-waypoints.js` |
| Radio del disco jugable | L2 | Alto — minimapa, chunks, muro, spawns |

### Audits automáticos (build)

- `scripts/validate-patrol-waypoints.js` — waypoints dentro del disco
- `scripts/audit-*-bindings.js` — métodos del Player/EnemyManager

---

## L1 — Terreno visual

| Qué | Archivo | Notas |
|-----|---------|-------|
| Altura procedural | `Environment.getHeightAt()` | Capa L1 |
| Muros divisorios (altura) | `Environment._getPartitionWallHeight()` | Compartido con L2 |
| Chunks, LOD, minimapa bake | `Environment.js` | Capa L1 — mismo repo, revisar L2 al cambiar |
| Corredores planos (visual) | `Environment.isCorridorAt()` → usa `worldNav` | L1 lee L2 |

**Contrato con L2:** L2 llama `env.getHeightAt(x,z)` y `env.getPartitionWallHeight(x,z)`.  
No duplicar lógica de “¿bloquea?” en Environment — eso vive en `terrainRules.js`.

**Chunks:** solo se generan dentro del disco (`isChunkInsideWorld` en worldNav).

---

## L3 — Mundo hostil (enemigos y patrullas)

| Qué | Archivo |
|-----|---------|
| Orquestador | `src/EnemyManager.js` (fachada) |
| Spawn / validación | `src/enemies/EnemySpawner.js` |
| Combate enemigo | `src/enemies/EnemyCombat.js` |
| IA movimiento | `src/enemies/EnemyEntities.js` |
| Trenes patrulla | `src/patrols/PatrolSquadManager.js` |
| Población regional | `src/WorldDirector.js` |
| Roles / aggro | `src/enemyRoles.js` |

**Regla:** todo spawn pasa L2. Patrullas tren **no** saltan colisión (`resolveEnemyMove`).

**Datos:** `data/patrol_squads.json`, `data/planet_01.json`, `config.js` ZONES.

---

## L4 — Sistemas de juego (gameplay)

Capa de **reglas de negocio** — no geometría.

| Sistema | Archivos | Activación |
|---------|----------|------------|
| Historia | `MissionManager.js` | `J` — manual |
| Eventos | `EventDirector.js`, `EventBoard.js`, `eventCatalog.js` | `E` — manual |
| Economía | `shop.js`, `upgrades.js`, `craft.js`, `balance.js` | `B`/`U` |
| Loot | `LootManager.js`, `itemCatalog.js` | drops |
| Perfil | `profile.js` | `P` — localStorage |

Ver también: [`GAME_SYSTEMS_MAP.md`](GAME_SYSTEMS_MAP.md) (capa de diseño / teclas).

---

## L5 — Contenido (datos)

| Archivo | Qué define | Validar con |
|---------|------------|-------------|
| `config.js` | Zonas, combate, visuals | balance.js |
| `data/planet_01.json` | Regiones, hub | worldNav (centers en disco) |
| `data/patrol_squads.json` | Rutas tren | validate-patrol-waypoints |
| `data/*.json` | Loot, recetas, etc. | según sistema |

**Modo diseño:** editar JSON + doc. **Modo implementa:** código solo si falta capacidad en L3/L4.

---

## L6 — Game loop

| Qué | Archivo |
|-----|---------|
| Orquestador | `src/game.js` |
| Entrada | `main.js` |

Orden por frame (simplificado):

```
Environment.update → Player.update → EnemyManager.update
  → PatrolSquads → VFX → CombatSync → EventDirector → HUD
```

---

## L7 — UI / DOM

| Qué | Dónde |
|-----|-------|
| HUD, minimapa | `index.html`, `style.css` |
| Modales | `src/ui/`, `armory.js`, `hangar.js`, … |
| Minimapa clic | `game.js` → `resolveNavDestination()` (L2) |

Three.js = mundo 3D. DOM = paneles y HUD.

---

## L0 — Render y VFX

| Qué | Archivo |
|-----|---------|
| Renderer, bloom | `game.js` |
| Partículas combate | `src/effects/VfxManager.js` |
| Presets gráficos | `src/graphicsQuality.js`, `perfBudget.js` |
| Carga combate | `src/combatLoad.js` |

No afecta L2 salvo FPS throttling que reduce updates.

---

## Multiplayer (cross-cutting)

| Qué | Carpeta |
|-----|---------|
| Sala / sync | `src/multiplayer/RoomSync.js` |
| Combate PvP | `src/multiplayer/CombatSync.js` |
| Jugadores remotos | `src/multiplayer/RemotePlayers.js` |
| Mundo host | `src/enemies/EnemyManagerMultiplayer.js` |

Host simula L3; guest ve ghosts. Spawns solo en host.

---

## Matriz: si cambias X, revisa Y

| Tocas… | Revisa también… |
|--------|------------------|
| `Environment.getHeightAt` | `terrainRules.js`, feel de bloqueo in-game |
| `_getPartitionWallHeight` | Minimapa (anillos marrones), `terrainRules` |
| `worldNav.js` corredores | Minimapa verde, patrullas, `patrol_squads.json` |
| `config.js` ZONES | worldNav segments, spawners, planet_01 |
| `patrol_squads.json` | `npm run build` (audit waypoints) |
| `EnemySpawner` | L2 validación, no fallback sin snap |
| Cambias shaders / relieve en L1 | `terrainRules.js`, feel in-game, minimapa |

---

## Modos de trabajo (Comandante ↔ IA)

| Modo | Acción |
|------|--------|
| **diseño** | JSON + docs. No spawns automáticos en código. |
| **implementa** | Código tras diseño. Leer capa afectada en este doc. |
| **revisión** | Checklist en WORLD_ACCESSIBILITY + probar in-game. |

---

## Documentos del ecosistema

| Doc | Rol |
|-----|-----|
| **LAYERS.md** (este) | Índice de capas técnicas |
| **WORLD_ACCESSIBILITY.md** | Profundidad L2 navegación |
| **GAME_SYSTEMS_MAP.md** | Capas de gameplay / teclas |
| **ARCHITECTURE.md** | Flujo código + refactor |
| **PROJECT_TRACKER.md** | Qué está hecho / pendiente |
| **md.comunicacion.md** | Notas de sesión Maiko + Cursor |
| `.cursor/rules/*.mdc` | Reglas persistentes para IA |

---

## Checklist antes de un PR / sesión grande

- [ ] ¿Qué capa (L0–L7) toco?
- [ ] Si L1 → ¿L2 sigue correcta?
- [ ] Si bots/mapas → ¿pasa audit de waypoints?
- [ ] Si contenido → ¿JSON alineado con worldNav?
- [ ] Nota en `md.comunicacion.md` si toco L1 compartido
