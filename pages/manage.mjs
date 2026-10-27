import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { GithubStore, validateConfig } from './github-store.mjs';
import { makeSeed } from './seed.mjs';
import { archiveInventory } from './archive.mjs';
import { importArchive } from './migration.mjs';
import { openJson } from '../lib/vault.mjs';
import { validateSnapshot, restoreSnapshot } from './recovery.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), local = resolve(root, '.prototype');
const command = process.argv[2];
async function exists(path) { try { await readFile(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
async function loadConfig() {
  let config = {};
  try { config = JSON.parse(await readFile(resolve(local, 'runtime-config.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return validateConfig({ owner: 'jpbroering', repo: 'conexaocomunidade', branch: 'dados-prototipo', ...config,
    ...(process.env.PROTOTYPE_GITHUB_TOKEN ? { token: process.env.PROTOTYPE_GITHUB_TOKEN } : {}),
    ...(process.env.PROTOTYPE_DATA_KEY_V1 ? { key: process.env.PROTOTYPE_DATA_KEY_V1 } : {}),
    ...(process.env.PROTOTYPE_GITHUB_OWNER ? { owner: process.env.PROTOTYPE_GITHUB_OWNER } : {}),
    ...(process.env.PROTOTYPE_GITHUB_REPO ? { repo: process.env.PROTOTYPE_GITHUB_REPO } : {}),
  });
}
async function prepare() {
  if (await exists(resolve(local, 'runtime-config.json'))) throw Error('A configuração local já existe. Ela não será substituída.');
  await archiveInventory(root);
  const key = randomBytes(32).toString('base64'), seed = await makeSeed(key);
  await mkdir(resolve(local, 'seed'), { recursive: true, mode: 0o700 });
  for (const [path, text] of seed.records) { await mkdir(dirname(resolve(local, 'seed', path)), { recursive: true }); await writeFile(resolve(local, 'seed', path), text, { mode: 0o600 }); }
  await writeFile(resolve(local, 'runtime-config.json'), JSON.stringify({ owner: 'jpbroering', repo: 'conexaocomunidade', branch: 'dados-prototipo', token: '', key }, null, 2) + '\n', { mode: 0o600 });
  await writeFile(resolve(local, 'credentials.txt'), 'Conexão Comunidade · base fictícia\nGuarde este arquivo com a equipe. Não publicar no Git.\n\n' + seed.accounts.map(a => `${a.username}\nPerfil: ${a.role}\nSenha: ${a.password}\n`).join('\n'), { mode: 0o600 });
  console.log('Base cifrada preparada em .prototype/seed. Configuração e credenciais em .prototype/ (ignoradas pelo Git).');
}
async function readSeed() {
  const records = new Map();
  async function walk(dir) { for (const entry of await readdir(resolve(local, 'seed', dir), { withFileTypes: true })) entry.isDirectory() ? await walk(dir + '/' + entry.name) : records.set(dir + '/' + entry.name, await readFile(resolve(local, 'seed', dir, entry.name), 'utf8')); }
  await walk('private-json'); return records;
}
async function initialize(store) {
  try { await store.snapshot(); throw Error('A branch dados-prototipo já existe. Inicialização cancelada para preservar os dados.'); }
  catch (e) { if (e.githubStatus !== 404) throw e; }
  const records = await readSeed(), entries = [];
  for (const [path, text] of records) {
    const envelope = JSON.parse(text); await openJson(store.config.key, path, envelope);
    const blob = await store.api('/git/blobs', { method: 'POST', body: JSON.stringify({ content: text, encoding: 'utf-8' }) });
    entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const tree = await store.api('/git/trees', { method: 'POST', body: JSON.stringify({ tree: entries }) });
  const commit = await store.api('/git/commits', { method: 'POST', body: JSON.stringify({ message: 'Inicializar base fictícia do protótipo', tree: tree.sha, parents: [] }) });
  await store.api('/git/refs', { method: 'POST', body: JSON.stringify({ ref: 'refs/heads/dados-prototipo', sha: commit.sha }) });
  console.log('Branch de dados inicializada com a base fictícia.');
}
async function backup(store) {
  const snapshot = await store.snapshot(), target = resolve(local, 'backups', snapshot.head);
  for (const [path, sha] of snapshot.objects) { await mkdir(dirname(resolve(target, path)), { recursive: true, mode: 0o700 }); await writeFile(resolve(target, path), await store.text(sha), { mode: 0o600 }); }
  await writeFile(resolve(target, 'snapshot.json'), JSON.stringify({ head: snapshot.head, files: Object.fromEntries(snapshot.objects) }, null, 2), { mode: 0o600 });
  console.log('Cópia cifrada salva em .prototype/backups/' + snapshot.head);
}
async function restore(store, sha) {
  await restoreSnapshot(store, sha);
  console.log('Base restaurada em um novo commit, preservando o histórico.');
}
async function check(store) {
  const snapshot = await store.snapshot();
  await validateSnapshot(store, snapshot);
  console.log(`Base acessível: ${snapshot.objects.size} arquivos, commit ${snapshot.head}.`);
}

async function verifyArchive() {
  const createInventory = !(await exists(resolve(root, 'archive/inventory.json')));
  const inventory = await archiveInventory(root, createInventory);
  console.log(`Acervo conferido: ${inventory.files.length} arquivos intactos.`);
}

async function importRecords(store, source) {
  if (!source) throw Error('Informe a pasta da exportação.');
  // Validate and re-encrypt the whole import before touching the remote branch.
  const records = await importArchive(
    resolve(source),
    process.env.OLD_MASTER_KEY_V1,
    store.config.key,
    process.env.OLD_DIRECTORY_KEY_V1,
  );
  const transaction = await store.begin();
  for (const path of records.keys()) {
    if (transaction.snapshot.objects.has(path)) {
      throw Error('Colisão de identificador. Importação cancelada: ' + path);
    }
  }
  for (const [path, text] of records) {
    await transaction.put(path, text, { onlyIf: { etagDoesNotMatch: '*' } });
  }
  await transaction.commit('Importar acervo anterior recifrado');
  console.log(`${records.size} arquivos importados em um único commit. Sessões antigas não foram importadas.`);
}

async function main() {
  if (command === 'archive') return verifyArchive();
  if (command === 'prepare') return prepare();
  if (!['init', 'backup', 'restore', 'import', 'check'].includes(command)) {
    throw Error('Uso: node pages/manage.mjs archive|prepare|init|check|backup|restore SHA|import PASTA');
  }

  const store = new GithubStore(await loadConfig());
  switch (command) {
    case 'init': return initialize(store);
    case 'backup': return backup(store);
    case 'restore': return restore(store, process.argv[3]);
    case 'check': return check(store);
    case 'import': return importRecords(store, process.argv[3]);
  }
}

main().catch(error => { console.error(error.name === 'OperationError' ? 'Não foi possível decifrar o acervo. Confira as chaves originais.' : error.message); process.exitCode = 1; });
