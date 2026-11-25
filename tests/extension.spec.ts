import { test as base, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const extension = resolve('dist');
const baseURL = 'https://github.com/acme/workspace';
const fixture = `<!doctype html><html lang="en"><head><title>GitHub reading settings</title><style>
body{margin:0;font:14px/1.6 system-ui}main{padding:28px}.container-xl{max-width:1100px;margin:auto}.Layout{display:grid;grid-template-columns:minmax(0,1fr) 190px;gap:28px}.markdown-body{font-size:14px;padding:20px;border:1px solid #ddd}pre{font-size:13px}
</style></head><body><main id="repo-content-pjax-container"><div class="container-xl"><h1>GitHub page</h1><div class="Layout"><section><article class="markdown-body"><h2>Overview</h2><p>Read issues, documentation, and code reviews comfortably.</p></article><pre>Code diff stays at its original size.</pre></section><aside class="discussion-sidebar Layout-sidebar">Assignees and labels</aside></div></div></main></body></html>`;

const test = base.extend<{ context: BrowserContext; page: Page }>({
  context: async ({}, use) => {
    const profile = await mkdtemp(join(tmpdir(), 'refine-github-test-'));
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'msedge', headless: true, viewport: { width: 1440, height: 1000 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      ignoreDefaultArgs: ['--disable-extensions'],
    });
    await context.route('https://github.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
    try { await use(context); } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
  },
  page: async ({ context }, use) => { const page = await context.newPage(); await use(page); },
});
async function open(page: Page, path = '/issues/42') {
  await page.goto(baseURL + path); await expect(page.locator('html')).toHaveClass(/refine-active/);
}
async function popupFor(context: BrowserContext): Promise<Page> {
  const page = await context.newPage(); await page.goto('edge://extensions-internals');
  const json = JSON.parse(await page.locator('body').innerText());
  const records = Array.isArray(json) ? json : json.extensions;
  const extension = records.find((entry: { name: string }) => entry.name === 'Refine GitHub');
  expect(extension).toBeTruthy();
  await page.goto(`chrome-extension://${extension.id}/popup.html`);
  await expect(page.getByRole('group', { name: 'Page width' })).toBeVisible(); return page;
}

async function optionsFor(popup: Page): Promise<Page> {
  const options = await popup.context().newPage();
  await options.goto(new URL('options.html', popup.url()).href);
  return options;
}

test('popup exposes reading settings and no page panel is injected', async ({ page, context }) => {
  await open(page);
  const popup = await popupFor(context);
  const options = await optionsFor(popup);
  await expect(popup.getByLabel('Enable extension')).toBeChecked();
  const reset = popup.locator('header').getByRole('button', { name: 'Reset' });
  await reset.focus();
  await popup.keyboard.press('Tab');
  await expect(popup.getByLabel('Enable extension')).toBeFocused();
  await expect(popup.getByLabel('Pull requests')).toHaveCount(0);
  await expect(popup.getByRole('radio', { name: 'Default' })).toBeChecked();
  await expect(popup.getByLabel('Focus', { exact: true })).not.toBeChecked();
  await expect(popup.getByRole('group', { name: 'Page width' }).locator('label')).toHaveText(['Default', 'Wide', 'Full width']);
  await expect(popup.getByLabel('Font size')).toHaveCount(0);
  await expect(options.getByLabel('Font size')).toHaveValue('default');
  await expect(options.getByLabel('Font size').locator('option')).toHaveText(
    ['GitHub default', ...Array.from({ length: 13 }, (_, index) => (index + 8) + ' px')],
  );
  await expect(popup.getByRole('heading')).toHaveCount(0);
  await expect(popup.getByRole('tab')).toHaveCount(0);
  await expect(popup.getByRole('searchbox')).toHaveCount(0);
  await expect(popup.getByText(/페이지 저장|링크 복사|Alt \+ Shift/)).toHaveCount(0);
  await expect(page.locator('#refine-github-root')).toHaveCount(0);
  await expect(page.locator('body')).toHaveCSS('padding-right', '0px');
  await popup.setViewportSize({ width: 290, height: 360 });
  expect(await popup.evaluate(() => document.documentElement.scrollWidth)).toBe(290);
  await popup.getByLabel('Enable extension').blur();
  await popup.locator('#app').screenshot({ path: 'artifacts/popup-simple.png' });
  await popup.getByRole('radio', { name: 'Default' }).focus();
  await popup.keyboard.press('ArrowRight');
  await expect(popup.getByRole('radio', { name: 'Wide' })).toBeChecked();
  await expect(popup.getByRole('radio', { name: 'Wide' })).toBeFocused();
});

test('preferences change actual page layout, synchronize across Issue Wiki PR, and persist', async ({ page, context }) => {
  await open(page);
  const wiki = await context.newPage(); await open(wiki, '/wiki/Guide');
  const pr = await context.newPage(); await open(pr, '/pull/7/files');
  const popup = await popupFor(context);
  const options = await optionsFor(popup);
  await popup.getByRole('radio', { name: 'Default' }).check();

  await popup.getByLabel('Focus', { exact: true }).check();
  await options.getByLabel('Font size').focus();
  await options.getByLabel('Font size').selectOption('20');
  await expect(options.getByLabel('Font size')).toBeFocused();
  for (const tab of [page, wiki, pr]) {
    await expect(tab.locator('.container-xl')).toHaveCSS('max-width', '1100px');
    await expect(tab.locator('.discussion-sidebar')).toBeHidden();
    await expect(tab.locator('.markdown-body')).toHaveCSS('font-size', '20px');
    await expect(tab.locator('pre')).toHaveCSS('font-size', '13px');
  }
  await page.reload(); await expect(page.locator('.markdown-body')).toHaveCSS('font-size', '20px');
  await options.reload(); await expect(options.getByLabel('Font size')).toHaveValue('20');
  await popup.getByRole('radio', { name: 'Full width' }).check(); await popup.getByLabel('Focus', { exact: true }).uncheck();
  await options.getByLabel('Font size').selectOption('8');
  await expect(page.locator('.container-xl')).toHaveCSS('max-width', 'none');
  await expect(page.locator('.discussion-sidebar')).toBeVisible();
  await expect(wiki.locator('.markdown-body')).toHaveCSS('font-size', '8px');
  await page.evaluate(() => { const article = document.createElement('article'); article.className = 'markdown-body'; article.textContent = 'Dynamically loaded comment'; document.querySelector('section')!.append(article); });
  await expect(page.locator('.markdown-body').last()).toHaveCSS('font-size', '8px');
});

test('settings reach already-open GitHub tabs after the extension reloads', async ({ page, context }) => {
  await open(page, '/discussions/3');
  const other = await context.newPage();
  await open(other, '/discussions/4');
  const popup = await popupFor(context);
  const options = await optionsFor(popup);
  await options.getByLabel('Font size').selectOption('20');
  await expect(other.locator('.markdown-body')).toHaveCSS('font-size', '20px');
  const worker = context.waitForEvent('serviceworker');
  await popup.evaluate(() => setTimeout(() => chrome.runtime.reload(), 0));
  await worker;
  const controls = await popupFor(context);
  const reopenedOptions = await optionsFor(controls);
  await reopenedOptions.getByLabel('Font size').selectOption('13');
  await controls.getByRole('radio', { name: 'Full width' }).check();
  for (const tab of [page, other]) {
    await expect(tab.locator('.markdown-body')).toHaveCSS('font-size', '13px');
    await expect(tab.locator('.container-xl')).toHaveCSS('max-width', 'none');
  }
});

test('editor height follows settings on writing routes and preserves drafts', async ({ page, context }) => {
  const popup = await popupFor(context);
  const options = await context.newPage();
  await options.goto(new URL('options.html', popup.url()).href);
  const height = options.getByLabel('Editor height');
  await expect(height).toHaveValue('default');
  const form = '<textarea name="issue[body]" style="height:100px">draft</textarea><input name="title">';
  await page.route('https://github.com/acme/workspace/**', route => route.fulfill({
    contentType: 'text/html', body: '<main>' + form + '</main>',
  }));
  await page.goto(baseURL + '/issues/new');
  const draft = page.locator('textarea');
  await height.selectOption('480');
  await expect(draft).toHaveCSS('height', '480px');
  await expect(page.locator('html')).not.toHaveClass(/refine-wide/);
  await draft.fill('unfinished reply');
  await options.reload();
  await expect(height).toHaveValue('480');
  await popup.getByLabel('Enable extension').uncheck();
  await expect(draft).toHaveCSS('height', '100px');
  await popup.getByLabel('Enable extension').check();
  await expect(draft).toHaveCSS('height', '480px');
  await popup.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(draft).toHaveCSS('height', '100px');
  await expect(draft).toHaveValue('unfinished reply');
  await height.selectOption('320');
  await page.goto(baseURL + '/edit/main/README.md');
  await page.locator('main').evaluate(main => {
    main.innerHTML = '<div class="cm-editor"><div class="cm-content" contenteditable="true">file draft</div></div>';
  });
  await expect(page.locator('.cm-editor')).toHaveCSS('height', '320px');
  await page.evaluate(() => history.pushState({}, '', '/acme/workspace/settings'));
  await expect(page.locator('html')).not.toHaveClass(/refine-editor-height/);
});

test('Markdown split preview tracks a draft and restores the editor tabs', async ({ page, context }) => {
  const options = await optionsFor(await popupFor(context));
  await page.goto(baseURL + '/edit/main/README.md');
  await page.locator('main').evaluate(main => {
    main.innerHTML = '<div><button>Edit</button><button>Preview</button></div><div><textarea id="code-editor"># Draft</textarea></div>';
  });
  const toggle = options.getByLabel('Side-by-side Markdown preview');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  const editor = page.locator('#code-editor');
  const preview = page.getByRole('region', { name: 'Markdown preview' });
  await expect(preview.getByRole('heading', { name: 'Draft' })).toBeVisible();
  const left = (await editor.boundingBox())!, right = (await preview.boundingBox())!;
  expect(right.x).toBeGreaterThanOrEqual(left.x + left.width - 1);
  expect(right.y).toBe(left.y);
  await expect(page.getByRole('button', { name: 'Preview' })).toBeHidden();
  await editor.fill('**New text**');
  await expect(preview.locator('strong')).toHaveText('New text');
  await toggle.uncheck();
  await expect(preview).toHaveCount(0);
  await expect(editor).toHaveValue('**New text**');
  await expect(page.getByRole('button', { name: 'Preview' })).toBeVisible();
  const bundle = await build({
    stdin: { contents: `
      import { EditorView } from '@codemirror/view';
      const editor = document.querySelector('#code-editor');
      const view = new EditorView({
        doc: 'Paragraph\\n\\n'.repeat(600) + '# Complete draft',
        extensions: [EditorView.theme({ '&': { height: '240px' }, '.cm-scroller': { overflow: 'auto' } })],
        parent: editor.parentElement
      });
      editor.remove();
    `, resolveDir: process.cwd() }, bundle: true, write: false,
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await expect(page.locator('.cm-content')).not.toContainText('Complete draft');
  await toggle.check();
  await expect(preview.getByRole('heading', { name: 'Complete draft' })).toBeVisible();
  const middle = preview.locator('p').nth(300);
  await middle.evaluate(el => {
    const pane = el.parentElement!;
    pane.scrollTop += el.getBoundingClientRect().top - pane.getBoundingClientRect().top - pane.clientTop;
  });
  await expect.poll(() => page.locator('.cm-scroller').evaluate(el => el.scrollTop / el.scrollHeight)).toBeCloseTo(0.5, 1);
  await page.locator('.cm-content').press('Control+Home');
  await page.keyboard.insertText('# Start\n\n');
  await expect(preview.getByRole('heading', { name: 'Start' })).toBeVisible();
  await page.evaluate(() => history.pushState({}, '', '/acme/workspace/edit/main/app.ts'));
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
});

for (const [route, field] of [
  ['/issues/42', 'data-testid="markdown-editor-textarea"'],
  ['/wiki/Guide/_edit', 'id="gollum-editor-body"'],
]) {
  test(`split preview follows the editor on ${route}`, async ({ page, context }) => {
    const options = await optionsFor(await popupFor(context));
    const toggle = options.getByLabel('Side-by-side Markdown preview');
    await toggle.check();
    await page.goto(baseURL + route);
    await page.locator('main').evaluate((main, attribute) => {
      main.innerHTML = '<input name="title"><div hidden><textarea ' + attribute + '># Draft</textarea></div>';
      const writePanel = main.querySelector('div')!;
      const panels = document.createElement('div');
      writePanel.before(panels);
      panels.append(writePanel);
      panels.insertAdjacentHTML('beforebegin', '<button>Write</button><button>Preview</button>');
      const [writeTab, previewTab] = main.querySelectorAll('button');
      previewTab.onclick = () => {
        panels.style.display = 'none';
        if (!main.querySelector('article')) main.insertAdjacentHTML('beforeend', '<article>Native preview</article>');
        main.querySelector('article')!.style.display = '';
      };
      writeTab.onclick = () => {
        main.querySelector('article')!.style.display = 'none';
        panels.style.display = '';
      };
      if (location.pathname.includes('/issues/')) {
        main.insertAdjacentHTML('afterbegin', '<div><textarea name="comment[body]">Reply</textarea></div>');
      }
    }, field);
    const editor = page.locator('textarea[' + field + ']');
    if (route.includes('/issues/')) await expect(page.locator('.refine-split-preview')).toHaveText('Reply');
    await editor.locator('..').evaluate(container => container.removeAttribute('hidden'));
    const preview = editor.locator('..').getByRole('region', { name: 'Markdown preview' });
    await expect(preview.getByRole('heading', { name: 'Draft' })).toBeVisible();
    const left = (await editor.boundingBox())!, right = (await preview.boundingBox())!;
    expect(right.x).toBeGreaterThanOrEqual(left.x + left.width - 1);
    expect(right.y).toBe(left.y);
    await editor.fill('**Changed**');
    await expect(preview.locator('strong')).toHaveText('Changed');
    for (const draft of ['First return', 'Second return']) {
      await page.getByRole('button', { name: 'Preview' }).click();
      await expect(page.getByText('Native preview')).toBeVisible();
      await expect(editor.locator('..').locator('.refine-split-preview')).toHaveCount(0);
      await page.getByRole('button', { name: 'Write' }).click();
      await expect(preview.locator('strong')).toHaveText('Changed');
      const sourceBox = (await editor.boundingBox())!, previewBox = (await preview.boundingBox())!;
      expect(previewBox.x).toBeGreaterThanOrEqual(sourceBox.x + sourceBox.width - 1);
      expect(previewBox.y).toBe(sourceBox.y);
      await editor.fill(draft);
      await expect(preview).toHaveText(draft);
      await editor.fill('**Changed**');
    }
    if (route.includes('/issues/')) await expect(page.locator('.refine-split-preview').first()).toHaveText('Reply');
    await toggle.uncheck();
    await expect(page.locator('.refine-split-preview')).toHaveCount(0);
    await expect(editor).toHaveValue('**Changed**');
  });
}

for (const kind of ['issue', 'wiki'] as const) {
  test(`the ${kind} side pane uses the host preview and its editor context`, async ({ page, context }) => {
    const options = await optionsFor(await popupFor(context));
    await options.getByLabel('Side-by-side Markdown preview').check();
    const wiki = kind === 'wiki';
    const endpoint = wiki ? baseURL + '/wiki/_preview' : 'https://github.com/preview';
    await page.route(endpoint, async route => {
      const body = await new Response(route.request().postDataBuffer(), {
        headers: { 'Content-Type': route.request().headers()['content-type'] },
      }).formData();
      expect(String(body.get('text')).replace(/\r\n/g, '\n')).toBe('## Tasks\n- [x] Done');
      if (wiki) {
        expect(body.get('authenticity_token')).toBe('wiki-preview-token');
      } else {
        expect(body.get('repository')).toBe('123');
        expect(body.get('issue')).toBe('456');
      }
      const label = body.get('wiki_format') ?? 'Issue';
      await route.fulfill({ contentType: 'text/html', body:
        '<div class="markdown-heading"><h2>Tasks</h2></div><ul><li><input type="checkbox" checked>Done</li></ul><p>' + label + '</p><a href="Other">Other</a>' });
    });
    await page.goto(baseURL + (wiki ? '/wiki/Guide/_edit' : '/issues/42'));
    await page.locator('main').evaluate((main, wiki) => {
      document.head.insertAdjacentHTML('beforeend', '<meta name="octolytics-dimension-repository_id" content="123">' +
        '<meta name="hovercard-subject-tag" content="issue:456">');
      main.innerHTML = wiki ?
        '<form data-preview-url="/acme/workspace/wiki/_preview"><input class="js-data-preview-url-csrf" value="wiki-preview-token">' +
        '<select id="wiki_format"><option>markdown</option><option>asciidoc</option></select><div><textarea id="gollum-editor-body"></textarea></div></form>' :
        '<div><textarea name="issue[body]"></textarea></div>';
    }, wiki);
    await page.locator('textarea').fill('## Tasks\n- [x] Done');
    const pane = page.getByRole('region', { name: 'Markdown preview' });
    await expect(pane.getByRole('checkbox')).toBeChecked();
    await expect(pane.locator('h2')).toHaveAttribute('data-refine-line', '0');
    await expect(pane.locator('p')).toHaveText(wiki ? 'markdown' : 'Issue');
    await expect(pane.getByRole('link')).toHaveAttribute('href', baseURL + (wiki ? '/wiki/Other' : '/issues/Other'));
    await expect(pane.getByRole('link')).toHaveAttribute('target', '_blank');
    if (wiki) {
      await page.locator('#wiki_format').selectOption('asciidoc');
      await expect(pane.locator('p')).toHaveText('asciidoc');
    }
    await page.unroute(endpoint);
    await page.route(endpoint, route => route.fulfill({ status: 503 }));
    await page.locator('textarea').fill('**Updated draft**');
    await expect(pane.locator('strong')).toHaveText('Updated draft');
    await expect(pane).toHaveAttribute('data-local-preview', /Local preview/);
  });
}

test('server-only markup preserves scroll anchors on subsequent blocks', async ({ page, context }) => {
  const options = await optionsFor(await popupFor(context));
  await options.getByLabel('Side-by-side Markdown preview').check();
  await page.route('https://github.com/preview', route => route.fulfill({
    contentType: 'text/html', body: '<details><summary>Details</summary></details><h2>Next</h2><p>Final</p>',
  }));
  await page.goto(baseURL + '/issues/42');
  await page.locator('main').evaluate(main => {
    main.innerHTML = '<div><textarea name="issue[body]"></textarea></div>';
    main.querySelector('textarea')!.value = '<details><summary>Details</summary></details>\n\n## Next\n\nFinal';
  });
  const pane = page.getByRole('region', { name: 'Markdown preview' });
  await expect(pane.locator('details')).toHaveCount(1);
  await expect(pane.locator('h2')).toHaveAttribute('data-refine-line', '2');
  await expect(pane.locator('p')).toHaveAttribute('data-refine-line', '4');
});

test('scroll aligns Markdown sections in both directions despite collapsed blank lines', async ({ page, context }) => {
  const options = await optionsFor(await popupFor(context));
  await options.getByLabel('Side-by-side Markdown preview').check();
  await page.goto(baseURL + '/wiki/Guide/_edit');
  await page.locator('main').evaluate(main => {
    main.innerHTML = '<div><textarea id="gollum-editor-body" style="height:140px;padding:0;line-height:20px"></textarea></div>';
    main.querySelector('textarea')!.value = '# Start' + '\n'.repeat(80) + '# Target\n\n' +
      Array.from({ length: 50 }, (_, i) => '## Section ' + i).join('\n\n');
  });
  const editor = page.locator('textarea');
  const pane = page.getByRole('region', { name: 'Markdown preview' });
  const heading = pane.getByRole('heading', { name: 'Target', exact: true });
  await expect(heading).toHaveCount(1);
  await editor.evaluate(el => { el.scrollTop = 80 * 20; });
  await expect.poll(() => heading.evaluate(el => {
    const pane = el.parentElement!;
    return Math.abs(el.getBoundingClientRect().top - pane.getBoundingClientRect().top - pane.clientTop);
  })).toBeLessThan(2);
  await pane.getByRole('heading', { name: 'Section 12', exact: true }).evaluate(el => {
    const pane = el.parentElement!;
    pane.scrollTop += el.getBoundingClientRect().top - pane.getBoundingClientRect().top - pane.clientTop;
  });
  await expect.poll(() => editor.evaluate(el => Math.abs(el.scrollTop - (82 + 12 * 2) * 20))).toBeLessThan(2);
  await editor.fill('Wrapped source text '.repeat(150) + '\n\n# After wrap\n\n' + 'More text\n\n'.repeat(40));
  const afterWrap = pane.getByRole('heading', { name: 'After wrap' });
  await expect(afterWrap).toHaveCount(1);
  for (const width of [1200, 760]) {
    await page.setViewportSize({ width, height: 800 });
    // Measure the wrapped prefix with a native textarea independent of the extension.
    await editor.evaluate(el => {
      const probe = el.cloneNode(false) as HTMLTextAreaElement;
      probe.removeAttribute('id');
      probe.style.cssText += ';position:fixed;visibility:hidden;border:0;height:0;overflow:hidden;box-sizing:content-box';
      probe.style.width = el.clientWidth + 'px';
      probe.value = el.value.split('# After wrap')[0] + 'X';
      document.body.append(probe);
      el.scrollTop = probe.scrollHeight - 20;
      probe.remove();
    });
    await expect.poll(() => afterWrap.evaluate(el => {
      const pane = el.parentElement!;
      return Math.abs(el.getBoundingClientRect().top - pane.getBoundingClientRect().top - pane.clientTop);
    })).toBeLessThan(2);
  }
});

test('editor width follows page overrides and shared settings with and without split preview', async ({ page, context }) => {
  const options = await optionsFor(await popupFor(context));
  const split = options.getByLabel('Side-by-side Markdown preview');
  await options.evaluate(() => chrome.storage.local.set({
    'refine:width': 'wide', 'refine:width:issues': 960, 'refine:width:wiki': 1024,
  }));
  await page.setViewportSize({ width: 1920, height: 900 });
  for (const [path, field, limit] of [
    ['/issues/42', 'name="issue[body]"', 960],
    ['/issues/new', 'name="issue[body]"', 960],
    ['/wiki/Guide/_edit', 'id="gollum-editor-body"', 1024],
    ['/wiki/_new', 'id="gollum-editor-body"', 1024],
    ['/edit/main/README.md', 'id="code-editor"', 1600],
  ] as const) {
    await split.uncheck();
    await page.goto(baseURL + path);
    await page.locator('main').evaluate((main, attribute) => {
      main.style.padding = '0';
      main.innerHTML = '<div data-width="large" style="max-width:800px;margin:auto"><form>' +
        '<textarea style="width:100%;box-sizing:border-box" ' + attribute + '>draft</textarea></form></div>';
    }, field);
    const editor = page.locator('textarea');
    await expect(editor).toHaveCSS('width', limit + 'px');
    await split.check();
    await expect(editor).toHaveCSS('width', limit / 2 + 'px');
    await expect(page.getByRole('region', { name: 'Markdown preview' })).toBeVisible();
  }
  await options.evaluate(() => chrome.storage.local.set({ 'refine:width': 'full' }));
  await expect(page.locator('form')).toHaveCSS('width', '1920px');
  await options.evaluate(() => chrome.storage.local.set({ 'refine:width': 'default' }));
  await expect(page.locator('form')).toHaveCSS('width', '800px');
  await expect(page.locator('textarea')).toHaveValue('draft');
});

test('Reset restores fresh-install settings on open pages and after reopening the popup', async ({ page, context }) => {
  await open(page);
  const popup = await popupFor(context);
  const options = await optionsFor(popup);
  await popup.evaluate(() => chrome.storage.local.set({
    'refine:width': 'wide', 'refine:wide': true, 'refine:focus': true, 'refine:fontSize': 20,
  }));
  await expect(page.locator('.markdown-body')).toHaveCSS('font-size', '20px');
  await popup.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(popup.getByRole('radio', { name: 'Default' })).toBeChecked();
  await expect(page.locator('.markdown-body')).toHaveCSS('font-size', '14px');
  await expect(page.locator('.container-xl')).toHaveCSS('max-width', '1100px');
  await expect(page.locator('.discussion-sidebar')).toBeVisible();
  await popup.reload();
  await expect(popup.getByRole('radio', { name: 'Default' })).toBeChecked();
  await expect(popup.getByLabel('Focus', { exact: true })).not.toBeChecked();
  await expect(options.getByLabel('Font size')).toHaveValue('default');
});

test('page widths inherit, override, persist and reset independently', async ({ page, context }) => {
  await open(page, '/issues');
  const pr = await context.newPage(); await open(pr, '/pulls');
  const wiki = await context.newPage(); await open(wiki, '/wiki');
  const popup = await popupFor(context);
  const optionsOpened = context.waitForEvent('page');
  await popup.getByRole('link', { name: 'Page options' }).click();
  const options = await optionsOpened;
  const shared = options.getByRole('slider', { name: 'Shared page width' });
  const pulls = options.getByLabel('Pull requests');
  const wikiWidth = options.getByLabel('Wiki', { exact: true });
  await shared.press('ArrowRight');
  await pulls.press('End');
  await wikiWidth.press('ArrowRight');
  await expect(page.locator('.container-xl')).toHaveCSS('max-width', '960px');
  await expect(pr.locator('.container-xl')).toHaveCSS('max-width', 'none');
  await expect(wiki.locator('.container-xl')).toHaveCSS('max-width', '1100px');
  await page.evaluate(() => history.pushState({}, '', '/acme/workspace/pull/7/files'));
  await expect(page.locator('.container-xl')).toHaveCSS('max-width', 'none');
  await options.reload();
  await expect(pulls).toHaveAttribute('aria-valuetext', 'Full width');
  await expect(wikiWidth).toHaveAttribute('aria-valuetext', 'Default');
  await options.locator('#app').screenshot({ path: 'artifacts/page-options.png' });
  await options.setViewportSize({ width: 320, height: 640 });
  expect(await options.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await pulls.press('Home');
  await expect(pr.locator('.container-xl')).toHaveCSS('max-width', '960px');
  await shared.press('End');
  await expect(pulls).toHaveAttribute('aria-valuetext', 'Use shared · Full width');
  await expect(pr.locator('.container-xl')).toHaveCSS('max-width', 'none');
  await expect(wiki.locator('.container-xl')).toHaveCSS('max-width', '1100px');
  const all = popup.getByRole('group', { name: 'Page width' });
  await expect(all.getByRole('radio', { checked: true })).toHaveCount(0);
  await all.getByRole('radio', { name: 'Full width' }).check();
  await expect(wikiWidth).toHaveValue('0');
  await expect(wiki.locator('.container-xl')).toHaveCSS('max-width', 'none');
  await popup.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(wikiWidth).toHaveValue('0');
  await expect(pr.locator('.container-xl')).toHaveCSS('max-width', '1100px');
});

test('Discussions and Wiki have independent widths and can return to the shared setting', async ({ page, context }) => {
  const popup = await popupFor(context);
  const options = await context.newPage();
  await options.goto(new URL('options.html', popup.url()).href);
  const wiki = await context.newPage();
  await open(wiki, '/wiki/Layout-example');
  await popup.getByRole('radio', { name: 'Wide' }).check();
  const discussions = options.getByRole('slider', { name: 'Discussions' });
  await discussions.press('End');
  for (const path of ['/discussions', '/discussions/categories/ideas', '/discussions/42']) {
    await open(page, path);
    await expect(page.locator('.container-xl')).toHaveCSS('max-width', 'none');
    await expect(wiki.locator('.container-xl')).toHaveCSS('max-width', '1600px');
  }
  await options.reload();
  await expect(discussions).toHaveAttribute('aria-valuetext', 'Full width');
  await discussions.press('Home');
  await expect(page.locator('.container-xl')).toHaveCSS('max-width', '1600px');
  await page.goto(baseURL + '/discussions/new');
  await expect(page.locator('html')).not.toHaveClass(/refine-active/);
});

test('a delayed popup refresh cannot overwrite a more recent width', async ({ context }) => {
  const popup = await popupFor(context);
  await popup.evaluate(() => {
    const query = chrome.tabs.query.bind(chrome.tabs);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    document.addEventListener('release-query', release, { once: true });
    let first = true;
    Object.defineProperty(chrome.tabs, 'query', { value: async (info: chrome.tabs.QueryInfo) => {
      if (first) {
        first = false;
        document.body.dataset.queryPending = 'true';
        await gate;
      }
      return query(info);
    } });
  });
  await popup.evaluate(() => chrome.storage.local.set({ 'refine:width': 'wide' }));
  await expect(popup.locator('body')).toHaveAttribute('data-query-pending', 'true');
  await popup.evaluate(() => chrome.storage.local.set({ 'refine:width': 'full' }));
  const shared = popup.getByRole('group', { name: 'Page width' });
  await expect(shared.getByRole('radio', { name: 'Full width' })).toBeChecked();
  await popup.evaluate(() => document.dispatchEvent(new Event('release-query')));
  // A later API round trip lets the released query finish before inspecting the UI.
  await popup.evaluate(() => chrome.tabs.query({ active: true }));
  await expect(shared.getByRole('radio', { name: 'Full width' })).toBeChecked();
});

test('a successful retry clears a save error in the popup', async ({ context }) => {
  const popup = await popupFor(context);
  await popup.evaluate(() => {
    const local = chrome.storage.local;
    const original = local.set;
    Object.defineProperty(local, 'set', { configurable: true, value: async () => {
      Object.defineProperty(local, 'set', { configurable: true, value: original });
      throw new Error('Temporary write failure');
    } });
  });
  const shared = popup.getByRole('group', { name: 'Page width' });
  await shared.getByRole('radio', { name: 'Wide' }).click();
  await expect(popup.getByRole('status')).toContainText('Could not save');
  await expect(shared.getByRole('radio', { name: 'Default' })).toBeChecked();
  await shared.getByRole('radio', { name: 'Wide' }).click();
  await expect.poll(() => popup.evaluate(async () => (await chrome.storage.local.get('refine:width'))['refine:width'])).toBe('wide');
  await expect(popup.getByRole('status')).toBeHidden();
});

test('width modes on an ultrawide screen preserve the legacy preference', async ({ page, context }) => {
  await page.setViewportSize({ width: 2560, height: 1000 });
  await open(page);
  const popup = await popupFor(context);
  const options = await optionsFor(popup);
  const width = popup.getByRole('group', { name: 'Page width' });
  const container = page.locator('.container-xl');
  for (const legacy of [false, true]) {
    await popup.evaluate(value => chrome.storage.local.set({ 'refine:wide': value }), legacy);
    await expect(width.getByRole('radio', { checked: true })).toHaveValue(legacy ? 'full' : 'default');
  }
  for (const [mode, pixels] of [['default', 1100], ['wide', 1600], ['full', 2504]] as const) {
    await width.locator('input[value=' + mode + ']').check();
    await expect(container).toHaveCSS('width', pixels + 'px');
  }
  await options.getByLabel('Font size').selectOption('13');
  await options.reload();
  await expect(options.getByLabel('Font size')).toHaveValue('13');
  await expect(page.locator('.markdown-body')).toHaveCSS('font-size', '13px');
});

test('client-side navigation removes styling from unsupported pages and editors', async ({ page, context }) => {
  await open(page);
  const popup = await popupFor(context);
  const options = await optionsFor(popup);
  await options.getByLabel('Font size').selectOption('16');
  for (const path of ['/branches', '/issues/new', '/wiki/_new', '/wiki/Guide/_edit']) {
    await page.evaluate(path => { history.pushState({}, '', '/acme/workspace' + path); document.dispatchEvent(new Event('turbo:load')); }, path);
    await expect(page.locator('html')).not.toHaveClass(/refine-active|refine-wide|refine-focus/);
    await expect(page.locator('.container-xl')).toHaveCSS('max-width', '1100px');
    await expect(page.locator('.markdown-body')).toHaveCSS('font-size', '14px');
  }
  await page.evaluate(() => { history.pushState({}, '', '/acme/workspace/pull/7'); document.dispatchEvent(new Event('turbo:load')); });
  await expect(page.locator('.markdown-body')).toHaveCSS('font-size', '16px');
  await page.evaluate(() => { history.pushState({}, '', '/acme/workspace/wiki/Guide'); document.querySelector('main')!.append(document.createElement('div')); });
  await expect(page.locator('html')).toHaveClass(/refine-active/);
});

test('README width and font follow settings inside the signed-in repository pane', async ({ page, context }) => {
  await page.route(baseURL, route => route.fulfill({ contentType: 'text/html', body: `
    <style>[data-width="large"] { max-width: 800px } .markdown-body { font-size: 14px }</style>
    <main id="ui-service-main-content"><div id="repos-split-pane-content">
      <div data-width="large"><article class="markdown-body"><p>README</p></article></div>
    </div></main>` }));
  await page.goto(baseURL);
  const article = page.locator('article');
  const popup = await popupFor(context);
  const options = await optionsFor(popup);
  await options.getByLabel('Font size').selectOption('20');
  await popup.getByRole('radio', { name: 'Full width' }).check();
  await expect(article.locator('p')).toHaveCSS('font-size', '20px');
  await expect.poll(() => article.evaluate(el => el.clientWidth)).toBeGreaterThan(800);
  await popup.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(article.locator('p')).toHaveCSS('font-size', '14px');
  await expect(article).toHaveCSS('width', '800px');
});

test('a centered wide README clears the full repository sidebar as its sections resize', async ({ page, context }) => {
  await page.route(baseURL, route => route.fulfill({ contentType: 'text/html', body: `
    <style>
      .container-xl { display: flex; max-width: 1100px; margin: auto; gap: 16px }
      [data-component="SplitPageLayout.Content"] { flex: 1; min-width: 0 }
      #folders-and-files { height: 80px }
      aside { width: 240px }
      aside section { padding: 20px }
    </style>
    <main id="repos-split-pane-content"><div data-component="SplitPageLayout" class="container-xl">
      <div data-component="SplitPageLayout.Content"><div id="folders-and-files">Files</div>
        <div><div><div class="js-snippet-clipboard-copy-unpositioned"><article class="markdown-body">README</article></div></div></div>
      </div>
      <aside><div hidden data-component="PageLayout.HorizontalDivider"></div>
        <div data-component="SplitPageLayout.Pane"><section>About</section><section>Releases</section><section>Packages</section><section>Contributors</section></div>
      </aside>
    </div></main>` }));
  await page.goto(baseURL);
  const popup = await popupFor(context);
  await popup.getByRole('radio', { name: 'Full width' }).check();
  const panel = page.locator('.refine-overview-readme');
  const clearance = () => panel.evaluate(el => el.getBoundingClientRect().top -
    document.querySelector('aside section:last-child')!.getBoundingClientRect().bottom);
  await expect.poll(clearance).toBe(16);
  await page.locator('aside section').first().evaluate(el => { el.style.height = '320px'; });
  await expect.poll(clearance).toBe(16);
  await page.locator('aside section').first().evaluate(el => { el.style.height = ''; });
  await expect.poll(clearance).toBe(16);
  const box = await panel.boundingBox();
  expect(box!.x + box!.width / 2).toBeCloseTo(page.viewportSize()!.width / 2, 0);
  await popup.getByRole('radio', { name: 'Default' }).check();
  await expect(panel).toHaveCount(0);
});

test('documents and diffs follow options and restore preferences across OFF and ON', async ({ page, context }) => {
  const popup = await popupFor(context);
  const options = await context.newPage();
  await options.goto(new URL('options.html', popup.url()).href);
  await options.getByLabel('Pull requests').press('ArrowRight');
  await options.getByLabel('Pull requests').press('ArrowRight');
  await options.getByLabel('README & Markdown').press('End');
  await options.getByLabel('Font size').selectOption('19');
  for (const path of ['', '/tree/main', '/tree/main/docs', '/blob/main/docs/Guide.MD']) {
    await open(page, path);
    await expect(page.locator('article')).toHaveCSS('font-size', '19px');
    await expect(page.locator('article')).toHaveCSS('max-width', 'none');
    await expect(page.locator('.container-xl')).toHaveCSS('max-width', '1100px');
  }
  const diff = await context.newPage();
  await open(diff, '/compare/v1...v2');
  await expect(diff.locator('.container-xl')).toHaveCSS('max-width', '960px');
  await diff.evaluate(() => history.pushState({}, '', '/acme/workspace/commit/012abcd'));
  await options.getByLabel('Compare & commits').press('End');
  await expect(diff.locator('.container-xl')).toHaveCSS('max-width', 'none');
  await popup.getByLabel('Enable extension').uncheck();
  await expect(page.locator('article')).toHaveCSS('font-size', '14px');
  await expect(diff.locator('.container-xl')).toHaveCSS('max-width', '1100px');
  await popup.reload();
  await expect(popup.getByLabel('Enable extension')).not.toBeChecked();
  await popup.getByLabel('Enable extension').check();
  await expect(diff.locator('.container-xl')).toHaveCSS('max-width', 'none');
  await expect(page.locator('article')).toHaveCSS('font-size', '19px');
  await page.goto(baseURL + '/blob/main/app.ts');
  await expect(page.locator('html')).not.toHaveClass(/refine-active/);
});

test('history-only navigation updates reading styles for wiki articles and editors', async ({ page, context }) => {
  await open(page);
  const popup = await popupFor(context);
  const options = await optionsFor(popup);
  await options.getByLabel('Font size').selectOption('16');
  const body = page.locator('.markdown-body');
  await page.evaluate(() => history.pushState({}, '', 'https://github.com/acme/workspace/wiki/_new'));
  await expect(body).toHaveCSS('font-size', '14px');
  for (const title of ['new', 'edit']) {
    await page.evaluate(title => history.replaceState({}, '', './' + title), title);
    await expect(body).toHaveCSS('font-size', '16px');
    await page.evaluate(title => history.replaceState({}, '', './' + title + '/_edit'), title);
    await expect(body).toHaveCSS('font-size', '14px');
    await page.evaluate(() => history.replaceState({}, '', '../_new'));
  }
  await page.goBack();
  await expect(body).toHaveCSS('font-size', '16px');
});

test('enterprise access is scoped to one host, survives reset and can be removed', async ({ page, context }) => {
  const host = 'git.corp.test';
  const issueURL = 'https://' + host + '/acme/workspace/issues/42';
  await context.route('https://*.corp.test/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.goto(issueURL);
  const other = await context.newPage();
  await other.goto(issueURL.replace(host, 'other.corp.test'));
  const popup = await popupFor(context);
  const options = await optionsFor(popup);
  // The test opens popup.html as a tab. Supply the URL that activeTab provides to a toolbar popup.
  await popup.addInitScript(url => {
    Object.defineProperty(chrome.tabs, 'query', { value: async () => [{ url }] });
  }, issueURL);
  await popup.reload();
  const enable = popup.getByRole('button', { name: 'Enable on this site' });
  await expect(popup.getByText(host, { exact: true })).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/refine-active/);
  await popup.evaluate(() => {
    Object.defineProperty(chrome.permissions, 'request', { value: async () => false, configurable: true });
  });
  await enable.click();
  await expect(popup.getByRole('status')).toHaveText('Site access was not granted.');
  await expect(page.locator('html')).not.toHaveClass(/refine-active/);
  await popup.reload();
  const observer = await context.newPage();
  await observer.addInitScript(url => {
    Object.defineProperty(chrome.tabs, 'query', { value: async () => [{ url }] });
  }, issueURL);
  await observer.goto(popup.url());
  await expect(observer.getByRole('button', { name: 'Enable on this site' })).toBeVisible();
  // Headless Edge has no clickable native permission prompt. Grant the requested
  // host through its extension manager in this disposable profile.
  const manager = await context.newPage();
  await manager.goto('edge://extensions');
  const extensionId = new URL(popup.url()).hostname;
  await manager.evaluate(async ({ id, pattern }) => {
    const managerApi = chrome as typeof chrome & {
      developerPrivate: { addHostPermission(id: string, pattern: string): Promise<void> };
    };
    await managerApi.developerPrivate.addHostPermission(id, pattern);
  }, { id: extensionId, pattern: 'https://' + host + '/*' });
  await enable.click();
  const disable = popup.getByRole('button', { name: 'Disable on this site' });
  await expect(disable).toBeVisible();
  await expect(observer.getByRole('button', { name: 'Disable on this site' })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/refine-active/);
  await expect(other.locator('html')).not.toHaveClass(/refine-active/);
  await options.getByLabel('Font size').selectOption('19');
  await expect(page.locator('.markdown-body')).toHaveCSS('font-size', '19px');
  await page.reload();
  await expect(page.locator('.markdown-body')).toHaveCSS('font-size', '19px');
  const enterpriseEndpoint = 'https://' + host + '/preview';
  await page.route(enterpriseEndpoint, route => route.fulfill({ contentType: 'text/html', body: '<p>Enterprise preview</p>' }));
  await options.getByLabel('Side-by-side Markdown preview').check();
  await page.locator('main').evaluate(main => {
    main.innerHTML = '<div><textarea name="issue[body]">Private draft</textarea></div>';
  });
  const preview = page.getByRole('region', { name: 'Markdown preview' });
  await expect(preview).toHaveText('Enterprise preview');
  await page.unroute(enterpriseEndpoint);
  await page.route(enterpriseEndpoint, route => route.fulfill({ json: { error: 'Sign in required' } }));
  await page.locator('textarea').fill('**Offline draft**');
  await expect(preview).toHaveAttribute('data-local-preview', /Local preview/);
  await expect(preview.locator('strong')).toHaveText('Offline draft');
  await page.locator('textarea').evaluate(el => el.parentElement!.dataset.previewUrl = 'https://github.com/preview');
  await page.locator('textarea').fill('Unrecognized endpoint');
  await expect(preview).toHaveText('Unrecognized endpoint');
  await expect(preview).toHaveAttribute('data-local-preview', /Local preview/);
  await page.goto(issueURL.replace('/issues/42', '/issues/new'));
  await expect(page.locator('html')).not.toHaveClass(/refine-active/);
  await page.goto(issueURL.replace('/issues/42', '/wiki/Guide'));
  await expect(page.locator('.markdown-body')).toHaveCSS('font-size', '19px');
  await popup.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('.markdown-body')).toHaveCSS('font-size', '14px');
  await disable.click();
  await expect(enable).toBeVisible();
  await expect(observer.getByRole('button', { name: 'Enable on this site' })).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/refine-active/);
  expect(await popup.evaluate(() => chrome.permissions.getAll())).not.toMatchObject({
    origins: expect.arrayContaining(['https://git.corp.test/*']),
  });
  await page.reload();
  await expect(page.locator('.markdown-body')).toHaveCSS('font-size', '14px');
});

test('popup stays light with a dark system theme and the manifest packages only local resources', async ({ page, context }) => {
  const popup = await popupFor(context); await popup.emulateMedia({ colorScheme: 'dark' });
  await expect(popup.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(popup.locator('body')).toHaveCSS('color', 'rgb(31, 35, 40)');
  await popup.setViewportSize({ width: 290, height: 360 }); await popup.screenshot({ fullPage: true, path: 'artifacts/popup-simple-dark.png' });
  const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
  expect(manifest.manifest_version).toBe(3); expect(manifest.permissions).toEqual(['storage', 'activeTab', 'scripting']);
  expect(manifest.optional_host_permissions).toEqual(['https://*/*']);
  expect(manifest.content_scripts[0].matches).toEqual(['https://github.com/*']);
  for (const file of [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons), ...manifest.content_scripts[0].js, ...manifest.content_scripts[0].css]) {
    expect((await readFile(join(extension, file as string))).length).toBeGreaterThan(0);
  }
  await open(page);
});
