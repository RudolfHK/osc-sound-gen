/**
 * In-app replacements for window.confirm: styled like the app, keyboard
 * friendly, and able to offer more than OK/Cancel ("Save / Don't save /
 * Cancel"). Call them from anywhere; <DialogHost /> renders them.
 */
import { useState, useSyncExternalStore } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';

export interface Choice<T extends string> {
  id: T;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

interface Request {
  id: number;
  title: string;
  message: string;
  choices: Choice<string>[];
  resolve: (id: string | null) => void;
  /** A text field (prompt): its starting value; the answer is the text. */
  input?: { label: string; value: string };
}

let queue: Request[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

/** Ask a question with several answers. Resolves to the chosen id, or null if dismissed. */
export function choiceDialog<T extends string>(opts: { title: string; message: string; choices: Choice<T>[] }): Promise<T | null> {
  return new Promise((resolve) => {
    queue = [...queue, { id: nextId++, ...opts, choices: opts.choices as Choice<string>[], resolve: resolve as (id: string | null) => void }];
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

/** Ask for a line of text (a name). Resolves to the text, or null if cancelled. */
export function promptDialog(opts: { title: string; label: string; value: string; confirmLabel?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    queue = [...queue, {
      id: nextId++, title: opts.title, message: '', input: { label: opts.label, value: opts.value },
      choices: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: opts.confirmLabel ?? 'OK', primary: true }],
      resolve,
    }];
    emit();
  });
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
  return <Ask key={current.id} request={current} />;
}

function Ask({ request }: { request: Request }) {
  const [text, setText] = useState(request.input?.value ?? '');
  const autofocus = request.input ? null : (request.choices.find((c) => c.primary) ?? request.choices[request.choices.length - 1]);
  // A prompt answers with its text; OK on an empty field changes nothing
  const answer = (id: string) => settle(request.input ? (id === 'ok' && text.trim() ? text.trim() : null) : id);
  return (
    <Dialog title={request.title} onClose={() => settle(null)}>
      {request.input ? (
        <form className="px-4 py-3" onSubmit={(e) => { e.preventDefault(); answer('ok'); }}>
          <label className="block text-xs text-neutral-400 mb-1" htmlFor="prompt-field">{request.input.label}</label>
          <input
            id="prompt-field"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            data-autofocus=""
            className="w-full bg-neutral-950 border border-neutral-600 text-sm text-neutral-100 px-2 py-1"
          />
        </form>
      ) : (
        <div className="px-4 py-3 text-sm text-neutral-300 leading-relaxed whitespace-pre-line">{request.message}</div>
      )}
      <div className="flex justify-end gap-2 px-4 pb-4">
        {request.choices.map((c) => (
          <Button
            key={c.id}
            variant={c.danger ? 'danger' : c.primary ? 'primary' : 'default'}
            onClick={() => answer(c.id)}
            data-autofocus={c === autofocus ? '' : undefined}
          >{c.label}</Button>
        ))}
      </div>
    </Dialog>
  );
}
