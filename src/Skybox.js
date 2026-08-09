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
        const baseCount = 7000;
        const basePos = new Float32Array(baseCount * 3);
        const baseColors = new Float32Array(baseCount * 3);
        
        const color1 = new THREE.Color(0xffffff); // White
        const color2 = new THREE.Color(0xaaaaff); // Blueish
        const color3 = new THREE.Color(0xffccaa); // Reddish/Orange
        
        for(let i=0; i<baseCount; i++) {
            // Generate random points on a massive sphere
            const r = 500000000 + Math.random() * 500000000; // Between 500M and 1B units away
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
            size: 800000, // Size in world units (they are extremely far away)
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
        const brightCount = 600;
        const brightPos = new Float32Array(brightCount * 3);
        const brightColors = new Float32Array(brightCount * 3);
        
        for(let i=0; i<brightCount; i++) {
            const r = 400000000 + Math.random() * 200000000;
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
            size: 2500000, 
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

    update(time) {
        // Points don't need update unless we want them to twinkle, which is expensive on CPU.
        // For realistic space, stars don't twinkle when viewed from outside an atmosphere!
    }
}
