import { grantedHosts, hostPattern, sitesKey } from './sites';

const scriptId = 'refine-enterprise';
async function syncSites(): Promise<void> {
  const hosts = grantedHosts(await chrome.permissions.getAll());
  const matches = hosts.map(hostPattern);
  const [script] = await chrome.scripting.getRegisteredContentScripts({ ids: [scriptId] });
  const previous = script?.matches ?? [];
  const added = matches.filter(pattern => !previous.includes(pattern));
  // Content scripts in already-open tabs also observe removals through storage.
  await chrome.storage.local.set({ [sitesKey]: hosts });
  if (!matches.length) {
    if (script) await chrome.scripting.unregisterContentScripts({ ids: [scriptId] });
    return;
  }
  const registration: chrome.scripting.RegisteredContentScript = {
    id: scriptId, matches, js: ['content.js'], css: ['content.css'], runAt: 'document_idle',
    persistAcrossSessions: true,
  };
  if (!script) {
    await chrome.scripting.registerContentScripts([registration]);
  } else if (added.length || previous.length !== matches.length) {
    await chrome.scripting.updateContentScripts([registration]);
  }

  if (!added.length) return;
  const tabs = await chrome.tabs.query({ url: added });
  await Promise.all(tabs.map(async tab => {
    if (tab.id === undefined || tab.discarded) return;
    const target = { tabId: tab.id };
    try {
      await chrome.scripting.insertCSS({ target, files: ['content.css'] });
      await chrome.scripting.executeScript({ target, files: ['content.js'] });
    } catch {
      // A tab can close or navigate while its access is being granted.
    }
  }));
}

// Permission prompts can outlive the popup. Let the worker finish registration.
let pending = Promise.resolve();
function reconcile(): Promise<void> {
  pending = pending.catch(() => {}).then(syncSites);
  return pending;
}
chrome.permissions.onAdded.addListener(reconcile);
chrome.permissions.onRemoved.addListener(reconcile);
chrome.runtime.onStartup.addListener(reconcile);
chrome.runtime.onInstalled.addListener(reconcile);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.url !== chrome.runtime.getURL('popup.html') || message !== 'sync-sites') return;
  void reconcile().then(() => respond(true), () => respond(false));
  return true;
});
