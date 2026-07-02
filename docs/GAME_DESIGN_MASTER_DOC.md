# WARSPACE - Game Design Master Doc v1

Owner: Maiko + Dev Team  
Version: 1.0  
Estado: Documento maestro activo (living document)  

---

## 1) Vision del producto

WarSpace no es un juego para "pasar y cerrar". Es una **plataforma viva** de exploracion, combate espacial y narrativa por temporadas.

Objetivo:
- Campana principal con peso narrativo.
- Contenido secundario profundo.
- Endgame infinito con eventos dinamicos.
- Roadmap continuo para que nunca se sienta abandonado.

Principio rector:
> Cada update debe ampliar el universo (espacio, riesgo, recompensa o historia), no solo subir numeritos.

---

## 2) Pilares de diseno

1. **Exploracion con descubrimiento real**
   - Siempre debe existir "algo nuevo" en cada sesion.
2. **Combate con lectura clara**
   - Amenazas, prioridades y telegraphs visibles en milisegundos.
3. **Progresion con decisiones**
   - Vertical (poder) + horizontal (builds, reputacion, rutas).
4. **Narrativa persistente**
   - Guion por fases, consecuencias y continuidad.
5. **LiveOps sostenible**
   - Sistema preparado para crecer por temporadas sin romper base.

---

## 3) Estructura macro de contenido

### 3.1 Campana principal (Main Story)
- Formato: temporadas.
- Cada temporada: 3 actos, 8-12 misiones main.
- Cierre parcial + cliffhanger macro.

### 3.2 Secundarias (Side Content)
- Arcos de faccion.
- Contratos procedurales.
- Misiones de exploracion/lore.
- Eventos emergentes por zona.

### 3.3 Endgame
- Invasiones escalables.
- Dungeons/Anomalias de alto riesgo.
- Cacerias de elite.
- Metas semanales/mensuales.

---

## 4) Mapa, sectores y posicionamiento del mundo

## 4.1 Modelo de mundo
- Universo dividido en sectores.
- Cada sector define:
  - faccion dominante,
  - riesgo base,
  - recursos,
  - pools de evento,
  - POIs fijos + dinamicos.

## 4.2 Regla de distribucion minima por sector
- 1 hub principal.
- 2-3 POIs mayores.
- 6-10 POIs menores.
- 1 evento dinamico dominante.
- 1 mini-boss rotativo.

## 4.3 Regla de legibilidad espacial
- Nunca colocar 2 objetivos criticos en el mismo eje visual sin separacion.
- Distancias de interes pensadas para:
  - micro-loop (3-7 min),
  - meso-loop (15-30 min),
  - macro-loop (45-90 min).

---

## 5) Formula de dificultad y recompensas (base)

> Nota: estos valores son base de tuning, no finales.

- `EnemyPower = Base * (1 + 0.16*TierSector + 0.05*NivelJugadorNorm)`
- `Reward = Base * (1 + 0.14*Riesgo + 0.10*Cadena + 0.08*RarezaEvento)`
- `EventSpawnRate = Base * (1 + 0.20*ActividadSector - 0.15*Saturacion)`

### Reglas de balance
- Cada mejora fuerte debe tener un costo de oportunidad.
- Evitar escalado lineal infinito sin nuevos riesgos.
- Siempre mantener 3 tipos de amenaza: rapida, resistente, tactica.

---

## 6) Narrativa por guion (sistema)

Cada mision debe definirse como:
- `id`
- `type` (`main`, `side`, `contract`, `event`)
- `triggers`
- `phases[]`
- `objectives[]`
- `dialogues[]`
- `success/fail conditions`
- `rewards`
- `state flags set/read`

### Flags narrativas
- Guardar decisiones clave para dialogos futuros.
- Soportar ramas por faccion y reputacion.
- Prohibido hardcodear ramas dentro de render/combat loops.

---

## 7) Sistema visual y animacion (pipeline)

## 7.1 UI Bible
- Paleta, jerarquia, espaciado, estados y motion.
- Componentes unificados (botones, paneles, alerts, progreso).

## 7.2 VFX Bible
- Prioridad: legibilidad > espectacularidad.
- Codigos de color por peligro, rareza y faccion.
- Presupuesto de particulas por escena.

## 7.3 Animacion
- Set minimo por entidad:
  - idle,
  - desplazamiento,
  - ataque telegrafiado,
  - hit reaction,
  - death variant.

