# Efectos visuales (VFX)

```
src/effects/
  README.md       ← este archivo
  VfxManager.js   ← combate unificado, ondas, cascadas, sacudida
```

## Paleta coherente

Todos los impactos usan `COMBAT_PALETTE`:

| Tipo | Color | Uso |
|------|-------|-----|
| `shield` | Cyan | Escudo absorbe daño |
| `hull` | Rojo/naranja | Casco directo |
| `shieldBreak` | Cyan + rojo | Escudo roto + overflow |
| `crit` | Ámbar | Misil / golpe fuerte |
| `kill` | Rojo intenso | Muerte / explosión grande |

## API principal

```js
// Impacto de combate — escudo, casco, crítico, muerte
game.vfx.combatImpact(position, 'shield', { severity: 0.6, amount: 24 });
game.vfx.combatImpact(position, 'hull', { severity: 0.8, amount: 40 });
game.vfx.combatImpact(position, 'shieldBreak', { hullLost: 15, amount: 30 });
game.vfx.combatImpact(position, 'crit', { amount: 75 });
game.vfx.combatImpact(position, 'kill', { scale: 4 });

// Capas extra sobre explosiones de partículas
game.vfx.boostExplosion(position, 2.5);

// Disparos y habilidades
game.vfx.muzzleFlash(position, direction, 0x66ccff);
game.vfx.abilityBurst(position, 'shield'); // repair | shield | missile | nitro | ion
game.vfx.addShake(0.4);
```

`Player._feedbackCombatHit()` enruta todo daño local/red al mismo sistema.
`game.js` llama `vfx.update(delta)` cada frame.
