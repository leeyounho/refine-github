import css from './popup.css';
import { loadSettings, resetSettings, settingKeys, type Settings } from './model';
import { brand, el, optionsUI, settingsUI, settingSwitch } from './ui';
import { grantedHosts, hostPattern, publicHost, sitesKey } from './sites';

const style = el('style'); style.textContent = css; document.head.append(style);
const root = document.getElementById('app')!;
const isOptions = document.body.classList.contains('options');
const status = el('p', 'status'); status.setAttribute('role', 'status'); status.hidden = true;
root.addEventListener('change', () => { status.hidden = true; }, { capture: true });
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
  const reset = el('button', 'reset reset-icon');
  reset.type = 'button';
  reset.name = 'reset';
  reset.setAttribute('aria-label', 'Reset');
  reset.title = 'Reset settings';
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
  const content = el('div', 'content');
  const footer = el('footer', 'footer');
  const onError = () => { status.textContent = 'Could not save settings. Try again.'; status.hidden = false; };
  if (isOptions) {
    content.append(optionsUI(settings, onError));
    reset.title = 'Reset all reading settings';
    reset.setAttribute('aria-label', reset.title);
    footer.append(reset);
  } else {
    const options = el('a', 'options-icon');
    options.title = 'Page options';
    options.setAttribute('aria-label', options.title);
    options.href = chrome.runtime.getURL('options.html');
    options.target = '_blank';
    options.addEventListener('click', event => {
      event.preventDefault();
      void chrome.runtime.openOptionsPage().catch(onError);
    });
    content.append(settingsUI(settings, onError));
    const actions = el('div', 'header-actions');
    actions.append(options, reset, settingSwitch('enabled', settings.enabled, onError));
    header.append(actions);
  }
  if (site) content.append(siteControl(site));
  if (isOptions) content.append(footer);
  content.append(status);
  root.replaceChildren(header, content);
}
let latestLoad = 0;
async function load(): Promise<void> {
  const request = ++latestLoad;
  try {
    const [settings, site] = await Promise.all([loadSettings(), isOptions ? undefined : currentSite()]);
    if (request !== latestLoad) return;
    const focused = document.activeElement;
    const name = focused?.getAttribute('name');
    render(settings, site);
    if (focused?.id) document.getElementById(focused.id)?.focus();
    else if (name) [...root.querySelectorAll<HTMLElement>('[name]')].find(node => node.getAttribute('name') === name)?.focus();
  } catch {
    if (request === latestLoad) root.replaceChildren(el('p', 'status', 'Could not load settings. Reopen the extension.'));
  }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (sitesKey in changes || settingKeys.some(key => key in changes))) void load();
});
void load();
