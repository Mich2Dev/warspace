const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const modelsDir = path.join(__dirname, 'public', 'models');

function compressGlb(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.glb') return;
    
    const stat = fs.statSync(filePath);
    const sizeMB = stat.size / (1024 * 1024);
    
    // Solo comprimir si es mayor a 1MB para evitar perder tiempo en partículas enanas
    if (sizeMB > 1.0) {
        console.log(`Comprimiendo: ${filePath} (${sizeMB.toFixed(2)} MB)`);
        const tempPath = filePath + '.temp.glb';
        try {
            execSync(`npx gltf-pipeline -i "${filePath}" -o "${tempPath}" -d --draco.compressionLevel 7`, { stdio: 'inherit' });
            
            // Reemplazar el original con el comprimido
            if (fs.existsSync(tempPath)) {
                fs.copyFileSync(tempPath, filePath);
                fs.unlinkSync(tempPath);
                
                const newSize = fs.statSync(filePath).size / (1024 * 1024);
                console.log(`✅ ¡Éxito! Nuevo tamaño: ${newSize.toFixed(2)} MB`);
            }
        } catch (e) {
            console.error(`❌ Error comprimiendo ${filePath}:`, e.message);
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        }
    } else {
        console.log(`Saltando (muy ligero): ${filePath} (${sizeMB.toFixed(2)} MB)`);
    }
}

function traverseDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            traverseDir(fullPath);
        } else {
            compressGlb(fullPath);
        }
    }
}

console.log("Iniciando compresión de modelos en", modelsDir);
traverseDir(modelsDir);
console.log("¡Compresión finalizada!");
