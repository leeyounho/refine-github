import { defaults, effectiveWidth, splitPreviewMode, pageTypeFor, readSettings, settingKeys, supportsEditorHeight, type Settings } from './model';
import { setSplitPreview } from './split-preview';
import { sitesKey } from './sites';

(() => {
  const scope = globalThis as typeof globalThis & { refineGitHubLoaded?: boolean };
  if (scope.refineGitHubLoaded) return;
  scope.refineGitHubLoaded = true;
  let settings: Settings = { ...defaults }, ready = false;
  let enabledHosts: string[] = [];
  let currentURL = '';
  let overview: HTMLElement | null = null;
  let frame = 0;
  const sizes = new ResizeObserver(scheduleOverview);
  const changes = new MutationObserver(scheduleOverview);
  function scheduleOverview(): void {
    if (!frame) frame = requestAnimationFrame(layoutOverview);
  }
  function layoutOverview(): void {
    frame = 0;
    if (!chrome.runtime?.id) {
      changes.disconnect();
      sizes.disconnect();
      return;
    }
    const split = document.querySelector('[data-component="SplitPageLayout"].container-xl:has(#folders-and-files)');
    const article = split?.querySelector('.js-snippet-clipboard-copy-unpositioned > article.markdown-body');
    const panel = article?.parentElement?.parentElement ?? null;
    const pane = split?.closest('#repos-split-pane-content, #repo-content-pjax-container');
    const column = split?.querySelector('[data-component="SplitPageLayout.Content"]');
    const sidebar = column?.parentElement?.querySelector('[data-component="SplitPageLayout.Pane"]');
    if (overview !== panel) clearOverview();
    if (!panel?.parentElement || !pane) return;
    overview = panel;
    const bounds = pane.getBoundingClientRect();
    const parent = panel.parentElement.getBoundingClientRect();
    panel.style.setProperty('--refine-pane-width', Math.max(0, bounds.width - 32) + 'px');
    panel.style.setProperty('--refine-pane-center', bounds.left + bounds.width / 2 - parent.left + 'px');
    panel.classList.add('refine-overview-readme');
    const rect = panel.getBoundingClientRect();
    const previous = parseFloat(panel.style.getPropertyValue('--refine-sidebar-clearance')) || 0;
    let gap = 0;
    // The pane itself stretches to the README's height. Measure its content
    // blocks so increasing the clearance cannot also increase the target height.
    for (const block of sidebar?.children ?? []) {
      sizes.observe(block);
      const aside = block.getBoundingClientRect();
      const besideColumn = aside.left >= parent.right || aside.right <= parent.left;
      if (aside.height && aside.width && besideColumn && rect.right > aside.left && rect.left < aside.right) {
        gap = Math.max(gap, Math.ceil(aside.bottom + 16 - (rect.top - previous)));
      }
    }
    panel.style.setProperty('--refine-sidebar-clearance', gap + 'px');
    sizes.observe(pane);
    sizes.observe(panel.parentElement);
    const files = split?.querySelector('table');
    if (files) sizes.observe(files);
  }
  function clearOverview(): void {
    sizes.disconnect();
    overview?.classList.remove('refine-overview-readme');
    for (const key of ['--refine-pane-width', '--refine-pane-center', '--refine-sidebar-clearance']) overview?.style.removeProperty(key);
    overview = null;
  }
  function apply(): void {
    if (!chrome.runtime?.id) return;
    currentURL = location.href;
    const editor = ready && settings.enabled ? splitPreviewMode(currentURL, enabledHosts) : undefined;
    setSplitPreview(settings.splitPreview ? editor : undefined);
    const type = ready && settings.enabled ? pageTypeFor(currentURL, enabledHosts) : undefined;
    const active = type !== undefined;
    const widthType = type ?? (editor === 'issue' ? 'issues' : editor === 'file' ? 'markdown' : editor);
    const width = widthType ? effectiveWidth(settings, widthType) : 'default';
    const html = document.documentElement;
    const resizeEditor = ready && settings.enabled && settings.editorHeight !== 'default' && supportsEditorHeight(currentURL, enabledHosts);
    html.classList.toggle('refine-editor-height', resizeEditor);
    if (resizeEditor) html.style.setProperty('--refine-editor-height', settings.editorHeight + 'px');
    else html.style.removeProperty('--refine-editor-height');
    html.classList.toggle('refine-active', active);
    html.classList.toggle('refine-wide', width !== 'default');
    html.classList.toggle('refine-editor-width', !!editor && width !== 'default');
    html.classList.toggle('refine-capped', width === 'wide' || typeof width === 'number');
    if (typeof width === 'number') html.style.setProperty('--refine-layout-limit', width + 'px');
    else html.style.removeProperty('--refine-layout-limit');
    html.classList.toggle('refine-document', type === 'markdown');
    if (type === 'markdown' && width !== 'default') {
      changes.observe(document.documentElement, { childList: true, subtree: true });
      scheduleOverview();
    } else {
      changes.disconnect();
      cancelAnimationFrame(frame);
      frame = 0;
      clearOverview();
    }
    html.classList.toggle('refine-diff', type === 'diff');
    html.classList.toggle('refine-focus', active && type !== 'markdown' && type !== 'diff' && settings.focus);
    const customFont = active && settings.fontSize !== 'default';
    html.classList.toggle('refine-custom-font', customFont);
    if (customFont) html.style.setProperty('--refine-font-size', `${settings.fontSize}px`);
    else html.style.removeProperty('--refine-font-size');
  }
  // Same-document history changes can occur before GitHub updates the DOM.
  if (window.navigation) {
    window.navigation.addEventListener('currententrychange', apply);
  } else {
    const observer = new MutationObserver(() => { if (currentURL !== location.href) apply(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('popstate', apply);
  }
  for (const event of ['turbo:load', 'turbo:render', 'pjax:end']) document.addEventListener(event, apply);
  let latestLoad = 0;
  async function load(): Promise<void> {
    if (!chrome.runtime?.id) return;
    const request = ++latestLoad;
    try {
      const data = await chrome.storage.local.get([...settingKeys, sitesKey]);
      if (request !== latestLoad) return;
      settings = readSettings(data);
      enabledHosts = Array.isArray(data[sitesKey]) ? data[sitesKey] : [];
      ready = true;
    }
    catch { return; }
    apply();
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (sitesKey in changes || settingKeys.some(key => key in changes))) void load();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void load();
  });
  window.addEventListener('pageshow', event => { if (event.persisted) void load(); });
  void load();
})();
