/**
 * Performance regression test: the budgets from
 * docs/proposals/professional-polish-plan.md (Part B), as thresholds.
 *
 *   npm run build && npm run test:perf
 *
 * Machines differ, and so does one machine from day to day, so every number
 * is normalised to the reference machine the budgets were set on. A fixed
 * synthetic audio workload is rendered first; how long it takes here against
 * how long it took there (REFERENCE_CALIBRATION_MS) is the speed factor.
 * Offline loads are scaled by it, and the "4× slower CPU" runs throttle by
 * 4 ÷ factor, so a slow machine isn't failed for being slow.
 *
 * Offline (audio-thread) numbers come from the dev server, where the render
 * module can be imported; live playback runs against the production build.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

/** Calibration render time on the reference machine (4-core build box, Chromium 141). */
const REFERENCE_CALIBRATION_MS = 306;

const BUDGETS = {
  heaviestLoad: 0.5,       // audio-thread load, Midnight Drive (Extended) drop
  exportSpeed: 3,          // × real time, every example's busiest 8 bars
  lateNotes: 0,            // notes queued < 5 ms ahead, slow machine
  slowFrameP95Ms: 33,      // slow machine, mixer meters + visualizer open
  dropouts: 0,             // normal speed (where Chrome reports them)
};

const exe = process.env.CHROMIUM_PATH
  ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const manifest = JSON.parse(readFileSync('examples/index.json', 'utf8'));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : NaN; };

function serve(args, port) {
  const proc = spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...args, '--port', String(port), '--strictPort'], { stdio: 'pipe' });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`vite ${args[0] ?? 'dev'} did not start`)), 30000);
    proc.stdout.on('data', (d) => { if (String(d).includes(String(port))) { clearTimeout(timer); resolve(proc); } });
    proc.on('exit', (code) => reject(new Error(`vite exited (${code})`)));
  });
}

