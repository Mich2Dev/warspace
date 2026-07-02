# Pipeline 3D — naves, enemigos y patrullas

Guía paso a paso para modelos **orgánicos**, consistentes con WarSpace (Three.js + GLB).

## 1. Herramientas recomendadas

| Herramienta | Para qué | Nivel |
|-------------|----------|-------|
| **[Blender](https://www.blender.org/)** (gratis) | Modelado, rig, bake, export GLB | Principal |
| **Blockbench** | Naves low-poly estilo voxel/lowpoly rápido | Prototipos |
| **Materialize** / **ArmorPaint** | PBR desde foto o pintura directa | Texturas |
| **Mixamo** | Animaciones humanoides (poco útil para naves) | Opcional |
| **glTF Viewer** (`viewer.html` en el repo) | Preview local antes de meter al juego | QA |

**No necesitáis anime.js para 3D** — anime.js es DOM/UI. En 3D usamos el loop del juego + shaders.

## 2. Convención de archivos en el proyecto

```
public/models/
  player/shock_lvl1.glb      — nave jugador
  zona1/E1.glb               — enemigo Mantis
  zona2/E2.glb               — Carroñero
  zona3/E3.glb               — Comando
  patrols/patrol_base.glb    — patrulla con luces (FALTA — crear)
  zona1/base1.glb            — base spawner
```

Vite sirve desde `public/`. Tras exportar: **Ctrl+F5** en el juego.

## 3. Workflow Blender → WarSpace

### A. Escala y orientación
- 1 unidad Blender ≈ 1 metro en juego.
- **Proa hacia -Z** (Three.js `lookAt` y láseres asumen esto).
- Escala final en código: `CONFIG.VISUALS.ZONA1_SCALE` (≈20) — mejor modelar pequeño y escalar en Blender **Apply Scale** antes de export.

### B. Modelado orgánico (tips)
- **Silueta primero** — 3 vistas en blockout (caja + 2-3 masas).
- **Mirror modifier** — simetría de naves.
- **Subdivision solo al final** — controla polycount.
- **Greebles** (detalle): arrays duplicados, no miles de polys sueltos.
- **Emissive** en ventanas/motores → se ve bien con bloom del juego.

### C. Materiales PBR
- Base Color + Roughness + Metalness (+ Normal si hay).
- Emissive para motores (RGB + strength en Blender → exporta a GLB).
- Evitá nombres de material genéricos repetidos entre zonas (facilita tint por rol en código).

### D. Export GLB
- File → Export → glTF 2.0 (.glb)
- ✅ Apply Modifiers, ✅ UVs, ✅ Materials
- ❌ Animaciones si no las usáis (reduce tamaño)
- Comprobar en `viewer.html` o consola del juego (sin errores 404).

## 4. Diferenciar roles sin duplicar modelos

En código (`enemyVisuals.js`):
- **Tint + emissive** por rol (`patrol_border`, `ambush`…)
- **Addons** opcionales: antenas, misiles (`applyVisualVariant`)

En Blender (mejor resultado):
- **Mismo hull**, variantes como objetos hijo: `variant_disruptor`, `variant_escort`
- Export un GLB con mesh names → el código puede activar hijos por rol

## 5. Patrulla visible (`patrol_base.glb`)

Diseño sugerido:
- Hull Mantis/Carroñero + **barra luminosa** R/A (ya el código añade esferas emissive si existe el GLB)
- Escala ~15% mayor que E1
- Guardar en `public/models/patrols/patrol_base.glb`

## 6. Checklist antes de subir un modelo

- [ ] Se ve en `viewer.html` sin warnings
- [ ] Proa -Z, escala aplicada
- [ ] < 50k triángulos por unidad móvil (móvil/túnel)
- [ ] Emissive en motores
- [ ] Probado en zona 1 con `7` (teleport cheat)

## 7. Roadmap arte (con el código)

| Fase | Entregable |
|------|------------|
| **Ahora** | E1/E2/E3 estables + procedural fallback si falla carga |
| **2** | `patrol_base.glb` + README en `public/models/patrols/` |
| **3** | Variantes por rol (mesh hijos o 2º GLB ligero) |
| **4** | Nave jugador lvl5 (`navelvl10.glb`) coherente con shock_lvl1 |
| **5** | Eventos invasión (`public/models/events/invasion/`) |

## 8. Recursos útiles

- [Khronos glTF samples](https://github.com/KhronosGroup/glTF-Sample-Models)
- Blender Guru / Grant Abbitt — low-poly spaceships (tutoriales)
- Poly Haven — HDR/texturas PBR gratis
