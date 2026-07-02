# Zona 3 — E3.glb (Comandante Pesado)

**Archivo:** `E3.glb`  
**Spawn type:** `Zona3`  
**Planeta:** 1 — región avanzada

## Comportamiento de combate

| Habilidad | Descripción |
|-----------|-------------|
| **Disparo normal** | Fuego de cañón sostenido en combate. |
| **Escudo energético** | Al entrar en combate activa escudo (~42 % HP extra). |

## Integración código

- Catálogo: `src/enemies/enemyModelCatalog.js` → diseño `E3`
- Comportamiento: `src/enemies/zoneBehaviors.js` → `ZONE_BEHAVIORS.Zona3`
- Escudo: `activateEnemyShield()` en `src/enemies/EnemyCombat.js`

## Notas diseño

Unidad más resistente. El escudo absorbe daño antes del casco; destruirlo es clave antes de focus fire.
