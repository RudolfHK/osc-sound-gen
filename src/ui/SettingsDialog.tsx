import { useEffect, useState, type ReactNode } from 'react';
import { useAppStore, useAccent } from '../store/appStore';
import {
  DEFAULT_SETTINGS, updateSettings, useSettings,
  type FollowMode, type LatencyHint, type Settings,
} from '../store/settings';
import { getAudioEngine } from '../engine/audio';
import { SNAP_OPTIONS, type SnapValue } from '../utils/music';
import { THEME_COLORS, type ColorTheme } from '../utils/math';
import { accentFor, setTheme, useTheme } from './theme';
import { Dialog } from './kit/Dialog';
import { Button } from './kit/Button';
import { TEMPLATES } from './examples';
import { notify } from './notices';

function Row({ label, help, children, htmlFor }: { label: string; help?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-x-4 items-start py-1.5">
      <label htmlFor={htmlFor} className="text-xs text-neutral-300 pt-1">{label}</label>
      <div className="min-w-0">
        {children}
        {help && <p className="text-[11px] text-neutral-500 leading-snug mt-1">{help}</p>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="py-2 border-b border-neutral-800 last:border-b-0">
      <h3 className="text-[11px] tracking-widest text-neutral-500 mb-1">{title.toUpperCase()}</h3>
      {children}
    </section>
  );
}

const select = 'bg-neutral-950 border border-neutral-700 text-xs text-neutral-200 px-1.5 py-1 max-w-full';

/** Audio outputs the browser will tell us about ('' = the system default). */
function useOutputDevices(): { id: string; label: string }[] | null {
  const [devices, setDevices] = useState<{ id: string; label: string }[] | null>(null);
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) { setDevices(null); return; }
    const load = () => md.enumerateDevices().then((all) => {
      const outs = all.filter((d) => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default');
      setDevices(outs.map((d, i) => ({ id: d.deviceId, label: d.label || `Output ${i + 1}` })));
    }).catch(() => setDevices(null));
    void load();
    md.addEventListener?.('devicechange', load);
    return () => md.removeEventListener?.('devicechange', load);
  }, []);
  return devices;
}

