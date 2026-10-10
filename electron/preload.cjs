'use strict';

/**
 * Runs in the renderer before the app, with contextIsolation and the sandbox
 * on. The app needs no Node access. It learns that it is running as the
 * desktop app, receives commands from the menu bar, and answers the window's
 * close requests (so unsaved work can be saved first).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oscDesktop', {
  isDesktop: true,
  platform: process.platform,
  /** Menu bar commands, by shortcut id ("file.save", "help.guide"…). */
  onCommand: (fn) => {
    const listener = (_event, id) => fn(String(id));
    ipcRenderer.on('osc:command', listener);
    return () => ipcRenderer.removeListener('osc:command', listener);
  },
  /**
   * The window wants to close. The handler resolves true to let it close;
   * false (Cancel) keeps it open.
   */
  onCloseRequest: (fn) => {
    const listener = async () => {
      ipcRenderer.send('osc:close-ack');
      let ok = true;
      try { ok = await fn(); } catch { /* a failing check must not trap the window */ }
      if (ok) ipcRenderer.send('osc:close-ok');
    };
    ipcRenderer.on('osc:close-request', listener);
    return () => ipcRenderer.removeListener('osc:close-request', listener);
  },
});
