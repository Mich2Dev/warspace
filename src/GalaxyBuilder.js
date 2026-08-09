/**
 * GalaxyBuilder.js — Construye la Vía Láctea procedural con datos reales.
 *
 * DATOS CIENTÍFICOS REALES USADOS:
 * - Posición del Sol en la Vía Láctea: 8.15 kpc del centro (27,000 años luz)
 * - Diámetro de la Vía Láctea: ~100,000 años luz
 * - Sagitario A* (agujero negro supermasivo): 4 millones de masas solares
 * - Colores estelares basados en clasificación espectral real
 */

import * as THREE from 'three';

// ===========================================================================
// DATOS REALES DE ESTRELLAS CERCANAS
// ===========================================================================
const REAL_NEARBY_STARS = [
  ["Proxima Centauri",   -1.29,  -1.20,  -3.77,  "M", 11.1, "La estrella más cercana al Sol."],
  ["Alpha Centauri A",   -1.32,  -1.22,  -3.79,  "G",  0.0, "Gemela solar del sistema triple más cercano."],
  ["Alpha Centauri B",   -1.31,  -1.22,  -3.79,  "K",  1.3, "Estrella naranja del sistema Alfa Centauri."],
  ["Barnard's Star",     -0.06,  -5.94,   0.08,  "M",  9.5, "Segunda estrella más cercana."],
  ["Sirius A",            3.64,  -7.72,   0.62,  "A", -1.5, "La estrella más brillante del cielo nocturno."],
  ["Vega",               -3.86,  24.76,   1.36,  "A",  0.0, "Estrella polar del futuro."],
  ["Arcturus",           -19.80, 32.64,  19.31,  "K", -0.1, "La gigante naranja más brillante."],
  ["Betelgeuse",        404.00,  34.00,  168.00, "M",  0.4, "Supergigante roja en Orión."],
  ["Rigel",            -560.00, -760.00, 0.00,  "B",  0.1, "Supergigante azul."],
  ["Deneb",           1800.00,   50.00, 1900.00, "A",  1.3, "Hipergigante a 2600 años luz."],
  ["Antares",          304.00, -200.00, -484.00, "M",  1.1, "Corazón del Escorpión."],
];

const STAR_COLORS = {
  'O': 0x9BB0FF, 'B': 0xAABFFF, 'A': 0xCAD8FF, 'F': 0xF8F7FF,
  'G': 0xFFF4EA, 'K': 0xFFD2A1, 'M': 0xFF9966, 'D': 0xDDEEFF,
};

const SCALE = 1; 
const SUN_DISTANCE_LY = 26700; 

const SPIRAL_ARMS = [
  { name: "Brazo de Norma", color: 0x4466FF, pitchAngle: 12.5, startAngle: 0.3, startRadius: 11000, turns: 1.8, armWidth: 2500 },
  { name: "Brazo Escudo-Centauro", color: 0x88AAFF, pitchAngle: 12.5, startAngle: 0.3 + Math.PI * 0.5, startRadius: 11000, turns: 1.8, armWidth: 2200 },
  { name: "Brazo de Sagitario-Carina", color: 0xFF8844, pitchAngle: 13.0, startAngle: 0.3 + Math.PI, startRadius: 9500, turns: 2.0, armWidth: 2800 },
  { name: "Brazo de Perseo", color: 0xFF4488, pitchAngle: 13.0, startAngle: 0.3 + Math.PI * 1.5, startRadius: 9500, turns: 2.0, armWidth: 2600 },
  { name: "Brazo de Orión (Brazo Local)", color: 0xFFFF88, pitchAngle: 11.0, startAngle: 0.3 + Math.PI * 1.1, startRadius: 25000, turns: 0.4, armWidth: 1200 },
];

export class GalaxyBuilder {
  constructor(scene) {
    this.scene = scene;
    this.galaxyGroup = new THREE.Group();
    scene.add(this.galaxyGroup);
    
    this.GALAXY_SCALE = 0.15; 
    this.starMarkers = [];
    this.built = false;
    
    // Generamos textura procedural suave para que los puntos parezcan estrellas/polvo real
    this.particleTexture = this._createSoftParticleTexture();
  }

