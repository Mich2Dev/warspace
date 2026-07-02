/**
 * Compila WarSpace, lo sirve en localhost:5174 y abre un túnel público
 * para que alguien fuera de tu red lo abra en el navegador.
 *
 * Uso: npm run share
 */
const { spawn, execSync } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');

const root = path.join(__dirname, '..');
const PORT = 5174;
const LOCAL_URL = `http://127.0.0.1:${PORT}`;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function isPortInUse(port) {
    return new Promise((resolve) => {
        const tester = net.createServer()
            .once('error', (err) => resolve(err.code === 'EADDRINUSE'))
            .once('listening', () => tester.close(() => resolve(false)))
            .listen(port, '127.0.0.1');
    });
}

/** Libera el puerto matando el proceso que escucha (p. ej. npm start / vite dev). */
function killPort(port) {
    let killed = false;
    try {
        if (process.platform === 'win32') {
            const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            const pids = new Set();
            for (const line of out.split('\n')) {
                if (!/LISTENING/i.test(line)) continue;
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
            }
            for (const pid of pids) {
                try {
                    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
                    killed = true;
                } catch { /* otro proceso */ }
            }
        } else {
            execSync(`lsof -ti:${port} | xargs -r kill -9`, { shell: true, stdio: 'ignore' });
            killed = true;
        }
    } catch { /* puerto libre o sin permisos */ }
    return killed;
}

function run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            cwd: root,
            stdio: opts.inherit ? 'inherit' : 'pipe',
            shell: process.platform === 'win32',
            env: { ...process.env, ...opts.env },
        });
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} salió con código ${code}`))));
    });
}

function waitForServer(url, maxAttempts = 40) {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const check = () => {
            http.get(url, (res) => {
                res.resume();
                resolve();
            }).on('error', () => {
                attempts++;
                if (attempts >= maxAttempts) reject(new Error('El servidor no respondió a tiempo.'));
                else setTimeout(check, 500);
            });
        };
        check();
    });
}

function startPreview() {
    const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
    return spawn(process.execPath, [viteBin, 'preview', '--host', '0.0.0.0', '--port', String(PORT), '--strictPort'], {
        cwd: root,
        stdio: 'inherit',
    });
}

async function ensurePreviewServer() {
    for (let attempt = 1; attempt <= 3; attempt++) {
        if (await isPortInUse(PORT)) {
            console.log(`  ⚠ Puerto ${PORT} ocupado (intento ${attempt}/3). Liberando...\n`);
            killPort(PORT);
            await sleep(1500);
        }

        if (!(await isPortInUse(PORT))) {
            const preview = startPreview();
            try {
                await new Promise((resolve, reject) => {
                    const failTimer = setTimeout(() => resolve(), 5000);
                    preview.once('exit', (code) => {
                        clearTimeout(failTimer);
                        if (code !== 0 && code !== null) {
                            reject(new Error(`vite preview salió con código ${code}`));
                        }
                    });
                    preview.once('error', reject);
                    waitForServer(LOCAL_URL, 40)
                        .then(() => {
                            clearTimeout(failTimer);
                            resolve();
                        })
                        .catch(reject);
                });
                return preview;
            } catch (err) {
                if (!preview.killed) preview.kill();
                if (attempt === 3) throw err;
                console.log(`  Reintentando preview (${err.message})...\n`);
                killPort(PORT);
                await sleep(1500);
            }
        }
    }

    throw new Error(
        `Puerto ${PORT} sigue ocupado.\n` +
        `  → Cierra otras terminales con "npm start" o "npm run dev"\n` +
        `  → O mata el proceso manualmente y vuelve a ejecutar: npm run share`,
    );
}

function startLocaltunnel() {
    const ltBin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'lt.cmd' : 'lt');
    const fs = require('fs');
    if (fs.existsSync(ltBin)) {
        return spawn(ltBin, ['--port', String(PORT)], { cwd: root, stdio: ['inherit', 'pipe', 'pipe'] });
    }
    return spawn('npx', ['--yes', 'localtunnel', '--port', String(PORT)], {
        cwd: root,
        stdio: ['inherit', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
    });
}

function tryCloudflared() {
    return new Promise((resolve) => {
        const localBin = path.join(root, 'scripts', 'cloudflared.exe');
        const fs = require('fs');
        const bin = fs.existsSync(localBin) ? localBin : (process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
        const proc = spawn(bin, ['tunnel', '--url', LOCAL_URL], {
            cwd: root,
            stdio: ['inherit', 'pipe', 'pipe'],
        });
        let resolved = false;
        const onData = (chunk) => {
            const text = chunk.toString();
            process.stdout.write(text);
            const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
            if (match && !resolved) {
                resolved = true;
                resolve({ proc, url: match[0] });
            }
        };
        proc.stdout.on('data', onData);
        proc.stderr.on('data', onData);
        proc.on('error', () => resolve(null));
        setTimeout(() => {
            if (!resolved) {
                proc.kill();
                resolve(null);
            }
        }, 12000);
    });
}

function watchLocaltunnel(proc) {
    return new Promise((resolve, reject) => {
        let buf = '';
        const onData = (chunk) => {
            const text = chunk.toString();
            process.stdout.write(text);
            buf += text;
            const match = buf.match(/https:\/\/[^\s]+\.loca\.lt/i);
            if (match) resolve({ proc, url: match[0].trim() });
        };
        proc.stdout.on('data', onData);
        proc.stderr.on('data', onData);
        proc.on('error', reject);
        proc.on('close', (code) => {
            if (code !== 0 && code !== null) reject(new Error('localtunnel se cerró.'));
        });
    });
}

async function main() {
    console.log('\n  WarSpace — modo compartir remoto\n');

    if (await isPortInUse(PORT)) {
        console.log(`  Liberando puerto ${PORT} antes de compilar...\n`);
        killPort(PORT);
        await sleep(1200);
    }

    console.log('  1/3 Compilando...\n');
    await run('npm', ['run', 'build'], { inherit: true });

    console.log('\n  2/3 Sirviendo en', LOCAL_URL, '\n');
    const preview = await ensurePreviewServer();
    let shuttingDown = false;

    function shutdown() {
        if (shuttingDown) return;
        shuttingDown = true;
        if (preview && !preview.killed) preview.kill();
        process.exit(0);
    }
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    preview.on('close', (code) => {
        if (!shuttingDown && code !== 0 && code !== null) {
            console.error(`\n  El servidor preview se cerró (código ${code}).`);
        }
        shutdown();
    });

    console.log('  3/3 Abriendo túnel público...\n');

    let tunnel = await tryCloudflared();
    if (!tunnel) {
        console.log('  (cloudflared no encontrado — usando localtunnel)\n');
        tunnel = await watchLocaltunnel(startLocaltunnel());
    }

    console.log('\n══════════════════════════════════════════════════════');
    console.log('  SALA — Enlace para TODOS (mismo enlace obligatorio):');
    console.log('\n  ', tunnel.url);
    console.log('\n  Host y amigos abren ESE enlace (no mezclar con npm start aparte).');
    console.log('  Cada uno: nick distinto → Entrar a la sala.');
    console.log('  Cierra esta terminal cuando terminen (Ctrl+C).');
    console.log('══════════════════════════════════════════════════════\n');
    console.log('  Con localtunnel la 1ª vez puede pedir "Click to Continue".\n');
}

main().catch((err) => {
    console.error('\nError:', err.message);
    process.exit(1);
});
