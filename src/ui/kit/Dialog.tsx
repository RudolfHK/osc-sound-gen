import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useOverlay } from '../overlay';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Extra classes for the panel (width, padding). */
  className?: string;
  /** Hide the title row (the content has its own heading). */
  bare?: boolean;
  /** Don't close on Escape / backdrop click (e.g. while busy). */
  locked?: boolean;
}

/**
 * A modal dialog that behaves: focus moves into it and stays there (Tab
 * wraps), Escape and a backdrop click close it, focus returns to whatever
 * opened it, and the app's shortcuts pause while it's open.
 */
export function Dialog({ title, onClose, children, className = 'w-[440px]', bare, locked }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useOverlay();

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = panel.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el)?.focus();
    return () => { opener?.focus?.(); };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !locked) { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (items.length === 0) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !locked) onClose(); }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={bare ? undefined : titleId}
        aria-label={bare ? title : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`max-w-[calc(94vw/var(--ui-zoom,1))] max-h-[calc(92vh/var(--ui-zoom,1))] overflow-y-auto bg-neutral-900 border border-neutral-700 shadow-2xl text-neutral-200 focus:outline-none ${className}`}
      >
        {!bare && (
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-neutral-800">
            <h2 id={titleId} className="text-sm tracking-widest text-neutral-200 uppercase">{title}</h2>
            {!locked && (
              <button onClick={onClose} className="ml-auto text-neutral-500 hover:text-neutral-200" aria-label="Close">✕</button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
