'use strict';

const { app, BrowserWindow, shell, Menu, session } = require('electron');
const path = require('path');

/**
 * Only these permission requests are granted; everything else is denied.
 * `fileSystem` lets Save write back to the project file the user picked.
 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fileSystem']);

/** How long the page gets to answer a close request before the window closes anyway. */
const CLOSE_ACK_MS = 1500;

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
    // macOS takes the icon from the app bundle
    ...(process.platform !== 'darwin' && { icon: path.join(__dirname, '../assets/icon.png') }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
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

  // Open web links in the system browser; never open app windows from content
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // The app is a single page: it never navigates away from itself
  win.webContents.on('will-navigate', (event, url) => {
    const own = url.startsWith('file://') || (isDev && url.startsWith('http://localhost:5173'));
    if (!own) event.preventDefault();
  });

  // Closing with unsaved changes: the page asks Save / Don't save / Cancel.
  // A page that doesn't answer (crashed, still loading) doesn't keep the
  // window open.
  let closeApproved = false;
  let fallback = null;
  win.on('close', (event) => {
    if (closeApproved || win.webContents.isCrashed?.()) return;
    event.preventDefault();
    clearTimeout(fallback);
    fallback = setTimeout(() => { closeApproved = true; win.close(); }, CLOSE_ACK_MS);
    win.webContents.send('osc:close-request');
  });
  // The page is asking the user; it will answer with close-ok (or not at all, on Cancel)
  win.webContents.ipc.on('osc:close-ack', () => clearTimeout(fallback));
  win.webContents.ipc.on('osc:close-ok', () => {
    closeApproved = true;
    win.close();
  });
}

/** Ask the focused window's page to run one of its commands (a shortcut id). */
const command = (id) => () => {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  win?.webContents.send('osc:command', id);
};

// Minimal application menu (removes Node.js-style View > Reload that confuses users)
function buildMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project', click: command('file.new') },
        { label: 'Open…', click: command('file.open') },
        { label: 'Save', click: command('file.save') },
        { label: 'Save As…', click: command('file.saveAs') },
        { label: 'Export Audio / MIDI…', click: command('file.export') },
        { type: 'separator' },
        { label: 'Settings…', click: command('view.settings') },
        ...(process.platform === 'darwin' ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
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
    {
      role: 'help',
      submenu: [
        { label: 'User Guide', accelerator: 'F1', registerAccelerator: false, click: command('help.guide') },
        { label: 'Keyboard Shortcuts', accelerator: 'Shift+/', registerAccelerator: false, click: command('help.shortcuts') },
        { label: 'Welcome Screen', click: command('help.welcome') },
        { type: 'separator' },
        { label: 'Project Page', click: () => shell.openExternal('https://github.com/RudolfHK/osc-sound-gen') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
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
