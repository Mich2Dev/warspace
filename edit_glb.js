const fs = require('fs');

function squashGLB(filePath) {
    console.log("Procesando:", filePath);
    const buf = fs.readFileSync(filePath);
    
    // Parse GLB Header
    const magic = buf.readUInt32LE(0);
    if (magic !== 0x46546C67) { console.error("No es GLB"); return; }
    
    // Parse JSON Chunk
    const jsonLen = buf.readUInt32LE(12);
    const jsonStr = buf.toString('utf8', 20, 20 + jsonLen);
    const gltf = JSON.parse(jsonStr);
    
    // Parse BIN Chunk
    const binOffset = 20 + jsonLen;
    const binLen = buf.readUInt32LE(binOffset);
    const binData = buf.subarray(binOffset + 8, binOffset + 8 + binLen);
    
    // Find all POSITION accessors
    const positionAccessors = [];
    if (gltf.meshes) {
        gltf.meshes.forEach(m => {
            m.primitives.forEach(p => {
                if (p.attributes.POSITION !== undefined) {
                    positionAccessors.push(p.attributes.POSITION);
                }
            });
        });
    }
    
    if (positionAccessors.length === 0) return;
    
    // Hemos verificado empíricamente que los modelos enemi2 y base1 fueron exportados en Z-up 
    // sin el nodo de rotación raíz correctivo. Por lo tanto, el eje de altura real en la data binaria es Z.
    const heightAxis = 2; // 2 es Z
    
    console.log(filePath, "heightAxis forced to:", heightAxis);

    let minH = Infinity;
    let maxH = -Infinity;
    
    positionAccessors.forEach(accIdx => {
        const accessor = gltf.accessors[accIdx];
        if (accessor.min && accessor.max) {
            minH = Math.min(minH, accessor.min[heightAxis]);
            maxH = Math.max(maxH, accessor.max[heightAxis]);
        }
    });
    
    const sizeH = maxH - minH;
    // Aumentamos el corte al 33% para llevarnos también los pequeños conectores metálicos (los "nubs") 
    // y dejar la panza 100% lisa.
    const squashThreshold = minH + (sizeH * 0.33); 
    const swallow = minH + (sizeH * 0.5); // Centro de la panza
    
    let modified = false;
    
    positionAccessors.forEach(accIdx => {
        const accessor = gltf.accessors[accIdx];
        const bufferView = gltf.bufferViews[accessor.bufferView];
        const offset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
        
        // El accessor podría usar un "byteStride"
        const stride = bufferView.byteStride !== undefined ? bufferView.byteStride : 12;
        
        // VEC3 Float32
        for (let i = 0; i < accessor.count; i++) {
            const bytePos = offset + (i * stride);
            const val = binData.readFloatLE(bytePos + (heightAxis * 4));
            if (val < squashThreshold) {
                binData.writeFloatLE(swallow, bytePos + (heightAxis * 4));
                modified = true;
            }
        }
        
        // Actualizar min/max en el JSON
        if (accessor.min && accessor.max) {
            accessor.min[heightAxis] = squashThreshold; // El nuevo mínimo es el umbral
        }
    });
    
    if (modified) {
        // Tenemos que reescribir el JSON porque modificamos los min/max
        const newJsonStr = JSON.stringify(gltf);
        // Pad with spaces to match 4-byte boundary
        const paddedJsonLen = Math.ceil(newJsonStr.length / 4) * 4;
        const newJsonBuf = Buffer.alloc(paddedJsonLen, ' ');
        newJsonBuf.write(newJsonStr, 'utf8');
        
        // Construir nuevo GLB
        const newBuf = Buffer.alloc(20 + paddedJsonLen + 8 + binLen);
        
        // Header
        newBuf.writeUInt32LE(0x46546C67, 0); // magic
        newBuf.writeUInt32LE(2, 4); // version
        newBuf.writeUInt32LE(newBuf.length, 8); // length
        
        // JSON Chunk
        newBuf.writeUInt32LE(paddedJsonLen, 12);
        newBuf.writeUInt32LE(0x4E4F534A, 16); // 'JSON'
        newJsonBuf.copy(newBuf, 20);
        
        // BIN Chunk
        const newBinOffset = 20 + paddedJsonLen;
        newBuf.writeUInt32LE(binLen, newBinOffset);
        newBuf.writeUInt32LE(0x004E4942, newBinOffset + 4); // 'BIN\0'
        binData.copy(newBuf, newBinOffset + 8);
        
        fs.writeFileSync(filePath, newBuf);
        console.log("¡Éxito! Las llantas de", filePath, "han sido amputadas desde el archivo binario.");
    } else {
        console.log("No se detectaron vértices en el umbral inferior.");
    }
}

squashGLB('C:/Users/maiko/OneDrive/Escritorio/jg/public/models/zona2/enemi2.glb');
squashGLB('C:/Users/maiko/OneDrive/Escritorio/jg/public/models/zona1/base1.glb');
