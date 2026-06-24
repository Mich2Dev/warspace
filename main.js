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

  // In development, we load from Vite dev server if running, else load file.
  // We'll determine this by checking if the dev url is reachable or simply by env.
  // For simplicity, we'll try to load localhost, and if it fails, load dist.
  win.loadURL('http://localhost:5173').catch(() => {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  });
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
