# Zona 2 — E2.glb (Carroñero Elite)

**Archivo:** `E2.glb`  
**Spawn type:** `Zona2`  
**Planeta:** 1 — región intermedia

## Comportamiento de combate

| Habilidad | Descripción |
|-----------|-------------|
| **Disparo normal** | Igual que E1 tras la embestida. |
| **Correr duro (hard charge)** | Al detectarte (< ~980 u) embiste hacia ti a ~2.45× velocidad durante ~3 s. |

### Detalle de la carga

- Animación: inclinación de proa + estela de propulsores (`chargeTrail` / `chargeBurst` en VFX).
- Al acercarse (< ~200 u) frena y vuelve a orbitar/disparar.
- Cooldown ~5.5 s entre cargas.

## Integración código

- Catálogo: `src/enemies/enemyModelCatalog.js` → diseño `E2`
- Comportamiento: `src/enemies/zoneBehaviors.js` → `ZONE_BEHAVIORS.Zona2`
- IA carga: `tickZoneCombat()` + rama `zoneCombat.charging` en `EnemyEntities.js`
