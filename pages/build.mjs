import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserBuildOptions } from './bundle.mjs';
import { validateConfig } from './github-store.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist-pages');
const publicDirectory = resolve(root, 'public');

async function copyInterface() {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });

  // Publish only the interface, never credentials, source modules or archives.
  await cp(resolve(publicDirectory, 'assets'), resolve(output, 'assets'), { recursive: true });
  for (const entry of await readdir(resolve(publicDirectory, 'pages'), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.html')) {
      await cp(resolve(publicDirectory, 'pages', entry.name), resolve(output, entry.name));
    }
  }
  for (const name of ['sw.js', 'manifest.webmanifest']) await cp(resolve(publicDirectory, name), resolve(output, name));
  await cp(resolve(output, 'teste.html'), resolve(output, 'index.html'));
  await writeFile(resolve(output, '.nojekyll'), '');
}

async function compileBrowserScripts() {
  const options = {
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    logLevel: 'warning',
  };
  await build({
    ...options,
    ...browserBuildOptions,
    entryPoints: [resolve(root, 'pages/browser.ts')],
    outfile: resolve(output, 'assets/js/prototype.js'),
  });
  await build({
    ...options,
    entryPoints: [resolve(root, 'pages/password-worker.mjs')],
    outfile: resolve(output, 'assets/js/password-worker.js'),
  });
}

async function publicationConfig(preview) {
  if (preview) return null;

  // In CI the credential pair must come entirely from the environment. The
  // local file is only the fallback when neither credential was supplied.
  if (process.env.PROTOTYPE_GITHUB_TOKEN || process.env.PROTOTYPE_DATA_KEY_V1) {
    return validateConfig({
      owner: process.env.PROTOTYPE_GITHUB_OWNER || 'jpbroering',
      repo: process.env.PROTOTYPE_GITHUB_REPO || 'conexaocomunidade',
      branch: 'dados-prototipo',
      token: process.env.PROTOTYPE_GITHUB_TOKEN,
      key: process.env.PROTOTYPE_DATA_KEY_V1,
    });
  }
  let local;
  try {
    local = JSON.parse(await readFile(resolve(root, '.prototype/runtime-config.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw Error('O arquivo local de configuração é inválido.');
  }
  if (local?.token) return validateConfig(local);
  if (process.env.CI) {
    throw Error('Configure PROTOTYPE_GITHUB_TOKEN e PROTOTYPE_DATA_KEY_V1 antes de publicar.');
  }
  return null;
}

async function versionServiceWorker() {
  const hash = createHash('sha256');
  async function fingerprint(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await fingerprint(path);
      } else if (entry.name !== 'sw.js') {
        hash.update(path.slice(output.length));
        hash.update(await readFile(path));
      }
    }
  }
  await fingerprint(output);
  const workerPath = resolve(output, 'sw.js');
  const worker = await readFile(workerPath, 'utf8');
  await writeFile(workerPath, worker.replace('__BUILD_ID__', hash.digest('hex').slice(0, 16)));
}

async function versionInterfaceAssets() {
  const hash = createHash('sha256');
  async function fingerprint(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await fingerprint(path);
      else if (/\.(css|js)$/.test(entry.name)) {
        hash.update(path.slice(output.length));
        hash.update(await readFile(path));
      }
    }
  }
  await fingerprint(resolve(output, 'assets'));
  const version = hash.digest('hex').slice(0, 12);
  for (const entry of await readdir(output)) {
    if (!entry.endsWith('.html')) continue;
    const path = resolve(output, entry);
    const html = await readFile(path, 'utf8');
    await writeFile(path, html.replace(/\b(src|href)=(["'])(\.\/assets\/[^"'?]+\.(?:js|css))\2/g, (_, attribute, quote, url) => `${attribute}=${quote}${url}?v=${version}${quote}`));
  }
}

export async function buildPages({ preview = false } = {}) {
  await copyInterface();
  await compileBrowserScripts();
  const config = await publicationConfig(preview);
  await writeFile(resolve(output, 'runtime-config.json'), JSON.stringify(config || { configured: false }));
  await versionInterfaceAssets();
  await versionServiceWorker();
  console.log(`Pages: pacote gerado em dist-pages (${config ? 'configuração automática incluída' : 'prévia sem credenciais'}).`);
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildPages();
}
