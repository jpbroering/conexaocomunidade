import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPages } from '../build.mjs';
import { archiveInventory } from '../archive.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let directory;
before(async () => { directory = await buildPages({ preview: true }); });
test('the original encrypted archive is byte-for-byte intact', async () => { assert.equal((await archiveInventory(root)).files.length, 16); });
test('the Pages artifact contains only the interface, with working relative assets and no old host or APK', async () => {
  const files = [];
  async function walk(dir) { for (const entry of await readdir(dir, { withFileTypes: true })) entry.isDirectory() ? await walk(resolve(dir, entry.name)) : files.push(resolve(dir, entry.name)); }
  await walk(directory);
  for (const file of files) assert(!/\/(private-json|archive|app|lib|downloads|\.prototype)\//.test(file.slice(directory.length)), file);
  const site = 'https://example.github.io/conexaocomunidade/';
  for (const file of files.filter(f => /\.(html|css|js)$/.test(f))) {
    const text = await readFile(file, 'utf8');
    assert(!/chatgpt\.site|pages-bridge|\.apk\b|signin-with-chatgpt|signout-with-chatgpt/.test(text), file);
    if (file.endsWith('.html')) {
      assert.match(text, /src="\.\/assets\/js\/prototype\.[a-f0-9]{12}\.js\?v=[a-f0-9]{12}"/, file);
      for (const asset of text.matchAll(/(?:src|href)=["'](\.\/assets\/[^"']+\.(?:js|css)[^"']*)["']/g)) {
        assert.match(asset[1], /\?v=[a-f0-9]{12}$/, `${file}: unversioned script or style`);
      }
      for (const match of text.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
        const raw = match[1];
        if (/^(https?:|data:|blob:|tel:|mailto:|#)/.test(raw) || raw.includes('${')) continue;
        assert(!raw.startsWith('/'), `${file}: absolute asset ${raw}`);
        const url = new URL(raw, site);
        assert(url.pathname.startsWith('/conexaocomunidade/'));
        const local = resolve(directory, decodeURIComponent(url.pathname.slice('/conexaocomunidade/'.length)));
        assert((await stat(local)).isFile(), local);
      }
    }
    if (file.endsWith('.css') && !file.includes('/vendor/')) {
      for (const match of text.matchAll(/url\(\s*(["']?)([^)"']+)\1\s*\)/g)) {
        if (/^(data:|https?:|#)/.test(match[2])) continue;
        const url = new URL(match[2].trim(), new URL(file.slice(directory.length + 1), site));
        const local = resolve(directory, decodeURIComponent(url.pathname.slice('/conexaocomunidade/'.length)));
        assert((await stat(local)).isFile(), `${file}: missing CSS asset ${match[2]}`);
      }
    }
  }
  assert.equal(await readFile(resolve(directory, 'index.html'), 'utf8'), await readFile(resolve(directory, 'teste.html'), 'utf8'));
  const browser = await readFile(resolve(directory, 'assets/js/prototype.js'), 'utf8');
  assert(!/cloudflare:workers|next\/headers|node:crypto/.test(browser));
  const archivedSeed = JSON.parse(await readFile(resolve(root, 'lib/local-directory-seed.json'), 'utf8'));
  assert(!browser.includes(archivedSeed.body));
});
test('PWA scope and start URL remain inside the project; config is not precached', async () => {
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.scope, './'); assert.equal(manifest.start_url, './comunidade.html?app=1');
  const worker = await readFile(resolve(directory, 'sw.js'), 'utf8');
  assert(!worker.includes('__BUILD_ID__')); assert(!worker.includes('runtime-config.json'));
  assert.equal(JSON.parse(await readFile(resolve(directory, 'runtime-config.json'), 'utf8')).configured, false);
  for (const icon of manifest.icons) assert((await stat(resolve(directory, icon.src))).isFile());
  const cached = worker.match(/const PATHS = \[([\s\S]*?)\]\.map/)[1];
  for (const path of cached.matchAll(/'([^']+)'/g)) {
    assert((await stat(resolve(directory, path[1]))).isFile());
    if (/\.(js|css)$/.test(path[1])) assert.match(path[1], /\.[a-f0-9]{12}\.(js|css)$/, 'precache uses immutable asset filenames');
  }
});

test('public keeps pages and assets in dedicated folders', async () => {
  const source = resolve(root, 'public');
  assert.deepEqual((await readdir(source)).sort(), ['README.md', 'assets', 'manifest.webmanifest', 'pages', 'sw.js']);
  assert.deepEqual((await readdir(resolve(source, 'assets'))).sort(), ['css', 'icons', 'images', 'js', 'vendor']);
  assert((await readdir(resolve(source, 'pages'))).every(name => name.endsWith('.html')));
});
