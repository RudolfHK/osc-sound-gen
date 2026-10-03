import { useSyncExternalStore } from 'react';
import type { PcmAudio } from '../export/wav';

/** What the export dialog is exporting, or null when it's closed. */
export type ExportSource = 'song' | 'take';

let open: ExportSource | null = null;
let lastTake: PcmAudio | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

export function openExport(source: ExportSource): void {
  open = source;
  emit();
}

export function closeExport(): void {
  open = null;
  emit();
}

/** Keep the most recent live recording so it can be exported (and re-exported in another format). */
export function setLastTake(take: PcmAudio | null): void {
  lastTake = take;
  emit();
}

export function getLastTake(): PcmAudio | null {
  return lastTake;
}

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

export function useExportState(): { open: ExportSource | null; take: PcmAudio | null } {
  const o = useSyncExternalStore(subscribe, () => open, () => open);
  const t = useSyncExternalStore(subscribe, () => lastTake, () => lastTake);
  return { open: o, take: t };
}
