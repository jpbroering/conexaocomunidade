import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdir, readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { bundleApi } from '../bundle.mjs';
import { GithubStore, Conflict, blobSha } from '../github-store.mjs';
import { sealJson, openJson, sealBytes, openBytes, encode64, decode64 } from '../../lib/vault.mjs';
import { restoreSnapshot, validateSnapshot } from '../recovery.mjs';
import { makeSeed, recordKey } from '../seed.mjs';
import { importArchive } from '../migration.mjs';
import { FakeGithub, sessions } from './fake-github.mjs';
let createClient, seed;
const master = randomBytes(32).toString('base64');
const config = { owner: 'test', repo: 'project', branch: 'dados-prototipo', token: 'fake-token-for-tests-only', key: master };
const derive = (password, salt) => new Uint8Array(scryptSync(password, salt, 32, { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 }));
before(async () => {
  await mkdir(new URL('../.test-build/', import.meta.url), { recursive: true });
  const output = new URL('../.test-build/api.mjs', import.meta.url);
  await bundleApi(output.pathname);
  ({ createClient } = await import(output.href));
  seed = await makeSeed(master);
});
async function setup() {
  const github = new FakeGithub(); await github.seed(seed.records);
  const client = () => createClient(config, { fetch: github.fetch, sessions: sessions(), derive });
  return { github, client, admin: client(), company: client(), visitor: client(), coordination: client(), customer: client() };
}
async function call(client, path, method = 'GET', body) {
  const response = await client.request('/api/' + path, { method, ...(body === undefined ? {} : body instanceof FormData ? { body } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() };
}
async function login(client, role) { const user = seed.accounts.find(a => a.role === role); const result = await call(client, 'auth', 'POST', { username: user.username, password: user.password }); assert.equal(result.status, 200); return user; }
function successful(result, status = 200) { assert.equal(result.status, status, JSON.stringify(result.data)); return result.data; }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/TsAAAAASUVORK5CYII=','base64');
test('catalogue, registration, independent sessions, revocation, company edits and deletion', async () => {
  const { visitor, client, admin } = await setup();
  assert.equal(successful(await call(visitor, 'companies')).companies.length, 3);
  assert.equal((await call(visitor, 'companies', 'POST', { action: 'create' })).status, 401);
  const password = 'Uma senha fictícia bastante longa!';
  successful(await call(visitor, 'auth', 'POST', { action: 'register-company', username: 'nova.empresa', name: 'Nova empresa fictícia', password }), 201);
  const created = successful(await call(visitor, 'companies', 'POST', { action: 'create' }), 201);
  const current = successful(await call(visitor, 'companies')).companies.find(c => c.id === created.id);
  const { id, revision, mine, configured, ...company } = current;
  const saved = successful(await call(visitor, 'companies', 'POST', { id, revision, data: { ...company, name: 'Empresa teste independente', published: true } }));
  assert(successful(await call(client(), 'companies')).companies.some(c => c.id === id));
  assert.equal((await call(visitor, 'companies', 'POST', { id, revision, data: company })).status, 409);
  await login(admin, 'company-admin');
  const account = successful(await call(admin, 'test-users')).users.find(u => u.username === 'nova.empresa');
  successful(await call(admin, 'test-users', 'POST', { action: 'reset', username: account.username, revision: account.revision, password: password + ' nova' }));
  assert.equal(successful(await call(visitor, 'auth')).user, null);
  assert.equal((await call(visitor, 'companies', 'DELETE', { id, revision: saved.revision })).status, 401);
  successful(await call(visitor, 'auth', 'POST', { username: 'nova.empresa', password: password + ' nova' }));
  successful(await call(visitor, 'companies', 'DELETE', { id, revision: saved.revision }));
  assert(!successful(await call(client(), 'companies')).companies.some(c => c.id === id));
  successful(await call(visitor, 'auth', 'POST', { action: 'password', currentPassword: password + ' nova', password: password + ' final' }));
  assert.equal(successful(await call(visitor, 'auth')).user, null);
});
test('image upload, approval, replacement and removal are atomic and ownership is checked', async () => {
  const { github, company, admin, visitor, customer } = await setup();
  await login(company, 'company'); await login(admin, 'company-admin'); await login(customer, 'client');
  const owned = successful(await call(company, 'companies')).companies.find(c => c.mine);
  const upload = (revision, replace) => { const f = new FormData(); f.set('company', owned.id); f.set('revision', revision); f.set('kind', 'facade'); if (replace) f.set('replace', replace); f.set('image', new File([png], 'image.png', { type: 'image/png' })); return f; };
  const before = github.updates;
  const image = successful(await call(company, 'company-image', 'POST', upload(owned.revision)));
  assert.equal(github.updates, before + 1);
  assert.equal((await visitor.request('/api/company-image?id=' + image.id)).status, 403);
  const asset = successful(await call(admin, 'admin-images')).companies.flatMap(c => c.images).find(a => a.id === image.id);
  successful(await call(admin, 'company-image', 'PATCH', { id: image.id, revision: asset.revision, approval: 'approved' }));
  assert.deepEqual(Buffer.from(await (await visitor.request('/api/company-image?id=' + image.id)).arrayBuffer()), png);
  assert.equal((await call(customer, 'company-image', 'POST', upload(image.revision))).status, 403);
  const replaced = successful(await call(company, 'company-image', 'POST', upload(image.revision, image.id)));
  assert(![...github.files().keys()].some(p => p.includes(image.id)));
  const state = github.head;
  github.failure = (p, method) => p === '/git/blobs' && method === 'POST' ? new Response('', { status: 503 }) : null;
  assert.equal((await call(company, 'company-image', 'POST', upload(replaced.revision, replaced.id))).status, 503);
  assert.equal(github.head, state);
  github.failure = null;
  successful(await call(company, 'company-image', 'DELETE', { company: owned.id, id: replaced.id, revision: replaced.revision }));
  assert(![...github.files().keys()].some(p => p.includes(replaced.id)));
});
test('reports, coordination accounts, profiles, legacy entries and institutional photos', async () => {
  const { admin, company, visitor, coordination, customer } = await setup();
  await login(admin, 'company-admin'); await login(company, 'company'); await login(coordination, 'coordination'); await login(customer, 'client');
  const report = successful(await call(visitor, 'reports', 'POST', { title: 'Relato fictício', address: 'Local fictício', description: 'Um texto suficientemente longo para teste.', anonymous: true, name: 'Não armazenar', contact: 'Não armazenar', images: [{ type: 'image/png', body: png.toString('base64') }] }), 201);
  assert.equal((await call(company, 'reports')).status, 403);
  const row = successful(await call(coordination, 'reports')).reports.find(r => r.id === report.id);
  assert.equal(row.name, ''); assert.equal(row.photoCount, 1);
  successful(await call(coordination, 'reports', 'PATCH', { id: row.id, revision: row.revision, status: 'Aprovado' }));
  assert.equal((await coordination.request(`/api/reports?id=${row.id}&photo=0`)).status, 200);
  const informal = successful(await call(coordination, 'coordination', 'POST', { name: 'Negócio da escola fictício', provider: 'Pessoa fictícia', category: 'Costura', address: '', contact: '', hours: '', description: '', products: '', lat: null, lng: null, published: false }), 201);
  successful(await call(coordination, 'coordination', 'POST', { action: 'release-account', id: informal.id, revision: informal.revision, username: 'informal.teste', password: 'Senha inicial longa para testes!' }), 201);
  const linked = successful(await call(coordination, 'coordination')).companies.find(c => c.id === informal.id);
  assert.equal(linked.account.active, true);
  const community = successful(await call(customer, 'community'));
  successful(await call(customer, 'community', 'POST', { action: 'profile', revision: community.profileRevision, data: { name: 'Cliente fictício', neighborhood: 'Brejaru' } }));
  successful(await call(customer, 'community', 'POST', { data: { kind: 'problem', title: 'Exemplo de registro', category: 'Teste', description: 'Registro fictício para exercício do fluxo.', address: 'Endereço fictício', hours: '', contact: '', lat: null, lng: null, photo: null, gallery: [] } }), 201);
  successful(await call(customer, 'ideas', 'POST', { idea: 'Ideia fictícia para testar o protótipo.' }));
  assert.equal(successful(await call(customer, 'ideas')).ideas.length, 1);
  const form = new FormData(); form.set('slot', 'team'); form.set('revision', ''); form.set('image', new File([png], 'image.png', { type: 'image/png' }));
  const about = successful(await call(admin, 'about-images', 'POST', form));
  assert.equal((await visitor.request('/api/about-images?id=' + about.image)).status, 200);
  successful(await call(admin, 'about-images', 'DELETE', { slot: 'team', revision: about.revision }));
  assert.equal((await visitor.request('/api/about-images?id=' + about.image)).status, 404);
  assert(successful(await call(admin, 'admin-activity')).events.length);
});
test('concurrent commits preserve independent edits and reject stale touched records', async () => {
  const { github } = await setup(), store = new GithubStore(config, github.fetch);
  const paths = [...seed.records.keys()].filter(p => p.includes('/companies/'));
  const a = await store.begin(), b = await store.begin();
  await a.put(paths[0], seed.records.get(paths[0]) + ' '); await b.put(paths[1], seed.records.get(paths[1]) + ' ');
  await a.commit(); await b.commit();
  assert.equal(github.files().get(paths[0]), await blobSha(seed.records.get(paths[0]) + ' '));
  assert.equal(github.files().get(paths[1]), await blobSha(seed.records.get(paths[1]) + ' '));
  const c = await store.begin(), d = await store.begin();
  await c.put(paths[0], seed.records.get(paths[0]) + '  '); await d.put(paths[0], seed.records.get(paths[0]) + '   ');
  await c.commit(); await assert.rejects(() => d.commit(), Conflict);
});
test('network failures, rate limits, invalid tokens and corrupt envelopes do not report success', async () => {
  const { github, visitor, company } = await setup();
  github.failure = () => new Response('', { status: 401 });
  assert.match((await call(visitor, 'companies')).data.error, /token/);
  github.failure = () => new Response('', { status: 429, headers: { 'retry-after': '30' } });
  assert.equal((await call(visitor, 'companies')).status, 429);
  github.failure = () => { throw new TypeError('offline'); };
  assert.equal((await call(visitor, 'companies')).status, 503);
  github.failure = null;
  const path = [...seed.records.keys()].find(p => p.includes('/companies/'));
  await github.mutate(path, JSON.stringify({ version: 1, iv: 'broken', body: 'broken' }));
  const response = await call(company, 'companies'); assert.equal(response.status, 503); assert.match(response.data.error, /decifrar/);
});
test('archive importer preserves identifiers and bytes, and fails before publishing incomplete exports', async () => {
  const source = await mkdtemp(resolve(tmpdir(), 'conexao-import-')), original = randomBytes(32).toString('base64');
  const id = crypto.randomUUID(), tenant = crypto.randomUUID();
  const imagePath = `private-json/v1/image-files/company-images/${tenant}/${id}.json`, metaPath = recordKey('company-images', id);
  const sealed = await sealBytes(original, tenant, id, png);
  const records = new Map([[metaPath, JSON.stringify({ version: 1, ...await sealJson(original, metaPath, { company_id: tenant, tenant, type: 'image/png', binaryKey: imagePath, storage: 'encrypted-json', encrypted: true }) })], [imagePath, JSON.stringify({ version: 2, algorithm: 'AES-256-GCM', iv: encode64(sealed.iv), body: encode64(sealed.bytes) })]]);
  for (const [path, text] of records) { await mkdir(dirname(resolve(source, path)), { recursive: true }); await writeFile(resolve(source, path), text); }
  const imported = await importArchive(source, original, master);
  assert.equal(imported.size, 2);
  assert.equal((await openJson(master, metaPath, JSON.parse(imported.get(metaPath)))).company_id, tenant);
  const restoredImage = JSON.parse(imported.get(imagePath));
  assert.deepEqual(Buffer.from(await openBytes(master, tenant, id, decode64(restoredImage.iv), decode64(restoredImage.body))), png);
  await assert.rejects(() => importArchive(source, master, master));
  const missingPath = recordKey('about-slots', 'team');
  await mkdir(dirname(resolve(source, missingPath)), { recursive: true });
  await writeFile(resolve(source, missingPath), JSON.stringify({ version: 1, ...await sealJson(original, missingPath, { image: crypto.randomUUID() }) }));
  await assert.rejects(() => importArchive(source, original, master), /ausente/);
});
test('restore validates the saved snapshot and creates a new commit without losing history', async () => {
  const { github } = await setup(), store = new GithubStore(config, github.fetch);
  const saved = github.head, path = [...seed.records.keys()].find(p => p.includes('/companies/'));
  await github.mutate(path, seed.records.get(path) + ' ');
  const extra = recordKey('ideas', crypto.randomUUID());
  await github.mutate(extra, JSON.stringify({ version: 1, ...await sealJson(master, extra, { idea: 'Registro fictício a remover na restauração' }) }));
  const beforeRestore = github.head;
  const restored = await restoreSnapshot(store, saved);
  assert.notEqual(restored, saved);
  assert.equal(github.commits.get(restored).parents[0].sha, beforeRestore);
  assert.equal(github.files().get(path), await blobSha(seed.records.get(path)));
  assert(!github.files().has(extra));
  assert.equal((await validateSnapshot(store, await store.snapshot())).size, seed.records.size);
});
test('a lost reference-update response is confirmed instead of submitting a duplicate write', async () => {
  const { github } = await setup();
  let loseResponse = true;
  const fetch = async (url, init) => {
    const response = await github.fetch(url, init);
    if (init.method === 'PATCH' && response.ok && loseResponse) { loseResponse = false; throw new TypeError('response lost'); }
    return response;
  };
  const store = new GithubStore(config, fetch), transaction = await store.begin();
  const path = [...seed.records.keys()].find(p => p.includes('/companies/'));
  await transaction.put(path, seed.records.get(path) + ' ');
  await transaction.commit();
  assert.equal(github.updates, 1);
});
test('the browser fetch function keeps its global receiver', async () => {
  const { github } = await setup(), original = globalThis.fetch;
  try {
    globalThis.fetch = function (...args) { assert.equal(this, globalThis); return github.fetch(...args); };
    assert.equal((await new GithubStore(config).snapshot()).head, github.head);
  } finally { globalThis.fetch = original; }
});
