# WarSpace - Fase 0 (Diseno Cerrado)

Estado: aprobado para implementacion  
Objetivo: convertir creditos en progresion real, con compra, equipamiento, builds y continuidad.

---

## 1) Resultado esperado de Fase 0

Al terminar esta fase, el jugador debe poder:
- Ganar creditos por varias actividades.
- Comprar componentes y naves nuevas.
- Equipar build y notar cambio real en combate/movilidad/supervivencia.
- Gastar moneda continuamente (sin dinero muerto).
- Ver ruta clara de progreso corto, medio y largo plazo.

---

## 2) Economia cerrada (fuentes y sinks)

## 2.1 Fuentes de credito
- Kill normal: 25-130 CR (segun tipo).
- Cadena de kills (streak): multiplicador x1.0 a x3.0.
- Evento Invasion completado: +650 CR.
- Distress Signal completado: +450 CR base (+bonus por tiempo restante).
- Mini-boss eliminado: +1200 CR.
- Main mission: 600-1800 CR.
- Side mission: 250-900 CR.
- Exploracion POI raro: 100-400 CR.

## 2.2 Sinks de credito
- Compra de componentes.
- Compra de naves.
- Mejoras de rareza (bench).
- Re-roll de stats.
- Reparacion premium (opcional, no paywall).
- Consumo tactico de combate (kits EMP, drones temporales, etc).

## 2.3 Regla anti-inflacion
- Todo ingreso mayor a +1000 CR debe habilitar un sink relevante en el mismo tier.
- Objetivo de gasto por hora (midgame): 1400-2200 CR/h.

---

## 3) Inventario y equipamiento

## 3.1 Slots
- Weapon
- Missile
- Shield
- Engine
- Hull
- Tactical Module

## 3.2 Rarezas
- Common
- Uncommon
- Rare
- Epic
- Legendary

Regla:
- Rareza sube stats base + habilita perks secundarios.
- No permitir perk roto por rareza baja.

## 3.3 Escalado por item level
- ItemLevel 1-10 (temporada 1).
- Formula base:
  - `FinalStat = BaseStat * (1 + 0.07 * (ItemLevel-1)) * RareMultiplier`
- Multiplicador rareza:
  - Common: 1.00
  - Uncommon: 1.08
  - Rare: 1.18
  - Epic: 1.32
  - Legendary: 1.50

---

## 4) Line-up de naves (temporada 1)

## 4.1 Nave inicial (ya existente)
- Aegis Shock
- Rol: balanceada.

## 4.2 Nuevas naves

### 1) Raptor Interceptor
- Rol: movilidad / precision.
- Rasgos:
  - +22% velocidad base
  - +15% fire rate
  - -18% HP max
- Precio: 3200 CR.

### 2) Bastion Juggernaut
- Rol: tanque / primera linea.
- Rasgos:
  - +42% HP max
  - +20% resistencia a dano directo
  - -16% velocidad
- Precio: 4600 CR.

### 3) Helix Artillery
- Rol: burst / control de zona.
- Rasgos:
  - +28% dano de arma principal
  - +24% dano de misil
  - +10% cooldown general
- Precio: 5200 CR.

### 4) Null Specter
- Rol: tactica / utility.
- Rasgos:
  - +35% eficiencia energia
  - +20% duracion de habilidades
  - -10% dano base
- Precio: 6000 CR.

---

## 5) Componentes - catalogo inicial

Meta minima de contenido:
- 6 armas
- 5 misiles
- 5 escudos
- 5 motores
- 5 cascos
- 4 tacticos

Total inicial: 30 items.

## 5.1 Ejemplos cerrados (balance inicial)

Weapon:
- Ion Carbine: dano medio, coste energia bajo.
- Rail Lance: dano alto, cadencia baja.
- Plasma Scatter: dano en cono, corto alcance.

Missile:
- Hunter Mk1: tracking estable.
- Cluster Hive: dano de area.
- EMP Dart: dano bajo, deshabilita breve.

Shield:
- Aegis Bubble: escudo estable.
- Reflective Prism: reflect parcial.
- Surge Barrier: burst corto fuerte.

Engine:
- Vector Thrusters: movilidad general.
- Blink Drive: dash corto.
- Nitro Core: mejor aceleracion.

Hull:
- Titan Plating: HP bruto.
- Reactive Shell: reduccion vs rafagas.
- Capacitor Hull: energia maxima.

