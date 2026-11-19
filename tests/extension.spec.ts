import { test as base, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const extension = resolve('dist');
const baseURL = 'https://github.com/acme/workspace';
const fixture = `<!doctype html><html lang="en"><head><title>GitHub reading settings</title><style>
body{margin:0;font:14px/1.6 system-ui}main{padding:28px}.container-xl{max-width:1100px;margin:auto}.Layout{display:grid;grid-template-columns:minmax(0,1fr) 190px;gap:28px}.markdown-body{font-size:14px;padding:20px;border:1px solid #ddd}pre{font-size:13px}
</style></head><body><main><div class="container-xl"><h1>GitHub page</h1><div class="Layout"><section><article class="markdown-body"><h2>Overview</h2><p>Read issues, documentation, and code reviews comfortably.</p></article><pre>Code diff stays at its original size.</pre></section><aside class="discussion-sidebar Layout-sidebar">Assignees and labels</aside></div></div></main></body></html>`;

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
  await expect(page.getByLabel('Page width')).toBeVisible(); return page;
}

test('popup exposes only the three reading settings and no page panel is injected', async ({ page, context }) => {
  await open(page);
  const popup = await popupFor(context);
  await expect(popup.getByRole('checkbox')).toHaveCount(1);
  await expect(popup.getByLabel('Page width')).toHaveValue('default');
  await expect(popup.getByLabel('Focus mode')).not.toBeChecked();
  await expect(popup.getByLabel('Page width').locator('option')).toHaveText(['Default', 'Wide', 'Full width']);
  await expect(popup.getByLabel('Font size')).toHaveValue('16');
  await expect(popup.getByLabel('Font size').locator('option')).toHaveText(
    Array.from({ length: 13 }, (_, index) => (index + 8) + ' px'),
  );
  await expect(popup.getByRole('heading')).toHaveCount(0);
  await expect(popup.getByRole('tab')).toHaveCount(0);
  await expect(popup.getByRole('searchbox')).toHaveCount(0);
  await expect(popup.getByText(/페이지 저장|링크 복사|Alt \+ Shift/)).toHaveCount(0);
  await expect(page.locator('#refine-github-root')).toHaveCount(0);
  await expect(page.locator('body')).toHaveCSS('padding-right', '0px');
  await popup.setViewportSize({ width: 220, height: 180 });
  await popup.screenshot({ fullPage: true, path: 'artifacts/popup-simple.png' });
});

test('preferences change actual page layout, synchronize across Issue Wiki PR, and persist', async ({ page, context }) => {
  await open(page);
  const wiki = await context.newPage(); await open(wiki, '/wiki/Guide');
  const pr = await context.newPage(); await open(pr, '/pull/7/files');
  const popup = await popupFor(context);
  await popup.getByLabel('Page width').selectOption('default');

  await popup.getByLabel('Focus mode').check();
  await popup.getByLabel('Font size').focus();
  await popup.getByLabel('Font size').selectOption('20');
  await expect(popup.getByLabel('Font size')).toBeFocused();
  for (const tab of [page, wiki, pr]) {
    await expect(tab.locator('.container-xl')).toHaveCSS('max-width', '1100px');
    await expect(tab.locator('.discussion-sidebar')).toBeHidden();
    await expect(tab.locator('.markdown-body')).toHaveCSS('font-size', '20px');
    await expect(tab.locator('pre')).toHaveCSS('font-size', '13px');
  }
  await page.reload(); await expect(page.locator('.markdown-body')).toHaveCSS('font-size', '20px');
  await popup.reload(); await expect(popup.getByLabel('Font size')).toHaveValue('20');
  await popup.getByLabel('Page width').selectOption('full'); await popup.getByLabel('Focus mode').uncheck();
  await popup.getByLabel('Font size').selectOption('8');
  await expect(page.locator('.container-xl')).toHaveCSS('max-width', 'none');
  await expect(page.locator('.discussion-sidebar')).toBeVisible();
  await expect(wiki.locator('.markdown-body')).toHaveCSS('font-size', '8px');
  await page.evaluate(() => { const article = document.createElement('article'); article.className = 'markdown-body'; article.textContent = 'Dynamically loaded comment'; document.querySelector('section')!.append(article); });
  await expect(page.locator('.markdown-body').last()).toHaveCSS('font-size', '8px');
});

