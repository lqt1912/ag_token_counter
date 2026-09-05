const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } = require('electron');
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
let miniWindow = null;
let isMiniVisible = true;
let tray = null;
let isQuitting = false;

const htmlPath = path.join(__dirname, '../renderer/index.html');
const miniHtmlPath = path.join(__dirname, '../renderer/mini.html');

// IPC Handler: Respond to renderer requests for token stats safely
ipcMain.handle('get-stats', async () => {
  try {
    return await fetchAllStats();
  } catch (err) {
    console.error('IPC get-stats error:', err);
    return { error: err.message || 'Failed to fetch stats' };
  }
});

// IPC Handler: Open/show full dashboard from mini widget or tray
ipcMain.handle('open-dashboard', () => {
  showDashboard();
});

// IPC Handler: Toggle mini widget visibility
ipcMain.handle('toggle-mini-widget', (event, visible) => {
  toggleMiniWidget(visible);
});

// IPC Handler: Dynamically resize and re-center mini widget when text expands or shrinks
ipcMain.handle('resize-mini-widget', (event, contentWidth) => {
  if (!miniWindow || miniWindow.isDestroyed()) return;

  const primaryDisplay = screen.getPrimaryDisplay();
  const { workArea } = primaryDisplay;

  // Add 16px safe buffer for shadow and rounded caps (8px each side)
  const safeWidth = Math.max(300, Math.ceil(contentWidth + 16));
  const currentBounds = miniWindow.getBounds();

  if (Math.abs(currentBounds.width - safeWidth) < 2) return;

  // Keep it centered at top
  const newX = Math.round(workArea.x + (workArea.width - safeWidth) / 2);

  miniWindow.setBounds({
    x: newX,
    y: currentBounds.y,
    width: safeWidth,
    height: currentBounds.height,
  });
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

function toggleMiniWidget(visible) {
  if (visible === undefined) {
    isMiniVisible = !isMiniVisible;
  } else {
    isMiniVisible = !!visible;
  }

  if (isMiniVisible) {
    if (!miniWindow || miniWindow.isDestroyed()) {
      createMiniWindow();
    } else {
      miniWindow.showInactive();
    }
  } else {
    if (miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.hide();
    }
  }
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Dashboard',
      click: () => {
        showDashboard();
      },
    },
    {
      label: 'Mini Taskbar Widget',
      type: 'checkbox',
      checked: isMiniVisible,
      click: (menuItem) => {
        toggleMiniWidget(menuItem.checked);
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
        if (miniWindow && !miniWindow.isDestroyed()) {
          miniWindow.loadFile(miniHtmlPath);
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Exit AI Token Analytics',
      click: () => {
        isQuitting = true;
        if (miniWindow && !miniWindow.isDestroyed()) {
          miniWindow.destroy();
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.destroy();
        }
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
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

  updateTrayMenu();

  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      hideDashboard();
    } else {
      showDashboard();
    }
  });
}

function createMiniWindow() {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.showInactive();
    return;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { workArea } = primaryDisplay;

  const widgetWidth = 380;
  const widgetHeight = 32;

  // Position at top-center of the screen
  const x = Math.round(workArea.x + (workArea.width - widgetWidth) / 2);
  const y = Math.round(workArea.y + 4);

  miniWindow = new BrowserWindow({
    width: widgetWidth,
    height: widgetHeight,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  miniWindow.setAlwaysOnTop(true, 'screen-saver');
  miniWindow.loadFile(miniHtmlPath);

  miniWindow.once('ready-to-show', () => {
    if (isMiniVisible && miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.showInactive(); // Show without stealing keyboard/mouse focus
    }
  });

  miniWindow.on('closed', () => {
    miniWindow = null;
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
    createMiniWindow();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    clearInterval(keepAliveTimer);
    if (miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.destroy();
    }
  });

  app.on('window-all-closed', () => {
    // Stay running in system tray on Windows with ultra-low memory
  });
}
