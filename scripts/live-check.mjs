// Opt-in smoke check against public GitHub pages. Never uses a personal profile.
import { chromium, expect } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'refine-github-live-'));
const extension = resolve('dist');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'msedge', headless: true, viewport: { width: 1600, height: 1000 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  ignoreDefaultArgs: ['--disable-extensions'],
});
try {
  await mkdir('artifacts', { recursive: true });
  const popup = await context.newPage(); await popup.goto('edge://extensions-internals');
  const json = JSON.parse(await popup.locator('body').innerText());
  const installed = (Array.isArray(json) ? json : json.extensions).find(entry => entry.name === 'Refine GitHub');
  await popup.goto(`chrome-extension://${installed.id}/popup.html`);
  const widthSelect = popup.getByLabel('Page width');
  const focus = popup.getByLabel('Focus mode');
  await popup.getByLabel('Font size').selectOption('18');
  const page = await context.newPage();
  const list = '[data-component="PageLayout.Content"] > [data-width="xlarge"]';
  const pages = [
    { path: 'issues/1', content: '#issue-body-viewer .markdown-body', sidebar: '[data-testid="issue-viewer-metadata-container"]', viewport: 1280 },
    { path: 'wiki', content: '#wiki-body .markdown-body', sidebar: '#wiki-content .Layout-sidebar' },
    { path: 'pull/65579', content: '.pull-discussion-timeline .comment-body', sidebar: '#pr-conversation-sidebar' },
    { path: 'issues', content: '[data-testid="issues-list-surface"]', viewport: 1024 },
    { path: 'pulls', content: list },
  ];
  for (const { path, content, sidebar, viewport = 1600 } of pages) {
    await page.setViewportSize({ width: viewport, height: 1000 });
    await widthSelect.selectOption('default');
    await focus.uncheck();
    await page.goto('https://github.com/microsoft/TypeScript/' + path, { waitUntil: 'load', timeout: 45000 });
    const body = page.locator(content).first();
    await expect(body).toBeVisible();
    const width = () => body.evaluate(node => node.getBoundingClientRect().width);
    const originalWidth = await width();
    await widthSelect.selectOption('full');
    await expect.poll(width).toBeGreaterThan(originalWidth + 10);
    const wideWidth = await width();
    if (sidebar) {
      const panel = page.locator(sidebar).first();
      await expect(panel).toBeVisible();
      await focus.check();
      await expect(panel).toBeHidden();
      await expect.poll(width).toBeGreaterThan(wideWidth + 10);
      await expect(body).toHaveCSS('font-size', '18px');
      await focus.uncheck();
      await expect(panel).toBeVisible();
    }
    await widthSelect.selectOption('default');
    await expect.poll(width).toBeCloseTo(originalWidth, 0);
    console.log(path, Math.round(originalWidth), '→', Math.round(wideWidth), 'px');
    if (path === 'issues/1') {
      await page.setViewportSize({ width: 2560, height: 1000 });
      const nativeWidth = await width();
      await widthSelect.selectOption('wide');
      await expect.poll(width).toBeGreaterThan(nativeWidth);
      const cappedWidth = await width();
      await widthSelect.selectOption('full');
      await expect.poll(width).toBeGreaterThan(cappedWidth);
      console.log('2560px issue body: default / wide / full', nativeWidth, cappedWidth, await width());
    }
    await page.screenshot({ path: 'artifacts/live-' + path.replace('/', '-') + '.png' });
  }
} finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
