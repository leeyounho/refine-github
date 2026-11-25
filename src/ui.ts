import { editorHeights, effectiveWidth, fontSizes, pageTypes, setAllWidths, setPageWidth, setSetting, widthLabels, widthStops, type WidthPreset, type PageWidth, type Settings } from './model';

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
  const caption = el('strong', '', title);
  caption.id = name + '-label';
  const select = el('select');
  select.name = name;
  select.setAttribute('aria-labelledby', caption.id);
  for (const value of choices) select.add(new Option(display(value), String(value)));
  select.value = String(current);
  select.addEventListener('change', () => {
    const value = choices[select.selectedIndex];
    if (value === undefined) return;
    void save(value).catch(() => { select.value = String(current); onError(); });
  });
  row.append(caption, select);
  return row;
}

const widths = Object.keys(widthLabels) as WidthPreset[];

export function settingSwitch(name: 'focus' | 'enabled' | 'splitPreview', checked: boolean, onError: () => void) {
  const input = el('input', 'switch');
  input.type = 'checkbox';
  if (name === 'enabled') input.setAttribute('aria-label', 'Enable extension');
  input.name = name;
  input.checked = checked;
  input.addEventListener('change', () => {
    void setSetting(name, input.checked).catch(() => { input.checked = checked; onError(); });
  });
  return input;
}

function widthPicker(current: PageWidth | undefined, save: (width: PageWidth) => Promise<void>,
  onError: () => void): HTMLElement {
  const widthRow = el('fieldset', 'width-picker');
  widthRow.setAttribute('aria-labelledby', 'page-width-label');
  const choices = el('div', 'width-choices');
  for (const width of widths) {
    const label = el('label');
    const input = el('input');
    input.type = 'radio';
    input.name = 'width';
    input.value = width;
    input.id = 'width-' + width;
    input.checked = current === width;
    input.addEventListener('change', () => {
      void save(width).catch(() => {
        for (const radio of choices.querySelectorAll('input')) {
          radio.checked = radio.value === current;
        }
        onError();
      });
    });
    label.append(input, el('span', '', widthLabels[width]));
    choices.append(label);
  }
  widthRow.append(choices);
  return widthRow;
}

function widthText(width: PageWidth): string {
  if (typeof width === 'number') return width + ' px';
  return width === 'wide' ? '1600 px' : widthLabels[width];
}

function widthSlider(title: string, name: string, current: PageWidth | 'inherit',
  save: (width: PageWidth | 'inherit') => Promise<void>, onError: () => void, inherited?: string): HTMLElement {
  const stops: (PageWidth | 'inherit')[] = inherited ? ['inherit', ...widthStops] : widthStops;
  const row = el('div', 'width-slider');
  const caption = el('label', '', title);
  const input = el('input');
  input.type = 'range';
  input.id = input.name = name;
  caption.htmlFor = input.id;
  input.min = '0';
  input.max = String(stops.length - 1);
  const value = el('span', 'slider-value');
  function update(): void {
    const width = stops[input.valueAsNumber];
    value.textContent = width === 'inherit' ? inherited! : widthText(width);
    input.setAttribute('aria-valuetext', value.textContent);
  }
  input.value = String(stops.indexOf(current));
  update();
  input.addEventListener('input', update);
  input.addEventListener('change', () => {
    void save(stops[input.valueAsNumber]).catch(() => {
      input.value = String(stops.indexOf(current));
      update();
      onError();
    });
  });
  const ends = el('div', 'slider-ends');
  ends.append(el('span', '', inherited ? inherited.split(' · ')[0] : 'Default'), el('span', '', 'Full width'));
  row.append(caption, value, input, ends);
  return row;
}

export function optionsUI(settings: Settings, onError: () => void): HTMLElement {
  const perType = el('fieldset', 'page-widths');
  perType.append(el('legend', '', 'Width by page type'));
  const labels = { issues: 'Issues', pulls: 'Pull requests', discussions: 'Discussions', wiki: 'Wiki', markdown: 'README & Markdown', diff: 'Compare & commits' };
  for (const type of pageTypes) {
    const inherited = type === 'diff' ? 'Use PR · ' + widthText(effectiveWidth(settings, 'pulls'))
      : 'Use shared · ' + widthText(settings.width);
    perType.append(widthSlider(labels[type], 'width-' + type, settings.widths[type] ?? 'inherit',
      width => setPageWidth(type, width), onError, inherited));
  }
  const root = el('div', 'settings');
  root.append(
    el('h1', '', 'Page options'),
    widthSlider('Shared page width', 'shared-width', settings.width,
      width => width === 'inherit' ? Promise.resolve() : setSetting('width', width), onError),
    perType,
    selectRow('Font size', 'fontSize', ['default', ...fontSizes] as const, settings.fontSize,
      size => size === 'default' ? 'GitHub default' : size + ' px', size => setSetting('fontSize', size), onError),
    selectRow('Editor height', 'editorHeight', ['default', ...editorHeights] as const, settings.editorHeight,
      height => height === 'default' ? 'GitHub default' : height + ' px',
      height => setSetting('editorHeight', height), onError));
  const split = el('label', 'setting-row');
  split.append(el('strong', '', 'Side-by-side Markdown preview'), settingSwitch('splitPreview', settings.splitPreview, onError));
  root.append(split);
  return root;
}

export function settingsUI(settings: Settings, onError: () => void): HTMLElement {
  const root = el('div', 'settings');
  const custom = Object.keys(settings.widths).length > 0;
  const widthRow = widthPicker(custom ? undefined : settings.width, setAllWidths, onError);
  if (custom) widthRow.append(el('p', 'width-note', 'Choose a width to replace per-page settings.'));
  else if (typeof settings.width === 'number') widthRow.append(el('p', 'width-note', widthText(settings.width) + ' · Page options'));
  const heading = el('div', 'width-heading');
  const caption = el('strong', '', 'Page width');
  caption.id = 'page-width-label';
  const focus = el('label', 'focus-control', 'Focus');
  focus.append(settingSwitch('focus', settings.focus, onError));
  heading.append(caption, focus);
  root.append(heading, widthRow);
  return root;
}
