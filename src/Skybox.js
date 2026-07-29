import * as THREE from 'three';

export class Skybox {
    constructor(scene) {
        this.scene = scene;
        this.createRealisticStars();
    }
    
    createRealisticStars() {
        const starGroup = new THREE.Group();
        
        // 1. Base Stars (Small and numerous)
        const baseGeom = new THREE.BufferGeometry();
        const baseCount = 20000;
        const basePos = new Float32Array(baseCount * 3);
        const baseColors = new Float32Array(baseCount * 3);
        
        const color1 = new THREE.Color(0xffffff); // White
        const color2 = new THREE.Color(0xaaaaff); // Blueish
        const color3 = new THREE.Color(0xffccaa); // Reddish/Orange
        
        for(let i=0; i<baseCount; i++) {
            // Generate random points on a massive sphere
            // Siempre dentro del far plane de la cámara principal (500M).
            const r = 120000000 + Math.random() * 80000000;
            const theta = 2 * Math.PI * Math.random();
            const phi = Math.acos(2 * Math.random() - 1);
            
            basePos[i*3] = r * Math.sin(phi) * Math.cos(theta);
            basePos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
            basePos[i*3+2] = r * Math.cos(phi);
            
            // Subtle color variation
            const rand = Math.random();
            let c = color1;
            if (rand > 0.8) c = color2;
            if (rand < 0.2) c = color3;
            
            baseColors[i*3] = c.r * (0.5 + Math.random()*0.5);
            baseColors[i*3+1] = c.g * (0.5 + Math.random()*0.5);
            baseColors[i*3+2] = c.b * (0.5 + Math.random()*0.5);
        }
        
        baseGeom.setAttribute('position', new THREE.BufferAttribute(basePos, 3));
        baseGeom.setAttribute('color', new THREE.BufferAttribute(baseColors, 3));
        
        // Create a circular texture for the points
        const canvas = document.createElement('canvas');
        canvas.width = 16; canvas.height = 16;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.2, 'rgba(255,255,255,0.8)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0,0,16,16);
        const tex = new THREE.CanvasTexture(canvas);
        
        const baseMat = new THREE.PointsMaterial({
            size: 260000,
            map: tex,
            vertexColors: true,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        
        const baseStars = new THREE.Points(baseGeom, baseMat);
        starGroup.add(baseStars);
        
        // 2. Bright Stars (Fewer, larger)
        const brightGeom = new THREE.BufferGeometry();
        const brightCount = 2000;
        const brightPos = new Float32Array(brightCount * 3);
        const brightColors = new Float32Array(brightCount * 3);
        
        for(let i=0; i<brightCount; i++) {
            const r = 100000000 + Math.random() * 80000000;
            const theta = 2 * Math.PI * Math.random();
            const phi = Math.acos(2 * Math.random() - 1);
            
            brightPos[i*3] = r * Math.sin(phi) * Math.cos(theta);
            brightPos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
            brightPos[i*3+2] = r * Math.cos(phi);
            
            brightColors[i*3] = 1.0;
            brightColors[i*3+1] = 1.0;
            brightColors[i*3+2] = 1.0;
        }
        
        brightGeom.setAttribute('position', new THREE.BufferAttribute(brightPos, 3));
        brightGeom.setAttribute('color', new THREE.BufferAttribute(brightColors, 3));
        
        const brightMat = new THREE.PointsMaterial({
            size: 850000,
            map: tex,
            vertexColors: true,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        
        const brightStars = new THREE.Points(brightGeom, brightMat);
        starGroup.add(brightStars);
        
        // Pure black background
        this.scene.background = new THREE.Color(0x000000);
        
        starGroup.renderOrder = -100;
        this.scene.add(starGroup);
        this.mesh = starGroup; // required for setOpacity (stars fade inside atmosphere)
        return starGroup;
    }
    
    setOpacity(opacity) {
        if (!this.mesh) return;
        const o = THREE.MathUtils.clamp(opacity, 0, 1);
        this.mesh.visible = o > 0.02;
        this.mesh.children.forEach(child => {
            if (child.material) {
                child.material.opacity = o;
                child.material.transparent = true;
                // Hide fully so additive stars don't show through blue sky
                child.visible = o > 0.02;
            }
        });
    }

    update(time, cameraPosition = null) {
        // La esfera de estrellas sigue a la cámara. En viajes de cientos de
        // millones de unidades, dejarla en el origen hacía que la nave saliera
        // fuera de ella y aparecieran sectores completamente negros.
        if (this.mesh && cameraPosition) {
            this.mesh.position.copy(cameraPosition);
        }
    }
}