  // Genera un gradiente radial suave en canvas para las partículas volumétricas
  _createSoftParticleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.2, 'rgba(255,255,255,0.8)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.2)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
  }

  build() {
    if (this.built) return this.galaxyGroup;
    this.built = true;
    this._buildGalacticCore();
    this._buildSpiralArms();
    this._buildGalacticDust();
    this._buildNearbyStars();
    this._buildSagittariusAStar();
    return this.galaxyGroup;
  }

  /**
   * Generación de números aleatorios con distribución Gaussiana.
   * Útil para agrupar estrellas en el centro del bulbo o de los brazos.
   */
  _randomGaussian() {
    let u = 0, v = 0;
    while(u === 0) u = Math.random(); 
    while(v === 0) v = Math.random();
    let num = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
    num = num / 10.0 + 0.5; // Aproximar a rango [0,1]
    if (num > 1 || num < 0) return this._randomGaussian();
    return num;
  }

  _buildGalacticCore() {
    const coreRadius = 12000 * this.GALAXY_SCALE;
    const particleCount = 120000; // MUCHÍSIMAS más partículas para efecto volumétrico
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    
    const coreColorCenter = new THREE.Color(0xFFEEAA); // Blanco-amarillo puro
    const coreColorEdge = new THREE.Color(0xFF8833);   // Naranja viejo
    
    for (let i = 0; i < particleCount; i++) {
      // Distribución muy concentrada en el centro
      const distance = Math.pow(Math.random(), 3) * coreRadius; 
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      
      let x = distance * Math.sin(phi) * Math.cos(theta);
      let y = distance * Math.cos(phi) * 0.3; // Bulbo galáctico MUY achatado en Y
      let z = distance * Math.sin(phi) * Math.sin(theta);
      
      // Aplicar barra central (elongación en un eje específico)
      const barRatio = 1 - (distance / coreRadius);
      if (barRatio > 0.3) {
         x *= 1.8; // Estirar el núcleo formando la Barra de la Vía Láctea
         const angle = 44 * Math.PI / 180;
         const nx = x * Math.cos(angle) - z * Math.sin(angle);
         const nz = x * Math.sin(angle) + z * Math.cos(angle);
         x = nx; z = nz;
      }

      positions[i*3] = x;
      positions[i*3+1] = y;
      positions[i*3+2] = z;
      
      // El color cambia gradualmente del amarillo cálido al naranja viejo en los bordes
      const t = distance / coreRadius;
      const c = coreColorCenter.clone().lerp(coreColorEdge, t);
      colors[i*3] = c.r;
      colors[i*3+1] = c.g;
      colors[i*3+2] = c.b;
    }
    
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const mat = new THREE.PointsMaterial({
      size: 400 * this.GALAXY_SCALE,
      vertexColors: true,
      map: this.particleTexture, // ¡Textura suave!
      transparent: true,
      opacity: 0.1, // Reducido drásticamente por el Bloom
      blending: THREE.AdditiveBlending, // Esto suma las luces para crear un brillo cegador en el centro
      depthWrite: false,
      sizeAttenuation: true,
    });
    
    this.galaxyGroup.add(new THREE.Points(geo, mat));
  }

  _buildSpiralArms() {
    const totalArmParticles = 300000; // 300 mil partículas para los brazos enteros
    const particlesPerArm = totalArmParticles / SPIRAL_ARMS.length;
    
    for (const arm of SPIRAL_ARMS) {
      const positions = new Float32Array(particlesPerArm * 3);
      const colors = new Float32Array(particlesPerArm * 3);
      const pitchRad = arm.pitchAngle * Math.PI / 180;
      
      const armBaseColor = new THREE.Color(arm.color);
      const whiteColor = new THREE.Color(0xFFFFFF);
      const blueColor = new THREE.Color(0x9BB0FF); // Zonas de formación O/B
      
      for (let i = 0; i < particlesPerArm; i++) {
        // "t" avanza por el brazo, pero con más densidad hacia el centro
        const t = Math.pow(Math.random(), 1.5); 
        const angle = arm.startAngle + t * arm.turns * Math.PI * 2;
        
        // Fórmula de espiral logarítmica real
        const radius = arm.startRadius * Math.exp(t * arm.turns * 2 * Math.PI * Math.tan(pitchRad));
        if (radius > 55000) continue; // Cortar el disco a 55k años luz
        
        // Dispersión desde la espina central del brazo (Gaussiana)
        const spreadFactor = this._randomGaussian() - 0.5; // -0.5 a 0.5 con campana
        const armThickness = arm.armWidth * this.GALAXY_SCALE * (1 + t * 2); // Los brazos se ensanchan hacia afuera
        
        // Dispersión en el plano XZ
        const spreadDistance = spreadFactor * armThickness;
        // Dirección perpendicular al brazo
        const perpAngle = angle - Math.PI/2 + pitchRad;
        
        const x = radius * Math.cos(angle) * this.GALAXY_SCALE + Math.cos(perpAngle) * spreadDistance;
        const z = radius * Math.sin(angle) * this.GALAXY_SCALE + Math.sin(perpAngle) * spreadDistance;
        
        // Altura Y: el disco es extremadamente fino (grosor ~1000 al)
        const ySpread = (this._randomGaussian() - 0.5);
        const y = ySpread * armThickness * 0.15;
        
        positions[i*3] = x;
        positions[i*3+1] = y;
        positions[i*3+2] = z;
        
        // Mezclamos polvo blanco, gas del color del brazo y zonas brillantes azules (Hot Jupiters / O-Type stars)
        let c;
        const colorVar = Math.random();
        if (Math.abs(spreadFactor) < 0.1 && colorVar > 0.8) {
          // Estrellas jóvenes y brillantes en el núcleo del brazo (Azul-blanco)
          c = blueColor;
        } else if (colorVar > 0.5) {
          // Blanco de la Vía Láctea "lechosa"
          c = armBaseColor.clone().lerp(whiteColor, 0.7);
        } else {
          // Color base del gas del brazo
          c = armBaseColor;
        }
        
        // Atenuar brillo hacia los bordes del brazo y de la galaxia
        const fade = (1 - Math.abs(spreadFactor * 2)) * (1 - t);
        
        colors[i*3] = c.r * fade;
        colors[i*3+1] = c.g * fade;
        colors[i*3+2] = c.b * fade;
      }
      
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      
      const mat = new THREE.PointsMaterial({
        size: 300 * this.GALAXY_SCALE,
        vertexColors: true,
        map: this.particleTexture,
        transparent: true,
        opacity: 0.15, // Reducido por el Bloom
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      });
      
      this.galaxyGroup.add(new THREE.Points(geo, mat));
    }
  }

  _buildGalacticDust() {
    const dustCount = 100000;
    const positions = new Float32Array(dustCount * 3);
    const colors = new Float32Array(dustCount * 3);
    
    const galaxyRadius = 55000 * this.GALAXY_SCALE;
    
    for (let i = 0; i < dustCount; i++) {
      // El polvo sigue principalmente los brazos, pero está más esparcido
      const r = Math.pow(Math.random(), 0.8) * galaxyRadius;
      const theta = Math.random() * Math.PI * 2;
      
      // Disco polvoriento extremadamente plano, corta justo por la mitad
      const thickness = (150 * this.GALAXY_SCALE) * (1 + r / galaxyRadius);
      const y = (Math.random() - 0.5) * thickness;
      
      positions[i * 3]     = Math.cos(theta) * r;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(theta) * r;
      
      // Colores del polvo: marrón casi negro, absorbe la luz
      const shade = 0.05 + Math.random() * 0.1; 
      colors[i * 3]     = shade * 0.5; // Un poco de rojo
      colors[i * 3 + 1] = shade * 0.3; // Menos verde
      colors[i * 3 + 2] = shade * 0.2; // Casi nada de azul
    }
    
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const mat = new THREE.PointsMaterial({
      size: 1500 * this.GALAXY_SCALE, // Nubes muy grandes de polvo
      vertexColors: true,
      map: this.particleTexture,
      blending: THREE.NormalBlending, // Normal blending oscurece lo que hay detrás si es opaco/negro!
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
      sizeAttenuation: true,
    });
    
    this.galaxyGroup.add(new THREE.Points(geo, mat));
  }

  _buildSagittariusAStar() {
    const bhRadius = 800 * this.GALAXY_SCALE;
    
    // Shader inspirado en Gargantua (Interestelar) - Simula lente gravitacional
    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        // Hacer que el billboard siempre mire a la cámara
        vec4 mvPosition = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mvPosition.xy += position.xy;
        gl_Position = projectionMatrix * mvPosition;
      }
    `;

    const fragmentShader = `
      varying vec2 vUv;
      uniform float time;

      void main() {
        vec2 uv = (vUv - 0.5) * 2.0; // [-1, 1]
        float r = length(uv);
        
        // 1. EVENT HORIZON (Absolute Black)
        float ehRadius = 0.15;
        if (r < ehRadius) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }
        
        // 2. PHOTON RING (Anillo brillante en el límite)
        float prDist = r - ehRadius;
        float photonRing = 0.005 / (prDist * prDist + 0.0001);
        photonRing *= smoothstep(0.15, 0.0, prDist);
        
        // 3. GRAVITATIONAL LENSING (El disco doblado por la gravedad)
        // Deformación del espacio-tiempo cerca del borde
        vec2 warpedUv = uv;
        // Doblar fuertemente los rayos que pasan cerca del horizonte
        float lensEffect = ehRadius / r;
        warpedUv.y /= (1.0 - pow(lensEffect, 3.0));
        
        float diskR = length(vec2(warpedUv.x, warpedUv.y * 3.5));
        
        float disk = 0.0;
        if (diskR > ehRadius + 0.02 && diskR < 1.0) {
           float band1 = sin(diskR * 50.0 - time * 3.0) * 0.5 + 0.5;
           float band2 = sin(diskR * 120.0 + time * 1.5) * 0.5 + 0.5;
           disk = (band1 * 0.7 + band2 * 0.3);
           disk *= smoothstep(1.0, 0.4, diskR) * smoothstep(ehRadius + 0.02, ehRadius + 0.08, diskR);
        }
        
        // Efecto Doppler Relativista: Un lado se acerca al observador (más brillante y azul), otro se aleja (más rojo y tenue)
        float doppler = 1.0 + 0.8 * uv.x / r; 
        
        vec3 color = vec3(0.0);
        
        // Color del disco base (Naranja / Fuego radiante)
        vec3 diskColor = vec3(1.0, 0.4, 0.05);
        // Desplazamiento al azul en el lado que se acerca
        if (uv.x < 0.0) {
            diskColor = mix(diskColor, vec3(0.7, 0.9, 1.0), -uv.x * 0.8);
        }
        
        color += diskColor * disk * doppler * 2.5;
        
        // Photon ring blanco/dorado
        color += vec3(1.0, 0.95, 0.8) * photonRing * 1.5;
        
        // Fade circular del plano
        float alpha = smoothstep(1.0, 0.9, r);
        // El horizonte en sí debe tener alpha 1 para ser negro, y el resto lo que corresponda al disco
        // Pero usamos additive blending, por lo que el negro del horizonte no borrará el fondo si la opacidad es total.
        // Así que usamos Normal Blending con pre-multiplicado.
        
        gl_FragColor = vec4(color, alpha * clamp(length(color), 0.0, 1.0));
      }
    `;
    
    this.bhUniforms = { time: { value: 0 } };
    
    const bhMat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.bhUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    
    // Un plano gigantesco para dibujar el shader (el shader en billboard mantendrá la cara a la cámara)
    const planeGeo = new THREE.PlaneGeometry(bhRadius * 30, bhRadius * 30);
    const bh = new THREE.Mesh(planeGeo, bhMat);
    
    // Una esfera negra sólida de respaldo just in case (para que bloquee estrellas detrás del horizonte de eventos)
    const solidSphereGeo = new THREE.SphereGeometry(bhRadius * 4.4, 32, 32);
    const solidSphereMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const solidSphere = new THREE.Mesh(solidSphereGeo, solidSphereMat);
    
    this.galaxyGroup.add(solidSphere);
    this.galaxyGroup.add(bh);
    
    this.sagittariusAstar = bh;
  }

  _buildNearbyStars() {
    const sunX = SUN_DISTANCE_LY * this.GALAXY_SCALE;
    
    // Solo creamos marcadores muy sutiles para las estrellas para no arruinar la vista
    for (const starData of REAL_NEARBY_STARS) {
      const [name, relX, relY, relZ, spectral, magnitude, desc] = starData;
      const color = new THREE.Color(STAR_COLORS[spectral] || 0xFFFFFF);
      
      const x = (sunX + relX * this.GALAXY_SCALE);
      const y = relZ * this.GALAXY_SCALE; 
      const z = relY * this.GALAXY_SCALE;
      
      const starSize = 300 * this.GALAXY_SCALE;
      
      // Sprite de estrella usando la textura suave
      this.particleMaterial = new THREE.PointsMaterial({
        size: 35 * this.GALAXY_SCALE, // Un poco más pequeñas
        map: this.particleTexture,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.25, // Reducido para evitar plastas blancas
        depthWrite: false,
        vertexColors: true
      });
      const mat = new THREE.SpriteMaterial({
        color: color,
        map: this.particleTexture,
        blending: THREE.AdditiveBlending,
        transparent: true,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(x, y, z);
      sprite.scale.set(starSize, starSize, 1);
      
      this.galaxyGroup.add(sprite);
      
      this.starMarkers.push({
        name, spectralClass: spectral, description: desc, magnitude,
        position: new THREE.Vector3(x, y, z),
      });
    }
    
    // SOL
    const sunMat = new THREE.SpriteMaterial({
      color: 0xFFFF88,
      map: this.particleTexture,
      blending: THREE.AdditiveBlending,
    });
    const sunSprite = new THREE.Sprite(sunMat);
    sunSprite.position.set(sunX, 25 * this.GALAXY_SCALE, 0);
    sunSprite.scale.set(600 * this.GALAXY_SCALE, 600 * this.GALAXY_SCALE, 1);
    this.galaxyGroup.add(sunSprite);
  }

  update(delta) {
    this.galaxyGroup.rotation.y -= delta * 0.002; // Rotación completa y solemne
  }
}
