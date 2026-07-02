# Zona 1 — E1.glb (Mantis de Asalto)

**Archivo:** `E1.glb`  
**Spawn type:** `Zona1`  
**Planeta:** 1 — región inicial

## Comportamiento de combate

| Habilidad | Descripción |
|-----------|-------------|
| **Disparo normal** | Cañón dual estándar; orbita al jugador y dispara al alinearse. |
| **Misil guiado** | Lanza misiles cada ~8.5 s si estás entre rango medio y ~2900 u. |

## Integración código

- Catálogo: `src/enemies/enemyModelCatalog.js` → diseño `E1`
- Comportamiento: `src/enemies/zoneBehaviors.js` → `ZONE_BEHAVIORS.Zona1`
- IA: `src/enemies/EnemyEntities.js` → `MobileEnemy.update()`

## Notas diseño

Unidad base del planeta 1. Patrullas de esta zona usan el mismo tipo pero con roles especiales (comandante / escolta).
