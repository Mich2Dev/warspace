# Notas de sesión — Maiko + Cursor

Canal de **continuidad** entre sesiones de chat. Ya no hay otro agente en este repo: **Cursor es el único socio de desarrollo** en `jg - copia`.

---

## Para qué sirve

- Recordar decisiones recientes sin repetirlas en cada chat.
- Anotar qué capa/sistema se tocó (`docs/LAYERS.md`).
- Estado rápido antes de cerrar una sesión larga.

---

## Formato (opcional, al cerrar sesión)

```
## Cursor — YYYY-MM-DD
**Capa:** L2 / L3 / L4 …
**Archivos:** …
**Hecho:** 1-2 líneas
**Pendiente:** …
```

---

## Log

### Cursor — 2026-06-26 (continuidad)
**Capa:** L2 + L3 + docs  
**Archivos:** `worldNav.js`, `terrainRules.js`, `Environment.js`, `PatrolSquadManager.js`, `docs/LAYERS.md`, reglas `.cursor/rules/`  
**Hecho:** Navegación unificada, borde del mapa, spawns validados, índice de capas L0–L7, audits en build.  
**Pendiente:** Probar borde/corredores in-game; ampliar L3/L4 en LAYERS.md si hace falta.

---

*Antigravity ya no participa en este proyecto. Todo el código (incluido `Environment.js`) se trabaja aquí con Maiko.*