---

## 8) Economia y retencion

### 8.1 Fuentes
- Kills, eventos, contratos, hallazgos, objetivos narrativos.

### 8.2 Sumideros
- Upgrades, crafting, reparacion, acceso high-tier, cosmesticos.

### 8.3 Regla de salud economica
- Ninguna moneda puede crecer sin sinks equivalentes en late game.
- Ajustes de inflacion por temporada documentados y versionados.

---

## 9) Arquitectura tecnica para escalar

Estructura objetivo (data-driven):
- `data/campaign/`
- `data/missions/`
- `data/events/`
- `data/factions/`
- `data/planets/`
- `data/liveops/`

Regla:
- Nueva temporada = principalmente nuevos datos + assets, no refactor masivo de codigo core.

---

## 10) Plan de QA y pruebas

## 10.1 Tipos de prueba
- Funcional: objetivos, triggers, rewards, estados.
- Balance: TTK, supervivencia, progresion por hora.
- Rendimiento: stress de combate, VFX, streaming.
- Narrativa: continuidad de flags, ramas, regresiones de guion.
- Durabilidad: sesiones 30m / 2h / 6h / full campaign.

## 10.2 Exit criteria minima por release
- Sin bloqueos criticos de progresion.
- FPS estable en escenarios objetivo.
- Main arc jugable de inicio a cierre parcial.
- Eventos semanales activos sin caidas de estado.

---

## 11) Durabilidad objetivo del jugador

Por temporada completa:
- Rush (solo main): 18-25h
- Normal (main + side clave): 40-60h
- Complecionista: 90-140h
- Endgame/liveops: abierto indefinido

Regla anti-burn:
- Cada 20-30 minutos debe existir 1 momento de alto impacto:
  - hallazgo, mini-boss, decision o recompensa fuerte.

---

## 12) Roadmap de produccion

## Fase A (4-6 semanas) - Base escalable
- Framework narrativo por fases.
- Event Director robusto.
- 1 capitulo main completo.
- 1 linea de side quests.
- Tooling de datos y validacion basica.

## Fase B (6-8 semanas) - Expansion controlada
- 1 planeta/sector nuevo.
- 2 facciones con reputacion.
- 3 eventos dinamicos adicionales.
- 1 dungeon/anomalia repeatable.

## Fase C (8-10 semanas) - Temporada completa
- Acto final de temporada.
- Endgame loop consolidado.
- LiveOps semanal + mensual.
- QA duro + optimizacion.

## Fase D (continuo) - Operacion viva
- Nuevas temporadas.
- Nuevas lineas de enemigo.
- Nuevas ramas narrativas.
- Rotaciones de contenido.

---

## 13) Riesgos y mitigaciones

1. **Scope explosion**
   - Mitigacion: backlog priorizado por impacto/tiempo.
2. **Contenido sin cohesion**
   - Mitigacion: UI/VFX/Narrative bibles obligatorias.
3. **Power creep**
   - Mitigacion: progresion horizontal y caps de temporada.
4. **Jugadores quemados**
   - Mitigacion: rotacion de loops y objetivos por sesion.

---

## 14) Backlog maestro inicial (prioridad)

P0 (inmediato):
- Framework de missions data-driven.
- Acto 1 jugable end-to-end.
- Eventos dinamicos: invasion + distress + mini-boss.
- Persistencia de estado (campana, reputacion, economia).

P1:
- Sector/planeta 2.
- Arcos secundarios de faccion.
- Contratos procedurales robustos.

P2:
- Herramientas internas de authoring (misiones/eventos).
- Telemetria de gameplay para balance automatico asistido.

---

## 15) Definition of Done (DoD)

Una feature se considera "hecha" solo si cumple:
1. Diseno documentado (objetivo + reglas + edge cases).
2. Implementacion funcional sin hardcode fragil.
3. UI/VFX legible y consistente con estilo.
4. Telemetria/logs minimos para diagnostico.
5. Pruebas manuales + validacion de regresion.
6. Impacto en durabilidad/rejugabilidad verificado.

---

## 16) Proximo entregable recomendado

Crear `Chapter 1 Production Pack`:
- `data/campaign/chapter1.json`
- `data/missions/main_ch1/*.json`
- `data/missions/side_ch1/*.json`
- `data/events/event_tables_ch1.json`
- `state_flags_schema.json`

Con eso pasamos de vision a produccion real.
