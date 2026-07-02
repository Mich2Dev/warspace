# Invasion Event Asset Line

This folder is reserved for **dedicated invasion units** (not zone bots).

## Planned GLB files

- `invader_alpha.glb`
- `invader_beta.glb`
- `invader_gamma.glb`

## Orientation / scale rules

- Forward axis: `-Z`
- Up axis: `+Y`
- Pivot: center mass
- Preferred size envelope: around `28-36` world units tip-to-tail
- Materials: PBR, emissive channels enabled for bloom

## Integration status

Current build uses **procedural prototypes** from `EnemyManager` for invasion units:

- `Invader_Alpha`
- `Invader_Beta`
- `Invader_Gamma`

Once GLBs are ready, hook them in `EnemyManager` as the invasion template groups.
