export const widthLabels = { default: 'Default', wide: 'Wide', full: 'Full width' } as const;
export type PageWidth = keyof typeof widthLabels;
export interface Settings { width: PageWidth; focus: boolean; fontSize: number }
export const defaults: Settings = { width: 'default', focus: false, fontSize: 16 };
export const fontSizes = Array.from({ length: 13 }, (_, index) => 8 + index);
const PREFIX = 'refine:';
export const settingKeys = [...Object.keys(defaults), 'wide'].map(key => PREFIX + key);

export function supportsPage(href: string, enabledHosts: readonly string[] = []): boolean {
  const url = new URL(href);
  if (url.protocol !== 'https:' || (url.origin !== 'https://github.com' && !enabledHosts.includes(url.hostname))) return false;
  const parts = url.pathname.split('/').filter(Boolean);
  const [owner, repo, section, number] = parts;
  if (['orgs', 'users', 'settings', 'marketplace', 'features', 'topics', 'collections', 'sponsors'].includes(owner ?? '')) return false;
  if (!owner || !repo || !['issues', 'pull', 'pulls', 'wiki'].includes(section ?? '')) return false;
  if (parts.slice(3).some(part => ['new', 'edit', '_new', '_edit'].includes(part))) return false;
  if (section === 'issues' && number && !/^\d+$/.test(number)) return false;
  if (section === 'pull' && !/^\d+$/.test(number ?? '')) return false;
  return true;
}

export function readSettings(data: Record<string, unknown>): Settings {
  const settings = { ...defaults };
  const width = data[PREFIX + 'width'];
  if (width === 'default' || width === 'wide' || width === 'full') settings.width = width;
  else if (data[PREFIX + 'wide'] === true) settings.width = 'full';
  const focus = data[PREFIX + 'focus'];
  if (typeof focus === 'boolean') settings.focus = focus;
  const fontSize = Number(data[PREFIX + 'fontSize']);
  if (fontSizes.includes(fontSize)) settings.fontSize = fontSize;
  return settings;
}

export async function loadSettings(): Promise<Settings> {
  return readSettings(await chrome.storage.local.get(settingKeys));
}
export function resetSettings(): Promise<void> {
  return chrome.storage.local.remove(settingKeys);
}
export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  await chrome.storage.local.set({ [PREFIX + key]: value });
}