test('Reset restores fresh-install settings on open pages and after reopening the popup', async ({ page, context }) => {
  await open(page);
  const popup = await popupFor(context);
  await popup.evaluate(() => chrome.storage.local.set({
    'refine:width': 'wide', 'refine:wide': true, 'refine:focus': true, 'refine:fontSize': 20,
  }));
  await expect(page.locator('.markdown-body')).toHaveCSS('font-size', '20px');
  await popup.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(popup.getByLabel('Page width')).toHaveValue('default');
  await expect(page.locator('.markdown-body')).toHaveCSS('font-size', '16px');
  await expect(page.locator('.container-xl')).toHaveCSS('max-width', '1100px');
  await expect(page.locator('.discussion-sidebar')).toBeVisible();
  await popup.reload();
  await expect(popup.getByLabel('Page width')).toHaveValue('default');
  await expect(popup.getByLabel('Focus mode')).not.toBeChecked();
  await expect(popup.getByLabel('Font size')).toHaveValue('16');
});

test('width modes on an ultrawide screen preserve the legacy preference', async ({ page, context }) => {
  await page.setViewportSize({ width: 2560, height: 1000 });
  await open(page);
  const popup = await popupFor(context);
  const width = popup.getByLabel('Page width');
  const container = page.locator('.container-xl');
  for (const legacy of [false, true]) {
    await popup.evaluate(value => chrome.storage.local.set({ 'refine:wide': value }), legacy);
    await expect(width).toHaveValue(legacy ? 'full' : 'default');
  }
  for (const [mode, pixels] of [['default', 1100], ['wide', 1600], ['full', 2504]] as const) {
    await width.selectOption(mode);
    await expect(container).toHaveCSS('width', pixels + 'px');
  }
  await popup.getByLabel('Font size').selectOption('13');
  await popup.reload();
  await expect(popup.getByLabel('Font size')).toHaveValue('13');
  await expect(page.locator('.markdown-body')).toHaveCSS('font-size', '13px');
});

test('client-side navigation removes styling from unsupported pages and editors', async ({ page }) => {
  await open(page);
  for (const path of ['/tree/main', '/issues/new', '/wiki/_new', '/wiki/Guide/_edit']) {
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

test('enterprise access is scoped to one host, survives reset and can be removed', async ({ page, context }) => {
  const host = 'git.corp.test';
  const issueURL = 'https://' + host + '/acme/workspace/issues/42';
  await context.route('https://*.corp.test/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.goto(issueURL);
  const other = await context.newPage();
  await other.goto(issueURL.replace(host, 'other.corp.test'));
  const popup = await popupFor(context);
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
  await expect(page.locator('html')).toHaveClass(/refine-active/);
  await expect(other.locator('html')).not.toHaveClass(/refine-active/);
  await popup.getByLabel('Font size').selectOption('19');
  await expect(page.locator('.markdown-body')).toHaveCSS('font-size', '19px');
  await page.reload();
  await expect(page.locator('.markdown-body')).toHaveCSS('font-size', '19px');
  await page.goto(issueURL.replace('/issues/42', '/issues/new'));
  await expect(page.locator('html')).not.toHaveClass(/refine-active/);
  await page.goto(issueURL.replace('/issues/42', '/wiki/Guide'));
  await expect(page.locator('.markdown-body')).toHaveCSS('font-size', '19px');
  await popup.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('.markdown-body')).toHaveCSS('font-size', '16px');
  await disable.click();
  await expect(enable).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/refine-active/);
  expect(await popup.evaluate(() => chrome.permissions.getAll())).not.toMatchObject({
    origins: expect.arrayContaining(['https://git.corp.test/*']),
  });
  await page.reload();
  await expect(page.locator('.markdown-body')).toHaveCSS('font-size', '14px');
});

test('popup supports dark theme and the manifest packages only local resources', async ({ page, context }) => {
  const popup = await popupFor(context); await popup.emulateMedia({ colorScheme: 'dark' });
  await expect(popup.locator('body')).toHaveAttribute('data-theme', 'dark');
  await expect(popup.getByLabel('Font size')).toHaveCSS('color', 'rgb(240, 246, 252)');
  await popup.setViewportSize({ width: 220, height: 180 }); await popup.screenshot({ fullPage: true, path: 'artifacts/popup-simple-dark.png' });
  const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
  expect(manifest.manifest_version).toBe(3); expect(manifest.permissions).toEqual(['storage', 'activeTab', 'scripting']);
  expect(manifest.optional_host_permissions).toEqual(['https://*/*']);
  expect(manifest.content_scripts[0].matches).toEqual(['https://github.com/*']);
  for (const file of [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons), ...manifest.content_scripts[0].js, ...manifest.content_scripts[0].css]) {
    expect((await readFile(join(extension, file as string))).length).toBeGreaterThan(0);
  }
  await open(page);
});
