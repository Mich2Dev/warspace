const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const devUrl = process.env.WARSPACE_DEV_URL || 'http://127.0.0.1:5174';
  const distIndex = path.join(__dirname, 'dist', 'index.html');

  async function loadGame() {
    try {
      await win.loadURL(devUrl);
    } catch {
      try {
        await win.loadFile(distIndex);
      } catch {
        win.loadURL(`data:text/html,<h2>WarSpace</h2><p>Ejecuta <code>npm start</code> desde la raíz del proyecto.</p>`);
      }
    }
  }

  loadGame();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
