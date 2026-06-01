# OSC — Quick Start (Windows)

Get the synthesizer running in under 5 minutes.

---

## Prerequisites

| Tool | Minimum version | Download |
|------|----------------|----------|
| **Node.js** | 18.x (LTS) | https://nodejs.org (click "LTS") |
| **Browser** | Chrome 98+ or Edge 98+ | Pre-installed on Windows 10/11 |
| Git | Any | https://git-scm.com (optional) |

No other tools required.

---

## Installation

### Step 1 — Install Node.js

1. Go to https://nodejs.org and click **"LTS"** to download the installer
2. Run the installer. Accept defaults. **Check "Add to PATH"** if prompted
3. Open a new **Command Prompt** (Start → type `cmd` → Enter) and verify:

```cmd
node --version
```

Expected output: `v18.x.x` or higher (e.g. `v20.11.0`)

```cmd
npm --version
```

Expected output: `10.x.x` or similar — any version bundled with Node 18+ works

---

### Step 2 — Get the project files

**Option A — Git clone:**

```cmd
git clone https://github.com/RudolfHK/osc-sound-gen.git
cd osc-sound-gen
```

**Option B — Download ZIP:**

1. Go to the repository page on GitHub
2. Click **Code → Download ZIP**
3. Extract the ZIP somewhere (e.g. `C:\Users\You\osc-sound-gen`)
4. Open Command Prompt and navigate to the folder:

```cmd
cd C:\Users\You\osc-sound-gen
```

---

### Step 3 — Install dependencies

```cmd
npm install
```

Expected: output ending with `added N packages` and `found 0 vulnerabilities`. Warnings about peer deps are normal and harmless.

If you see `npm ERR! code EACCES`, open Command Prompt as Administrator (right-click → "Run as administrator") and try again.

---

### Step 4 — Start the development server

```cmd
npm run dev
```

Expected output:

```
  VITE v6.x.x  ready in Xms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

Leave this window open — closing it stops the server.

---

### Step 5 — Open the app

1. Open **Chrome** or **Edge**
2. Navigate to: **http://localhost:5173**
3. You should see the dark oscillator interface

**Verify audio works:**

1. Click **▶ PLAY** in the Controls area
2. You should hear a 440 Hz sine tone
3. If silent, check the speaker icon in the browser address bar — click it and allow audio

---

## Building for production (optional)

To create a static build you can deploy to any web host:

```cmd
npm run build
```

Output files are placed in the `dist/` folder. Serve with any static file server or upload to Netlify/Vercel/GitHub Pages.

To preview the production build locally:

```cmd
npm run preview
```

---

## Common Windows Issues

| Problem | Cause | Fix |
|---------|-------|-----|
| `'node' is not recognized` | Node.js not on PATH | Reinstall Node.js and check "Add to PATH" during setup, or restart Command Prompt |
| `npm install` fails with `EACCES` | Permissions | Run Command Prompt as Administrator |
| `npm install` fails with `ENOENT` | Wrong directory | Make sure you `cd` into the project folder first |
| Port 5173 already in use | Another process on that port | Run with a different port: `npm run dev -- --port 3000` |
| No audio in browser | Autoplay policy | Click anywhere on the page before pressing Play |
| `npm install` is very slow | Antivirus scanning | Exclude the project folder (and `node_modules`) from antivirus real-time scanning |
| White screen / blank page | Build error | Check the Command Prompt running `npm run dev` for error messages |
| `Cannot find module` error | Incomplete install | Delete `node_modules` folder and run `npm install` again |
