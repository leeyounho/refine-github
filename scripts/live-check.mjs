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
  const widthGroup = popup.getByRole('group', { name: 'Page width' });
  const focus = popup.getByLabel('Focus');
  const page = await context.newPage();
  const options = await context.newPage();
  await options.goto(new URL('options.html', popup.url()).href);
  await options.getByLabel('Font size').selectOption('18');
  const list = '[data-component="PageLayout.Content"] > [data-width="xlarge"]';
  const pages = [
    { path: 'issues/1', content: '#issue-body-viewer .markdown-body', sidebar: '[data-testid="issue-viewer-metadata-container"]', viewport: 1280 },
    { path: 'wiki', content: '#wiki-body .markdown-body', sidebar: '#wiki-content .Layout-sidebar' },
    { repo: 'vercel/next.js', path: 'discussions', content: '.new-discussion-timeline.container-xl', type: 'Discussions' },
    { repo: 'vercel/next.js', path: 'discussions/10640', content: '.comment-body.markdown-body', type: 'Discussions' },
    { repo: 'leeyounho/refine-github', path: 'discussions/3', content: '#discussion_bucket .comment-body.markdown-body', type: 'Discussions', viewport: 1280 },
    { path: 'pull/65579', content: '.pull-discussion-timeline .comment-body', sidebar: '#pr-conversation-sidebar' },
    { path: 'issues', content: '[data-testid="issues-list-surface"]', viewport: 1024 },
    { path: 'pulls', content: list },
    { path: '', content: 'article.markdown-body', type: 'README & Markdown' },
    { path: 'tree/main', content: 'article.markdown-body', type: 'README & Markdown' },
    { path: 'blob/main/README.md', content: 'article.markdown-body', type: 'README & Markdown' },
    { path: 'compare/v5.8.2...v5.8.3', content: '.new-discussion-timeline', type: 'Compare & commits' },
    { path: 'commit/f6b94db', content: '#diff-content-parent', type: 'Compare & commits', viewport: 2400 },
  ];
  for (const { repo = 'microsoft/TypeScript', path, content, sidebar, type, viewport = 1600 } of pages) {
    const typeLabel = type ?? (path.startsWith('pull') ? 'Pull requests' : path === 'wiki' ? 'Wiki' : 'Issues');
    const typeWidth = options.getByLabel(typeLabel, { exact: true });
    await page.setViewportSize({ width: viewport, height: 1000 });
    await widthGroup.getByRole('radio', { name: 'Default' }).check();
    await focus.uncheck();
    await page.goto('https://github.com/' + repo + '/' + path, { waitUntil: 'load', timeout: 45000 });
    const body = page.locator(content).first();
    await expect(body).toBeVisible();
    const width = () => body.evaluate(node => node.getBoundingClientRect().width);
    await expect.poll(width).toBeGreaterThan(0);
    const originalWidth = await width();
    if (path === 'discussions/3') {
      await typeWidth.press('ArrowRight'); // GitHub default
      await typeWidth.press('ArrowRight'); // 960 px
      const container = page.locator('.new-discussion-timeline.container-xl');
      await expect(container).toHaveCSS('width', '960px');
      const first = await width();
      await typeWidth.press('ArrowRight');
      await expect.poll(width).toBe(first + 16);
      await expect(page.locator('#partial-discussion-sidebar')).toBeVisible();
    }
    if (type === 'README & Markdown') {
      await page.setViewportSize({ width: 2400, height: 1000 });
      const fileList = page.getByRole('table', { name: 'Folders and files' });
      const fileListWidth = () => fileList.evaluate(table => table.getBoundingClientRect().width);
      const originalFileListWidth = path.startsWith('blob/') ? undefined : await fileListWidth();
      const centerError = () => body.evaluate(article => {
        const pane = article.closest('#repos-split-pane-content, #repo-content-pjax-container').getBoundingClientRect();
        const rect = article.getBoundingClientRect();
        return Math.abs((rect.left + rect.right - pane.left - pane.right) / 2);
      });
      const panelWidth = () => body.evaluate(article => {
        const parent = article.parentElement.parentElement;
        return (parent.matches('section') ? parent.parentElement : parent).getBoundingClientRect().width;
      });
      const shared = options.getByLabel('Shared page width');
      await shared.press('ArrowRight');
      await expect.poll(width).toBe(960);
      if (originalFileListWidth !== undefined) await expect.poll(centerError).toBeLessThan(1);
      if (originalFileListWidth !== undefined) await expect.poll(fileListWidth).toBe(originalFileListWidth);
      const firstPanelWidth = await panelWidth();
      await shared.press('ArrowRight');
      await expect.poll(width).toBe(976);
      await expect.poll(panelWidth).toBe(firstPanelWidth + 16);
      await shared.press('Home');
      await typeWidth.press('End');
      await expect.poll(width).toBeGreaterThan(1440);
      if (originalFileListWidth !== undefined) {
        await expect.poll(centerError).toBeLessThan(1);
        await expect.poll(fileListWidth).toBe(originalFileListWidth);
        await body.scrollIntoViewIfNeeded();
        await expect.poll(() => body.evaluate(article => {
          const rect = article.getBoundingClientRect();
          const y = Math.min(innerHeight - 16, Math.max(100, rect.top + 24));
          return article.contains(document.elementFromPoint(rect.left + 8, y));
        })).toBe(true);
        console.log(path || 'repository', 'file list', originalFileListWidth, 'px; README', await width(), 'px');
      }
      await typeWidth.press('Home');
      await page.setViewportSize({ width: viewport, height: 1000 });
      await expect.poll(width).toBeCloseTo(originalWidth, 0);
    }
    const capped = path.startsWith('commit/');
    if (capped) {
      await typeWidth.press('Home');
      // From the inherited position, advance past Default to 960 px, then to Wide.
      for (let step = 0; step < 2 + (1600 - 960) / 16; step++) await typeWidth.press('ArrowRight');
      await expect(typeWidth).toHaveAttribute('aria-valuetext', '1600 px');
    } else await typeWidth.press('End');
    if (capped) await expect.poll(width).toBe(1600);
    else await expect.poll(width).toBeGreaterThan(originalWidth + 10);
    if (type === 'README & Markdown') await expect(body).toHaveCSS('font-size', '18px');
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
    await typeWidth.press('Home');
    await expect.poll(width).toBeCloseTo(originalWidth, 0);
    console.log(path, Math.round(originalWidth), '→', Math.round(wideWidth), 'px');
    if (path === 'issues/1') {
      await page.setViewportSize({ width: 2560, height: 1000 });
      const nativeWidth = await width();
      await widthGroup.getByRole('radio', { name: 'Wide' }).check();
      await expect.poll(width).toBeGreaterThan(nativeWidth);
      const cappedWidth = await width();
      await widthGroup.getByRole('radio', { name: 'Full width' }).check();
      await expect.poll(width).toBeGreaterThan(cappedWidth);
      console.log('2560px issue body: default / wide / full', nativeWidth, cappedWidth, await width());
    }
    await page.screenshot({ path: 'artifacts/live-' + (path || 'readme').replaceAll('/', '-') + '.png' });
  }
} finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
