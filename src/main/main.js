const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { fetchAllStats } = require('./service');

// Global exception safety to prevent silent exits/crashes
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception in Main Process:', err);
  try {
    const logPath = path.join(app.getPath('userData'), 'crash.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Uncaught Exception: ${err.stack || err}\n`);
  } catch {}
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection in Main Process:', reason);
  try {
    const logPath = path.join(app.getPath('userData'), 'crash.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Unhandled Rejection: ${reason && (reason.stack || reason)}\n`);
  } catch {}
});

// Optimization Flags: Expose GC for memory cleanup, without the restrictive 128MB heap choke that caused crashes
app.commandLine.appendSwitch('js-flags', '--expose-gc');
app.commandLine.appendSwitch('disable-gpu-memory-buffer-video-frames');

// Keep-alive heartbeat interval to ensure the libuv event loop never drains
const keepAliveTimer = setInterval(() => {}, 1000 * 60 * 60);

let mainWindow = null;
let tray = null;
let isQuitting = false;

const htmlPath = path.join(__dirname, '../renderer/index.html');

// IPC Handler: Respond to renderer requests for token stats safely
ipcMain.handle('get-stats', async () => {
  try {
    return await fetchAllStats();
  } catch (err) {
    console.error('IPC get-stats error:', err);
    return { error: err.message || 'Failed to fetch stats' };
  }
});

function showDashboard() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function hideDashboard() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Safely hide the window to tray instead of destroying it.
  // This avoids IPC race conditions, native minimize-animation crashes, and process termination.
  mainWindow.hide();
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
      backgroundThrottling: true,
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
    clearInterval(keepAliveTimer);
  });

  app.on('window-all-closed', () => {
    // Stay running in system tray on Windows with ultra-low memory
  });
}