Tactical:
- Combat Drone
- EMP Pulse
- Overcharge
- Decoy Beacon

---

## 6) Tienda y flujo de compra

## 6.1 Tiendas
- Hub Shop (siempre disponible): tier bajo/medio.
- Specialist Vendor (rotativo): items raros.
- Black Market (alto riesgo): stats altos con trade-off.

## 6.2 UX minima
- Comprar / vender / equipar en misma interfaz.
- Comparador de stats (actual vs candidato).
- Alertas de incompatibilidad de build.

## 6.3 Requisitos
- Tecla dedicada para mercado desde hub.
- Integracion con creditos actuales y persistencia.

---

## 7) Banco de mejoras (Upgrade Bench)

## 7.1 Funciones
- Upgrade rarity (consume CR + materiales).
- Re-roll de stat secundario.
- Fusion de 2 items para subir item level.

## 7.2 Costos base
- Upgrade rarity:
  - Common->Uncommon: 350 CR
  - Uncommon->Rare: 750 CR
  - Rare->Epic: 1600 CR
  - Epic->Legendary: 3200 CR

- Re-roll:
  - Item low tier: 120 CR
  - mid tier: 280 CR
  - high tier: 650 CR

---

## 8) Habilidades activas/pasivas

## 8.1 Activas (4 iniciales)
- Dash Quantum (movilidad defensiva)
- Drone Support (dps/utility)
- EMP Burst (control)
- Weapon Overcharge (burst ofensivo)

## 8.2 Pasivas (6 iniciales)
- Energy Efficiency
- Critical Targeting
- Reinforced Hull
- Missile Specialist
- Cooldown Optimizer
- Salvage Expert (+loot/CR)

Regla:
- 1 activa equipada + 2 pasivas equipadas al inicio.
- Desbloqueo de slots extra en progreso.

---

## 9) Eventos A (obligatorio en esta etapa)

## 9.1 Distress Signal
- Evento de rescate con tiempo limite.
- Fases:
  1. Detectar y viajar.
  2. Defender objetivo.
  3. Extraer o escoltar.
- Recompensa:
  - CR base + bonus por tiempo restante.
  - Probabilidad de drop de componente.

## 9.2 Mini-boss Event
- Spawn unico por sector con aviso global.
- Mecanica especial (escudo por fases / invulnerabilidad por nodos / etc).
- Recompensa:
  - CR alto.
  - 1 drop garantizado de rareza >= Rare.

---

## 10) Narrativa B (entrega de datos)

Se entrega `Chapter 1 Production Pack`:
- `data/campaign/chapter1.json`
- `data/missions/main_ch1/*.json`
- `data/missions/side_ch1/*.json`
- `data/events/event_tables_ch1.json`
- `data/state_flags_schema.json`

Minimo de contenido:
- Main: 10 misiones.
- Side: 12 misiones.
- Flags de decision: 8+.

---

## 11) Persistencia

Guardar:
- creditos
- nave actual
- inventario
- equipamiento activo
- upgrades comprados
- progreso de campana
- reputacion de facciones
- flags narrativas

Versionado:
- `save_version` obligatorio para migraciones futuras.

---

## 12) Criterios de aprobacion (gate)

Fase 0 se considera terminada solo si:
1. El jugador puede gastar creditos en 5 minutos de juego real.
2. Existen al menos 3 builds viables distintas.
3. Distress y Mini-boss jugables end-to-end.
4. Chapter 1 data pack cargable sin hardcode manual.
5. Progreso persiste entre sesiones.
6. QA sin bloqueos criticos de economia/progresion.

---

## 13) Plan de implementacion inmediato (orden)

1. Modelo de datos de items + inventario.
2. Tienda (comprar/vender/equipar).
3. Naves nuevas y stats por rol.
4. Tactical modules y habilidades.
5. Distress event.
6. Mini-boss event.
7. Chapter 1 data pack.
8. Persistencia total + migracion de save.

---

## 14) Revision post-implementacion (cuestionar todo)

Checklist:
- La moneda tiene valor real o sigue siendo cosmetica?
- El jugador entiende por que comprar una pieza vs otra?
- Se siente diferencia entre naves en 60s de combate?
- Hay loops muertos donde no vale la pena jugar?
- El contenido narrativo empuja a seguir o estanca?
- Hay abuso facil de economia?

Si alguna respuesta es negativa, se reitera balance antes de cerrar release.

