# WarSpace Galaxy — Checkpoint experimental

Copia de **WarSpace** para probar viaje entre planetas estilo **No Man's Sky** sin tocar el juego original.

## Qué incluye

- **Superficie:** el mapa actual (Aegis Prime) es solo un parche del planeta.
- **Ascensión:** sube alto + impulsor → sales a órbita y ves el planeta **redondo**.
- **Espacio:** vuela libremente hacia otros planetas del sistema.
- **Aterrizaje:** acércate y pulsa **F** para bajar a otro mundo.

## Arrancar

```bash
cd warspace-galaxy
npm install
npm start
```

Puerto **5175** (el original sigue en 5174).

## Controles (modo galaxia)

| Acción | Control |
|--------|---------|
| Salir al espacio | **G** (en superficie, con sesión activa) |
| Volar en espacio | WASD + ratón (igual que superficie) |
| Impulsor espacial | Shift |
| Aterrizar | **F** cerca de un planeta (< ~14 km) |

## Volver al juego original

Simplemente abre y juega la carpeta `jg - copia`. Esta carpeta es independiente.

## Archivos nuevos

- `src/galaxy/GalaxyDirector.js` — orquestador superficie ↔ espacio
- `src/galaxy/PlanetBody.js` — esfera + atmósfera
- `src/galaxy/galaxyCatalog.js` — catálogo de planetas
- `data/galaxy_system_01.json` — sistema estelar

## Notas de diseño

El terreno plano sigue siendo la simulación local (tangente al esferoide). En espacio ves el cuerpo planetario; al aterrizar en otro mundo reutilizamos la misma geometría con otro bioma/nombre (MVP). Un paso futuro sería `planet_02.json` con mapa propio.
