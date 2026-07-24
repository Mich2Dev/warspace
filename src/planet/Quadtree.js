import * as THREE from 'three';
import { TerrainBuilder } from './TerrainBuilder.js';

const MAX_DEPTH = 6; // was 7 — less cascade = no freeze near surface

// Async chunk queue (1/frame keeps the game responsive)
const chunkQueue = [];
let isGenerating = false;
const CHUNKS_PER_FRAME = 1;
const MAX_QUEUE = 20; // hard cap so LOD never snowballs the main thread

async function processChunkQueue() {
  if (isGenerating) return;
  isGenerating = true;
  while (chunkQueue.length > 0) {
    const batch = Math.min(CHUNKS_PER_FRAME, chunkQueue.length);
    for (let i = 0; i < batch; i++) {
      const task = chunkQueue.shift();
      try { task(); } catch (e) { console.warn('[Quadtree] chunk build failed', e); }
    }
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
  isGenerating = false;
}

function queueBusy() {
  return chunkQueue.length >= MAX_QUEUE;
}

export class Quadtree {
  constructor(group, localUp, radius, color, biome = 'Terran', depth = 0, center = new THREE.Vector2(0, 0), size = 2) {
    this.group = group;
    this.localUp = localUp;
    this.radius = radius;
    this.color = color;
    this.biome = biome;
    this.depth = depth;
    this.center = center;
    this.size = size;

    this.isLeaf = true;
    this.children = [];
    this._destroyed = false;
    this._pendingMesh = false;
    this._splitPending = false;
    this._mergePending = false;

    this.axisA = new THREE.Vector3(localUp.y, localUp.z, localUp.x);
    this.axisB = new THREE.Vector3().crossVectors(localUp, this.axisA);

    const pointOnCube = new THREE.Vector3()
      .copy(this.localUp)
      .addScaledVector(this.axisA, this.center.x)
      .addScaledVector(this.axisB, this.center.y);

    this.localCenter = pointOnCube.normalize().multiplyScalar(this.radius);
    this.worldCenter = this.localCenter.clone().add(this.group.position);
    this._currentWorldCenter = new THREE.Vector3();

    this.mesh = null;
    if (this.isLeaf) {
      this.buildMesh();
    }
  }

  buildMesh(onReady = null) {
    if (this._destroyed || this._pendingMesh) return;
    this._pendingMesh = true;

    chunkQueue.push(() => {
      this._pendingMesh = false;
      if (this._destroyed) {
        if (onReady) onReady(false);
        return;
      }
      if (!this.isLeaf && !this._splitPending) {
        if (onReady) onReady(false);
        return;
      }
      if (this.mesh) {
        if (onReady) onReady(true);
        return;
      }

      this.mesh = TerrainBuilder.buildChunk(
        this.localUp, this.axisA, this.axisB,
        this.radius, this.center, this.size, this.color, this.biome
      );
      this.mesh.isTerrainChunk = true;
      this.group.add(this.mesh);
      if (onReady) onReady(true);
    });
    processChunkQueue();
  }

  removeMesh() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      // Don't dispose material here if shared — TerrainBuilder creates per-chunk materials
      if (this.mesh.material) {
        if (Array.isArray(this.mesh.material)) this.mesh.material.forEach(m => m.dispose());
        else this.mesh.material.dispose();
      }
      this.group.remove(this.mesh);
      this.mesh = null;
    }
  }

  childrenReady() {
    if (this.children.length !== 4) return false;
    for (const c of this.children) {
      if (!c.mesh) return false;
    }
    return true;
  }

  update(cameraPosition, spaceshipSpeed = 0) {
    if (this._destroyed) return;

    this._currentWorldCenter.copy(this.localCenter).applyQuaternion(this.group.quaternion).add(this.group.position);
    const distance = cameraPosition.distanceTo(this._currentWorldCenter);
    const worldSize = this.size * this.radius;

    let dynamicMaxDepth = MAX_DEPTH;
    if (spaceshipSpeed > 80000) dynamicMaxDepth = 4;
    else if (spaceshipSpeed > 20000) dynamicMaxDepth = 5;

    let splitFactor = 1.6;
    if (this.depth > 3) splitFactor = 1.3;
    if (this.depth > 5) splitFactor = 1.1;
    const splitThreshold = worldSize * splitFactor;

    if (this._splitPending && this.childrenReady()) {
      this.removeMesh();
      this._splitPending = false;
    }

    if (this._mergePending && this.mesh) {
      for (const child of this.children) child.destroy();
      this.children = [];
      this._mergePending = false;
    }

    const busy = this._splitPending || this._mergePending || this._pendingMesh;

    // Never split if the global build queue is backed up (prevents freeze)
    if (!busy && this.isLeaf && this.mesh && this.depth < dynamicMaxDepth && distance < splitThreshold && !queueBusy()) {
      this.split();
    } else if (!busy && !this.isLeaf && distance > splitThreshold * 1.35) {
      this.merge();
    } else if (!busy && !this.isLeaf && this.depth >= dynamicMaxDepth) {
      this.merge();
    }

    // During split/merge pending: children may finish building, but should not cascade-subdivide yet
    if (!this.isLeaf || this._splitPending || this._mergePending) {
      const allowChildSplit = !this._splitPending && !this._mergePending;
      for (const child of this.children) {
        if (allowChildSplit) {
          child.update(cameraPosition, spaceshipSpeed);
        } else if (child._splitPending || child._mergePending || !child.isLeaf) {
          // Still resolve in-flight transitions without starting new deep cascades
          child._resolvePendingOnly();
        }
      }
    }
  }

  /** Only finish pending split/merge without starting new ones (anti-cascade). */
  _resolvePendingOnly() {
    if (this._destroyed) return;
    if (this._splitPending && this.childrenReady()) {
      this.removeMesh();
      this._splitPending = false;
    }
    if (this._mergePending && this.mesh) {
      for (const child of this.children) child.destroy();
      this.children = [];
      this._mergePending = false;
    }
    for (const child of this.children) {
      if (!child.isLeaf || child._splitPending || child._mergePending) {
        child._resolvePendingOnly();
      }
    }
  }

  split() {
    this.isLeaf = false;
    this._splitPending = true;
    this._mergePending = false;

    const childSize = this.size / 2;
    const offset = this.size / 4;

    this.children = [
      new Quadtree(this.group, this.localUp, this.radius, this.color, this.biome, this.depth + 1, new THREE.Vector2(this.center.x - offset, this.center.y - offset), childSize),
      new Quadtree(this.group, this.localUp, this.radius, this.color, this.biome, this.depth + 1, new THREE.Vector2(this.center.x + offset, this.center.y - offset), childSize),
      new Quadtree(this.group, this.localUp, this.radius, this.color, this.biome, this.depth + 1, new THREE.Vector2(this.center.x - offset, this.center.y + offset), childSize),
      new Quadtree(this.group, this.localUp, this.radius, this.color, this.biome, this.depth + 1, new THREE.Vector2(this.center.x + offset, this.center.y + offset), childSize),
    ];
  }

  merge() {
    if (this._mergePending) return;

    this._splitPending = false;
    this.isLeaf = true;
    this._mergePending = true;

    if (this.mesh) {
      for (const child of this.children) child.destroy();
      this.children = [];
      this._mergePending = false;
      return;
    }

    this.buildMesh((ok) => {
      if (!ok || this._destroyed) return;
      if (this.mesh && this._mergePending) {
        for (const child of this.children) child.destroy();
        this.children = [];
        this._mergePending = false;
      }
    });
  }

  destroy() {
    this._destroyed = true;
    this._splitPending = false;
    this._mergePending = false;
    this.removeMesh();
    for (const child of this.children) child.destroy();
    this.children = [];
  }
}
