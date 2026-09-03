const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require('electron');
const path = require('path');
const { fetchAllStats } = require('./service');

// Aggressive Memory & V8 Optimization Flags for Background System Tray Mode
app.commandLine.appendSwitch('js-flags', '--expose-gc --max-old-space-size=128');
app.commandLine.appendSwitch('disable-gpu-memory-buffer-video-frames');

let mainWindow = null;
let tray = null;
let isQuitting = false;

const htmlPath = path.join(__dirname, '../renderer/index.html');

// IPC Handler: Respond to renderer requests for token stats
ipcMain.handle('get-stats', async () => {
  return await fetchAllStats();
});

function showDashboard() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function hideDashboard() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Destroying the window terminates the Chromium Renderer process (~116MB saved immediately)
  // and releases GPU & Network buffers. Only the tiny ~30MB Node.js main process remains in background.
  mainWindow.destroy();
  mainWindow = null;
  if (global.gc) {
    try { global.gc(); } catch {}
  }
}

function createTray() {
  const iconPath = path.join(__dirname, '../../assets/icon.png');
  let icon = nativeImage.createFromPath(iconPath);

  if (icon.isEmpty()) {
    icon = nativeImage.createFromBuffer(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAMklEQVRYR+3QQREAAAzCMPtnmhkb7IsABW5Nkg7W+wEBAQEBAQEBAQEBAQEBAQEBAQGBtwFjgwHNQ5nNawAAAABJRU5ErkJggg==',
        'base64'
      )
    );
  }

  tray = new Tray(icon.resize({ width: 18, height: 18 }));
  tray.setToolTip('AI Token Analytics');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Dashboard',
      click: () => {
        showDashboard();
      },
    },
    {
      label: 'Reload UI',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadFile(htmlPath);
        } else {
          showDashboard();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Exit AI Token Analytics',
      click: () => {
        isQuitting = true;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.destroy();
        }
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      hideDashboard();
    } else {
      showDashboard();
    }
  });
}

function createWindow() {
  const iconPath = path.join(__dirname, '../../assets/icon.png');

  mainWindow = new BrowserWindow({
    width: 1300,
    height: 880,
    minWidth: 960,
    minHeight: 650,
    title: 'AI Token Analytics',
    icon: iconPath,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#e6f7f5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Load static HTML UI directly
  mainWindow.loadFile(htmlPath);

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Minimize to tray on clicking Windows minimize button "_"
  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    hideDashboard();
  });

  // Minimize to tray on clicking Windows close button "X"
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      hideDashboard();
      return false;
    }
  });
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our window instead
    showDashboard();
  });

  app.on('ready', () => {
    createTray();
    createWindow();
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('window-all-closed', () => {
    // Stay running in system tray on Windows with ultra-low memory
  });
}
