# Patrullas — `public/models/patrols/`

Cada patrulla usa **exactamente estos 3 GLB** en fila india:

| Archivo | Slot | Rol | Habilidad |
|---------|------|-----|-----------|
| `comandante.glb` | 0 — Frente | Comandante | Pulso paralizador |
| `escolta.glb` | 1 — Centro | Escolta | Fuego de supresión |
| `droid.glb` | 2 — Cola | Misilero | Misiles desde retaguardia |

```
[comandante.glb]
      ↓
 [escolta.glb]
      ↓
  [droid.glb]
```

3 trenes en el mapa (Alpha / Este / Oeste), **3 bots por tren** = 9 unidades total.

Config: `data/patrol_squads.json` · Código: `src/patrols/PatrolSquadManager.js`
