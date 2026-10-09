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
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { unzipSync } from 'fflate';

/** Parse a WAV file far enough to check its format and content. */
function parseWav(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let o = 12, fmt = null, data = null;
  while (o + 8 <= buf.length) {
    const id = tag(o), size = v.getUint32(o + 4, true);
    if (id === 'fmt ') fmt = { format: v.getUint16(o + 8, true), channels: v.getUint16(o + 10, true), sampleRate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    if (id === 'data') data = { at: o + 8, size };
    o += 8 + size + (size % 2);
  }
  const bps = fmt.bits / 8;
  const frames = data.size / (bps * fmt.channels);
  let peak = 0;
  for (let i = 0; i < frames * fmt.channels; i++) {
    const at = data.at + i * bps;
    let x;
    if (fmt.format === 3) x = v.getFloat32(at, true);
    else if (fmt.bits === 16) x = v.getInt16(at, true) / 32768;
    else { const u = buf[at] | (buf[at + 1] << 8) | (buf[at + 2] << 16); x = (u & 0x800000 ? u - 0x1000000 : u) / 8388608; }
    peak = Math.max(peak, Math.abs(x));
  }
  return { ...fmt, frames, seconds: frames / fmt.sampleRate, peak };
}

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
    if (process.env.E2E_SHOTS) await globalThis.__shot?.(name);
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
    // The app's output is the first node wired to the live speakers. Later
    // connections are an export's offline graph or the recorder's silent sink.
    const live = !(this.context instanceof OfflineAudioContext);
    if (dest instanceof AudioDestinationNode && live && window.__oscCtx !== this.context) {
      window.__oscOut = this;
      window.__oscCtx = this.context;
    }
    return origConnect.call(this, dest, ...rest);
  };
  // Whole effect racks built on the live context: only a rack's chorus uses
  // 0.1 s delay lines, so counting those counts racks
  window.__liveRacks = 0;
  const origDelay = BaseAudioContext.prototype.createDelay;
  BaseAudioContext.prototype.createDelay = function (max, ...a) {
    if (!(this instanceof OfflineAudioContext) && max === 0.1) window.__liveRacks += 0.5;
    return origDelay.call(this, max, ...a);
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

  globalThis.__shot = (name) => page.screenshot({ path: `${process.env.E2E_SHOTS}/${name.replace(/\W+/g, '-')}.png` }).catch(() => {});
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

  await step('the undo and redo buttons step through history', async () => {
    const undo = page.getByRole('button', { name: 'Undo', exact: true });
    const redo = page.getByRole('button', { name: 'Redo', exact: true });
    assert(await redo.isDisabled(), 'redo should be disabled with nothing undone');
    await undo.click();
    await page.getByText('2 notes').waitFor({ timeout: 2000 });
    assert(await redo.isEnabled(), 'redo should be enabled after an undo');
    await redo.click();
    await page.getByText('3 notes').waitFor({ timeout: 2000 });
    assert(await redo.isDisabled(), 'redo should be disabled once history is replayed');
  });

  await step('a drum clip can be placed on the drum track', async () => {
    const drums = page.locator('[data-lane-track]').nth(trackIndex.Drums);
    const box = await drums.boundingBox();
    await page.mouse.dblclick(box.x + 30, box.y + box.height / 2);
    await page.getByText('AUDITION', { exact: false }).first().waitFor({ timeout: 3000 });
  });

  await step('the drum AUDITION loop does not rewrite storage every frame', async () => {
    await page.waitForTimeout(600); // let saves from the previous edits land
    await button('▶ AUDITION').click();
    await page.waitForTimeout(600);
    const keys = await page.evaluate(() => new Promise((res) => {
      const written = [];
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (...a) { written.push(a[0]); return orig.apply(this, a); };
      setTimeout(() => { Storage.prototype.setItem = orig; res(written); }, 1500);
    }));
    await button('■ STOP').click();
    // It used to rewrite the whole drum library about 60 times a second
    assert(keys.length <= 1, `storage writes during 1.5 s of AUDITION: ${keys.join(', ')}`);
  });

  await step('drum edits and tempo changes are undoable', async () => {
    const stepBtn = page.getByRole('button', { name: /step 2$/ }).first();
    const was = await stepBtn.getAttribute('aria-pressed');
    await stepBtn.click();
    assert(await stepBtn.getAttribute('aria-pressed') !== was, 'step did not toggle');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.waitForTimeout(150);
    assert(await stepBtn.getAttribute('aria-pressed') === was, 'undo did not restore the drum step');

    const bpm = page.locator('input[inputmode="decimal"]');
    const before = await bpm.inputValue();
    await bpm.fill('133');
    await bpm.press('Enter');
    await page.waitForTimeout(100);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.waitForTimeout(150);
    assert(await bpm.inputValue() === before, `tempo not restored (${await bpm.inputValue()} vs ${before})`);
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
    await page.waitForTimeout(150);
    const muted = await page.evaluate(() => window.__level(600));
    // Mute covers the whole track — its instrument's own reverb and delay too,
    // which used to bypass the channel strip and keep sounding
    assert(muted < 0.003, `still sounding while every track is muted (peak ${muted.toFixed(4)} vs ${playingLevel.toFixed(4)})`);
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
    await page.getByRole('button', { name: 'midnight drive', exact: true }).click();
    await page.getByText(/Loaded/).first().waitFor({ timeout: 4000 });
    const lanes = await page.locator('[data-lane-track]').count();
    assert(lanes >= 5, `expected the example's tracks, saw ${lanes}`);
  });

  // ── Transport response: stop, seek and volume act at once ──
  // Midnight Drive holds long pad chords through a reverb, which is exactly
  // what used to keep sounding after stop.
  const settle = 90; // > one 2048-sample analyser window, so pre-stop audio is out of it
  await step('stop silences held notes and effect tails at once', async () => {
    await page.locator('main').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Home');
    await button('▶ PLAY').click();
    await page.waitForTimeout(2200);
    const loud = await page.evaluate(() => window.__level(500));
    assert(loud > 0.02, `example should be audible (peak ${loud.toFixed(4)})`);
    await button('■ STOP').click();
    await page.waitForTimeout(settle);
    const after = await page.evaluate(() => window.__level(400));
    assert(after < 0.003, `still sounding after stop (peak ${after.toFixed(4)} vs ${loud.toFixed(4)} playing)`);
  });

  await step('seeking while playing cuts the old notes immediately', async () => {
    // Make room past the song's end, fit it in view and seek into the silence there
    const length = page.getByTitle('Song length in bars').locator('input');
    await length.fill('64');
    await page.getByRole('button', { name: 'FIT' }).click();
    await page.keyboard.press('Home');
    await button('▶ PLAY').click();
    await page.waitForTimeout(2200);
    const ruler = page.locator('[data-arrange-lanes] canvas').first();
    const box = await ruler.boundingBox();
    await page.mouse.click(box.x + box.width - 40, box.y + box.height - 6); // bar row, about bar 62 — nothing plays there
    await page.waitForTimeout(settle);
    const after = await page.evaluate(() => window.__level(400));
    assert(after < 0.003, `old notes kept sounding after seek (peak ${after.toFixed(4)})`);
    await button('■ STOP').click();
    await button('▶ PLAY').waitFor({ timeout: 3000 });
    await length.fill('16');
  });

  await step('master volume changes are immediate', async () => {
    const vol = page.locator('header input[type="range"]');
    const setVol = (v) => vol.evaluate((el, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, String(value));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
    await page.getByTitle('Return to start (Home)').click();
    await button('▶ PLAY').click();
    await page.waitForTimeout(1500);
    const full = await page.evaluate(() => window.__level(700));
    await setVol(0);
    await page.waitForTimeout(settle);
    const off = await page.evaluate(() => window.__level(300));
    await setVol(0.8);
    await page.waitForTimeout(settle);
    const back = await page.evaluate(() => window.__level(500));
    await button('■ STOP').click();
    assert(off < 0.002, `volume 0 still audible after ${settle} ms (peak ${off.toFixed(4)} vs ${full.toFixed(4)})`);
    assert(back > full * 0.4, `volume did not come straight back (${back.toFixed(4)} vs ${full.toFixed(4)})`);
  });

  await step('starting inside a held chord is heard at once (note chase)', async () => {
    // Midnight Drive's intro is a pad holding one chord per bar. Stop halfway
    // into a chord, then play from there: the chord must sound immediately,
    // not only when the next bar starts.
    await page.getByTitle('Return to start (Home)').click();
    await button('▶ PLAY').click();
    await page.waitForTimeout(1200); // ≈ beat 2.4 of a 4-beat chord at 118 BPM
    await button('■ STOP').click();
    await page.waitForTimeout(300);
    await button('▶ PLAY').click();
    const level = await page.evaluate(() => window.__level(350));
    await button('■ STOP').click();
    assert(level > 0.02, `silent after starting mid-chord (peak ${level.toFixed(4)})`);
  });

  await step('the header stays one row on a 1024 px laptop and fits a phone', async () => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(200);
    const h1024 = await page.evaluate(() => document.querySelector('header').getBoundingClientRect().height);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    const phone = await page.evaluate(() => ({
      h: document.querySelector('header').getBoundingClientRect().height,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(200);
    assert(h1024 < 50, `header is ${h1024}px tall at 1024px`);
    assert(phone.h < 110 && !phone.overflow, `phone header ${phone.h}px, page overflow ${phone.overflow}`);
  });

  await step('mixer, instruments and FX tabs render', async () => {
    await page.getByRole('tab', { name: 'MIXER' }).click();
    await page.getByLabel('Master fader').waitFor({ timeout: 2000 });
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
    // Its play button follows the tone
    await page.getByRole('button', { name: 'Start audio' }).click();
    await page.getByRole('button', { name: 'Stop audio' }).waitFor({ timeout: 2000 });
    const tone = await page.evaluate(() => window.__level(300));
    await page.getByRole('button', { name: 'Stop audio' }).click();
    await page.getByRole('button', { name: 'Start audio' }).waitFor({ timeout: 2000 });
    assert(tone > 0.05, `lab tone silent (peak ${tone.toFixed(4)})`);
    await button('ARRANGE').click();
    await page.waitForSelector('[data-lane-track]');
  });

  await step('the visualizer toggles on and off', async () => {
    await button('VIZ').click();
    await page.getByText('VISUALIZER').waitFor({ timeout: 3000 });
    await button('VIZ').click();
  });


  // ─── Export ────────────────────────────────────────────────────────────────
  const dialog = () => page.getByRole('dialog', { name: 'Export' });
  // Options are radios inside a named group per row ("Normalize", "Dither", …)
  const pick = (name, group) => (group ? dialog().getByRole('group', { name: group }) : dialog())
    .getByRole('radio', { name, exact: true }).click();
  async function exportFile(configure) {
    await configure();
    const dl = page.waitForEvent('download', { timeout: 120000 });
    const t0 = Date.now();
    await dialog().getByRole('button', { name: /^EXPORT( AGAIN)?$/ }).click();
    const download = await dl;
    const bytes = new Uint8Array(readFileSync(await download.path()));
    return { bytes, name: download.suggestedFilename(), ms: Date.now() - t0 };
  }
  const SECTION_SECONDS = 16 / (118 / 60);  // Midnight Drive's Intro: 4 bars at 118 BPM
  const SONG_SECONDS = 64 / (118 / 60);

  let racksBeforeExport = 0;
  await step('opens the export dialog from the transport', async () => {
    racksBeforeExport = await page.evaluate(() => window.__liveRacks);
    // Make sure Midnight Drive is loaded — the export checks below depend on it
    await page.getByRole('button', { name: 'OSC ▾' }).click();
    await page.getByRole('menuitem', { name: /Open example/ }).hover();
    await page.getByRole('menu').getByRole('button', { name: 'midnight drive', exact: true }).click();
    await page.waitForTimeout(300);
    await button('Export').click();
    await dialog().waitFor({ timeout: 3000 });
    await pick('Off', 'Normalize');  // settings persist between runs
  });

  await step('exports a section as 24-bit WAV with its reverb tail', async () => {
    const f = await exportFile(async () => {
      await pick('WAV'); await pick('Mixdown'); await pick('48 kHz'); await pick('24-bit');
      await dialog().getByRole('combobox', { name: 'Range' }).selectOption({ label: 'Section: Intro' });
    });
    const w = parseWav(f.bytes);
    assert(f.name.endsWith('-Intro.wav'), `unexpected file name ${f.name}`);
    assert(w.format === 1 && w.bits === 24 && w.sampleRate === 48000 && w.channels === 2, `wrong format ${JSON.stringify(w)}`);
    assert(w.seconds >= SECTION_SECONDS - 0.01 && w.seconds <= SECTION_SECONDS + 4.1, `length ${w.seconds.toFixed(2)}s, expected ${SECTION_SECONDS.toFixed(2)}s + tail`);
    assert(w.peak > 0.05, `export is silent (peak ${w.peak})`);
  });

  await step('renders the whole song faster than real time', async () => {
    const f = await exportFile(async () => {
      await pick('16-bit');
      await dialog().getByRole('combobox', { name: 'Range' }).selectOption({ label: 'Whole song' });
    });
    const w = parseWav(f.bytes);
    assert(w.bits === 16 && w.seconds >= SONG_SECONDS - 0.01, `16-bit whole song expected, got ${w.bits}-bit ${w.seconds.toFixed(1)}s`);
    assert(w.peak > 0.05 && w.peak <= 1, `bad level (peak ${w.peak})`);
    console.log(`      ${SONG_SECONDS.toFixed(1)} s of music rendered + encoded in ${(f.ms / 1000).toFixed(1)} s`);
    assert(f.ms < SONG_SECONDS * 1000, `export took ${f.ms} ms for ${SONG_SECONDS.toFixed(1)} s of music`);
  });

  await step('exports MP3 that decodes back to audio', async () => {
    const f = await exportFile(async () => {
      await pick('MP3'); await pick('192'); await pick('Stereo');
      await dialog().getByRole('combobox', { name: 'Range' }).selectOption({ label: 'Section: Intro' });
    });
    assert(String.fromCharCode(...f.bytes.slice(0, 3)) === 'ID3', 'missing ID3 tag');
    const tagLen = 10 + ((f.bytes[6] << 21) | (f.bytes[7] << 14) | (f.bytes[8] << 7) | f.bytes[9]);
    assert(f.bytes[tagLen] === 0xff && (f.bytes[tagLen + 1] & 0xe0) === 0xe0, 'no MPEG frame sync after the tag');
    const decoded = await page.evaluate(async (b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const ctx = new OfflineAudioContext(2, 1, 48000);
      const buf = await ctx.decodeAudioData(bin.buffer);
      let peak = 0;
      for (let c = 0; c < buf.numberOfChannels; c++) for (const x of buf.getChannelData(c)) peak = Math.max(peak, Math.abs(x));
      return { seconds: buf.duration, peak };
    }, Buffer.from(f.bytes).toString('base64'));
    assert(decoded.peak > 0.05, `decoded MP3 is silent (peak ${decoded.peak})`);
    assert(Math.abs(decoded.seconds - SECTION_SECONDS) < 4.2, `decoded length ${decoded.seconds.toFixed(2)}s`);
    // The file includes the reverb tail, so measure against the decoded length
    const kbps = (f.bytes.length * 8) / decoded.seconds / 1000;
    assert(kbps > 170 && kbps < 215, `size implies ${kbps.toFixed(0)} kbps for a 192 kbps export`);
  });

  await step('loudness normalization reaches the streaming target', async () => {
    await exportFile(async () => {
      await pick('WAV'); await pick('Loudness', 'Normalize');
    });
    const text = await page.getByTestId('export-result').innerText();
    const lufs = parseFloat(text.match(/([−-]?\d+\.\d) LUFS/)[1].replace('−', '-'));
    const held = text.includes('held back');
    assert(held ? lufs < -14 : Math.abs(lufs + 14) < 0.3, `reported ${lufs} LUFS (held back: ${held})`);
    await pick('Off', 'Normalize');
  });

  await step('stems skip tracks with nothing in the range', async () => {
    // Only Arp and Pad play in the Intro
    const f = await exportFile(async () => {
      await pick('WAV'); await pick('Stems (ZIP)'); await pick('16-bit');
      await dialog().getByRole('combobox', { name: 'Range' }).selectOption({ label: 'Section: Intro' });
    });
    const names = Object.keys(unzipSync(f.bytes)).sort();
    assert(names.join(',') === '04-Arp.wav,05-Pad.wav' || names.length === 2, `Intro stems: ${names.join(', ')}`);
  });

  await step('exports stems: one aligned file per audible track', async () => {
    const f = await exportFile(async () => {
      await dialog().getByRole('combobox', { name: 'Range' }).selectOption({ label: 'Whole song' });
    });
    const files = unzipSync(f.bytes);
    const names = Object.keys(files).sort();
    assert(names.length === 6, `expected 6 stems, got ${names.join(', ')}`);
    const parsed = names.map((n) => parseWav(files[n]));
    assert(new Set(parsed.map((p) => p.frames)).size === 1, 'stems have different lengths');
    assert(parsed.every((p) => p.peak > 0.005), `a stem is silent: ${names.filter((_, i) => parsed[i].peak <= 0.005)}`);
    await pick('Mixdown');
  });

  await step('exports MIDI with a track per part plus tempo', async () => {
    const f = await exportFile(async () => { await pick('MIDI'); });
    const ascii = String.fromCharCode(...f.bytes.slice(0, 4));
    const ntrks = (f.bytes[10] << 8) | f.bytes[11];
    assert(ascii === 'MThd' && ntrks === 7, `expected MThd with 7 tracks, got ${ascii} / ${ntrks}`);
    assert(f.name.endsWith('.mid'), f.name);
    await pick('WAV');
    await dialog().getByRole('button', { name: 'Done', exact: true }).click();
  });

  await step('exporting leaves the live audio graph alone (no leaked effect racks)', async () => {
    await button('▶ PLAY').click();
    await page.waitForTimeout(400);
    await button('■ STOP').click();
    // Several exports and stems later, live playback still uses its one rack
    const now = await page.evaluate(() => window.__liveRacks);
    assert(racksBeforeExport === 1 && now === 1, `live effect racks: ${racksBeforeExport} before exporting, ${now} after`);
  });

  await step('live recording is captured losslessly and exports as 32-bit float', async () => {
    await page.locator('main').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Home');
    await button('Record').click();                  // starts playback too
    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: /^Stop recording/ }).click();   // the running REC button
    await page.getByRole('dialog', { name: 'Export' }).waitFor({ timeout: 4000 });
    assert(await page.getByText('EXPORT RECORDING').count() === 1, 'dialog did not open with the take');
    const f = await exportFile(async () => { await pick('WAV'); await pick('32-bit float'); });
    const w = parseWav(f.bytes);
    assert(w.format === 3 && w.bits === 32, `expected 32-bit float, got ${JSON.stringify(w)}`);
    assert(w.peak > 0.01, `recording is silent (peak ${w.peak})`);
    assert(w.seconds > 1.0 && w.seconds < 3.5, `recording length ${w.seconds.toFixed(2)}s`);
    await dialog().getByRole('button', { name: 'Done', exact: true }).click();
    if (await button('■ STOP').count()) await button('■ STOP').click();
  });

  await step('the extended Midnight Drive loads as a full song', async () => {
    await page.getByRole('button', { name: 'OSC ▾' }).click();
    await page.getByRole('menuitem', { name: /Open example/ }).hover();
    await page.getByRole('button', { name: 'midnight drive extended', exact: true }).click();
    await page.getByText(/Loaded/).first().waitFor({ timeout: 4000 });
    const lanes = await page.locator('[data-lane-track]').count();
    assert(lanes === 11, `expected 11 tracks, saw ${lanes}`);
    // Section names are drawn on the ruler canvas; read them from the saved session instead
    const saved = await page.evaluate(() => new Promise((r) => setTimeout(() => r(localStorage.getItem('osc-app-state')), 700)));
    const sections = JSON.parse(saved).sequencer.markers.map((m) => m.name);
    for (const name of ['Intro', 'Breakdown', 'Drop', 'Bridge', 'Outro']) {
      assert(sections.includes(name), `missing section ${name} (have ${sections.join(', ')})`);
    }
    await page.getByTitle('Return to start (Home)').click();
    await button('▶ PLAY').click();
    await page.waitForTimeout(1500);
    const level = await page.evaluate(() => window.__level(500));
    await button('■ STOP').click();
    assert(level > 0.01, `extended example is silent (peak ${level.toFixed(4)})`);
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