const results = [];
function check(name, value, ok, detail) {
  results.push({ name, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(56)} ${value}${detail ? `   ${detail}` : ''}`);
}

const DEV_PORT = 4381, PREVIEW_PORT = 4382;
const dev = await serve([], DEV_PORT);
const preview = await serve(['preview'], PREVIEW_PORT);
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-experimental-web-platform-features'],
});

try {
  // ── Calibration ─────────────────────────────────────────────────────────────
  const page = await browser.newPage();
  await page.goto(`http://localhost:${DEV_PORT}/src/utils/music.ts`);
  const calib = median(await page.evaluate(async () => {
    const one = async () => {
      const sr = 44100;
      const ctx = new OfflineAudioContext(2, sr * 6, sr);
      for (let v = 0; v < 48; v++) {
        const t = (v % 12) * 0.5;
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 110 * (1 + (v % 7) / 7);
        const f = ctx.createBiquadFilter(); f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(4000, t + 3);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 5);
        const p = ctx.createStereoPanner(); p.pan.value = (v % 5) / 5 - 0.4;
        o.connect(f); f.connect(g); g.connect(p); p.connect(ctx.destination); o.start(t); o.stop(t + 5.5);
      }
      const t0 = performance.now(); await ctx.startRendering(); return performance.now() - t0;
    };
    const out = [];
    for (let i = 0; i < 5; i++) out.push(await one());
    return out;
  }));
  const factor = calib / REFERENCE_CALIBRATION_MS;
  console.log(`\nOSC performance — machine speed factor ${factor.toFixed(2)} (calibration ${Math.round(calib)} ms; 1.00 = reference)\n`);

  // ── Offline: audio-thread load and export speed ────────────────────────────
  // The busiest 8 bars of each example, rendered the way Export renders them.
  console.log('Audio thread (offline render, normalised)');
  for (const ex of manifest.examples) {
    const raw = JSON.parse(readFileSync(`examples/${ex.file}`, 'utf8'));
    const heaviest = ex.file === 'midnight-drive-extended.oscproject';
    const { load, from } = await page.evaluate(async ({ raw, heaviest }) => {
      const { parseProject } = await import('/src/utils/project.ts');
      const { makeDefaultSequencerState } = await import('/src/utils/music.ts');
      const { eventsInWindow } = await import('/src/engine/timeline.ts');
      const render = await import('/src/export/render.ts');
      const p = parseProject(raw);
      const bpb = p.beatsPerBar;
      const seq = { ...makeDefaultSequencerState(), ...p.doc, bpm: p.bpm, beatsPerBar: bpb, songLengthBars: p.songLengthBars };
      const span = Math.min(8, p.songLengthBars);
      let from = 0;
      if (heaviest) {
        from = 64; // the Drop: every part at once
      } else {
        // Busiest window by event count
        const input = {
          tracks: p.doc.tracks, patterns: p.doc.patterns,
          drumPatterns: new Map(p.drumPatterns.map((d) => [d.id, d])),
          notesFor: (_t, pat) => pat.notes, metronome: false, beatsPerBar: bpb,
        };
        let best = -1;
        for (let bar = 0; bar + span <= p.songLengthBars; bar++) {
          const n = eventsInWindow(input, bar * bpb, (bar + span) * bpb, { enabled: false, start: 0, end: 0 }, false).length;
          if (n > best) { best = n; from = bar; }
        }
      }
      const loads = [];
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        const buf = await render.renderArrangement(
          { seq, tabs: p.oscillators, drumPatterns: p.drumPatterns, effects: p.effects, masterVolume: p.masterVolume },
          { startBeat: from * bpb, endBeat: (from + span) * bpb, sampleRate: 44100, maxTailSeconds: 0.5 },
        );
        loads.push((performance.now() - t0) / 1000 / (buf.length / 44100));
      }
      loads.sort((a, b) => a - b);
      return { load: loads[1], from };
    }, { raw, heaviest });
    const norm = load / factor;
    const speed = 1 / norm;
    const where = `bars ${from + 1}–${from + 8}`;
    if (heaviest) check(`Load: ${ex.title} drop`, `${Math.round(norm * 100)} %`, norm <= BUDGETS.heaviestLoad, `budget ≤ ${BUDGETS.heaviestLoad * 100} %`);
    check(`Export speed: ${ex.title}`, `${speed.toFixed(1)}×`, speed >= BUDGETS.exportSpeed, `${where}, budget ≥ ${BUDGETS.exportSpeed}×`);
  }
  await page.close();

  // ── Live playback ───────────────────────────────────────────────────────────
  console.log('\nLive playback');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('osc-welcome-seen', '1');
    const oc = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (d, ...r) {
      if (d instanceof AudioDestinationNode && !(this.context instanceof OfflineAudioContext) && window.__c !== this.context) window.__c = this.context;
      return oc.call(this, d, ...r);
    };
    window.__margins = [];
    const os = AudioScheduledSourceNode.prototype.start;
    AudioScheduledSourceNode.prototype.start = function (when = 0, ...r) {
      if (!(this.context instanceof OfflineAudioContext) && when > 0) window.__margins.push(when - this.context.currentTime);
      return os.call(this, when, ...r);
    };
    window.__frames = (ms) => new Promise((res) => {
      const dts = []; let last = performance.now(); const end = last + ms;
      const f = (t) => { dts.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else res(dts); };
      requestAnimationFrame(f);
    });
  });
  const live = await ctx.newPage();
  const cdp = await ctx.newCDPSession(live);
  const btn = (name) => live.getByRole('button', { name, exact: true }).first();
  await live.goto(`http://localhost:${PREVIEW_PORT}`);
  await live.waitForSelector('[data-lane-track]');

  async function open(title) {
    await live.getByRole('button', { name: 'OSC ▾' }).click();
    await live.getByRole('menuitem', { name: /Open example/ }).hover();
    await live.getByRole('menuitem', { name: title, exact: true }).click();
    const guard = live.getByRole('dialog', { name: 'Unsaved changes' });
    if (await guard.waitFor({ timeout: 800 }).then(() => true, () => false)) await guard.getByRole('button', { name: "Don't save" }).click();
    await live.getByText(/Loaded/).first().waitFor({ timeout: 8000 });
  }

  async function play(seconds, slow) {
    const rate = slow ? Math.max(1, 4 / factor) : 1;
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await btn('▶ PLAY').click();
    await live.waitForTimeout(600);
    const before = await live.evaluate(() => { window.__margins = []; return window.__c?.playoutStats?.fallbackFramesEvents ?? null; });
    const frames = await live.evaluate((ms) => window.__frames(ms), seconds * 1000);
    const after = await live.evaluate(() => ({ margins: window.__margins, glitches: window.__c?.playoutStats?.fallbackFramesEvents ?? null }));
    await btn('■ STOP').click();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    return {
      p95: q(frames, 0.95),
      late: after.margins.filter((m) => m < 0.005).length,
      notes: after.margins.length,
      glitches: before === null || after.glitches === null ? null : after.glitches - before,
      rate,
    };
  }

  // Seek by clicking the ruler at a beat
  async function seekTo(beat, totalBeats) {
    await live.getByRole('button', { name: 'FIT' }).click();
    const ruler = live.locator('[data-arrange-lanes] canvas').first();
    const rb = await ruler.boundingBox();
    await live.mouse.click(rb.x + (beat / totalBeats) * (rb.width - 20) + 4, rb.y + rb.height - 6);
  }

  const runs = [
    { title: 'Midnight Drive (Extended)', beat: 256, total: 98 * 4, panels: true },
    { title: 'Velvet Hours', beat: 160, total: 64 * 4 },
    { title: 'Neon Drift', beat: 128, total: 52 * 4 },
  ];
  for (const r of runs) {
    await open(r.title);
    if (r.panels) {
      await live.getByRole('tab', { name: 'MIXER' }).click();
      await btn('VIZ').click();
    }
    await seekTo(r.beat, r.total);
    const normal = await play(8, false);
    await seekTo(r.beat, r.total);
    const slow = await play(8, true);
    const label = r.title + (r.panels ? ' + meters + visualizer' : '');
    check(`Late notes, slow machine: ${label}`, `${slow.late} of ${slow.notes}`, slow.late <= BUDGETS.lateNotes, `CPU ÷${slow.rate.toFixed(1)}`);
    if (r.panels) {
      check(`Frame p95, slow machine: ${label}`, `${slow.p95.toFixed(1)} ms`, slow.p95 <= BUDGETS.slowFrameP95Ms, `budget ≤ ${BUDGETS.slowFrameP95Ms} ms`);
    }
    // The audio thread can't be slowed down or sped up to match the reference
    // machine, so dropouts are only judged on a machine close to it
    if (normal.glitches === null) {
      console.log(`  · Dropouts, normal speed: ${label} — not reported by this browser`);
    } else if (factor > 1.3) {
      console.log(`  · Dropouts, normal speed: ${label} — ${normal.glitches} (not judged: this machine is ${factor.toFixed(1)}× slower than the reference)`);
    } else {
      check(`Dropouts, normal speed: ${label}`, String(normal.glitches), normal.glitches <= BUDGETS.dropouts, '(headless: fake audio device)');
    }
    if (r.panels) {
      await btn('VIZ').click();
      await live.getByRole('tab', { name: 'EDITOR' }).click();
    }
  }
  await ctx.close();
} finally {
  await browser.close();
  dev.kill();
  preview.kill();
}

const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} budgets met\n`);
process.exit(bad.length ? 1 : 0);
