import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { runBuild } from '../scripts/build.js';

test('runBuild generates valid PWA dist and standalone single-file HTML bundle', async () => {
  const result = await runBuild();

  // Verify bundled JS compiles cleanly with zero syntax or duplicate identifier errors
  assert.doesNotThrow(() => new vm.Script(result.bundledJs));

  const expectedFiles = [
    'index.html',
    'styles.css',
    'manifest.webmanifest',
    'sw.js',
    'robots.txt',
    'sitemap.xml',
    '.nojekyll',
    'src/app.js',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'zoneshift-standalone.html',
  ];

  for (const rel of expectedFiles) {
    const stat = await fs.stat(path.join(result.distDir, rel));
    assert.ok(stat.size >= 0, `Expected ${rel} in dist/`);
  }

  const indexHtml = await fs.readFile(path.join(result.distDir, 'index.html'), 'utf8');
  assert.match(indexHtml, /<link rel="canonical" href="https:\/\/[^"]+"/);
  assert.match(indexHtml, /property="og:title"/);
  assert.match(indexHtml, /"@type":\s*"WebApplication"/);
  assert.match(indexHtml, /"@type":\s*"FAQPage"/);
  assert.match(indexHtml, /href="\?from=America\/New_York&amp;to=Asia\/Kolkata"/);

  const standaloneHtml = await fs.readFile(result.standalonePath, 'utf8');
  assert.match(standaloneHtml, /<style>/);
  assert.match(standaloneHtml, /data:image\/svg\+xml;base64,/);
  assert.doesNotMatch(standaloneHtml, /src="\.\/src\/app\.js"/);
});
