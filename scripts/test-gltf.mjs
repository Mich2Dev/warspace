import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import fs from 'fs';

const scene = new THREE.Scene();
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

const exporter = new GLTFExporter();
exporter.parse(
    scene,
    function (gltf) {
        fs.writeFileSync('test.glb', Buffer.from(gltf));
        console.log('GLB exported successfully!');
    },
    function (error) {
        console.error('Error exporting GLB:', error);
    },
    { binary: true }
);
