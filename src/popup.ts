import css from './popup.css';
import { loadSettings, resetSettings, settingKeys, type Settings } from './model';
import { brand, el, settingsUI } from './ui';
import { grantedHosts, hostPattern, publicHost } from './sites';

const style = el('style'); style.textContent = css; document.head.append(style);
const root = document.getElementById('app')!;
const status = el('p', 'status'); status.setAttribute('role', 'status'); status.hidden = true;
function theme(): void { document.body.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
theme(); matchMedia('(prefers-color-scheme: dark)').addEventListener('change', theme);
async function currentSite() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith('https://')) return;
  const host = new URL(tab.url).hostname;
  if (host === publicHost) return;
  const enabled = grantedHosts(await chrome.permissions.getAll()).includes(host);
  return { host, enabled };
}

type Site = NonNullable<Awaited<ReturnType<typeof currentSite>>>;

function siteControl({ host, enabled }: Site): HTMLElement {
  const row = el('div', 'site-control');
  const action = el('button', 'reset', enabled ? 'Disable on this site' : 'Enable on this site');
  action.type = 'button';
  action.name = 'site-access';
  action.addEventListener('click', async () => {
    action.disabled = true;
    status.hidden = true;
    const permission = { origins: [hostPattern(host)] };
    try {
      // Request permission directly in the click handler to preserve the user gesture.
      const changed = enabled ? await chrome.permissions.remove(permission) : await chrome.permissions.request(permission);
      if (!changed) {
        status.textContent = enabled ? 'Could not remove site access.' : 'Site access was not granted.';
        status.hidden = false;
        return;
      }
      if (!await chrome.runtime.sendMessage('sync-sites')) throw new Error('Site registration failed');
      await load();
    } catch {
      status.textContent = 'Could not update site access. Reopen the extension and try again.';
      status.hidden = false;
    } finally {
      action.disabled = false;
    }
  });
  row.append(el('strong', '', host), action);
  return row;
}

function render(settings: Settings, site?: Site): void {
  const header = el('header', 'header');
  const reset = el('button', 'reset', 'Reset');
  reset.type = 'button';
  reset.name = 'reset';
  reset.title = 'Reset all settings to defaults';
  reset.addEventListener('click', async () => {
    status.hidden = true;
    try {
      await resetSettings();
    } catch {
      status.textContent = 'Could not reset settings. Try again.';
      status.hidden = false;
    }
  });
  header.append(brand());
  if (!site || site.enabled) header.append(reset);
  const content = el('div', 'content');
  if (!site || site.enabled) {
    content.append(settingsUI(settings, () => { status.textContent = 'Could not save settings. Try again.'; status.hidden = false; }));
  }
  if (site) content.append(siteControl(site));
  content.append(status);
  root.replaceChildren(header, content);
}
async function load(): Promise<void> {
  try {
    const [settings, site] = await Promise.all([loadSettings(), currentSite()]);
    const name = document.activeElement?.getAttribute('name');
    render(settings, site);
    if (name) [...root.querySelectorAll<HTMLElement>('[name]')].find(node => node.getAttribute('name') === name)?.focus();
  } catch { root.replaceChildren(el('p', 'status', 'Could not load settings. Reopen the extension.')); }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && settingKeys.some(key => key in changes)) void load();
});
void load();
