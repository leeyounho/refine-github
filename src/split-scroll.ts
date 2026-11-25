/** Measure source lines with the textarea's actual font and wrapping width. */
function textareaOffsets(editor: HTMLTextAreaElement, pane: HTMLElement, lines: number[]): number[] {
  const style = getComputedStyle(editor);
  const mirror = document.createElement('div');
  mirror.style.cssText = 'all:initial;position:fixed;visibility:hidden;pointer-events:none;box-sizing:border-box;';
  for (const property of ['font', 'line-height', 'letter-spacing', 'word-spacing', 'text-indent', 'tab-size',
    'padding', 'direction', 'word-break', 'overflow-wrap', 'white-space', 'text-transform']) {
    mirror.style.setProperty(property, style.getPropertyValue(property));
  }
  mirror.style.width = editor.clientWidth + 'px';
  const rows = editor.value.split('\n').map(text => {
    const row = document.createElement('div');
    row.textContent = text || '\u200b';
    return row;
  });
  for (const row of rows) mirror.append(row);
  pane.append(mirror);
  const top = mirror.getBoundingClientRect().top;
  const offsets = lines.map(line => rows[line].getBoundingClientRect().top - top);
  mirror.remove();
  return offsets;
}

export function linkScroll(editor: HTMLElement, pane: HTMLElement) {
  const source = editor.querySelector<HTMLElement>('.cm-scroller, .CodeMirror-scroll') ?? editor;
  let anchors: { block: HTMLElement; edge: 'top' | 'bottom' }[] = [];
  let lines: number[] = [];
  let sourceOffsets: number[] | undefined;
  let renderedText = '';
  let version = 0;
  let frame = 0;
  const expected = new Map<HTMLElement, number>();

  async function align(from: HTMLElement, request: number) {
    if (editor instanceof HTMLTextAreaElement && editor.value !== renderedText) return;
    const to = from === source ? pane : source;
    const max = from.scrollHeight - from.clientHeight;
    const targetMax = to.scrollHeight - to.clientHeight;
    if (max <= 0 || targetMax <= 0) return;
    let target = 0;
    if (from.scrollTop >= max - 1) {
      target = targetMax;
    } else if (from.scrollTop > 0) {
      if (!sourceOffsets) {
        const offsets: unknown = editor instanceof HTMLTextAreaElement
          ? textareaOffsets(editor, pane, lines)
          : await chrome.runtime.sendMessage({
            type: 'read-markdown-editor', editorId: editor.dataset.refineEditor, lines,
          }).catch(() => null);
        if (request !== version || !Array.isArray(offsets) || offsets.length !== lines.length) return;
        sourceOffsets = offsets;
      }
      const origin = pane.getBoundingClientRect().top + pane.clientTop - pane.scrollTop;
      const previewOffset = (i: number) => {
        const { block, edge } = anchors[i];
        return block.getBoundingClientRect()[edge] - origin;
      };
      const input = (i: number) => from === source ? sourceOffsets![i] : previewOffset(i);
      const output = (i: number) => from === source ? previewOffset(i) : sourceOffsets![i];
      // Interpolate only between the two Markdown blocks around the viewport's top edge.
      let low = 0, high = anchors.length;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (input(mid) <= from.scrollTop) low = mid + 1;
        else high = mid;
      }
      const start = low ? input(low - 1) : 0;
      const end = low < anchors.length ? input(low) : from.scrollHeight;
      const targetStart = low ? output(low - 1) : 0;
      const targetEnd = low < anchors.length ? output(low) : to.scrollHeight;
      target = targetStart + (targetEnd - targetStart) * (from.scrollTop - start) / Math.max(1, end - start);
    }
    to.scrollTop = Math.max(0, Math.min(targetMax, target));
    expected.set(to, to.scrollTop);
  }

  function queue(from: HTMLElement) {
    const request = ++version;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => void align(from, request));
  }
  function onScroll(event: Event) {
    const from = event.currentTarget as HTMLElement;
    if (expected.get(from) === from.scrollTop) return;
    expected.delete(from);
    queue(from);
  }
  const size = new ResizeObserver(() => {
    sourceOffsets = undefined;
    queue(source);
  });
  size.observe(source);
  source.addEventListener('scroll', onScroll);
  pane.addEventListener('scroll', onScroll);
  return {
    updated(text: string) {
      renderedText = text;
      sourceOffsets = undefined;
      anchors = [];
      lines = [];
      for (const block of pane.querySelectorAll<HTMLElement>('[data-refine-line]')) {
        const line = Number(block.dataset.refineLine);
        if (line <= (lines.at(-1) ?? -1)) continue;
        const previous = anchors.at(-1)?.block;
        const end = Number(previous?.dataset.refineEnd);
        // Empty source lines map to the rendered gap between adjacent blocks.
        if (previous && end < line) {
          lines.push(end);
          anchors.push({ block: previous, edge: 'bottom' });
        }
        lines.push(line);
        anchors.push({ block, edge: 'top' });
      }
      queue(source);
    },
    destroy() {
      version++;
      cancelAnimationFrame(frame);
      size.disconnect();
      source.removeEventListener('scroll', onScroll);
      pane.removeEventListener('scroll', onScroll);
    },
  };
}
