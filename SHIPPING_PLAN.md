# Shipping Plan — OSC as a Standalone Windows Desktop App

This document compares three packaging options and provides a complete step-by-step guide for the recommended approach.

---

## Option Comparison

### Option A — Electron ✅ Recommended

Bundles the app with a full Chromium runtime and Node.js. The user installs a `.exe` and runs it like any desktop application.

**Pros:**
- Full Web Audio API support — same Chromium engine the app was developed and tested in
- No browser install required
- Mature toolchain, excellent documentation
- Supports system tray, OS notifications, native menus if needed later
- VS Code and Slack use this approach

**Cons:**
- Large installer (~150 MB) — Chromium is included
- Higher RAM usage than a native app

---

### Option B — Tauri ❌ Not recommended for this project

Bundles with the system WebView (Edge/WebView2 on Windows) instead of Chromium.

**Pros:** ~10 MB bundle, fast startup, uses Rust for the backend

**Cons:**
- Requires installing the Rust toolchain (complex setup)
- Edge WebView2's Web Audio API implementation has documented differences from Chrome's, particularly around `AudioWorklet`, `StereoPannerNode`, and `MediaRecorder` — all of which this app uses
- `MediaRecorder` format support differs between WebView2 versions; the fallback chain in `RecordingEngine.bestFormat()` may not find a supported format
- The risk of subtle audio bugs specific to WebView2 is not worth the bundle-size saving for an audio-focused application

**When Tauri is appropriate:** apps that don't rely heavily on Web Audio API or MediaRecorder.

---

### Option C — PWA (Progressive Web App)

Makes the app installable from the browser with no Electron packaging.

**Pros:** Zero extra tooling, automatic updates, tiny distribution (just a URL)

**Cons:**
- Still requires a browser to be installed and up to date
- Not a true "offline desktop" experience (browser must run)
- No system tray or file-association support
- `npm run build` output already works as a PWA with a service worker added — trivial to implement

**When PWA is sufficient:** when users are comfortable opening a browser to launch the app, and you want zero-friction distribution (share a link). Add a `manifest.json` and a service worker to `public/` and you're done.

---

## Complete Electron Build Guide (Windows)

### Prerequisites

Install these once before starting:

**1. Node.js 18+ LTS** (already needed for development)

**2. Python 3.x** (required by some native Node modules used by Electron)
- Download: https://python.org/downloads/
- During install: check **"Add Python to PATH"**
- Verify: `python --version`

**3. Visual Studio Build Tools** (required for native modules)

Option A — lighter, command-line only:
```cmd
npm install --global windows-build-tools
```
(Run as Administrator. This installs Python + VS Build Tools automatically.)

Option B — full IDE (if you use Visual Studio):
- Download "Visual Studio Community" from https://visualstudio.microsoft.com
- Install workload: **"Desktop development with C++"**

**4. Verify everything:**
```cmd
node --version    # v18+
python --version  # 3.x
```

---

### Step 1 — Install Electron and build tools

```cmd
npm install --save-dev electron electron-builder
```

Also install `electron-vite` for integrated dev experience (optional but recommended):

```cmd
npm install --save-dev electron-vite
```

---

### Step 2 — Create the Electron main process

Create the file `electron/main.ts`:

```typescript
import { app, BrowserWindow, shell } from 'electron';
import path from 'path';

const isDev = !app.isPackaged;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    title: 'OSC — Digital Oscillator Synthesizer',
    icon: path.join(__dirname, '../assets/icon.ico'),
    webPreferences: {
      // Required for Web Audio API to work without a user gesture on load
      autoplayPolicy: 'no-user-gesture-required',
      // Disable Node integration in renderer (security best practice)
      nodeIntegration: false,
      contextIsolation: true,
      // Enable hardware acceleration for canvas rendering
      enableWebSQL: false,
    },
  });

  if (isDev) {
    // Load Vite dev server in development
    void win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    // Load built files in production
    void win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Open external links in the default browser, not in Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    // macOS: re-create window when dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Windows/Linux: quit when last window is closed
  if (process.platform !== 'darwin') app.quit();
});
```

---

### Step 3 — Add TypeScript config for the main process

Create `tsconfig.electron.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "lib": ["ES2020"],
    "outDir": "dist-electron",
    "rootDir": "electron",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "moduleResolution": "node"
  },
  "include": ["electron"]
}
```

---

### Step 4 — Configure electron-builder in package.json

Add the following to `package.json`:

```json
{
  "main": "dist-electron/main.js",
  "scripts": {
    "electron:compile": "tsc -p tsconfig.electron.json",
    "electron:dev": "npm run build && npm run electron:compile && electron .",
    "electron:build": "npm run build && npm run electron:compile && electron-builder"
  },
  "build": {
    "appId": "com.yourname.osc-synth",
    "productName": "OSC Synthesizer",
    "copyright": "Copyright © 2025",
    "directories": {
      "output": "release"
    },
    "files": [
      "dist/**/*",
      "dist-electron/**/*",
      "assets/**/*"
    ],
    "win": {
      "target": [
        {
          "target": "nsis",
          "arch": ["x64"]
        }
      ],
      "icon": "assets/icon.ico"
    },
    "nsis": {
      "oneClick": false,
      "allowDirChange": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "OSC Synthesizer"
    }
  }
}
```

---

### Step 5 — Create app icon

Electron on Windows requires an `.ico` file. Create `assets/icon.ico`:

- Minimum size: 256×256 pixels
- Recommended: multi-size ICO containing 16×16, 32×32, 48×48, 256×256

Free tools:
- https://convertio.co/png-ico/ — convert any PNG to multi-size ICO
- GIMP (File → Export As → `.ico`)

