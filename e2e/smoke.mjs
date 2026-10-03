/**
 * End-to-end smoke test: builds nothing, serves the existing `dist/` with
 * `vite preview`, and drives the real app in Chromium.
 *
 * Beyond clicking through the UI, it taps the app's audio output with an
 * AnalyserNode so it can check that sound is actually produced (and that
 * mute really silences it) rather than only that nothing threw.
 *
 *   npm run build && npm run test:e2e
 *
 * Set CHROMIUM_PATH to use a specific browser binary.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4179;
const URL = `http://localhost:${PORT}`;
const exe = process.env.CHROMIUM_PATH
  ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

// ─── Harness ──────────────────────────────────────────────────────────────────

const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
    console.log(`  ✗ ${name}\n      ${err.message.split('\n')[0]}`);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

function startServer() {
  // Run Vite's entry script directly: killing an `npx` wrapper leaves the real
  // server running and holding the port for the next run.
  const proc = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'pipe',
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('vite preview did not start')), 20000);
    proc.stdout.on('data', (d) => {
      if (String(d).includes(String(PORT))) { clearTimeout(timer); resolve(proc); }
    });
    proc.on('exit', (code) => reject(new Error(`vite preview exited (${code})`)));
  });
}

/**
 * Runs before any app code: remembers the AudioContext and whichever node the
 * app connects to the speakers, so the test can measure what comes out.
 */
const AUDIO_TAP = () => {
  const origConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest instanceof AudioDestinationNode) {
      window.__oscOut = this;
      window.__oscCtx = this.context;
    }
    return origConnect.call(this, dest, ...rest);
  };
  window.__level = (ms = 600) => new Promise((resolve) => {
    const ctx = window.__oscCtx;
    const out = window.__oscOut;
    if (!ctx || !out) { resolve(-1); return; }
    const a = ctx.createAnalyser();
    a.fftSize = 2048;
    out.connect(a);
    const buf = new Float32Array(a.fftSize);
    let peak = 0;
    const t0 = performance.now();
    const tick = () => {
      a.getFloatTimeDomainData(buf);
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
      if (performance.now() - t0 < ms) setTimeout(tick, 20);
      else { out.disconnect(a); resolve(peak); }
    };
    tick();
  });
};

// ─── Tests ────────────────────────────────────────────────────────────────────

const server = await startServer();
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--autoplay-policy=no-user-gesture-required'],
});

