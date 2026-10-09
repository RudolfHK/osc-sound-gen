/**
 * Desktop smoke test: launches the packaged Electron app and checks that it
 * starts, honours its Content-Security-Policy without blocking anything the
 * app needs, makes sound, and can export (which exercises the workers and the
 * audio worklet under the file:// origin).
 *
 *   npx electron-builder --linux dir && xvfb-run -a node e2e/electron-smoke.mjs
 */

import { _electron as electron } from 'playwright';
import { existsSync } from 'node:fs';

const exe = process.env.OSC_APP ?? 'release/linux-unpacked/osc-sound-gen';
if (!existsSync(exe)) {
  console.error(`No packaged app at ${exe}. Run: npx electron-builder --linux dir`);
  process.exit(1);
}

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(true); console.log(`  ✓ ${name}`); }
  catch (e) { results.push(false); console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

const app = await electron.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
const win = await app.firstWindow();
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
win.on('pageerror', (e) => errors.push(e.message));

console.log('\nOSC desktop\n');
try {
  await step('opens the app from the packaged files', async () => {
    await win.waitForSelector('[data-lane-track]', { timeout: 20000 });
    const url = win.url();
    assert(url.startsWith('file://'), `loaded ${url}`);
  });

  await step('runs with its Content-Security-Policy and the desktop bridge', async () => {
    const csp = await win.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '');
    assert(csp.includes("script-src 'self'"), 'CSP meta missing');
    const bridge = await win.evaluate(() => (window).oscDesktop?.isDesktop === true && typeof (window).require === 'undefined');
    assert(bridge, 'preload bridge missing or Node exposed to the page');
  });

  await step('plays an example', async () => {
    await win.getByRole('button', { name: 'OSC ▾' }).click();
    await win.getByRole('menuitem', { name: /Open example/ }).hover();
    await win.getByRole('button', { name: 'midnight drive', exact: true }).click();
    await win.getByText(/Loaded/).first().waitFor({ timeout: 5000 });
    await win.getByRole('button', { name: '▶ PLAY', exact: true }).click();
    await win.waitForTimeout(1500);
    const pos = await win.getByLabel('Song position').innerText();
    await win.getByRole('button', { name: '■ STOP', exact: true }).click();
    assert(!pos.startsWith('1.1.1'), `playhead did not move (${pos})`);
  });

  await step('exports MP3 (worker + worklet under file://)', async () => {
    await win.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = win.getByRole('dialog', { name: 'Export' });
    await dialog.waitFor({ timeout: 4000 });
    await dialog.getByRole('combobox', { name: 'Range' }).selectOption({ label: 'Section: Intro' });
    await dialog.getByRole('radio', { name: 'MP3', exact: true }).click();
    // Electron would show a save dialog for the download; intercept it
    await app.evaluate(({ session }) => {
      session.defaultSession.once('will-download', (_e, item) => item.setSavePath('/tmp/osc-electron-test.mp3'));
    });
    await dialog.getByRole('button', { name: /^EXPORT( AGAIN)?$/ }).click();
    await win.getByText(/Exported .*\.mp3/).first().waitFor({ timeout: 60000 });
  });

  await step('no console errors (including CSP violations)', async () => {
    assert(errors.length === 0, errors.slice(0, 5).join(' | '));
  });
} finally {
  await app.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
