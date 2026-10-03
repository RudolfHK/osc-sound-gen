/**
 * Minimal ID3v2.3 tag: title, artist, album and encoder — enough for players
 * and libraries to show something better than the file name.
 */

function frame(id: string, value: string): number[] {
  // Encoding byte 1 = UTF-16 with BOM, which every reader handles
  const body: number[] = [0x01, 0xff, 0xfe];
  for (const ch of value) {
    const c = ch.codePointAt(0)!;
    if (c > 0xffff) {
      const v = c - 0x10000;
      const hi = 0xd800 + (v >> 10), lo = 0xdc00 + (v & 0x3ff);
      body.push(hi & 0xff, hi >> 8, lo & 0xff, lo >> 8);
    } else {
      body.push(c & 0xff, c >> 8);
    }
  }
  const size = body.length;
  return [
    ...Array.from(id, (c) => c.charCodeAt(0)),
    (size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff,
    0, 0, // flags
    ...body,
  ];
}

/** Sizes in the ID3 header are "synchsafe": 7 bits per byte. */
function synchsafe(n: number): number[] {
  return [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
}

export function id3v2(tags: { title?: string; artist?: string; album?: string; encoder?: string }): Uint8Array {
  const frames: number[] = [];
  if (tags.title) frames.push(...frame('TIT2', tags.title));
  if (tags.artist) frames.push(...frame('TPE1', tags.artist));
  if (tags.album) frames.push(...frame('TALB', tags.album));
  if (tags.encoder) frames.push(...frame('TSSE', tags.encoder));
  return new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, ...synchsafe(frames.length), ...frames]);
}
