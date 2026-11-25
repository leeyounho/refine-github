import type { SplitPreviewMode } from './model';
import { linkScroll } from './split-scroll';
import { fetchPreview, mapPreviewLines, nativePreviewRequest } from './native-preview';
import MarkdownIt from 'markdown-it';

let markdown: InstanceType<typeof MarkdownIt> | undefined;
const editorSelector = '.cm-editor:has(.cm-content[contenteditable="true"]), .CodeMirror, textarea#code-editor, textarea#code, textarea[aria-label="File content"]';
const issueSelector = 'textarea:is(.js-comment-field, .comment-form-textarea, [name="body"], [name$="[body]"], [data-testid="markdown-editor-textarea"], [aria-label="Markdown value"], #issue-body), .js-write-bucket textarea';
const wikiSelector = 'textarea:is(#wiki-body, #gollum-editor-body, [name="wiki[body]"], [name="gollum:body"])';
let mode: SplitPreviewMode;
interface Preview {
  host: HTMLElement;
  pane: HTMLElement;
  scroll: ReturnType<typeof linkScroll>;
  lastText?: string;
  context?: string;
  pending?: AbortController;
  timer?: number;
}
const previews = new Map<HTMLElement, Preview>();
const observedEditors = new Set<HTMLElement>();
// GitHub can show the same Write panel again without replacing any DOM nodes.
const editorSizes = new ResizeObserver(schedule);
let revision = 0;
let timer = 0;
const observer = new MutationObserver(records => {
  if (records.some(({ target }) => {
    const element = target instanceof Element ? target : target.parentElement;
    return !element?.closest('.refine-split-preview');
  })) schedule();
});

function schedule(): void {
  revision++;
  clearTimeout(timer);
  timer = window.setTimeout(() => void refresh(), 100);
}

function removePreview(editor: HTMLElement): void {
  const preview = previews.get(editor);
  clearTimeout(preview?.timer);
  preview?.pending?.abort();
  const pane = preview?.pane;
  const host = preview?.host;
  preview?.scroll.destroy();
  delete editor.dataset.refineEditor;
  pane?.remove();
  editor.classList.remove('refine-split-source');
  if (!host?.querySelector(':scope > .refine-split-preview')) host?.classList.remove('refine-split-host');
  previews.delete(editor);
}

function restoreTabs(): void {
  document.querySelectorAll('.refine-split-tab').forEach(tab => tab.classList.remove('refine-split-tab'));
}

function editorTabs() {
  const controls = document.querySelectorAll<HTMLElement>('button, [role="tab"], [role="radio"]');
  const named = (tab: HTMLElement, name: string) => tab.textContent?.trim() === name || tab.getAttribute('aria-label') === name;
  for (const preview of controls) {
    if (!named(preview, 'Preview')) continue;
    const group = preview.closest('[role="tablist"], [role="radiogroup"]') ?? preview.parentElement?.parentElement;
    const edit = [...(group?.querySelectorAll<HTMLElement>('button, [role="tab"], [role="radio"]') ?? [])].find(tab => named(tab, 'Edit'));
    if (edit) return { edit, preview };
  }
}

