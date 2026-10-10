/**
 * Where to jump for typed text: "17" is bar 17, "17.3" its third beat,
 * "17.3.2" a sixteenth into that; "1:30" or "1:30.5" is a time. Null if the
 * text isn't a position.
 */
export function parsePosition(text: string, bpm: number, beatsPerBar: number): number | null {
  const t = text.trim();
  const time = t.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (time) return ((parseInt(time[1], 10) * 60 + parseFloat(time[2])) * bpm) / 60;
  const pos = t.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!pos) return null;
  const bar = parseInt(pos[1], 10);
  const beat = pos[2] ? parseInt(pos[2], 10) : 1;
  const six = pos[3] ? parseInt(pos[3], 10) : 1;
  if (bar < 1 || beat < 1 || beat > beatsPerBar || six < 1 || six > 4) return null;
  return (bar - 1) * beatsPerBar + (beat - 1) + (six - 1) / 4;
}
