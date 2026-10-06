import { useEffect, useState } from 'react';

export interface Notice {
  id: number;
  text: string;
  tone: 'info' | 'warn' | 'error';
}

let nextId = 1;
let notices: Notice[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Show a short message in the corner. Errors stay until dismissed. */
export function notify(text: string, tone: Notice['tone'] = 'info'): void {
  const n = { id: nextId++, text, tone };
  notices = [...notices, n];
  emit();
  if (tone !== 'error') {
    setTimeout(() => dismiss(n.id), tone === 'warn' ? 9000 : 3500);
  }
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

  if (list.length === 0) return null;
  return (
    <div className="fixed bottom-3 right-3 z-[120] flex flex-col gap-1.5 max-w-[380px]" role="status">
      {list.map((n) => (
        <div
          key={n.id}
          className={`flex items-start gap-2 px-3 py-2 text-xs border rounded-sm shadow-xl bg-neutral-900 ${
            n.tone === 'error' ? 'border-red-800 text-red-300'
              : n.tone === 'warn' ? 'border-amber-800 text-amber-200' : 'border-neutral-700 text-neutral-300'
          }`}
        >
          <span className="flex-1 leading-snug">{n.text}</span>
          <button onClick={() => dismiss(n.id)} className="text-neutral-500 hover:text-neutral-200" aria-label="Dismiss">✕</button>
        </div>
      ))}
    </div>
  );
}
