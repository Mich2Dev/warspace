# WarSpace - Project Tracker

Estado de referencia para no perder lineas de trabajo.

## 1) Implementado en codigo

- [x] UI visual unificada (HUD, paneles, modales, action bar, minimapa).
- [x] Panel de Settings lateral animado (tecla `O`).
- [x] FPS counter toggle.
- [x] Presets de layout (`classic`, `compact`, `cinematic`).
- [x] Animaciones open/close para modales.
- [x] Economia base: creditos por kill.
- [x] Kill streak con multiplicador y feedback visual.
- [x] Tienda de upgrades (tecla `U`).
- [x] Evento dinamico inicial: invasion por oleadas.
- [x] Eventos manuales via Centro de Eventos (E) — sin auto-invasion.
- [x] Perfil de piloto local (P) con rol, stats y preferencias.
- [x] Mapa de sistemas: `GAME_SYSTEMS_MAP.md`.
- [x] Invasion separada de zonas: linea `Invader_*` (Alpha/Beta/Gamma) con tipos/stats propios.
- [x] Minimap con boton de maximizar y escala dinamica.

## 2) Documentado pero NO terminado

- [ ] Framework de campana data-driven por temporadas.
- [ ] Chapter 1 Production Pack (JSON de campana/misiones/eventos/flags).
- [ ] Eventos adicionales: distress signal y mini-boss event dedicado.
- [ ] Persistencia de progreso completa (campana, reputacion, economia, decisiones).
- [ ] Planetas/sectores nuevos con contenido propio.
- [ ] Arcos secundarios por faccion.
- [ ] Contratos procedurales robustos.
- [ ] Pipeline de assets GLB finales para invaders en `public/models/events/invasion/`.

## 3) Definicion de prioridad sugerida

1. Campana base (`Chapter 1 Production Pack`)  
2. MissionManager narrativo por fases + flags  
3. Distress + mini-boss events  
4. Persistencia de estado  
5. Planeta/Sector 2

## 4) Documentos actuales

- **`LAYERS.md`** -> **índice maestro capas técnicas L0–L7** (leer primero).
- **`WORLD_ACCESSIBILITY.md`** -> capa L2 navegación (mapa, corredores, bots).
- `GAME_DESIGN_MASTER_DOC.md` -> vision macro y roadmap.
- `GAME_SYSTEMS_MAP.md` -> capas gameplay / teclas.
- `ARCHITECTURE.md` -> flujo codigo y refactor.
- `.cursor/rules/project-layers.mdc` + `world-navigation.mdc` -> reglas IA persistentes.

## 5) Sincronía de desarrollo (acordado)

| Modo | Significado |
|------|-------------|
| **diseño** | JSON/reglas/docs — no implementar spawns automáticos |
| **implementa** | Código tras diseño cerrado |
| **revisión** | Checklist en WORLD_ACCESSIBILITY.md |

Antes de enemigos/terreno: leer `WORLD_ACCESSIBILITY.md`. Build incluye `validate-patrol-waypoints.js`.

