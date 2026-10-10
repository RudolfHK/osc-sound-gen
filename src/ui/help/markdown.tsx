/**
 * Just enough Markdown for the user guide: headings, paragraphs, lists,
 * tables, quotes, code, bold/italic/inline code and links. Not a general
 * parser — the guide is ours, so it only needs to handle what the guide uses.
 */
import { Fragment, type ReactNode } from 'react';

export interface Section {
  title: string;
  /** Slug used for #anchors and topic lookup. */
  id: string;
  body: string;
}

export const slug = (s: string) => s.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');

/** Split the guide at its "## " headings. */
export function splitSections(md: string): Section[] {
  const out: Section[] = [];
  let current: Section | null = null;
  for (const line of md.split('\n')) {
    const m = /^## (.+)$/.exec(line);
    if (m) {
      current = { title: m[1].trim(), id: slug(m[1]), body: '' };
      out.push(current);
    } else if (current) {
      current.body += line + '\n';
    }
  }
  return out;
}

function inline(text: string, onLink: (href: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2]) out.push(<strong key={k++} className="text-neutral-100">{m[2]}</strong>);
    else if (m[3]) out.push(<em key={k++}>{m[3]}</em>);
    else if (m[4]) out.push(<code key={k++} className="px-1 bg-neutral-800 text-neutral-200">{m[4]}</code>);
    else if (m[5]) {
      const href = m[6];
      out.push(
        <a key={k++} href={href} className="underline text-[var(--accent)]"
          onClick={(e) => { if (href.startsWith('#') || !/^https?:/.test(href)) { e.preventDefault(); onLink(href); } }}
          target={/^https?:/.test(href) ? '_blank' : undefined} rel="noreferrer">{m[5]}</a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, onLink }: { text: string; onLink: (href: string) => void }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0, k = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim() || /^---+$/.test(l.trim())) { i++; continue; }
    if (l.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={k++} className="my-2 p-2 bg-neutral-950 border border-neutral-800 text-[11px] overflow-x-auto">{code.join('\n')}</pre>);
      continue;
    }
    const h = /^(#{3,4}) (.+)$/.exec(l);
    if (h) {
      blocks.push(h[1].length === 3
        ? <h3 key={k++} id={slug(h[2])} className="mt-4 mb-1 text-sm text-neutral-100 tracking-wide">{inline(h[2], onLink)}</h3>
        : <h4 key={k++} className="mt-3 mb-1 text-xs text-neutral-200 uppercase tracking-widest">{inline(h[2], onLink)}</h4>);
      i++; continue;
    }
    if (l.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <table key={k++} className="my-2 w-full text-[12px] border-collapse">
          <thead><tr>{head.map((c, j) => <th key={j} className="text-left px-2 py-1 border-b border-neutral-700 text-neutral-300">{inline(c, onLink)}</th>)}</tr></thead>
          <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j} className="align-top px-2 py-1 border-b border-neutral-800 text-neutral-400">{inline(c, onLink)}</td>)}</tr>)}</tbody>
        </table>,
      );
      continue;
    }
    if (/^\s*([-*]|\d+\.) /.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items: string[] = [];
      while (i < lines.length && (/^\s*([-*]|\d+\.) /.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (/^\s*([-*]|\d+\.) /.test(lines[i])) items.push(lines[i].replace(/^\s*([-*]|\d+\.) /, ''));
        else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={k++} className={`my-2 pl-5 space-y-1 text-neutral-300 ${ordered ? 'list-decimal' : 'list-disc'}`}>
          {items.map((it, j) => <li key={j}>{inline(it, onLink)}</li>)}
        </List>,
      );
      continue;
    }
    if (l.startsWith('>')) {
      const q: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) q.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(<blockquote key={k++} className="my-2 pl-3 border-l-2 border-neutral-700 text-neutral-400">{inline(q.join(' '), onLink)}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{3,4} |\||```|>|\s*([-*]|\d+\.) )/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={k++} className="my-2 text-neutral-300 leading-relaxed">{inline(para.join(' '), onLink)}</p>);
  }
  return <Fragment>{blocks}</Fragment>;
}
