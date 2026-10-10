import { useEffect, useState } from 'react';

export interface NoticeAction {
  label: string;
  run: () => void;
}

export interface Notice {
  id: number;
  text: string;
  tone: 'info' | 'warn' | 'error';
  action?: NoticeAction;
}

let nextId = 1;
let notices: Notice[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/**
 * Show a short message in the corner, optionally with one action ("Undo",
 * "Turn off"). Errors stay until dismissed; messages with an action stay a
 * little longer so there is time to use it.
 */
export function notify(text: string, tone: Notice['tone'] = 'info', action?: NoticeAction): number {
  const n = { id: nextId++, text, tone, action };
  notices = [...notices, n];
  emit();
  if (tone !== 'error') {
    // Long messages stay up long enough to read
    const base = action ? 8000 : tone === 'warn' ? 9000 : 3500;
    setTimeout(() => dismiss(n.id), Math.max(base, text.length * 65));
  }
  return n.id;
}

export function dismiss(id: number): void {
  notices = notices.filter((n) => n.id !== id);
  emit();
}

export function Notices() {
  const [list, setList] = useState(notices);
  useEffect(() => {
    const l = () => setList(notices);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  // The live regions stay mounted so screen readers announce the first notice too
  return (
    <div className="fixed bottom-9 right-3 z-[120] flex flex-col gap-1.5 max-w-[400px]">
      <div role="status" aria-live="polite" className="flex flex-col gap-1.5">
        {list.filter((n) => n.tone !== 'error').map((n) => <NoticeCard key={n.id} n={n} />)}
      </div>
      <div role="alert" className="flex flex-col gap-1.5">
        {list.filter((n) => n.tone === 'error').map((n) => <NoticeCard key={n.id} n={n} />)}
      </div>
    </div>
  );
}

function NoticeCard({ n }: { n: Notice }) {
  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 text-xs border rounded-sm shadow-xl bg-neutral-900 ${
        n.tone === 'error' ? 'border-red-800 text-red-300'
          : n.tone === 'warn' ? 'border-amber-800 text-amber-200' : 'border-neutral-700 text-neutral-300'
      }`}
    >
      <span className="flex-1 leading-snug">{n.text}</span>
      {n.action && (
        <button
          onClick={() => { n.action!.run(); dismiss(n.id); }}
          className="shrink-0 px-1.5 border border-neutral-600 text-neutral-200 hover:border-neutral-400"
        >{n.action.label}</button>
      )}
      <button onClick={() => dismiss(n.id)} className="text-neutral-500 hover:text-neutral-200" aria-label="Dismiss">✕</button>
    </div>
  );
}
