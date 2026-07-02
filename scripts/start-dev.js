const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');

const root = path.join(__dirname, '..');
const PORT = 5175;
const VITE_URL = `http://127.0.0.1:${PORT}`;

const env = { ...process.env, WARSPACE_DEV_URL: VITE_URL };

function isPortInUse(port) {
    return new Promise((resolve) => {
        const tester = net.createServer()
            .once('error', (err) => resolve(err.code === 'EADDRINUSE'))
            .once('listening', () => tester.close(() => resolve(false)))
            .listen(port, '127.0.0.1');
    });
}

function waitForServer(url, maxAttempts = 60) {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const check = () => {
            http.get(url, (res) => {
                res.resume();
                resolve();
            }).on('error', () => {
                attempts++;
                if (attempts >= maxAttempts) {
                    reject(new Error(`Vite no respondió en ${url} a tiempo.`));
                } else {
                    setTimeout(check, 500);
                }
            });
        };
        check();
    });
}

function spawnVite() {
    const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
    return spawn(process.execPath, [viteBin, '--host', '0.0.0.0', '--port', String(PORT), '--strictPort'], {
        cwd: root,
        stdio: 'inherit',
        env
    });
}

function spawnElectron() {
    const electronPath = require('electron');
    return spawn(electronPath, ['.'], {
        cwd: root,
        stdio: 'inherit',
        env
    });
}

async function main() {
    console.log('WarSpace — iniciando...\n');

    if (await isPortInUse(PORT)) {
        console.log(`El puerto ${PORT} ya está en uso. Asumiendo que Vite ya está corriendo en segundo plano.`);
        console.log('Conectando directamente...\n');
        
        let electron = spawnElectron();
        electron.on('close', (code) => process.exit(code ?? 0));
        return;
    }

    const vite = spawnVite();
    let electron = null;
    let shuttingDown = false;

    function shutdown(code = 0) {
        if (shuttingDown) return;
        shuttingDown = true;
        if (electron && !electron.killed) electron.kill();
        if (vite && !vite.killed) vite.kill();
        process.exit(code);
    }

    process.on('SIGINT', () => shutdown(0));
    process.on('SIGTERM', () => shutdown(0));

    vite.on('error', (err) => {
        console.error('No se pudo iniciar Vite:', err.message);
        shutdown(1);
    });

    vite.on('close', (code) => {
        if (!shuttingDown) shutdown(code ?? 0);
    });

    try {
        await waitForServer(VITE_URL);
        console.log('\nServidor listo (multijugador incluido en la misma URL).');
        console.log('Abriendo ventana del juego...\n');

        electron = spawnElectron();

        electron.on('error', (err) => {
            console.error('No se pudo iniciar Electron:', err.message);
            shutdown(1);
        });

        electron.on('close', (code) => shutdown(code ?? 0));
    } catch (err) {
        console.error(err.message);
        shutdown(1);
    }
}

main();
