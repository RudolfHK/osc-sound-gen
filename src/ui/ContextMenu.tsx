import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useOverlay } from './overlay';

export interface MenuItem {
  label: string;
  onSelect?: () => void;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Renders a divider instead of an item. */
  divider?: boolean;
  /** Nested items, shown when this one is hovered or opened with →. */
  submenu?: MenuItem[];
  checked?: boolean;
  /** Secondary line under the label (e.g. an example's description). */
  hint?: string;
  /** Shown greyed but still selectable (History: steps that can be redone). */
  dim?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  title?: string;
  /** Long flat lists scroll (menus with submenus can't, or the submenus would be clipped). */
  scroll?: boolean;
}

const itemsIn = (el: HTMLElement | null) =>
  el ? [...el.querySelectorAll<HTMLButtonElement>(':scope > div > button[role="menuitem"]:not([disabled])')] : [];

/**
 * Menu used for right-click menus and the File menu. Closes on outside click,
 * Escape, scroll or selection; keeps itself on screen; and works from the
 * keyboard: ↑ ↓ to move, → / ← to open and close a submenu, Enter to choose.
 */
export function ContextMenu({ x, y, items, onClose, title, scroll }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [openSub, setOpenSub] = useState<number | null>(null);
  useOverlay();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
    // Keyboard users land on the first item
    itemsIn(el)[0]?.focus();
  }, [x, y]);

  useEffect(() => {
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    // Defer so the click that opened the menu doesn't close it
    const id = setTimeout(() => {
      document.addEventListener('mousedown', away);
      document.addEventListener('wheel', onClose, { passive: true });
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', away);
      document.removeEventListener('wheel', onClose);
    };
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const active = document.activeElement as HTMLElement | null;
    const inSub = !!active?.closest('[data-submenu]');
    const list = inSub ? itemsIn(active!.closest('[data-submenu]') as HTMLElement) : itemsIn(ref.current);
    const i = list.indexOf(active as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === 'Tab') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === 'ArrowRight' && !inSub) {
      const idx = Number(active?.dataset.index);
      if (Number.isFinite(idx) && items[idx]?.submenu) {
        e.preventDefault();
        setOpenSub(idx);
        requestAnimationFrame(() => itemsIn(ref.current?.querySelector(`[data-submenu="${idx}"]`) as HTMLElement)[0]?.focus());
      }
    } else if (e.key === 'ArrowLeft' && inSub) {
      e.preventDefault();
      const idx = openSub;
      setOpenSub(null);
      (ref.current?.querySelector(`button[data-index="${idx}"]`) as HTMLElement | null)?.focus();
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={title}
      className={`fixed z-[100] min-w-[180px] py-1 bg-neutral-900 border border-neutral-700 rounded-sm shadow-2xl text-xs ${scroll ? 'max-h-[70vh] overflow-y-auto' : ''}`}
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={onKeyDown}
    >
      {title && (
        <div className="px-3 py-1 text-neutral-500 tracking-widest border-b border-neutral-800 mb-1 truncate max-w-[260px]">
          {title}
        </div>
      )}
      {items.map((item, i) =>
        item.divider ? (
          <div key={i} role="separator" className="my-1 border-t border-neutral-800" />
        ) : (
          <div key={i} className="relative" onMouseEnter={() => setOpenSub(item.submenu ? i : null)}>
            <button
              role="menuitem"
              data-index={i}
              disabled={item.disabled}
              aria-haspopup={item.submenu ? 'menu' : undefined}
              aria-expanded={item.submenu ? openSub === i : undefined}
              onClick={() => {
                if (item.submenu) { setOpenSub(i); return; }
                item.onSelect?.();
                onClose();
              }}
              className={`w-full flex items-center gap-2 px-3 py-1 text-left transition-colors disabled:opacity-40 disabled:pointer-events-none focus:bg-neutral-800 ${
                item.danger ? 'text-red-400 hover:bg-red-950/50' : item.dim ? 'text-neutral-500 hover:bg-neutral-800' : 'text-neutral-300 hover:bg-neutral-800'
              }`}
            >
              <span className="w-3 text-center text-neutral-400">{item.checked ? '✓' : ''}</span>
              <span className="flex-1 truncate">{item.label}</span>
              {item.shortcut && <span className="text-neutral-500 font-mono">{item.shortcut}</span>}
              {item.submenu && <span className="text-neutral-500">▸</span>}
            </button>
            {item.submenu && openSub === i && <Submenu index={i} items={item.submenu} onClose={onClose} />}
          </div>
        ))}
    </div>
  );
}

function Submenu({ index, items, onClose }: { index: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);
  // Open to the left when there's no room on the right
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r && r.right > window.innerWidth - 4) setFlip(true);
  }, []);
  return (
    <div
      ref={ref}
      role="menu"
      data-submenu={index}
      className={`absolute top-0 -mt-1 min-w-[200px] max-w-[360px] max-h-[70vh] overflow-y-auto py-1 bg-neutral-900 border border-neutral-700 rounded-sm shadow-2xl ${
        flip ? 'right-full mr-0.5' : 'left-full ml-0.5'
      }`}
    >
      {items.map((sub, j) => sub.divider
        ? <div key={j} role="separator" className="my-1 border-t border-neutral-800" />
        : (
          <div key={j}>
            <button
              role="menuitem"
              disabled={sub.disabled}
              onClick={() => { sub.onSelect?.(); onClose(); }}
              className="w-full flex items-start gap-2 px-3 py-1 text-left text-neutral-300 hover:bg-neutral-800 focus:bg-neutral-800 disabled:opacity-40"
            >
              <span className="w-3 text-center text-neutral-400">{sub.checked ? '✓' : ''}</span>
              <span className="flex-1 min-w-0">
                <span className="block truncate">{sub.label}</span>
                {sub.hint && <span className="block text-[11px] text-neutral-500 whitespace-normal leading-snug">{sub.hint}</span>}
              </span>
              {sub.shortcut && <span className="text-neutral-500 font-mono">{sub.shortcut}</span>}
            </button>
          </div>
        ))}
    </div>
  );
}
