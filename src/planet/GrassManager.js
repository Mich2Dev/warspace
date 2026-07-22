import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TerrainBuilder, getNoise, globalTerrainUniforms } from './TerrainBuilder.js';

/**
 * Earth-only grass: short dense tufts snapped to TerrainBuilder.getHeight
 * (same function as the green/brown painted mesh), so blades sit ON the floor.
 */
export class GrassManager {
    constructor(planetGroup, planetRadius) {
        this.planetGroup = planetGroup;
        this.planetRadius = planetRadius;

        // Área de renderizado ajustada estrictamente alrededor del jugador para MAX FPS
        this.gridSize = 24; // 60km radio (Oculto bajo la niebla perfectamente)
        this.cellSize = 5000; 
        this.halfGrid = Math.floor(this.gridSize / 2);
        this.perCell = 150; // Densidad altísima pero sin matar el CPU (~86k instancias en total)
        this.total = this.gridSize * this.gridSize * this.perCell;

        // Escala
        this.bladeScale = 65.0; // Un poco más pequeños como pediste
        this.lift = 1.0;
        this.viewDist = 90000; // Visible desde 90km (Bajo la niebla)

        // Geometría 3D Real: Optimizada y con Puntas Bordeadas
        // Geometría 3D Real: Optimizada y con Puntas Bordeadas
        const bladeCount = 24; // El doble de briznas por parche para que se vea extra denso
        const positions = [];
        const indices = [];
        let vertexOffset = 0;
        
        // Agrupar en 3 sub-manojos muy apretados
        for (let g = 0; g < 3; g++) {
            const groupOffsetX = (Math.random() - 0.5) * 1.0; // Mas pegadas
            const groupOffsetZ = (Math.random() - 0.5) * 1.0;

            for (let b = 0; b < bladeCount / 3; b++) {
                // Independencia de hojas
                const angle = Math.random() * Math.PI * 2;
                const radiusSpread = Math.random() * 0.5; // Muy apretadas
                const bx = groupOffsetX + Math.cos(angle) * radiusSpread;
                const bz = groupOffsetZ + Math.sin(angle) * radiusSpread;
                
                // Variación Extrema de Tamaño
                const height = 2.0 + Math.random() * 8.0; 
                const width = 0.15 + Math.random() * 0.35; 
                const bend = (Math.random() - 0.2) * 4.0; 
                
                const segments = 4;
                
                for (let i = 0; i <= segments; i++) {
                    const t = i / segments; 
                    const y = t * height;
                    
                    const currentBend = Math.pow(t, 2.0) * bend;
                    const vx = bx + Math.cos(angle) * currentBend;
                    const vz = bz + Math.sin(angle) * currentBend;
                    
                    // PUNTAS BORDEADAS (Redondeadas): Usamos una curva circular en lugar de recta
                    // Esto hace que la hoja mantenga su grosor y se redondee suavemente al final
                    const currentWidth = width * Math.sqrt(1.0 - Math.pow(t, 2.0)); 
                    
                    if (i === segments) {
                        positions.push(vx, y, vz);
                        indices.push(vertexOffset - 2, vertexOffset - 1, vertexOffset);
                        vertexOffset += 1;
                    } else {
                        const wx = Math.sin(angle) * currentWidth;
                        const wz = -Math.cos(angle) * currentWidth;
                        positions.push(vx - wx, y, vz - wz);
                        positions.push(vx + wx, y, vz + wz);
                        
                        if (i > 0) {
                            const bl = vertexOffset - 2;
                            const br = vertexOffset - 1;
                            const tl = vertexOffset;
                            const tr = vertexOffset + 1;
                            indices.push(bl, br, tl);
                            indices.push(br, tr, tl);
                        }
                        vertexOffset += 2;
                    }
                }
            }
        }
        
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setIndex(indices);
        geo.computeVertexNormals();

        // Material sólido sin transparencia (máximo rendimiento y nitidez)
        const mat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            side: THREE.DoubleSide,
            roughness: 0.9,
            metalness: 0.0,
        });

        // ----------------------------------------------------
        // INJECT CUSTOM SHADERS FOR WIND AND INTERACTION
        // ----------------------------------------------------
        this.uniforms = {
            uTime: globalTerrainUniforms.time,
            uPlayerPos: { value: new THREE.Vector3() },
            uPlayerRadius: { value: 1500.0 } 
        };

        mat.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = this.uniforms.uTime;
            shader.uniforms.uPlayerPos = this.uniforms.uPlayerPos;
            shader.uniforms.uPlayerRadius = this.uniforms.uPlayerRadius;

            shader.vertexShader = `
                uniform float uTime;
                uniform vec3 uPlayerPos;
                uniform float uPlayerRadius;
                varying float vHeightFactor;
                ${shader.vertexShader}
            `;

            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `
                vHeightFactor = clamp(position.y / 6.0, 0.0, 1.0);
                #include <begin_vertex>

                vec4 worldInstPos = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);

                // Viento muy sutil para que estén casi quietas por defecto
                float randSeed = fract(sin(dot(worldInstPos.xyz, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
                float windX = sin(uTime * 0.8 + randSeed) * 0.03;
                float windZ = cos(uTime * 0.7 + randSeed) * 0.03;

                // 3. Onda interactiva direccional de la nave
                float distToPlayer = distance(worldInstPos.xyz, uPlayerPos);
                
                // Desvanecimiento suave por distancia (Fade In)
                // Empieza a encogerse a los 70km, desaparece a los 80km (Oculto por la niebla)
                float maxDist = 80000.0;
                float fadeStart = 70000.0;
                float distScale = 1.0 - smoothstep(fadeStart, maxDist, distToPlayer);
                transformed *= distScale; // Encoge la hierba lejos para evitar popping

                if (distToPlayer < uPlayerRadius) {
                    float normDist = distToPlayer / uPlayerRadius;
                    vec3 pushDir = normalize(worldInstPos.xyz - uPlayerPos);
                    
                    // Curva suave de empuje
                    float waveForce = pow(1.0 - normDist, 2.0) * 1.5; 
                    
                    windX += pushDir.x * waveForce;
                    windZ += pushDir.z * waveForce;
                    
                    transformed.y -= waveForce * 2.5 * vHeightFactor;
                }

                transformed.x += windX * vHeightFactor;
                transformed.z += windZ * vHeightFactor;
                `
            );

            // OPTIMIZACIÓN EXTREMA GPU: Frustum Culling por Hardware (Vertex Collapse)
            shader.vertexShader = shader.vertexShader.replace(
                '#include <project_vertex>',
                `
                #include <project_vertex>
                // Calculamos la posición en pantalla de TODA la instancia (no del vértice individual)
                vec4 instClipPos = projectionMatrix * viewMatrix * worldInstPos;
                
                // Si la instancia entera está detrás de la cámara o fuera del cono de visión extendido
                if (instClipPos.w <= 0.0 || abs(instClipPos.x) > instClipPos.w * 1.5 || abs(instClipPos.y) > instClipPos.w * 1.5) {
                    // Colapsamos enviándolo detrás del plano lejano de recorte (Far clipping plane)
                    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
                }
                `
            );

            shader.fragmentShader = `
                varying float vHeightFactor;
            ` + shader.fragmentShader;

            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <color_fragment>',
                `
                #include <color_fragment>
                diffuseColor.rgb *= mix(0.2, 1.0, vHeightFactor);
                vec3 tipHighlight = vec3(0.1, 0.15, 0.0) * vHeightFactor;
                diffuseColor.rgb += tipHighlight;
                `
            );
        };
        // ----------------------------------------------------

        this.mesh = new THREE.InstancedMesh(geo, mat, this.total);
        this.mesh.raycast = () => {}; // never hit collision rays
        this.mesh.frustumCulled = false; // We manage visibility via our rolling grid
        this.planetGroup.add(this.mesh);
        
        // ==========================================
        // LUCIÉRNAGAS (FIREFLIES)
        // ==========================================
        // Usamos esferas de baja poligonización para no lidiar con billboarding
        const fireflyGeo = new THREE.IcosahedronGeometry(0.6, 0); 
        const fireflyMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(0.4, 1.0, 0.1), // Verde fluorescente radiactivo
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        
        fireflyMat.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = this.uniforms.uTime;
            shader.vertexShader = `
                uniform float uTime;
                uniform vec3 uPlayerPos;
                ${shader.vertexShader}
            `.replace('#include <begin_vertex>', `
                #include <begin_vertex>
                vec4 worldInstPos = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                
                float distToPlayer = distance(worldInstPos.xyz, uPlayerPos);
                float maxDist = 80000.0;
                float fadeStart = 70000.0;
                float distScale = 1.0 - smoothstep(fadeStart, maxDist, distToPlayer);
                transformed *= distScale;
                float randSeed = fract(sin(dot(worldInstPos.xyz, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
                
                // Movimiento flotante mágico (wobble orgánico)
                transformed.x += sin(uTime * 1.2 + randSeed * 100.0) * 3.5;
                transformed.y += cos(uTime * 0.9 + randSeed * 200.0) * 2.5;
                transformed.z += sin(uTime * 1.5 + randSeed * 300.0) * 3.5;
            `);
            
            // Frustum Culling
            shader.vertexShader = shader.vertexShader.replace(
                '#include <project_vertex>',
                `
                #include <project_vertex>
                vec4 instClipPos = projectionMatrix * viewMatrix * worldInstPos;
                if (instClipPos.w <= 0.0 || abs(instClipPos.x) > instClipPos.w * 1.5 || abs(instClipPos.y) > instClipPos.w * 1.5) {
                    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
                }
                `
            );
            
            shader.fragmentShader = `
                uniform float uTime;
                ${shader.fragmentShader}
            `.replace('#include <color_fragment>', `
                #include <color_fragment>
                float randSeed = fract(sin(dot(gl_FragCoord.xyz, vec3(12.9, 78.2, 45.1))) * 43758.5);
                float pulse = (sin(uTime * 2.5 + randSeed * 10.0) * 0.5 + 0.5);
                
                // Parpadeo intermitente
                diffuseColor.a *= (0.2 + pulse * 0.8);
                // Brillo Bloom HDR
                diffuseColor.rgb *= 2.5; 
            `);
        };
        
        this.fireflyMesh = new THREE.InstancedMesh(fireflyGeo, fireflyMat, this.total);
        this.fireflyMesh.raycast = () => {};
        this.fireflyMesh.frustumCulled = false;
        this.planetGroup.add(this.fireflyMesh);

        // Keep track of which patches are loaded
        this.activeCells = new Set();
        this.cellData = new Map(); 

        this.dummy = new THREE.Object3D();
        this.dummy.scale.set(0, 0, 0);
        for (let i = 0; i < this.total; i++) {
            this.dummy.updateMatrix();
            this.mesh.setMatrixAt(i, this.dummy.matrix);
            this.fireflyMesh.setMatrixAt(i, this.dummy.matrix);
            
            // Paleta de colores orgánicos y ricos: Desde verde limón/amarillento hasta verde oscuro intenso
            const isDry = Math.random() > 0.7; // 30% de hojas más secas/amarillas
            const hue = isDry ? (0.15 + Math.random() * 0.05) : (0.25 + Math.random() * 0.12);
            const sat = isDry ? 0.6 : (0.65 + Math.random() * 0.25);
            const light = isDry ? 0.5 : (0.35 + Math.random() * 0.2);
            
            this.mesh.setColorAt(i, new THREE.Color().setHSL(hue, sat, light));
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

        this.center = new THREE.Vector3();
        this.right = new THREE.Vector3();
        this.forward = new THREE.Vector3();
        this.anchorX = 0;
        this.anchorY = 0;
        this.cells = [];
        this.queue = [];
        let idx = 0;
        for (let gy = -this.halfGrid; gy < this.halfGrid; gy++) {
            for (let gx = -this.halfGrid; gx < this.halfGrid; gx++) {
                const indices = [];
                for (let j = 0; j < this.perCell; j++) indices.push(idx++);
                this.cells.push({ gx, gy, absX: gx, absY: gy, indices });
            }
        }
        this.ready = false;
        this._dir = new THREE.Vector3();
        this._tmp = new THREE.Vector3();
        this._up = new THREE.Vector3(0, 1, 0);
    }

    setBasis(n) {
        const ax = Math.abs(n.x) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        this.right.crossVectors(ax, n).normalize();
        this.forward.crossVectors(n, this.right).normalize();
    }

    /** Meadow clusters — Creates natural clearings and dense patches synced with trees AND lakes */
    patchOk(dir, elev) {
        const isNearWater = (elev > -28.0 && elev < 100.0); // Costas húmedas y riberas bajas
        
        // El mismo ruido que usamos para agrupar los árboles en PlanetDecorator.js
        const clusterNoise = getNoise(dir.x * 2, dir.y * 2, dir.z * 2); 
        const isForest = (clusterNoise >= 0.4);
        
        if (isNearWater || isForest) {
            // Micro ruido para claros naturales dentro del pastizal
            const micro = getNoise(dir.x * 25, dir.y * 25, dir.z * 25);
            if (micro > 0.85) return false; 
            return true;
        }
        
        return false; // Sin agua y sin bosque = llanura desierta o montaña pelada
    }

    update(worldCamPos) {
        if (this.uniforms) {
            this.uniforms.uPlayerPos.value.copy(worldCamPos);
        }
        this.lastCamPos = worldCamPos.clone();

        const local = worldCamPos.clone();
        this.planetGroup.worldToLocal(local);

        const camDir = local.clone().normalize();
        const surf = TerrainBuilder.getHeight(camDir, this.planetRadius, 'Terran', true);
        const alt = local.length() - surf;

        if (alt > this.viewDist || alt < -800) {
            this.mesh.visible = false;
            return;
        }
        this.mesh.visible = true;

        if (!this.ready) {
            this.center.copy(camDir).multiplyScalar(this.planetRadius);
            this.setBasis(camDir);
            this.anchorX = 0;
            this.anchorY = 0;
            for (const c of this.cells) {
                c.absX = c.gx;
                c.absY = c.gy;
            }
            this.queue = this.cells.slice();
            this.ready = true;
        }

        const off = this._tmp.subVectors(local, this.center);
        const sx = Math.round(off.dot(this.right) / this.cellSize);
        const sy = Math.round(off.dot(this.forward) / this.cellSize);

        if (sx !== 0 || sy !== 0) {
            this.anchorX += sx;
            this.anchorY += sy;
            this.center.addScaledVector(this.right, sx * this.cellSize);
            this.center.addScaledVector(this.forward, sy * this.cellSize);
            this.center.normalize().multiplyScalar(this.planetRadius);
            this.setBasis(this.center.clone().normalize());

            const minX = this.anchorX - this.halfGrid;
            const maxX = this.anchorX + this.halfGrid - 1;
            const minY = this.anchorY - this.halfGrid;
            const maxY = this.anchorY + this.halfGrid - 1;

            for (const c of this.cells) {
                const px = c.absX, py = c.absY;
                while (c.absX < minX) c.absX += this.gridSize;
                while (c.absX > maxX) c.absX -= this.gridSize;
                while (c.absY < minY) c.absY += this.gridSize;
                while (c.absY > maxY) c.absY -= this.gridSize;
                if ((c.absX !== px || c.absY !== py) && !this.queue.includes(c)) {
                    this.queue.push(c);
                }
            }
        }

        // Fill fast but carefully to avoid CPU lag 
        // OPTIMIZED: Hard cap at 15 cells per frame. The player doesn't move 75,000m per frame.
        const batch = Math.min(this.queue.length, 15);
        let dirty = false;
        for (let n = 0; n < batch; n++) {
            this.fillCell(this.queue.shift());
            dirty = true;
        }
        if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
    }

    fillCell(cell) {
        const dx = (cell.absX - this.anchorX) * this.cellSize;
        const dy = (cell.absY - this.anchorY) * this.cellSize;
        
        const cellCenter = this.center.clone()
            .addScaledVector(this.right, dx)
            .addScaledVector(this.forward, dy);

        for (let j = 0; j < this.perCell; j++) {
            const id = cell.indices[j];
            // Jitter/Overlap del 50% (1.5) para que las celdas se desborden unas sobre otras 
            // y rompan cualquier línea recta o patrón de cuadrícula!
            const rx = (Math.random() - 0.5) * this.cellSize * 1.5;
            const ry = (Math.random() - 0.5) * this.cellSize * 1.5;
            this._dir.copy(cellCenter)
                .addScaledVector(this.right, rx)
                .addScaledVector(this.forward, ry)
                .normalize();

            const h = TerrainBuilder.getHeight(this._dir, this.planetRadius, 'Terran');
            const elev = h - this.planetRadius;
            // El agua está en -28.0. La nieve empieza a los ~6000. Cortamos la hierba a los 5500.
            if (elev < -28.0 || elev > 5500.0) {
                this.hide(id);
                continue;
            }
            
            // Calcular inclinación matemática (Slope)
            const eps = 0.005; 
            const dirX = this._dir.clone().add(this.right.clone().multiplyScalar(eps)).normalize();
            const dirZ = this._dir.clone().add(this.forward.clone().multiplyScalar(eps)).normalize();
            const hx = TerrainBuilder.getHeight(dirX, this.planetRadius, 'Terran');
            const hz = TerrainBuilder.getHeight(dirZ, this.planetRadius, 'Terran');
            
            const dx = (hx - h) / (eps * this.planetRadius);
            const dz = (hz - h) / (eps * this.planetRadius);
            const slope = 1.0 / Math.sqrt(dx*dx + dz*dz + 1.0); // 1.0 = plano, 0.0 = pared vertical
            
            // Si es un acantilado (slope < 0.85 igual que el shader del terreno), es pura roca
            if (slope < 0.85 && elev > -15.0) {
                this.hide(id);
                continue;
            }

            if (!this.patchOk(this._dir, elev)) {
                this.hide(id);
                continue;
            }

            this.dummy.position.copy(this._dir).multiplyScalar(h + this.lift);
            this.dummy.quaternion.setFromUnitVectors(this._up, this._dir);
            this.dummy.rotateY(Math.random() * Math.PI * 2);

            // Escala natural estática (El fade out por distancia se hace en la GPU ahora)
            const s = this.bladeScale * (0.75 + Math.random() * 0.5);
            this.dummy.scale.set(s, s * (0.85 + Math.random() * 0.3), s);
            this.dummy.updateMatrix();
            this.mesh.setMatrixAt(id, this.dummy.matrix);
            
            // Spawn Fireflies (Luciérnagas) flotando mágicamente sobre el pasto (solo en un ~25% de los parches para que sean raras y especiales)
            if (Math.random() > 0.75) {
                // Posicionar un poco por encima del pasto
                this.dummy.position.add(this._dir.clone().multiplyScalar(this.bladeScale * 0.15 + Math.random() * 8.0));
                this.dummy.scale.set(1.5, 1.5, 1.5); // Tamaño de la luciérnaga
                this.dummy.updateMatrix();
                this.fireflyMesh.setMatrixAt(id, this.dummy.matrix);
            } else {
                this.dummy.scale.set(0, 0, 0);
                this.dummy.updateMatrix();
                this.fireflyMesh.setMatrixAt(id, this.dummy.matrix);
            }
        }
    }

    hide(id) {
        this.dummy.position.set(0, 0, 0);
        this.dummy.scale.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(id, this.dummy.matrix);
        this.fireflyMesh.setMatrixAt(id, this.dummy.matrix);
    }
}