async function refresh(): Promise<void> {
  if (!chrome.runtime?.id) { setSplitPreview(undefined); return; }
  const selector = mode === 'issue' ? issueSelector : mode === 'wiki' ? wikiSelector + ', ' + editorSelector : editorSelector;
  const candidates = new Set([...document.querySelectorAll<HTMLElement>(selector)].filter(editor =>
    !(editor instanceof HTMLTextAreaElement && editor.closest('.CodeMirror, .cm-editor'))));
  for (const editor of observedEditors) {
    if (!candidates.has(editor)) {
      editorSizes.unobserve(editor);
      observedEditors.delete(editor);
    }
  }
  for (const editor of candidates) {
    if (!observedEditors.has(editor)) {
      editorSizes.observe(editor);
      observedEditors.add(editor);
    }
  }
  const editors = [...candidates].filter(editor => editor.getClientRects().length && !editor.closest('[hidden]'));
  for (const [editor, { pane }] of previews) {
    if (!editors.includes(editor) || pane.parentElement !== editor.parentElement) removePreview(editor);
  }
  const tabs = mode === 'file' ? editorTabs() : undefined;
  if (!editors.length) {
    restoreTabs();
    if (tabs?.preview.matches('[aria-selected="true"], [aria-pressed="true"], [aria-checked="true"]')) tabs.edit.click();
    return;
  }
  const request = revision;
  for (const editor of editors) {
    const host = editor.parentElement!;
    if (!editor.classList.contains('refine-split-source')) editor.classList.add('refine-split-source');
    if (!(editor instanceof HTMLTextAreaElement)) editor.dataset.refineEditor ??= crypto.randomUUID();
    const text: unknown = editor instanceof HTMLTextAreaElement ? editor.value :
      await chrome.runtime.sendMessage({ type: 'read-markdown-editor', editorId: editor.dataset.refineEditor }).catch(() => null);
    if (request !== revision || !editor.isConnected) return;
    if (typeof text !== 'string') { removePreview(editor); continue; }
    let preview = previews.get(editor);
    if (!preview) {
      const pane = document.createElement('section');
      pane.className = 'refine-split-preview markdown-body';
      pane.setAttribute('aria-label', 'Markdown preview');
      pane.tabIndex = 0;
      editor.after(pane);
      preview = { host, pane, scroll: linkScroll(editor, pane) };
      previews.set(editor, preview);
    }
    if (!host.classList.contains('refine-split-host')) host.classList.add('refine-split-host');
    if (tabs) {
      for (const tab of [tabs.edit, tabs.preview]) {
        if (!tab.classList.contains('refine-split-tab')) tab.classList.add('refine-split-tab');
      }
    }
    const native = nativePreviewRequest(editor, mode);
    const context = JSON.stringify([location.pathname, native?.url.href, native?.fields.toString()]);
    if (text !== preview.lastText || context !== preview.context) {
      clearTimeout(preview.timer);
      preview.pending?.abort();
      delete preview.pane.dataset.localPreview;
      render(preview.pane, text);
      preview.scroll.updated(text);
      preview.lastText = text;
      preview.context = context;
      if (!native && mode !== 'file' && text.trim()) {
        preview.pane.dataset.localPreview = 'GitHub preview unavailable · Local preview';
      }
      if (native && text.trim()) {
        const controller = new AbortController();
        preview.pending = controller;
        preview.timer = window.setTimeout(async () => {
          try {
            const result = await fetchPreview(native, text, controller.signal);
            if (controller.signal.aborted || !editor.isConnected ||
              (editor instanceof HTMLTextAreaElement && editor.value !== text)) return;
            // Native HTML may contain relative Wiki links. Resolve them against the
            // viewed page and open links without navigating away from the unsaved draft.
            resolveLinks(result);
            mapPreviewLines(preview.pane, result);
            preview.pane.replaceChildren(result);
            preview.scroll.updated(text);
          } catch {
            if (!controller.signal.aborted) preview.pane.dataset.localPreview = 'GitHub preview unavailable · Local preview';
          }
        }, 400);
      }
    }
  }
}

function render(pane: HTMLElement, text: string): void {
  const template = document.createElement('template');
  markdown ??= new MarkdownIt({ html: false, linkify: true });
  const tokens = markdown.parse(text, {});
  for (const token of tokens) {
    if (!token.map || token.hidden || token.type === 'inline') continue;
    token.attrSet('data-refine-line', String(token.map[0]));
    token.attrSet('data-refine-end', String(token.map[1]));
  }
  template.innerHTML = markdown.renderer.render(tokens, markdown.options, {});
  resolveLinks(template.content);
  pane.replaceChildren(template.content);
}

function resolveLinks(content: DocumentFragment): void {
  const file = new URL(location.href);
  file.search = file.hash = '';
  if (mode === 'wiki') file.pathname = file.pathname.replace(/\/_edit$/, '').replace(/\/_new$/, '/');
  file.pathname = file.pathname.replace(/^(\/[^/]+\/[^/]+)\/edit\//, '$1/blob/');
  for (const link of content.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = link.getAttribute('href')!;
    if (!URL.canParse(href, file)) { link.removeAttribute('href'); continue; }
    link.href = new URL(href, file).href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  file.pathname = file.pathname.replace(/^(\/[^/]+\/[^/]+)\/blob\//, '$1/raw/');
  for (const image of content.querySelectorAll<HTMLImageElement>('img[src]')) {
    const src = image.getAttribute('src')!;
    if (!URL.canParse(src, file)) { image.removeAttribute('src'); continue; }
    image.src = new URL(src, file).href;
  }
}

export function setSplitPreview(active: SplitPreviewMode): void {
  if (active === mode) { if (active) schedule(); return; }
  mode = active;
  editorSizes.disconnect();
  observedEditors.clear();
  for (const editor of previews.keys()) removePreview(editor);
  restoreTabs();
  if (active) {
    observer.observe(document.documentElement, {
      subtree: true, childList: true, characterData: true,
      attributeFilter: active === 'issue' ? ['hidden', 'class'] : ['hidden'],
    });
    document.addEventListener('input', schedule, true);
    document.addEventListener('change', schedule, true);
    schedule();
  } else {
    observer.disconnect();
    document.removeEventListener('input', schedule, true);
    document.removeEventListener('change', schedule, true);
    clearTimeout(timer);
    revision++;
  }
}
