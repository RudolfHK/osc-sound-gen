'use strict';

const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

// True when running from source with `electron .`; false when installed
const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    title: 'OSC — Digital Oscillator Synthesizer',
    // Use icon from assets/ dir when packaged; fallback to favicon in public/
    ...(process.platform !== 'darwin' && {
      icon: isDev
        ? path.join(__dirname, '../public/favicon.svg')
        : path.join(__dirname, '../dist/favicon.svg'),
    }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,  // show once ready to avoid white flash
  });

  if (isDev) {
    // Connect to the Vite dev server (run `npm run dev` first)
    win.loadURL('http://localhost:5173').catch(() => {
      // If dev server isn't running, fall back to last build
      const builtIndex = path.join(__dirname, '../dist/index.html');
      win.loadFile(builtIndex).catch(console.error);
    });
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  // Open any <a target="_blank"> links in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Minimal application menu (removes Node.js-style View > Reload that confuses users)
function buildMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        ...(isDev
          ? [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }]
          : []),
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  // macOS: re-create window when Dock icon is clicked and no windows exist
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Windows / Linux: quit when the last window is closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
