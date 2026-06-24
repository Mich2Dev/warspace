const https = require('https');
const fs = require('fs');
const path = require('path');

const texturesDir = path.join(__dirname, '../public/textures');

if (!fs.existsSync(texturesDir)) {
    fs.mkdirSync(texturesDir, { recursive: true });
}

const filesToDownload = [
    {
        url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/aerial_rocks_02/aerial_rocks_02_diff_1k.jpg',
        filename: 'rock_diffuse.jpg'
    },
    {
        url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/aerial_rocks_02/aerial_rocks_02_nor_gl_1k.jpg',
        filename: 'rock_normal.jpg'
    },
    {
        url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/aerial_rocks_02/aerial_rocks_02_rough_1k.jpg',
        filename: 'rock_rough.jpg'
    }
];

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, function(response) {
            response.pipe(file);
            file.on('finish', function() {
                file.close(() => resolve(dest));
            });
        }).on('error', function(err) {
            fs.unlink(dest, () => {}); 
            reject(err);
        });
    });
}

async function main() {
    console.log('Downloading high-res PBR textures...');
    for (const file of filesToDownload) {
        const dest = path.join(texturesDir, file.filename);
        try {
            await downloadFile(file.url, dest);
            console.log(`Downloaded ${file.filename}`);
        } catch (e) {
            console.error(`Failed to download ${file.filename}:`, e);
        }
    }
    console.log('All textures downloaded successfully!');
}

main();