let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(AUDIO_TAP);
  let page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());

  const button = (name) => page.getByRole('button', { name, exact: true }).first();  // reads the current `page`
  // Lanes render in track order; filled in once the starter tracks are known
  const trackIndex = {};

  console.log('\nOSC end-to-end\n');

  await step('fresh session opens on the arrangement with starter tracks', async () => {
    await page.goto(URL);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('[data-lane-track]');
    const names = await page.locator('[data-lane-track]').count();
    assert(names === 4, `expected 4 starter tracks, got ${names}`);
    ['Drums', 'Bass', 'Keys', 'Pad'].forEach((n, i) => { trackIndex[n] = i; });
    assert(await page.getByText('Drum kit').count() > 0, 'drum track source label missing');
  });

  await step('a session saved by the previous release migrates instead of crashing', async () => {
    // A separate page seeded before any app code runs; on the main page the
    // app's unload flush would write the current session back over the seed.
    const legacy = await context.newPage();
    const legacyErrors = [];
    legacy.on('pageerror', (e) => legacyErrors.push(e.message));
    await legacy.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('osc-app-state', JSON.stringify({
        tabs: [{ id: 'tab-1', label: 'Old Lead', color: '#0f0', oscillator: { waveform: 'sine', frequency: 440, amplitude: 0.8, phase: 0, pulseWidth: 0.5, masterVolume: 0.7, isPlaying: false },
          advanced: { centsOffset: 0, zoomFactor: 2, lineThickness: 2, colorTheme: 'green', showGrid: true }, isPlaying: false, isMuted: false, solo: false }],
        activeTabId: 'tab-1', masterVolume: 0.8, isRecording: false, overlayMode: false,
        sequencer: { bpm: 110, beatsPerBar: 4, songLengthBars: 4, isOpen: true,
          tracks: [{ tabId: 'tab-1', notes: [{ id: 'x', midiNote: 64, startBeat: 0, durationBeats: 1, velocity: 100 }], pan: 0 }] },
      }));
    });
    await legacy.goto(URL);
    await legacy.waitForSelector('[data-lane-track]');
    assert(legacyErrors.length === 0, `errors after migration: ${legacyErrors.join(' | ')}`);
    assert(await legacy.getByText('Old Lead').count() > 0, 'migrated track should keep its tab name');
    assert(await legacy.getByText('Oscillator · Old Lead').count() > 0, 'migrated track should keep its oscillator sound');
    await legacy.close();
  });

  await step('reset to a fresh session', async () => {
    // Close the old page without its unload flush, then start clean
    await page.close();
    page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('dialog', (d) => d.accept());
    await page.addInitScript(() => {
      if (sessionStorage.getItem('cleared')) return;
      sessionStorage.setItem('cleared', '1');
      localStorage.clear();
    });
    await page.goto(URL);
    await page.waitForSelector('[data-lane-track]');
    assert(await page.locator('[data-lane-track]').count() === 4, 'expected the starter tracks after reset');
  });

  await step('double-clicking a lane creates a clip and opens it in the piano roll', async () => {
    const keys = page.locator('[data-lane-track]').nth(trackIndex.Keys);
    const box = await keys.boundingBox();
    await page.mouse.dblclick(box.x + 30, box.y + box.height / 2);
    await page.waitForSelector('canvas[aria-label^="Piano roll"]');
  });

  await step('drawing in the piano roll adds notes', async () => {
    const roll = page.locator('canvas[aria-label^="Piano roll"]');
    const box = await roll.boundingBox();
    // Three notes across the first bar, below the ruler
    for (const dx of [80, 160, 240]) {
      await page.mouse.click(box.x + dx, box.y + 120);
    }
    await page.getByText('3 notes').waitFor({ timeout: 2000 });
  });

  await step('undo removes the last note, redo restores it', async () => {
    await page.keyboard.press('Control+z');
    await page.getByText('2 notes').waitFor({ timeout: 2000 });
    await page.keyboard.press('Control+Shift+z');
    await page.getByText('3 notes').waitFor({ timeout: 2000 });
  });

  await step('a drum clip can be placed on the drum track', async () => {
    const drums = page.locator('[data-lane-track]').nth(trackIndex.Drums);
    const box = await drums.boundingBox();
    await page.mouse.dblclick(box.x + 30, box.y + box.height / 2);
    await page.getByText('AUDITION', { exact: false }).first().waitFor({ timeout: 3000 });
  });

  let playingLevel = 0;
  await step('playback produces sound and the playhead moves', async () => {
    const before = await page.getByLabel('Song position').innerText();
    await page.keyboard.press('Home');
    await page.locator('main').click({ position: { x: 5, y: 5 } }); // focus the arrangement, not the editor
    await button('▶ PLAY').click();
    await page.waitForTimeout(900);
    playingLevel = await page.evaluate(() => window.__level(800));
    const after = await page.getByLabel('Song position').innerText();
    assert(after !== before, `playhead did not move (${before} → ${after})`);
    assert(playingLevel > 0.01, `no audio during playback (peak ${playingLevel.toFixed(4)})`);
  });

  await step('playback does not write localStorage every frame', async () => {
    const writes = await page.evaluate(() => new Promise((res) => {
      let n = 0;
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (...a) { n++; return orig.apply(this, a); };
      setTimeout(() => { Storage.prototype.setItem = orig; res(n); }, 1500);
    }));
    assert(writes <= 1, `expected no per-frame persistence, saw ${writes} writes in 1.5s`);
  });

  await step('muting every track silences the output', async () => {
    for (let i = 0; i < 4; i++) {
      await page.locator('[aria-pressed]').filter({ hasText: /^M$/ }).nth(i).click();
    }
    await page.waitForTimeout(500); // let release tails and reverb decay
    const muted = await page.evaluate(() => window.__level(600));
    assert(muted < playingLevel * 0.1, `still loud while muted (peak ${muted.toFixed(4)} vs ${playingLevel.toFixed(4)})`);
    for (let i = 0; i < 4; i++) {
      await page.locator('[aria-pressed]').filter({ hasText: /^M$/ }).nth(i).click();
    }
  });

  await step('changing tempo while playing keeps the playhead continuous', async () => {
    const bpm = page.locator('input[inputmode="decimal"]');
    const readBeats = async () => {
      const [pos] = (await page.getByLabel('Song position').innerText()).split(/\s+/);
      const [bar, beat, six] = pos.split('.').map(Number);
      return (bar - 1) * 4 + (beat - 1) + (six - 1) / 4;
    };
    const a = await readBeats();
    await bpm.fill('90');
    await bpm.press('Enter');
    await page.waitForTimeout(250);
    const b = await readBeats();
    // At 90–120 BPM, a quarter second is well under 2 beats; a jump would be bigger
    assert(b >= a - 0.5 && b - a < 2.5, `playhead jumped on tempo change (${a} → ${b})`);
  });

  await step('stopping leaves the playhead where it stopped', async () => {
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    const stopped = await page.getByLabel('Song position').innerText();
    assert(!stopped.startsWith('1.1.1 '), `playhead reset to the start on stop (${stopped})`);
  });

  await step('a section marker can be added from the ruler', async () => {
    const ruler = page.locator('[data-arrange-lanes] canvas').first();
    const box = await ruler.boundingBox();
    await page.mouse.dblclick(box.x + 300, box.y + 8);
    await page.waitForTimeout(200);
    const saved = await page.evaluate(() => new Promise((r) => setTimeout(() => r(localStorage.getItem('osc-app-state')), 600)));
    const markers = JSON.parse(saved).sequencer.markers;
    assert(markers.length === 2, `expected 2 sections, got ${markers.length}`);
  });

  await step('example projects load from the File menu', async () => {
    await page.getByRole('button', { name: 'OSC ▾' }).click();
    await page.getByRole('menuitem', { name: /Open example/ }).hover();
    await page.getByRole('button', { name: /midnight drive/i }).click();
    await page.getByText(/Loaded/).first().waitFor({ timeout: 4000 });
    const lanes = await page.locator('[data-lane-track]').count();
    assert(lanes >= 5, `expected the example's tracks, saw ${lanes}`);
  });

  await step('mixer, instruments and FX tabs render', async () => {
    await page.getByRole('tab', { name: 'MIXER' }).click();
    await page.getByLabel('Master volume').waitFor({ timeout: 2000 });
    const strips = await page.getByLabel(/ fader$/).count();
    assert(strips >= 5, `expected a channel strip per track, saw ${strips}`);
    await page.getByRole('tab', { name: 'INSTRUMENTS' }).click();
    await page.getByLabel('Search instruments').waitFor({ timeout: 2000 });
    await page.getByRole('tab', { name: 'FX' }).click();
    await page.getByText('MASTER FX').waitFor({ timeout: 2000 });
  });

  await step('the oscillator lab is optional and still works', async () => {
    await button('OSC LAB').click();
    await page.waitForTimeout(300);
    assert(await page.getByText('OVERLAY').count() > 0, 'lab did not open');
    await button('ARRANGE').click();
    await page.waitForSelector('[data-lane-track]');
  });

  await step('the visualizer toggles on and off', async () => {
    await button('VIZ').click();
    await page.getByText('VISUALIZER').waitFor({ timeout: 3000 });
    await button('VIZ').click();
  });

  await step('no uncaught errors during the run', async () => {
    assert(errors.length === 0, errors.slice(0, 5).join('\n'));
  });

  await page.screenshot({ path: 'e2e/last-run.png' });
} finally {
  await browser.close();
  server.kill();
}

const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} passed\n`);
failed = bad.length > 0;
process.exit(failed ? 1 : 0);
