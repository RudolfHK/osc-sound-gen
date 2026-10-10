import { useEffect, useMemo, useRef, useState } from 'react';
import guide from '../../../GUIDE.md?raw';
import { Markdown, slug, splitSections } from './markdown';
import { useOverlay } from '../overlay';

const SECTIONS = splitSections(guide);

/**
 * The user guide, inside the app. Opens at the section for whatever is on
 * screen (F1), with a contents list and search across every section.
 */
export default function HelpPanel({ topic, onClose }: { topic: string | null; onClose: () => void }) {
  useOverlay();
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(() => SECTIONS.find((s) => s.title === topic)?.id ?? SECTIONS[0].id);
  const body = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => { search.current?.focus(); }, []);
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [current]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return null;
    return SECTIONS.flatMap((s) => {
      const lines = s.body.split('\n').filter((l) => l.toLowerCase().includes(q));
      const inTitle = s.title.toLowerCase().includes(q);
      return inTitle || lines.length ? [{ s, hits: lines.slice(0, 3) }] : [];
    });
  }, [query]);

  const section = SECTIONS.find((s) => s.id === current) ?? SECTIONS[0];
  const go = (href: string) => {
    const id = href.replace(/^#/, '');
    const target = SECTIONS.find((s) => s.id === id || slug(s.title) === id);
    if (target) setCurrent(target.id);
  };

  return (
    <aside
      role="dialog"
      aria-label="User guide"
      className="fixed top-0 right-0 bottom-0 z-[140] w-[640px] max-w-[calc(100vw/var(--ui-zoom,1))] flex flex-col bg-neutral-900 border-l border-neutral-700 shadow-2xl text-sm"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800">
        <span className="text-xs tracking-widest text-neutral-300">USER GUIDE</span>
        <input
          ref={search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the guide…"
          aria-label="Search the guide"
          className="flex-1 bg-neutral-950 border border-neutral-700 px-2 py-0.5 text-xs text-neutral-200"
        />
        <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200 px-1" aria-label="Close the guide">✕</button>
      </div>
      <div className="flex flex-1 min-h-0">
        <nav aria-label="Guide contents" className="w-44 shrink-0 overflow-y-auto border-r border-neutral-800 py-1">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => { setCurrent(s.id); setQuery(''); }}
              aria-current={s.id === current && !results ? 'page' : undefined}
              className={`block w-full text-left px-3 py-1 text-xs ${s.id === current && !results ? 'text-[var(--accent)] bg-neutral-800/60' : 'text-neutral-400 hover:text-neutral-100'}`}
            >{s.title}</button>
          ))}
        </nav>
        <div ref={body} className="flex-1 overflow-y-auto px-4 py-3">
          {results ? (
            <div>
              <p className="text-xs text-neutral-500 mb-2">{results.length} section{results.length === 1 ? '' : 's'} mention “{query}”</p>
              {results.map(({ s, hits }) => (
                <button key={s.id} onClick={() => { setCurrent(s.id); setQuery(''); }}
                  className="block w-full text-left mb-2 p-2 border border-neutral-800 hover:border-neutral-600">
                  <span className="text-neutral-100 text-xs">{s.title}</span>
                  {hits.map((h, i) => <span key={i} className="block text-[11px] text-neutral-500 truncate">{h.replace(/[*|`#>]/g, '').trim()}</span>)}
                </button>
              ))}
            </div>
          ) : (
            <article>
              <h2 className="text-base text-neutral-100 mb-1">{section.title}</h2>
              <Markdown text={section.body} onLink={go} />
            </article>
          )}
        </div>
      </div>
    </aside>
  );
}
