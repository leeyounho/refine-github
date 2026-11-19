import { defaults, readSettings, settingKeys, supportsPage, type Settings } from './model';
import { sitesKey } from './sites';

(() => {
  const scope = globalThis as typeof globalThis & { refineGitHubLoaded?: boolean };
  if (scope.refineGitHubLoaded) return;
  scope.refineGitHubLoaded = true;
  let settings: Settings = { ...defaults }, ready = false;
  let enabledHosts: string[] = [];
  let currentURL = '';
  function apply(): void {
    currentURL = location.href;
    const active = ready && supportsPage(currentURL, enabledHosts);
    const html = document.documentElement;
    html.classList.toggle('refine-active', active);
    html.classList.toggle('refine-wide', active && settings.width !== 'default');
    html.classList.toggle('refine-capped', active && settings.width === 'wide');
    html.classList.toggle('refine-focus', active && settings.focus);
    if (active) html.style.setProperty('--refine-font-size', `${settings.fontSize}px`);
    else html.style.removeProperty('--refine-font-size');
  }
  // GitHub can navigate between repository tabs without a full page reload.
  const observer = new MutationObserver(() => { if (currentURL !== location.href) apply(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  for (const event of ['turbo:load', 'turbo:render', 'pjax:end']) document.addEventListener(event, apply);
  window.addEventListener('popstate', apply);
  async function load(): Promise<void> {
    try {
      const data = await chrome.storage.local.get([...settingKeys, sitesKey]);
      settings = readSettings(data);
      enabledHosts = Array.isArray(data[sitesKey]) ? data[sitesKey] : [];
      ready = true;
    }
    catch { ready = false; observer.disconnect(); }
    apply();
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (sitesKey in changes || settingKeys.some(key => key in changes))) void load();
  });
  void load();
})();
