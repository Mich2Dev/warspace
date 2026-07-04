import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class RemotePlayer {
  constructor(scene) {
    this.mesh = new THREE.Group();
    scene.add(this.mesh);
    
    // Load the same ship model
    const loader = new GLTFLoader();
    loader.load('/nave1.glb', (gltf) => {
      const model = gltf.scene;
      this.mesh.add(model);
    });
    
    // Engine Thruster Flames (Real Volumetric Particle System)
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    gradient.addColorStop(0.2, 'rgba(200, 230, 255, 0.8)');
    gradient.addColorStop(0.5, 'rgba(0, 100, 255, 0.4)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    
    const particleTexture = new THREE.CanvasTexture(canvas);
    const particleMat = new THREE.SpriteMaterial({
      map: particleTexture,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    });
    
    this.engineParticles = [];
    for (let i = 0; i < 200; i++) {
      const sprite = new THREE.Sprite(particleMat.clone());
      sprite.visible = false;
      this.mesh.add(sprite);
      this.engineParticles.push({
        mesh: sprite,
        life: 0,
        maxLife: 0,
        velocity: new THREE.Vector3(),
        baseScale: 1
      });
    }
    
    this.nozzleSettings = [
      { pos: new THREE.Vector3(0, 0.16, 11.55), scale: 1.8 },
      { pos: new THREE.Vector3(-1.56, 2.14, 13.5), scale: 0.9 },
      { pos: new THREE.Vector3(1.56, 2.14, 13.5), scale: 0.9 },
      { pos: new THREE.Vector3(-5.26, -0.58, 13.5), scale: 2.1 },
      { pos: new THREE.Vector3(5.26, -0.58, 13.5), scale: 2.1 }
    ];
    
    this.engineLight = new THREE.PointLight(0x00aaff, 4, 150);
    this.engineLight.position.set(0, -6, 20);
    this.mesh.add(this.engineLight);
    
    // State coming from network
    this.targetFlameScale = 0;
    
    // Smooth interpolation targets
    this.targetPosition = new THREE.Vector3();
    this.targetQuaternion = new THREE.Quaternion();
    
    // Player HUD Marker
    this.marker = document.createElement('div');
    this.marker.className = 'player-marker';
    this.marker.innerHTML = `
      <div class="bracket">[</div>
      <div class="marker-content">
        <span class="marker-title">AMIGO</span>
        <span class="player-distance">0m</span>
        <div class="enemy-health-bar"><div class="enemy-health-fill"></div></div>
      </div>
      <div class="bracket">]</div>
    `;
    this.marker.style.position = 'absolute';
    this.marker.style.display = 'none';
    this.marker.style.color = '#00ff88';
    this.marker.style.fontFamily = "'Courier New', Courier, monospace";
    this.marker.style.display = 'flex';
    this.marker.style.alignItems = 'center';
    this.marker.style.justifyContent = 'center';
    this.marker.style.gap = '5px';
    this.marker.style.pointerEvents = 'none';
    this.marker.style.zIndex = '100';
    this.marker.style.textShadow = '0 0 5px rgba(0, 255, 136, 0.8)';
    document.body.appendChild(this.marker);
    
    this.distLabel = this.marker.querySelector('.player-distance');
    this.hpFill = this.marker.querySelector('.enemy-health-fill');
    
    // Combat State
    this.hp = 100;
    this.isDead = false;
    
    // Explosion Particles
    this.explosionParticles = [];
    for (let i = 0; i < 300; i++) {
      const sprite = new THREE.Sprite(particleMat.clone());
      sprite.visible = false;
      this.mesh.add(sprite); // added to mesh so it explodes outward from local center
      this.explosionParticles.push({
        mesh: sprite,
        velocity: new THREE.Vector3(),
        life: 0
      });
    }
  }
  
  // Se llama cada vez que recibimos un paquete del servidor
  updateNetworkState(data) {
    this.targetPosition.set(data.position.x, data.position.y, data.position.z);
    this.targetQuaternion.set(data.rotation.x, data.rotation.y, data.rotation.z, data.rotation.w);
    this.targetFlameScale = data.flameScale;
  }
  
  // Se llama en cada frame de renderizado
  update(delta, camera, localPosition) {
    // Interpolar suavemente hacia la posición y rotación real (para evitar lagazos)
    this.mesh.position.lerp(this.targetPosition, 0.3);
    this.mesh.quaternion.slerp(this.targetQuaternion, 0.3);
    
    // Actualizar sistema de fuego
    if (this.targetFlameScale > 0) {
      let targetFlameColor = 0x00ffff;
      if (this.targetFlameScale > 2.0) {
        targetFlameColor = 0xffaa00; // Naranja si usa boost
      }
      
      const particlesToSpawn = Math.floor(this.targetFlameScale * 5); 
      for(let i=0; i<particlesToSpawn; i++) {
        const p = this.engineParticles.find(p => p.life <= 0);
        if (p) {
          const nozzle = this.nozzleSettings[Math.floor(Math.random() * 5)];
          p.mesh.position.copy(nozzle.pos);
          p.mesh.position.x += (Math.random() - 0.5) * nozzle.scale * 0.5;
          p.mesh.position.y += (Math.random() - 0.5) * nozzle.scale * 0.5;
          p.mesh.visible = true;
          p.life = 0.2 + Math.random() * 0.2;
          p.maxLife = p.life;
          p.velocity.set(
            (Math.random() - 0.5) * 5,
            (Math.random() - 0.5) * 5,
            40 + Math.random() * 20 + this.targetFlameScale * 30
          );
          p.baseScale = nozzle.scale * this.targetFlameScale * 2.5;
          p.mesh.material.color.setHex(targetFlameColor);
        }
      }
      this.engineLight.color.setHex(targetFlameColor);
      this.engineLight.intensity = this.targetFlameScale * 2;
    } else {
      this.engineLight.intensity = 0;
    }
    
    for (const p of this.engineParticles) {
      if (p.life > 0) {
        p.life -= delta;
        p.mesh.position.addScaledVector(p.velocity, delta);
        const ratio = p.life / p.maxLife;
        p.mesh.scale.setScalar(p.baseScale * ratio);
        p.mesh.material.opacity = ratio;
        if (p.life <= 0) {
          p.mesh.visible = false;
        }
      }
    }
    
    // Update Explosion Particles
    for (const ep of this.explosionParticles) {
      if (ep.life > 0) {
        ep.life -= delta;
        ep.mesh.position.addScaledVector(ep.velocity, delta);
        ep.mesh.scale.setScalar(ep.life * 20); // Shrinks over time
        ep.mesh.material.opacity = ep.life;
        if (ep.life <= 0) ep.mesh.visible = false;
      }
    }
    
    // Update HUD Marker position
    if (camera && localPosition) {
      const dist = this.mesh.position.distanceTo(localPosition);
      this.distLabel.innerText = Math.round(dist) + 'm';
      
      const screenPos = this.mesh.position.clone();
      
      const toTarget = new THREE.Vector3().subVectors(screenPos, camera.position).normalize();
      const cameraForward = new THREE.Vector3();
      camera.getWorldDirection(cameraForward);
      
      screenPos.project(camera);
      
      // Check if it's in front of the camera using dot product
      if (toTarget.dot(cameraForward) > 0) {
        this.marker.style.display = 'flex';
        const x = (screenPos.x *  0.5 + 0.5) * window.innerWidth;
        const y = (screenPos.y * -0.5 + 0.5) * window.innerHeight;
        // Center the marker on the coordinate
        this.marker.style.transform = `translate(-50%, -50%)`;
        this.marker.style.left = `${x}px`;
        this.marker.style.top = `${y}px`;
      } else {
        this.marker.style.display = 'none';
      }
    }
  }
  
  takeDamage(newHp) {
    this.hp = newHp;
    if (this.hpFill) {
      this.hpFill.style.width = `${Math.max(0, this.hp)}%`;
      if (this.hp <= 30) this.hpFill.style.backgroundColor = 'red';
      else if (this.hp <= 60) this.hpFill.style.backgroundColor = 'orange';
      else this.hpFill.style.backgroundColor = '#00ff88';
    }
  }
  
  die() {
    this.isDead = true;
    this.targetFlameScale = 0;
    
    // Hide ship model
    for(const child of this.mesh.children) {
      if (child.isGroup || child.type === 'Scene') child.visible = false;
    }
    
    // Trigger Explosion
    for (const ep of this.explosionParticles) {
      ep.mesh.position.set(0, 0, 0); // Start at ship center
      ep.velocity.set(
        (Math.random() - 0.5) * 500,
        (Math.random() - 0.5) * 500,
        (Math.random() - 0.5) * 500
      );
      ep.mesh.material.color.setHex(0xffaa00);
      ep.life = 1.0 + Math.random(); // 1 to 2 seconds
      ep.mesh.visible = true;
    }
    
    if (this.marker) {
      const title = this.marker.querySelector('.marker-title');
      if(title) title.innerText = 'DESTRUIDO';
    }
  }
  
  respawn(position) {
    this.isDead = false;
    this.hp = 100;
    this.takeDamage(100);
    this.targetPosition.copy(position);
    this.mesh.position.copy(position);
    
    // Show ship model
    for(const child of this.mesh.children) {
      if (child.isGroup || child.type === 'Scene') child.visible = true;
    }
    
    if (this.marker) {
      const title = this.marker.querySelector('.marker-title');
      if(title) title.innerText = 'AMIGO';
    }
  }

  destroy(scene) {
    scene.remove(this.mesh);
    if (this.marker && this.marker.parentNode) {
      this.marker.parentNode.removeChild(this.marker);
    }
  }
}
