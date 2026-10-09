'use strict';

/**
 * Runs in the renderer before the app, with contextIsolation and the sandbox
 * on. The app needs no Node access; it only gets to know it is running as the
 * desktop app (for example to show desktop-specific hints).
 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('oscDesktop', {
  isDesktop: true,
  platform: process.platform,
});
