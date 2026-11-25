import { build } from 'esbuild';
import { mkdir, copyFile, cp } from 'node:fs/promises';

await mkdir('dist/icons', { recursive: true });
await build({
  entryPoints: ['src/content.ts', 'src/popup.ts', 'src/background.ts'], outdir: 'dist',
  bundle: true, format: 'iife', target: ['chrome120', 'edge120'],
  loader: { '.css': 'text' }, legalComments: 'none',
});
await Promise.all([
  cp('assets/icons', 'dist/icons', { recursive: true }),
  copyFile('manifest.json', 'dist/manifest.json'),
  copyFile('src/content.css', 'dist/content.css'),
  copyFile('src/popup.html', 'dist/popup.html'),
  copyFile('src/options.html', 'dist/options.html'),
  copyFile('docs/INSTALL.ko.txt', 'dist/INSTALL.txt'),
]);

console.log('Built dist/ — load this folder in Chrome or Edge.');
