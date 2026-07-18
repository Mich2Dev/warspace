# Registro de Cambios - Sistema de Planetas y Físicas (Sesión Reciente)

Este documento guarda un resumen de todas las correcciones y mejoras que realizamos juntos en el juego durante nuestra sesión para arreglar las mecánicas de vuelo superficial y generación de planetas.

## 1. Arreglo del "Giro Loco" y Sincronización Planetaria
- **Problema:** Al anclarse al planeta, la nave empezaba a girar violentamente perdiendo el control.
- **Solución:** Se corrigió el cálculo de rotación en `Spaceship.js` (`expectedPlanetRotY`). Estaba usando un factor de `0.2` en lugar de `0.005` (que era el real del planeta en `main.js`), desfasando las físicas por completo.

## 2. Mejoras de Velocidad Superficial (Hover) y Efecto Warp
- **Problema:** En planetas masivos (radio 10,000), la nave se sentía lenta (5,000 max).
- **Solución:** Se triplicó la velocidad base a 15,000. Además, se integraron los propulsores manuales:
  - **Espacio (`Space`):** Ahora funciona como turbo intermedio (hasta 30,000).
  - **Shift (`Hyperdrive`):** Ahora otorga un impulso absurdo (hasta 50,000).
- Se implementó un efecto de campo de visión dinámico (FOV Warp) y partículas de motor naranjas para transmitir visualmente esta tremenda sensación de velocidad.

## 3. Despegue Manual Inmersivo
- **Problema:** La nave forzaba un despegue vertical cinemático a 90° al presionar teclas de turbo, y bloqueaba por completo la capacidad de apuntar hacia arriba (pitch) mientras flotabas.
- **Solución:** Se eliminó el despegue automático. Se desbloqueó el eje vertical (pitch) en el ratón. Ahora los jugadores pueden despegar suavemente hacia el espacio de forma manual, simplemente tirando el ratón hacia atrás para levantar el morro, similar a *No Man's Sky*.

## 4. Corrección de Congelamiento por "Auto-Anclaje" (Bucle Infinito)
- **Problema:** Al levantar el morro para despegar manualmente sin mucha velocidad inicial, la gravedad del planeta te volvía a atrapar instantáneamente. Esto causaba un bucle rápido (60 veces por segundo) entre Modo Vuelo y Modo Superficie, congelando las físicas y parpadeando el radar de superficie.
- **Solución:** Al efectuar el despegue manual, se resetean correctamente los acumuladores del ratón y se inyecta una velocidad mínima segura de 1,000 para escapar del umbral de anclaje de la gravedad (speed < 400).

## 5. Arreglo del Sistema LOD (Nivel de Detalle) - Adiós a la Superficie Plana
- **Problema:** Todo el planeta se veía liso y sin formas geométricas al descender.
- **Solución:** Se descubrió un bug crítico en `Quadtree.js`. El árbol LOD recordaba el punto donde "nació" el planeta, pero no rastreaba la órbita ni la rotación en tiempo real. Esto hacía creer a la cámara que estaba a millones de kilómetros, por lo que nunca subdividía los polígonos. Ahora el terreno se carga en HD dinámicamente al acercarte.

## 6. Nueva Generación Procedural de Terreno (Montañas y Cráteres Gigantes)
- **Problema:** Las montañas procedimentales medían apenas 30 unidades de altura, invisibles en un planeta masivo.
- **Solución:** Se reescribió `TerrainBuilder.js`. Ahora el sistema genera supercontinentes y macizos montañosos de hasta **800 unidades de altura**, acompañados de raros pero masivos **cráteres alienígenas** que alcanzan hasta -800 unidades de profundidad. También se añadió un tintado visual adaptativo (nieve para los picos, oscuro para los cráteres).

## 7. Solución de "Enterramiento" en las Montañas (Clipping a Alta Velocidad)
- **Problema:** Al ir a 50,000 de velocidad, la nave atravesaba las nuevas mega-montañas porque la interpolación matemática (lerp) era muy lenta para escalar 800 metros en milisegundos.
- **Solución:** Se implementó un sistema de `hard-snap` (ajuste instantáneo) en `Spaceship.js` que impide físicamente que la nave quede por debajo del relieve topográfico generado. Adicionalmente, se expandió el radar de colisión atmosférica en `main.js` de 100 a 1,500 unidades para poder detectar estrellas y montañas colosales correctamente.
