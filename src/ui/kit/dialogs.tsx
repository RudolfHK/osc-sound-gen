/**
 * In-app replacements for window.confirm: styled like the app, keyboard
 * friendly, and able to offer more than OK/Cancel ("Save / Don't save /
 * Cancel"). Call them from anywhere; <DialogHost /> renders them.
 */
import { useSyncExternalStore } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';

export interface Choice<T extends string> {
  id: T;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

interface Request {
  title: string;
  message: string;
  choices: Choice<string>[];
  resolve: (id: string | null) => void;
}

let queue: Request[] = [];
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

/** Ask a question with several answers. Resolves to the chosen id, or null if dismissed. */
export function choiceDialog<T extends string>(opts: { title: string; message: string; choices: Choice<T>[] }): Promise<T | null> {
  return new Promise((resolve) => {
    queue = [...queue, { ...opts, choices: opts.choices as Choice<string>[], resolve: resolve as (id: string | null) => void }];
    emit();
  });
}

/** Yes/no question. */
export async function confirmDialog(opts: {
  title: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean;
}): Promise<boolean> {
  const answer = await choiceDialog({
    title: opts.title,
    message: opts.message,
    choices: [
      { id: 'cancel', label: opts.cancelLabel ?? 'Cancel' },
      { id: 'ok', label: opts.confirmLabel ?? 'OK', primary: !opts.danger, danger: opts.danger },
    ],
  });
  return answer === 'ok';
}

function settle(answer: string | null) {
  const [current, ...rest] = queue;
  if (!current) return;
  queue = rest;
  emit();
  current.resolve(answer);
}

export function DialogHost() {
  const current = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => queue[0] ?? null,
    () => null,
  );
  if (!current) return null;
  const autofocus = current.choices.find((c) => c.primary) ?? current.choices[current.choices.length - 1];
  return (
    <Dialog title={current.title} onClose={() => settle(null)}>
      <div className="px-4 py-3 text-sm text-neutral-300 leading-relaxed whitespace-pre-line">{current.message}</div>
      <div className="flex justify-end gap-2 px-4 pb-4">
        {current.choices.map((c) => (
          <Button
            key={c.id}
            variant={c.danger ? 'danger' : c.primary ? 'primary' : 'default'}
            onClick={() => settle(c.id)}
            data-autofocus={c === autofocus ? '' : undefined}
          >{c.label}</Button>
        ))}
      </div>
    </Dialog>
  );
}
