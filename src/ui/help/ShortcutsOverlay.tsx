import { useMemo, useState } from 'react';
import { Dialog } from '../kit/Dialog';
import { SHORTCUTS, formatKeys, type ShortcutDef } from '../shortcuts';
import { getFocusZone } from '../focus';

const GROUPS: ShortcutDef['group'][] = ['Transport', 'File', 'Edit', 'View', 'Help', 'Arrangement', 'Editor'];

/** Every shortcut, grouped and searchable; the area that owns the keys right now is marked. */
export function ShortcutsOverlay({ onClose, onOpenGuide }: { onClose: () => void; onOpenGuide: () => void }) {
  const [q, setQ] = useState('');
  const zone = getFocusZone();
  const activeGroup = zone === 'editor' ? 'Editor' : 'Arrangement';
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return SHORTCUTS.filter((x) => x.keys.length > 0).filter((x) => !s || x.label.toLowerCase().includes(s) || x.keys.some((k) => formatKeys(k).toLowerCase().includes(s)));
  }, [q]);

  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} className="w-[760px]">
      <div className="px-4 pt-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search shortcuts…"
          aria-label="Search shortcuts"
          data-autofocus=""
          className="w-full bg-neutral-950 border border-neutral-700 px-2 py-1 text-xs text-neutral-200"
        />
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-3">
        {GROUPS.map((g) => {
          const items = list.filter((x) => x.group === g);
          if (!items.length) return null;
          return (
            <section key={g} aria-label={g}>
              <h3 className="text-[11px] tracking-widest text-neutral-500 mb-1 flex items-center gap-2">
                {g.toUpperCase()}
                {g === activeGroup && <span className="px-1 border border-[var(--accent)] text-[var(--accent)]">KEYS ARE HERE</span>}
              </h3>
              <table className="w-full text-xs">
                <tbody>
                  {items.map((x) => (
                    <tr key={x.id}>
                      <td className="py-0.5 pr-3 whitespace-nowrap font-mono text-neutral-100">
                        {x.keys.map((k) => formatKeys(k)).join(' / ')}
                      </td>
                      <td className="py-0.5 text-neutral-400">{x.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>
      <div className="flex justify-between items-center px-4 pb-3 text-[11px] text-neutral-500">
        <span>Arrangement and editor keys act on whichever of the two you clicked last.</span>
        <button onClick={() => { onClose(); onOpenGuide(); }} className="underline text-[var(--accent)]">Open the full guide (F1) →</button>
      </div>
    </Dialog>
  );
}