/** Settings (⌘, / Ctrl+,): audio, new projects, editing, saving and appearance. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const { state, dispatch } = useAppStore();
  const accent = useAccent();
  const theme = useTheme();
  const devices = useOutputDevices();
  const canPickOutput = 'setSinkId' in AudioContext.prototype;
  const set = (patch: Partial<Settings>) => updateSettings(patch);

  const chooseOutput = async (id: string) => {
    const ok = await getAudioEngine().setOutputDevice(id);
    if (ok) set({ outputDeviceId: id });
    else notify("Couldn't switch to that output device.", 'error');
  };

  return (
    <Dialog title="Settings" onClose={onClose} className="w-[680px]">
      <div className="px-4 py-1 max-h-[calc(72vh/var(--ui-zoom,1))] overflow-y-auto">
        <Section title="Audio">
          <Row label="Output device" htmlFor="set-output"
            help={canPickOutput ? 'Where the sound plays. Switches at once.' : 'This browser always plays through the system output.'}>
            <select id="set-output" className={select} disabled={!canPickOutput}
              value={s.outputDeviceId} onChange={(e) => void chooseOutput(e.target.value)}>
              <option value="">System default</option>
              {(devices ?? []).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </Row>
          <Row label="Latency" htmlFor="set-latency"
            help="Lower latency answers the keyboard faster; higher is more stable on slow machines. Applies the next time the app starts.">
            <select id="set-latency" className={select} value={s.latencyHint}
              onChange={(e) => set({ latencyHint: e.target.value as LatencyHint })}>
              <option value="interactive">Low (interactive)</option>
              <option value="balanced">Balanced</option>
              <option value="playback">High (most stable)</option>
            </select>
          </Row>
          <Row label="Eco mode"
            help="A lighter sound engine for slow machines: narrower stereo, shorter release tails, slower meters.">
            <label className="flex items-center gap-2 text-xs text-neutral-300 pt-1">
              <input type="checkbox" checked={s.ecoMode} onChange={(e) => set({ ecoMode: e.target.checked })} style={{ accentColor: accent }} />
              On
            </label>
            <label className="flex items-center gap-2 text-xs text-neutral-300 mt-1">
              <input type="checkbox" checked={s.autoEco} onChange={(e) => set({ autoEco: e.target.checked })} style={{ accentColor: accent }} />
              Turn on by itself when the audio drops out (you’ll get a notice)
            </label>
          </Row>
        </Section>

        <Section title="New projects">
          <Row label="Start with" htmlFor="set-start" help="What File → New project… suggests first, and what the desktop menu's New Project makes.">
            <select id="set-start" className={select} value={s.newStart} onChange={(e) => set({ newStart: e.target.value })}>
              <option value="starter">Starter tracks (drums, bass, keys, pad)</option>
              <option value="empty">Empty — no tracks</option>
              {TEMPLATES.map((t) => <option key={t.id} value={t.id}>Template: {t.title}</option>)}
            </select>
          </Row>
          <Row label="Tempo" htmlFor="set-tempo" help="For starter and empty projects; templates bring their own.">
            <input id="set-tempo" type="number" min={40} max={240} className={`${select} w-20`} value={s.newTempo}
              onChange={(e) => { const v = parseInt(e.target.value, 10); if (v >= 40 && v <= 240) set({ newTempo: v }); }} />
            <span className="text-xs text-neutral-500 ml-2">BPM</span>
          </Row>
          <Row label="Editor grid / note length">
            <div className="flex gap-2">
              <select aria-label="Editor grid" className={select} value={s.newSnap} onChange={(e) => set({ newSnap: e.target.value as SnapValue })}>
                {SNAP_OPTIONS.map((o) => <option key={o} value={o}>Grid {o}</option>)}
              </select>
              <select aria-label="Note length" className={select} value={s.newNoteLength} onChange={(e) => set({ newNoteLength: e.target.value as SnapValue })}>
                {SNAP_OPTIONS.map((o) => <option key={o} value={o}>Notes {o}</option>)}
              </select>
            </div>
          </Row>
        </Section>

        <Section title="Editing">
          <Row label="Follow playhead" htmlFor="set-follow" help="How the arrangement keeps up while playing. Also on the ⇥ button by the zoom controls.">
            <select id="set-follow" className={select} value={s.followPlayhead} onChange={(e) => set({ followPlayhead: e.target.value as FollowMode })}>
              <option value="page">Page — jump when it reaches the edge</option>
              <option value="scroll">Scroll — keep it a third of the way in</option>
              <option value="off">Off — the view stays put</option>
            </select>
          </Row>
          <Row label="Keyboard piano" htmlFor="set-octave" help="In the piano roll, the A key plays this C; the row up to ; plays the notes above it.">
            <select id="set-octave" className={select} value={s.keyboardOctave} onChange={(e) => set({ keyboardOctave: parseInt(e.target.value, 10) })}>
              {[1, 2, 3, 4, 5, 6].map((o) => <option key={o} value={o}>A plays C{o}</option>)}
            </select>
          </Row>
          <Row label="Metronome level" htmlFor="set-click">
            <div className="flex items-center gap-2">
              <input id="set-click" type="range" min={0} max={1} step={0.05} value={s.metronomeLevel}
                onChange={(e) => set({ metronomeLevel: parseFloat(e.target.value) })} style={{ accentColor: accent }} className="w-40" />
              <span className="text-xs font-mono text-neutral-400 w-10">{Math.round(s.metronomeLevel * 100)}%</span>
            </div>
          </Row>
          <Row label="Count-in" htmlFor="set-countin" help="Clicks before playback starts, when the metronome is on.">
            <select id="set-countin" className={select} value={s.countIn} onChange={(e) => set({ countIn: parseInt(e.target.value, 10) as Settings['countIn'] })}>
              <option value={0}>Off</option>
              <option value={1}>1 bar</option>
              <option value={2}>2 bars</option>
            </select>
          </Row>
        </Section>

        <Section title="Saving">
          <Row label="Autosave" htmlFor="set-autosave"
            help="Writes changes to the project’s file — once it has been saved to, or opened from, a file in a browser that can write files (Chrome, Edge, the desktop app). Separately, your session is always kept in this browser and comes back after a reload.">
            <select id="set-autosave" className={select} value={s.autosaveMinutes} onChange={(e) => set({ autosaveMinutes: parseInt(e.target.value, 10) })}>
              <option value={0}>Off</option>
              <option value={1}>Every minute</option>
              <option value={2}>Every 2 minutes</option>
              <option value={5}>Every 5 minutes</option>
              <option value={10}>Every 10 minutes</option>
            </select>
          </Row>
        </Section>

        <Section title="Appearance">
          <Row label="Theme">
            <div className="flex gap-1" role="group" aria-label="Theme">
              {(['dark', 'light'] as const).map((t) => (
                <button key={t} onClick={() => setTheme(t)} aria-pressed={theme === t}
                  className="px-2.5 py-1 text-xs border"
                  style={theme === t ? { borderColor: accent, color: accent } : { borderColor: 'var(--color-neutral-700)', color: 'var(--color-neutral-400)' }}
                >{t === 'dark' ? 'Dark' : 'Light'}</button>
              ))}
            </div>
          </Row>
          <Row label="Accent colour">
            <div className="flex gap-2" role="group" aria-label="Accent colour">
              {(Object.keys(THEME_COLORS) as ColorTheme[]).map((c) => (
                <button key={c} onClick={() => dispatch({ type: 'SET_UI_THEME', theme: c })}
                  aria-label={c[0].toUpperCase() + c.slice(1)} aria-pressed={state.uiTheme === c}
                  className="w-6 h-6 rounded-full border-2"
                  style={{ backgroundColor: accentFor(THEME_COLORS[c], theme), borderColor: state.uiTheme === c ? 'var(--color-neutral-100)' : 'transparent' }}
                />
              ))}
            </div>
          </Row>
          <Row label="Interface size" htmlFor="set-scale">
            <select id="set-scale" className={select} value={s.uiScale} onChange={(e) => set({ uiScale: parseFloat(e.target.value) })}>
              {[0.9, 1, 1.1, 1.25, 1.5].map((v) => <option key={v} value={v}>{Math.round(v * 100)} %</option>)}
            </select>
          </Row>
          <Row label="Welcome screen">
            <label className="flex items-center gap-2 text-xs text-neutral-300 pt-1">
              <input type="checkbox" checked={s.welcomeOnStart} onChange={(e) => set({ welcomeOnStart: e.target.checked })} style={{ accentColor: accent }} />
              Show it every time the app starts
            </label>
          </Row>
        </Section>
      </div>
      <div className="flex justify-between gap-2 px-4 py-3 border-t border-neutral-800">
        <Button onClick={() => { updateSettings(DEFAULT_SETTINGS); void getAudioEngine().setOutputDevice(''); }}>Reset to defaults</Button>
        <Button variant="primary" onClick={onClose} data-autofocus="">Done</Button>
      </div>
    </Dialog>
  );
}
