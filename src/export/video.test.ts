import { describe, it, expect } from 'vitest';
import { VIDEO_SIZES, clock, pickVideoFormat, sectionAt, videoLayout, type VideoAspect } from './video';

describe('video format', () => {
  it('prefers MP4 with H.264, then WebM, and admits when it can\'t record', () => {
    expect(pickVideoFormat(() => true)!.ext).toBe('mp4');
    expect(pickVideoFormat((m) => m.startsWith('video/webm'))).toMatchObject({ ext: 'webm', mime: 'video/webm;codecs=vp9,opus' });
    expect(pickVideoFormat((m) => m === 'video/webm;codecs=vp8,opus')!.label).toMatch(/VP8/);
    expect(pickVideoFormat(() => false)).toBeNull();
  });
});

describe('video layout', () => {
  it('fits everything inside the frame, in order, for every shape', () => {
    for (const aspect of Object.keys(VIDEO_SIZES) as VideoAspect[]) {
      const [w, h] = VIDEO_SIZES[aspect];
      const L = videoLayout(w, h);
      expect(L.title.y, aspect).toBeLessThan(L.sub.y);
      expect(L.sub.y, aspect).toBeLessThan(L.viz.y);
      expect(L.viz.y + L.viz.h, aspect).toBeLessThan(L.time.y);
      expect(L.time.y, aspect).toBeLessThan(L.bar.y);
      expect(L.bar.y + L.bar.h, aspect).toBeLessThanOrEqual(h);
      expect(L.viz.x + L.viz.w, aspect).toBeLessThanOrEqual(w);
      // The picture gets most of the frame
      expect(L.viz.h, aspect).toBeGreaterThan(h * 0.45);
    }
  });
});

describe('video text', () => {
  it('formats the clock and finds the section playing', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(83.9)).toBe('1:23');
    const sections = [{ name: 'Intro', seconds: 0 }, { name: 'Drop', seconds: 16 }];
    expect(sectionAt(sections, 3)).toBe('Intro');
    expect(sectionAt(sections, 16)).toBe('Drop');
    expect(sectionAt([], 3)).toBe('');
  });
});
