import { fontSizes, widthLabels, setSetting, type PageWidth, type Settings } from './model';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
}
export function brand(): HTMLElement {
  const row = el('div', 'brand'), logo = el('img', 'brand-icon');
  logo.src = 'icons/48.png'; logo.alt = '';
  row.append(logo, el('strong', '', 'Refine GitHub')); return row;
}
function selectRow<T extends string | number>(
  title: string, name: string, choices: readonly T[], current: T,
  display: (value: T) => string, save: (value: T) => Promise<void>, onError: () => void,
): HTMLElement {
  const row = el('label', 'setting-row');
  const select = el('select');
  select.name = name;
  for (const value of choices) select.add(new Option(display(value), String(value)));
  select.value = String(current);
  select.addEventListener('change', () => {
    const value = choices[select.selectedIndex];
    if (value === undefined) return;
    void save(value).catch(() => { select.value = String(current); onError(); });
  });
  row.append(el('strong', '', title), select);
  return row;
}

export function settingsUI(settings: Settings, onError: () => void): HTMLElement {
  const root = el('div', 'settings');
  const focusRow = el('label', 'setting-row');
  const focus = el('input', 'switch');
  focus.type = 'checkbox';
  focus.name = 'focus';
  focus.checked = settings.focus;
  focus.addEventListener('change', () => {
    void setSetting('focus', focus.checked).catch(() => { focus.checked = settings.focus; onError(); });
  });
  focusRow.append(el('strong', '', 'Focus mode'), focus);
  root.append(
    selectRow('Page width', 'width', Object.keys(widthLabels) as PageWidth[], settings.width,
      width => widthLabels[width], width => setSetting('width', width), onError),
    focusRow,
    selectRow('Font size', 'fontSize', fontSizes, settings.fontSize,
      size => size + ' px', size => setSetting('fontSize', size), onError),
  );
  return root;
}
