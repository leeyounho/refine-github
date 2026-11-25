import { grantedHosts, hostPattern, publicHost, sitesKey } from './sites';

const scriptId = 'refine-enterprise';
async function syncSites(restoreTabs: boolean): Promise<void> {
  const hosts = grantedHosts(await chrome.permissions.getAll());
  const matches = hosts.map(hostPattern);
  const [script] = await chrome.scripting.getRegisteredContentScripts({ ids: [scriptId] });
  const previous = script?.matches ?? [];
  const added = matches.filter(pattern => !previous.includes(pattern));
  // Content scripts in already-open tabs also observe removals through storage.
  await chrome.storage.local.set({ [sitesKey]: hosts });
  if (!matches.length) {
    if (script) await chrome.scripting.unregisterContentScripts({ ids: [scriptId] });
  } else {
    const registration: chrome.scripting.RegisteredContentScript = {
      id: scriptId, matches, js: ['content.js'], css: ['content.css'], runAt: 'document_idle',
      persistAcrossSessions: true,
    };
    if (!script) {
      await chrome.scripting.registerContentScripts([registration]);
    } else if (added.length || previous.length !== matches.length) {
      await chrome.scripting.updateContentScripts([registration]);
    }
  }

  const targets = restoreTabs ? [hostPattern(publicHost), ...matches] : added;
  if (!targets.length) return;
  const tabs = await chrome.tabs.query({ url: targets });
  await Promise.all(tabs.map(async tab => {
    if (tab.id === undefined || tab.discarded) return;
    const target = { tabId: tab.id };
    try {
      await chrome.scripting.insertCSS({ target, files: ['content.css'] });
      await chrome.scripting.executeScript({ target, files: ['content.js'] });
    } catch {
      // The tab can close or navigate away during injection.
    }
  }));
}

// Permission prompts can outlive the popup. Let the worker finish registration.
let pending = Promise.resolve();
function reconcile(restoreTabs = false): Promise<void> {
  pending = pending.catch(() => {}).then(() => syncSites(restoreTabs));
  return pending;
}
chrome.permissions.onAdded.addListener(() => reconcile());
chrome.permissions.onRemoved.addListener(() => reconcile());
chrome.runtime.onStartup.addListener(() => reconcile(true));
chrome.runtime.onInstalled.addListener(() => reconcile(true));
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const editorRead = message?.type === 'read-markdown-editor' && typeof message.editorId === 'string' &&
    (message.lines === undefined || (Array.isArray(message.lines) && message.lines.every(Number.isSafeInteger)));
  if (editorRead && sender.tab?.id !== undefined && sender.documentId && sender.frameId === 0) {
    // CodeMirror virtualizes long documents. Its complete draft lives in the page world.
    void chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, documentIds: [sender.documentId] },
      world: 'MAIN',
      args: [message.editorId, message.lines ?? null],
      func: (editorId: string, lines: number[] | null) => {
        type View = import('@codemirror/view').EditorView;
        const editor = document.querySelector<HTMLElement>('[data-refine-editor="' + CSS.escape(editorId) + '"]');
        const content = editor?.querySelector('.cm-content') as (Element & {
          cmView?: { view?: View; rootView?: { view?: View } };
          cmTile?: { root?: { view?: View } };
        }) | null;
        const view = content?.cmTile?.root?.view ?? content?.cmView?.view ?? content?.cmView?.rootView?.view;
        const legacy = editor as (Element & { CodeMirror?: {
          getValue(): string;
          heightAtLine(line: number, mode: string): number;
        } }) | null;
        if (lines) {
          if (view) {
            const inset = view.documentTop - view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.scrollTop;
            return lines.map(line => inset + view.lineBlockAt(view.state.doc.line(Math.max(1,
              Math.min(view.state.doc.lines, line + 1))).from).top);
          }
          return legacy?.CodeMirror ? lines.map(line => legacy.CodeMirror!.heightAtLine(line, 'local')) : null;
        }
        return view?.state.doc.toString() ?? legacy?.CodeMirror?.getValue() ?? null;
      },
    }).then(results => respond(results[0]?.result ?? null), () => respond(null));
    return true;
  }
  if (sender.url !== chrome.runtime.getURL('popup.html') || message !== 'sync-sites') return;
  void reconcile().then(() => respond(true), () => respond(false));
  return true;
});
