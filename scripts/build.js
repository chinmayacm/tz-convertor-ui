import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const DEFAULT_SITE_URL = 'https://chinmayacm.github.io/tz-convertor-ui/';

const STATIC_FILES = [
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'sw.js',
  'robots.txt',
  'sitemap.xml',
  'src/tz-data.js',
  'src/tz-engine.js',
  'src/quick-parse.js',
  'src/app.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

const MODULE_ORDER = [
  'src/tz-data.js',
  'src/tz-engine.js',
  'src/quick-parse.js',
  'src/app.js',
];

function stripModuleSyntax(code) {
  return code
    .replace(/^\s*import\s+[\s\S]*?from\s+['"]\.\/[^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+(?=(?:async\s+)?function\b|const\b|let\b)/gm, '');
}

async function buildStandaloneHtml() {
  const [htmlRaw, cssRaw, svgRaw, ...moduleSources] = await Promise.all([
    fs.readFile(path.join(ROOT, 'index.html'), 'utf8'),
    fs.readFile(path.join(ROOT, 'styles.css'), 'utf8'),
    fs.readFile(path.join(ROOT, 'icons/icon.svg'), 'utf8'),
    ...MODULE_ORDER.map((rel) => fs.readFile(path.join(ROOT, rel), 'utf8')),
  ]);

  const svgDataUri = `data:image/svg+xml;base64,${Buffer.from(svgRaw, 'utf8').toString('base64')}`;

  const bundledJs = [
    '(() => {',
    "'use strict';",
    ...moduleSources.map((src, idx) => `// --- ${MODULE_ORDER[idx]} ---\n${stripModuleSyntax(src).trim()}`),
    '})();',
  ]
    .join('\n\n')
    .replace(/<\/script>/gi, '<\\/script>');

  let standalone = htmlRaw
    // Remove external manifest & apple-touch-icon links for pure single-file portability
    .replace(/^\s*<link\s+rel="manifest"[^>]*>\s*\n?/m, '')
    .replace(/^\s*<link\s+rel="apple-touch-icon"[^>]*>\s*\n?/m, '')
    // Inline SVG data URI for favicon and header logo
    .replace(/href="\.\/icons\/icon\.svg"/g, `href="${svgDataUri}"`)
    .replace(/src="\.\/icons\/icon\.svg"/g, `src="${svgDataUri}"`)
    // Inline CSS & JS
    .replace(
      /<link\s+rel="stylesheet"\s+href="\.\/styles\.css"\s*\/?>/,
      () => `<style>\n${cssRaw}\n</style>`
    )
    .replace(
      /<script\s+type="module"\s+src="\.\/src\/app\.js"><\/script>/,
      () => `<script>\n${bundledJs}\n</script>`
    );

  return { standalone, bundledJs };
}

export async function runBuild() {
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });

  // Copy PWA web assets
  for (const rel of STATIC_FILES) {
    const srcPath = path.join(ROOT, rel);
    const destPath = path.join(DIST, rel);
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.copyFile(srcPath, destPath);
  }

  // Validate manifest JSON and icon references
  const manifestRaw = await fs.readFile(path.join(DIST, 'manifest.webmanifest'), 'utf8');
  const manifest = JSON.parse(manifestRaw);
  for (const icon of manifest.icons || []) {
    const iconPath = path.join(DIST, icon.src.replace(/^\.\//, ''));
    await fs.access(iconPath);
  }

  // Apply custom SITE_URL (e.g. from GitHub Pages base_url or custom domain) if provided
  const siteUrlRaw = (process.env.SITE_URL || DEFAULT_SITE_URL).trim();
  const normalizedSiteUrl = siteUrlRaw.endsWith('/') ? siteUrlRaw : `${siteUrlRaw}/`;
  if (normalizedSiteUrl !== DEFAULT_SITE_URL) {
    for (const rel of ['index.html', 'robots.txt', 'sitemap.xml']) {
      const filePath = path.join(DIST, rel);
      const text = await fs.readFile(filePath, 'utf8');
      await fs.writeFile(
        filePath,
        text.replaceAll(DEFAULT_SITE_URL, normalizedSiteUrl),
        'utf8'
      );
    }
  }

  // Validate Schema.org JSON-LD in dist/index.html
  const distIndexHtml = await fs.readFile(path.join(DIST, 'index.html'), 'utf8');
  const jsonLdMatch = distIndexHtml.match(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  if (!jsonLdMatch) {
    throw new Error('Missing Schema.org JSON-LD block in index.html');
  }
  JSON.parse(jsonLdMatch[1]);

  // Add .nojekyll so GitHub Pages serves all files cleanly without Jekyll processing
  await fs.writeFile(path.join(DIST, '.nojekyll'), '', 'utf8');

  // Build portable single-file HTML edition
  const { standalone, bundledJs } = await buildStandaloneHtml();
  const standalonePath = path.join(DIST, 'zoneshift-standalone.html');
  await fs.writeFile(standalonePath, standalone, 'utf8');

  return {
    distDir: DIST,
    standalonePath,
    bundledJs,
    copiedFiles: STATIC_FILES.length,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runBuild();
  const stat = await fs.stat(result.standalonePath);
  console.log(`✔ Built PWA assets (${result.copiedFiles} files) -> dist/`);
  console.log(`✔ Built portable single-file bundle (${(stat.size / 1024).toFixed(1)} KB) -> dist/zoneshift-standalone.html`);
}
