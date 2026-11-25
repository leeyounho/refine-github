import DOMPurify from 'dompurify';
import type { SplitPreviewMode } from './model';

function meta(name: string): string {
  return document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? '';
}

export function nativePreviewRequest(editor: HTMLElement, mode: SplitPreviewMode) {
  if (mode !== 'issue' && mode !== 'wiki') return;
  const form = editor.closest<HTMLElement>('[data-preview-url]');
  const address = form?.dataset.previewUrl ?? '/preview';
  if (!URL.canParse(address, location.href)) return;
  const url = new URL(address, location.href);
  const repo = location.pathname.split('/').slice(0, 3).join('/');
  if (url.origin !== location.origin || !['/preview', repo + '/wiki/_preview', repo + '/wiki/preview'].includes(url.pathname)) return;

  const fields = new URLSearchParams();
  if (form) {
    const csrf = form.querySelector<HTMLInputElement>('.js-data-preview-url-csrf') ??
      form.closest('form')?.querySelector<HTMLInputElement>('input[name="authenticity_token"]');
    if (csrf) fields.set('authenticity_token', csrf.value);
    for (const name of ['path', 'comment_id']) {
      const input = form.querySelector<HTMLInputElement>('.js-' + name.replace('_', '-'));
      if (input?.value) fields.set(name, input.value);
    }
  } else {
    fields.set('repository', meta('octolytics-dimension-repository_id'));
    if (mode === 'issue') {
      const id = /^issue:(\d+)$/.exec(meta('hovercard-subject-tag'))?.[1] ?? '';
      fields.set('issue', id);
      fields.set('project', id);
      fields.set('subject_type', 'Issue');
    }
  }
  if (mode === 'wiki') {
    const format = (form ?? document).querySelector<HTMLSelectElement>('#wiki_format');
    fields.set('wiki_format', format?.value ?? editor.dataset.markupLang ?? 'markdown');
  }
  return { url, fields };
}

export async function fetchPreview(request: NonNullable<ReturnType<typeof nativePreviewRequest>>,
  text: string, signal: AbortSignal): Promise<DocumentFragment> {
  const body = new FormData();
  request.fields.forEach((value, key) => body.append(key, value));
  body.set('text', text);
  const response = await fetch(request.url, {
    method: 'POST', credentials: 'same-origin', mode: 'same-origin', redirect: 'error', signal, body,
    headers: { 'GitHub-Verified-Fetch': 'true', Accept: 'text/html' },
  });
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!response.ok || type !== 'text/html') throw new Error('Preview unavailable');
  const html = await response.text();
  if (/^\s*(?:<!doctype|<html\b)/i.test(html)) throw new Error('Expected a preview fragment');
  const result = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true, ADD_TAGS: ['g-emoji'], FORBID_TAGS: ['form', 'style', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['form', 'formaction', 'name', 'data-refine-line', 'data-refine-end'],
  });
  for (const input of result.querySelectorAll('input')) {
    if (input.type === 'checkbox') input.disabled = true;
    else input.remove();
  }
  return result;
}

/** Keep the scroll anchors on their corresponding blocks when GitHub adds wrappers and inline markup. */
export function mapPreviewLines(local: HTMLElement, result: DocumentFragment): void {
  const selector = 'h1,h2,h3,h4,h5,h6,p,blockquote,li,ul,ol,table,tr,hr,pre';
  const sources = [...local.querySelectorAll<HTMLElement>(selector)].filter(el =>
    el.hasAttribute('data-refine-line') || (el.matches('pre') && el.firstElementChild?.hasAttribute('data-refine-line')));
  const destinations = [...result.querySelectorAll<HTMLElement>(selector)];
  // GitHub may expand a source block into several paragraphs or omit a block.
  // First reserve exact matches so a tag-only match cannot consume a later heading or paragraph.
  const key = (el: HTMLElement) => el.tagName + ' ' + el.textContent.trim().replace(/\s+/g, ' ');
  const positions = new Map<string, number[]>();
  for (let i = destinations.length - 1; i >= 0; i--) {
    const id = key(destinations[i]);
    const group = positions.get(id);
    if (group) group.push(i);
    else positions.set(id, [i]);
  }
  const matches = new Map<number, number>();
  let last = -1;
  sources.forEach((source, i) => {
    const group = positions.get(key(source));
    while (group?.length && group.at(-1)! <= last) group.pop();
    if (group?.length) {
      last = group.pop()!;
      matches.set(i, last);
    }
  });
  let cursor = 0, start = 0;
  matches.set(sources.length, destinations.length);
  for (const [boundary, stop] of matches) {
    for (let i = start; i <= boundary && i < sources.length; i++) {
      const source = sources[i];
      let index = i === boundary ? stop : cursor;
      while (index < stop && destinations[index].tagName !== source.tagName) index++;
      if (i !== boundary && index === stop) continue;
      const anchor = source.hasAttribute('data-refine-line') ? source : source.firstElementChild as HTMLElement;
      destinations[index].dataset.refineLine = anchor.dataset.refineLine;
      destinations[index].dataset.refineEnd = anchor.dataset.refineEnd;
      cursor = index + 1;
    }
    start = boundary + 1;
  }
}
