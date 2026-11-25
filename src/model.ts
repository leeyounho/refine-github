export const widthLabels = { default: 'Default', wide: 'Wide', full: 'Full width' } as const;
export type WidthPreset = keyof typeof widthLabels;
export type PageWidth = WidthPreset | number;
export const widthStep = 16;
export const widthStops: PageWidth[] = ['default',
  ...Array.from({ length: (2560 - 960) / widthStep + 1 }, (_, i) => {
    const px = 960 + i * widthStep;
    return px === 1600 ? 'wide' as const : px;
  }), 'full'];
export const pageTypes = ['issues', 'pulls', 'discussions', 'wiki', 'markdown', 'diff'] as const;
export type PageType = typeof pageTypes[number];
export interface Settings { splitPreview: boolean; enabled: boolean; width: PageWidth; focus: boolean; fontSize: number | 'default'; editorHeight: number | 'default'; widths: Partial<Record<PageType, PageWidth>> }
export const defaults: Settings = { splitPreview: false, enabled: true, width: 'default', focus: false, fontSize: 'default', editorHeight: 'default', widths: {} };
export const fontSizes = Array.from({ length: 13 }, (_, index) => 8 + index);
export const editorHeights = [160, 240, 320, 480, 640, 800];
const PREFIX = 'refine:';
const widthKey = (type: PageType) => PREFIX + 'width:' + type;
export const settingKeys = ['splitPreview', 'width', 'focus', 'fontSize', 'editorHeight', 'wide', 'enabled'].map(key => PREFIX + key).concat(pageTypes.map(widthKey));

function repositoryPath(href: string, enabledHosts: readonly string[]): string[] | undefined {
  const url = new URL(href);
  if (url.protocol !== 'https:' || (url.origin !== 'https://github.com' && !enabledHosts.includes(url.hostname))) return;
  const parts = url.pathname.split('/').filter(Boolean);
  const [owner, repo] = parts;
  if (!owner || !repo || ['orgs', 'users', 'settings', 'marketplace', 'features', 'topics', 'collections', 'sponsors'].includes(owner)) return;
  return parts;
}

export function supportsEditorHeight(href: string, enabledHosts: readonly string[]): boolean {
  const parts = repositoryPath(href, enabledHosts);
  return !!parts && ['issues', 'pull', 'pulls', 'compare', 'commit', 'discussions', 'wiki', 'new', 'edit'].includes(parts[2]);
}

export type SplitPreviewMode = 'issue' | 'wiki' | 'file' | undefined;

export function splitPreviewMode(href: string, enabledHosts: readonly string[]): SplitPreviewMode {
  const parts = repositoryPath(href, enabledHosts);
  if (!parts) return;
  const [, , section, id] = parts;
  if (section === 'issues' && (id === 'new' || /^\d+$/.test(id ?? ''))) return 'issue';
  if (section === 'wiki' && ['_edit', '_new'].includes(parts.at(-1)!)) return 'wiki';
  if (section === 'edit' && parts.length >= 5 && /\.(md|markdown|mdown|mkd)$/i.test(parts.at(-1)!)) return 'file';
}

export function pageTypeFor(href: string, enabledHosts: readonly string[] = []): PageType | undefined {
  const parts = repositoryPath(href, enabledHosts);
  if (!parts) return;
  const [, , section, number] = parts;
  const tail = parts.slice(3);
  if (!section || (section === 'tree' && tail.length > 0)) return 'markdown';
  if (section === 'blob' && tail.length >= 2 && /\.(md|markdown|mdown|mkd)$/i.test(tail.at(-1)!)) return 'markdown';
  if (section === 'compare' || (section === 'commit' && tail.length === 1)) return 'diff';
  if (tail.some(part => part === '_new' || part === '_edit')) return;
  if (section === 'wiki') return 'wiki';
  if (tail.some(part => part === 'new' || part === 'edit')) return;
  if (section === 'discussions' && (!tail.length || (tail.length === 1 && /^\d+$/.test(number)) ||
    (number === 'categories' && tail.length <= 2))) return 'discussions';
  if (section === 'issues' && (!number || /^\d+$/.test(number))) return 'issues';
  if (section === 'pulls' || (section === 'pull' && /^\d+$/.test(number ?? ''))) return 'pulls';
}

function isWidth(value: unknown): value is PageWidth {
  return widthStops.some(width => width === value);
}

export function readSettings(data: Record<string, unknown>): Settings {
  const settings: Settings = { ...defaults, widths: {} };
  settings.splitPreview = data[PREFIX + 'splitPreview'] === true;
  settings.enabled = data[PREFIX + 'enabled'] !== false;
  const width = data[PREFIX + 'width'];
  if (isWidth(width)) settings.width = width;
  else if (data[PREFIX + 'wide'] === true) settings.width = 'full';
  for (const type of pageTypes) {
    const value = data[widthKey(type)];
    if (isWidth(value)) settings.widths[type] = value;
  }
  const focus = data[PREFIX + 'focus'];
  if (typeof focus === 'boolean') settings.focus = focus;
  const fontSize = Number(data[PREFIX + 'fontSize']);
  if (fontSizes.includes(fontSize)) settings.fontSize = fontSize;
  const height = data[PREFIX + 'editorHeight'];
  if (typeof height === 'number' && editorHeights.includes(height)) settings.editorHeight = height;
  return settings;
}

export async function loadSettings(): Promise<Settings> {
  return readSettings(await chrome.storage.local.get(settingKeys));
}
export function resetSettings(): Promise<void> {
  return chrome.storage.local.remove(settingKeys.filter(key => key !== PREFIX + 'enabled'));
}
export function effectiveWidth(settings: Settings, type: PageType): PageWidth {
  return settings.widths[type] ?? (type === 'diff' ? settings.widths.pulls : undefined) ?? settings.width;
}
export function setAllWidths(width: PageWidth): Promise<void> {
  const values = Object.fromEntries(pageTypes.map(type => [widthKey(type), 'inherit']));
  return chrome.storage.local.set({ ...values, [PREFIX + 'width']: width });
}
export function setPageWidth(type: PageType, width: PageWidth | 'inherit'): Promise<void> {
  const key = widthKey(type);
  return width === 'inherit' ? chrome.storage.local.remove(key) : chrome.storage.local.set({ [key]: width });
}
export async function setSetting<K extends Exclude<keyof Settings, 'widths'>>(key: K, value: Settings[K]): Promise<void> {
  await chrome.storage.local.set({ [PREFIX + key]: value });
}