Place the file at: `assets/icon.ico`

---

### Step 6 — Install Electron types

```cmd
npm install --save-dev @types/electron
```

If `@types/electron` is not found (it's bundled with `electron` in newer versions):

```cmd
npm install --save-dev electron
```

The types come with the `electron` package itself — no separate `@types/` package needed.

---

### Step 7 — Build the installer

```cmd
npm run electron:build
```

This runs in sequence:
1. `npm run build` — Vite builds the React app to `dist/`
2. TypeScript compiles `electron/main.ts` to `dist-electron/main.js`
3. `electron-builder` packages everything into `release/`

**Expected output:**
```
• packaging       platform=win32 arch=x64 electron=33.x.x appOutDir=release\win-unpacked
• building        target=nsis file=release\OSC Synthesizer Setup 1.0.0.exe archs=x64
• built           release\OSC Synthesizer Setup 1.0.0.exe
```

Installer size: approximately **150–170 MB** (Chromium + app).

---

### Step 8 — Test the built installer

1. Run `release\OSC Synthesizer Setup 1.0.0.exe`
2. Install to any folder
3. Launch from the Start menu or Desktop shortcut
4. Verify:
   - App opens without errors
   - Click Play on the oscillator — audio plays immediately (no click-first required — `autoplayPolicy: 'no-user-gesture-required'` handles this)
   - Sequencer opens, notes play
   - Recording works (WebM and WAV download)
   - Project save/load works

**Testing on a clean machine (recommended):** Install on a Windows machine that has never had Node.js or Chrome installed. The Electron installer is fully self-contained.

---

### Step 9 — Code signing (optional but strongly recommended for distribution)

Without code signing, Windows SmartScreen shows "Windows protected your PC" when users run the installer. Users must click "More info → Run anyway".

**For personal use:** self-signed certificates remove the SmartScreen warning only on your own machine.

**For public distribution:** purchase a code signing certificate from a trusted CA:
- DigiCert: ~$300/year
- Sectigo (formerly Comodo): ~$200/year
- SSL.com: ~$200/year

Once you have a `.pfx` certificate file, configure `electron-builder`:

```json
"win": {
  "certificateFile": "path/to/certificate.pfx",
  "certificatePassword": "${env.CERT_PASSWORD}",
  "signingHashAlgorithms": ["sha256"]
}
```

Set `CERT_PASSWORD` as an environment variable (not in the JSON file):

```cmd
set CERT_PASSWORD=your-certificate-password
npm run electron:build
```

---

## VS Code Integration

### `.vscode/tasks.json`

Create `.vscode/tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Dev: Start Vite dev server",
      "type": "shell",
      "command": "npm run dev",
      "group": "build",
      "presentation": {
        "reveal": "always",
        "panel": "new"
      },
      "isBackground": true,
      "problemMatcher": {
        "pattern": { "regexp": "." },
        "background": {
          "activeOnStart": true,
          "beginsPattern": "VITE",
          "endsPattern": "ready in"
        }
      }
    },
    {
      "label": "Build: Production web build",
      "type": "shell",
      "command": "npm run build",
      "group": "build",
      "presentation": { "reveal": "always" }
    },
    {
      "label": "Build: Electron development (compile + launch)",
      "type": "shell",
      "command": "npm run electron:dev",
      "group": "build",
      "presentation": { "reveal": "always", "panel": "new" }
    },
    {
      "label": "Build: Package Windows installer",
      "type": "shell",
      "command": "npm run electron:build",
      "group": {
        "kind": "build",
        "isDefault": true
      },
      "presentation": { "reveal": "always" }
    }
  ]
}
```

Run any task with **Ctrl+Shift+B** (default build task = Package Windows installer) or **Ctrl+Shift+P → Tasks: Run Task**.

---

### `.vscode/launch.json`

Create `.vscode/launch.json` for debugging:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug: Electron Main Process",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron",
      "runtimeArgs": ["--inspect=9229", "."],
      "program": "${workspaceFolder}/dist-electron/main.js",
      "outFiles": ["${workspaceFolder}/dist-electron/**/*.js"],
      "sourceMaps": true,
      "preLaunchTask": "Build: Production web build",
      "env": {
        "ELECTRON_ENABLE_LOGGING": "1"
      }
    },
    {
      "name": "Debug: Attach to Electron Renderer (Chrome DevTools)",
      "type": "chrome",
      "request": "attach",
      "port": 9223,
      "urlFilter": "http://localhost:*",
      "webRoot": "${workspaceFolder}/src"
    }
  ]
}
```

To debug the renderer process: in the running Electron app, press **Ctrl+Shift+I** (DevTools open automatically in dev mode anyway). The second launch config lets VS Code attach to the renderer if you launch Electron with `--remote-debugging-port=9223`.

---

## After Shipping: Auto-updater

Once you publish releases to GitHub Releases, add auto-update with `electron-updater`:

```cmd
npm install electron-updater
npm install --save-dev @types/electron-updater
```

In `electron/main.ts`, after `createWindow()`:

```typescript
import { autoUpdater } from 'electron-updater';

app.whenReady().then(() => {
  createWindow();
  if (!isDev) {
    autoUpdater.checkForUpdatesAndNotify();
  }
});
```

In `package.json` build config:

```json
"publish": {
  "provider": "github",
  "owner": "your-github-username",
  "repo": "osc-sound-gen"
}
```

To publish a release:

```cmd
npm run electron:build -- --publish=always
```

This builds the installer and uploads it to a GitHub Release. Users running an older version will automatically see an update notification.
