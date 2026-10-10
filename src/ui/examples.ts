/**
 * The bundled example projects and templates. Titles, genres, lengths and
 * descriptions come from examples/index.json; the project files themselves
 * are bundled lazily — each is fetched only when it's opened or previewed.
 */
import manifest from '../../examples/index.json';

const FILES = import.meta.glob('../../examples/*.oscproject', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;

const pathOf = (file: string) => `../../examples/${file}`;

export interface ExampleInfo {
  file: string;
  title: string;
  genre: string;
  /** Length in seconds (0 if unknown). */
  seconds: number;
  description: string;
  featured?: boolean;
}

export interface TemplateInfo {
  id: string;
  title: string;
  /** The example the template is made from. */
  from: string;
  description: string;
}

export const EXAMPLES: ExampleInfo[] = [
  ...manifest.examples.filter((e) => FILES[pathOf(e.file)]),
  // A project dropped into the folder appears even before it's in the manifest
  ...Object.keys(FILES)
    .map((p) => p.split('/').pop()!)
    .filter((file) => !manifest.examples.some((e) => e.file === file))
    .map((file) => ({ file, title: file.replace('.oscproject', '').replace(/-/g, ' '), genre: 'Other', seconds: 0, description: '' })),
];

export const TEMPLATES: TemplateInfo[] = manifest.templates.filter((t) => FILES[pathOf(t.from)]);

export function loadExampleText(file: string): Promise<string> {
  const load = FILES[pathOf(file)];
  return load ? load() : Promise.reject(new Error(`No example called ${file}`));
}

/** 89 → "1:29". */
export function formatLength(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
