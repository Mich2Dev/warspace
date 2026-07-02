# WarSpace — Mapa de sistemas (NC)

Documento corto para alinear **que es cada cosa** y **como se activa**. Actualizado con el flujo manual de eventos y perfil de piloto.

---

## 1) Capas del juego

| Capa | Que es | Tecla / UI | Archivo principal |
|------|--------|------------|-------------------|
| **Historia** | Misiones lineales del Cap. 1 (3 implementadas, 10 planeadas) | `J` Tablon de misiones | `MissionManager.js` |
| **Eventos** | Contratos opcionales (invasion, auxilio, mini-jefe) | `E` Centro de eventos | `EventBoard.js` + `EventDirector.js` |
| **Farm libre** | Sin mision ni evento activo — matar enemigos de zona | — | `EnemyManager.js` |
| **Economia** | Creditos, tienda, mejoras | `B` / `U` | `shop.js`, `upgrades.js` |
| **Perfil** | Piloto, rango, preferencias, stats locales | `P` Perfil | `profile.js` |

---

## 2) Reglas de activacion (importante)

### Misiones de historia
- **No arrancan solas.** Debes abrir `J` y pulsar **ACEPTAR MISION**.
- Progreso lineal: completas una → la siguiente queda **DISPONIBLE**.

### Eventos dinamicos
- **Nunca auto-inician.** El timer aleatorio anterior fue eliminado.
- Abre `E` → elige contrato → **ACEPTAR CONTRATO**.
- Tras completar o fallar: **cooldown** por tipo (2–4 min).
- **Radar de contratos** (perfil): aviso en pantalla cuando hay contrato listo; no lanza el evento.

### Perfil de piloto
- Guardado en `localStorage` (`warspace_pilot_profile_v1`).
- **Operador**: juego normal.
- **Comandante**: reservado para control ampliado (proximas funciones).
- **Desarrollo**: atajos `K` / `L` / `M` para probar eventos.

---

## 3) Catalogos de contenido

| Catalogo | Estado | Archivo |
|----------|--------|---------|
| 3 misiones main (Cap. 1) | En codigo | `MissionManager.js` |
| 10 main + 12 side (Cap. 1) | Solo diseno | `PHASE0_DESIGN_CLOSED.md` |
| 3 contratos de evento | En codigo | `eventCatalog.js` |

---

## 4) Roadmap inmediato (orden sugerido)

1. **Chapter 1 JSON** — sacar misiones/eventos del hardcode.
2. **Mas contratos de evento** ligados a misiones de historia (ej. mision 2 desbloquea invasion Beta).
3. **Persistencia completa** — campana, flags, reputacion.
4. **UI Comandante** — activar/forzar escaneos, panel de operaciones ampliado.
5. **Cuenta / servidor** — cuando haya backend; hoy solo perfil local.

---

## 5) Teclas rapidas

| Tecla | Accion |
|-------|--------|
| J | Misiones (historia) |
| E | Eventos (contratos) |
| P | Perfil de piloto |
| I | Inventario |
| H | Hangar |
| B / U | Tienda / Mejoras |
| O | Ajustes |
| K/L/M | Solo rol **dev** — prueba de eventos |

---

## 6) Documentos relacionados

- `GAME_DESIGN_MASTER_DOC.md` — vision macro NC.
- `PHASE0_DESIGN_CLOSED.md` — numeros de Cap. 1 (10+12 misiones).
- `PROJECT_TRACKER.md` — checklist de implementacion real.
