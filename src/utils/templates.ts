import type { LoadedProject } from './project';
import { uid, type Clip, type Track } from './music';

/** Bars the template's drum loop runs for (and the loop range). */
export const TEMPLATE_LOOP_BARS = 8;

/**
 * A template is an example with the music taken out. The tracks, sounds,
 * mixer, effects, tempo and drum patterns stay — the genre's palette is ready
 * — and the main drum beat loops over the first bars, so Play gives a groove
 * to write over straight away.
 */
export function makeTemplate(project: LoadedProject, title: string): LoadedProject {
  const loopBeats = TEMPLATE_LOOP_BARS * project.beatsPerBar;

  // The drum track carrying the most beats of drum clips has the main beat
  const drumWeight = (t: Track) => (t.source.type === 'drums' ? t.clips.reduce((s, c) => s + c.lengthBeats, 0) : 0);
  const mainDrums = [...project.doc.tracks].sort((a, b) => drumWeight(b) - drumWeight(a))[0];

  const tracks = project.doc.tracks.map((t): Track => {
    let clips: Clip[] = [];
    if (t === mainDrums && drumWeight(t) > 0) {
      const beats = new Map<string, number>();
      for (const c of t.clips) beats.set(c.patternId, (beats.get(c.patternId) ?? 0) + c.lengthBeats);
      const [patternId] = [...beats.entries()].sort((a, b) => b[1] - a[1])[0];
      clips = [{ id: uid('clip'), patternId, startBeat: 0, lengthBeats: loopBeats, offsetBeats: 0, muted: false }];
    }
    // Automation belongs to the song's arrangement, not its sound
    return { ...t, clips, lanes: [], showAutomation: false, activeLaneId: null, muted: false, solo: false };
  });

  return {
    ...project,
    name: `Untitled (${title})`,
    songLengthBars: TEMPLATE_LOOP_BARS * 2,
    loop: { enabled: true, startBeat: 0, endBeat: loopBeats },
    doc: { tracks, patterns: {}, markers: [] },
    warnings: [],
  };
}
