# WarSpace — Arquitectura del código

Mapa para entender **qué hace qué** y hacia dónde va el refactor.

> **Capas técnicas (L0–L7):** ver [`LAYERS.md`](LAYERS.md) — índice maestro.  
> **Navegación / mapa / bots:** ver [`WORLD_ACCESSIBILITY.md`](WORLD_ACCESSIBILITY.md).

## Flujo principal (1 frame)

```
game.js (Game)
  ├── Environment.update()     — terreno, agua, chunks (L1)
  ├── Player.update()          — movimiento, cámara, combate, UI
  ├── EnemyManager.update()    — IA, spawn, proyectiles enemigos
  ├── PatrolSquadManager       — trenes en formación V
  ├── WorldDirector            — patrullas regionales (bootstrap)
  ├── MissionManager / EventDirector / LootManager
  └── CombatSync (si MP)       — daño PvP autoritativo
```

**Entrada:** `main.js` → `new Game()` → loop `requestAnimationFrame`.

## Carpetas y responsabilidades

| Carpeta / archivo | Rol | ~Líneas |
|-------------------|-----|---------|
| `src/game.js` | Orquestador Three.js, input, modales | ~1000 |
| `src/Player.js` | Jugador (fachada + update loop) | ~970 |
| `src/player/` | Combate, economía, targeting, cámara | varios |
| `src/EnemyManager.js` | Mundo hostil, fachada + bind (capa L3) | ~100 |
| `src/enemies/` | Entidades, spawn, combate enemigo | varios |
| `src/Environment.js` | Terreno visual + altura (capa L1) | ~2000 |
| `src/worldNav.js` + `src/terrainRules.js` | Navegación y colisión gameplay (capa L2) | ~200 |
| `src/effects/VfxManager.js` | Partículas, ondas, luces 3D | 630 |
| `src/patrols/` | Trenes de patrulla (`patrol_squads.json`) | 330 |
| `src/ui/` | Modales DOM (`UiAnimator`, `gameModals`) | — |
| `src/multiplayer/` | WS, remotos, combate sync | varios |
| `data/` | Planetas, patrullas, loot, recetas | JSON |
| `config.js` + `balance.js` | Números de combate y zonas | — |

## Capas de diseño (GDD)

Ver `GAME_SYSTEMS_MAP.md`:

1. **Historia** — `MissionManager` (J)
2. **Eventos** — `EventDirector` + `EventBoard` (E)
3. **Farm** — `EnemyManager` + zonas
4. **Economía** — `shop.js`, `upgrades.js`, `craft.js`, `armory.js`
5. **Perfil** — `profile.js` (localStorage)

## Refactor (facade pattern)

Objetivo: archivos **300–500 líneas**, fachada estable.

### Hecho
- [x] `src/enemies/EnemyEntities.js` — `BaseEnemy`, `Spawner`, `MobileEnemy`
- [x] `src/player/` — split Player.js (Targeting, CameraNav, Economy, Combat)
- [x] `src/enemies/EnemySpawner.js` + `EnemyCombat.js` — split EnemyManager
- [x] `src/ui/UiAnimator.js` — modales unificados (armory, craft, upgrades, perfil, hangar)
- [x] Spawn patrulla relajado (`terrainRules.js`)
- [x] Nombres/visuales por rol (`enemyNames.js`, `enemyVisuals.js`)
- [x] Placeholder 5×5 → mesh procedural; fallback `patrol_base` procedural

### Pendiente
- [ ] `EnemySync.js` — ghosts MP, world_sync (extraer de EnemyManager)
- [ ] Reducir `game.js` (input + HUD en módulos)
- [ ] Asset real `public/models/patrols/patrol_base.glb` (Blender → ver `docs/ASSETS_3D.md`)
- [ ] anime.js opcional en `UiAnimator` si hace falta más motion design

## Reglas de convivencia

- **L1 vs L2:** `Environment.js` = visual; `terrainRules.js` + `worldNav.js` = gameplay estable. Ver [`LAYERS.md`](LAYERS.md). Si cambias altura/muros en L1, revisar L2 in-game.
- **Three.js** = lógica de juego; **DOM/CSS** = HUD y tiendas.
- Nuevos sistemas: carpeta propia + bind desde fachada, no archivos >800 líneas.
- Waypoints de patrulla: deben pasar `scripts/validate-patrol-waypoints.js` en build.
