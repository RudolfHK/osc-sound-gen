import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  onSelect?: () => void;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Renders a divider instead of an item. */
  divider?: boolean;
  /** Nested items, shown when this one is hovered. */
  submenu?: MenuItem[];
  checked?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  title?: string;
}

/**
 * Right-click menu. Closes on outside click, Escape, scroll or selection, and
 * keeps itself on screen.
 */
export function ContextMenu({ x, y, items, onClose, title }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [openSub, setOpenSub] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // Defer so the right-click that opened the menu doesn't close it
    const id = setTimeout(() => {
      document.addEventListener('mousedown', away);
      document.addEventListener('wheel', onClose, { passive: true });
    }, 0);
    document.addEventListener('keydown', key);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', away);
      document.removeEventListener('wheel', onClose);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[100] min-w-[180px] py-1 bg-neutral-900 border border-neutral-700 rounded shadow-2xl text-xs"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {title && (
        <div className="px-3 py-1 text-neutral-500 tracking-widest border-b border-neutral-800 mb-1 truncate max-w-[260px]">
          {title}
        </div>
      )}
      {items.map((item, i) =>
        item.divider ? (
          <div key={i} className="my-1 border-t border-neutral-800" />
        ) : (
          <div key={i} className="relative" onMouseEnter={() => setOpenSub(item.submenu ? i : null)}>
            <button
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (item.submenu) { setOpenSub(i); return; }
                item.onSelect?.();
                onClose();
              }}
              className={`w-full flex items-center gap-2 px-3 py-1 text-left transition-colors disabled:opacity-35 disabled:pointer-events-none ${
                item.danger ? 'text-red-400 hover:bg-red-950/50' : 'text-neutral-300 hover:bg-neutral-800'
              }`}
            >
              <span className="w-3 text-center text-neutral-400">{item.checked ? '✓' : ''}</span>
              <span className="flex-1 truncate">{item.label}</span>
              {item.shortcut && <span className="text-neutral-600 font-mono">{item.shortcut}</span>}
              {item.submenu && <span className="text-neutral-600">▸</span>}
            </button>
            {item.submenu && openSub === i && (
              <div className="absolute left-full top-0 -mt-1 ml-0.5 min-w-[180px] max-h-[60vh] overflow-y-auto py-1 bg-neutral-900 border border-neutral-700 rounded shadow-2xl">
                {item.submenu.map((sub, j) => sub.divider
                  ? <div key={j} className="my-1 border-t border-neutral-800" />
                  : (
                    <button
                      key={j}
                      disabled={sub.disabled}
                      onClick={() => { sub.onSelect?.(); onClose(); }}
                      className="w-full flex items-center gap-2 px-3 py-1 text-left text-neutral-300 hover:bg-neutral-800 disabled:opacity-35"
                    >
                      <span className="w-3 text-center text-neutral-400">{sub.checked ? '✓' : ''}</span>
                      <span className="flex-1 truncate">{sub.label}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
