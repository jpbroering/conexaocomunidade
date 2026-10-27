import { encode64, decode64 } from '../lib/encoding.mjs';
export { encode64, decode64 } from '../lib/encoding.mjs';
// Git is the persistent store. A request sees one immutable snapshot; all of its
// writes become visible together through a single fast-forward reference update.
export class StoreError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}
export class Conflict extends StoreError {
  constructor(message = 'O cadastro mudou em outra aba. Atualize a versão salva. Seus campos foram preservados.') { super(message, 409); }
}
const encoder = new TextEncoder();
export const prefix = 'private-json/v1/';
export function validPath(path) {
  return typeof path === 'string' && path.startsWith(prefix) && path.endsWith('.json') && !path.split('/').some(p => !p || p === '.' || p === '..');
}
export async function blobSha(text) {
  const bytes = encoder.encode(text), header = encoder.encode(`blob ${bytes.length}\0`);
  const input = new Uint8Array(header.length + bytes.length);
  input.set(header); input.set(bytes, header.length);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', input)), b => b.toString(16).padStart(2, '0')).join('');
}
export function validateConfig(config) {
  if (!config || !/^[\w.-]+$/.test(config.owner) || !/^[\w.-]+$/.test(config.repo) || config.branch !== 'dados-prototipo' || typeof config.token !== 'string' || !config.token.trim())
    throw new StoreError('O protótipo ainda não foi configurado para acessar o GitHub.');
  try { if (decode64(config.key).length !== 32) throw Error(); }
  catch { throw new StoreError('A chave da base do protótipo não foi configurada corretamente.'); }
  return config;
}
export class GithubStore {
  constructor(config, request = globalThis.fetch.bind(globalThis)) {
    this.config = validateConfig(config);
    this.request = request;
    this.base = `https://api.github.com/repos/${config.owner}/${config.repo}`;
    this.blobs = new Map();
    this.blobSizes = new Map();
    this.cachedBytes = 0;
    this.trees = new Map();
    this.snapshots = new Map();
  }
  async api(path, options = {}) {
    let response;
    try {
      response = await this.request(this.base + path, {
        ...options, cache: 'no-store', signal: options.signal || AbortSignal.timeout(30000),
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.config.token}`, 'X-GitHub-Api-Version': '2026-03-10', ...(options.body ? {'Content-Type': 'application/json'} : {}), ...options.headers },
      });
    } catch { throw new StoreError('Não foi possível alcançar o GitHub. Confira sua conexão e tente novamente.'); }
    if (!response.ok) {
      if (response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')) {
        const delay = response.headers.get('retry-after');
        throw new StoreError(`O GitHub limitou as requisições. ${delay ? `Aguarde ${delay} segundos` : 'Aguarde alguns instantes'} antes de tentar novamente.`, 429);
      }
      const message = response.status === 401 ? 'O token do protótipo expirou ou é inválido. Avise a equipe responsável.'
        : response.status === 403 ? 'O GitHub bloqueou a operação. Confira as permissões do token e os limites de requisições.'
        : response.status === 404 ? 'A base do protótipo não foi inicializada ou está inacessível.'
        : 'O GitHub não confirmou a operação. Tente novamente; seus campos foram preservados.';
      const error = new StoreError(message);
      error.githubStatus = response.status;
      throw error;
    }
    return response.json();
  }
  async snapshot() {
    const ref = await this.api('/git/ref/heads/' + encodeURIComponent(this.config.branch));
    return this.snapshotAt(ref.object.sha);
  }
  async snapshotAt(commitSha) {
    if (this.snapshots.has(commitSha)) return this.snapshots.get(commitSha);
    const commit = await this.api('/git/commits/' + encodeURIComponent(commitSha));
    const objects = new Map();
    const recursiveKey = commit.tree.sha + '?recursive=1';
    let recursiveTree = this.trees.get(recursiveKey);
    if (!recursiveTree) {
      recursiveTree = await this.api('/git/trees/' + recursiveKey);
      this.trees.set(recursiveKey, recursiveTree);
    }
    // Large trees can be truncated; only trust a complete recursive response.
    const walk = async (sha, path) => {
      let tree = this.trees.get(sha);
      if (!tree) { tree = await this.api('/git/trees/' + sha); this.trees.set(sha, tree); }
      if (tree.truncated) throw new StoreError('A árvore de dados está incompleta. Procure a equipe.');
      for (const entry of tree.tree) {
        const name = path + entry.path;
        if (entry.type === 'tree' && (prefix.startsWith(name + '/') || (name + '/').startsWith(prefix))) await walk(entry.sha, name + '/');
        else if (entry.type === 'blob' && validPath(name)) objects.set(name, entry.sha);
      }
    };
    if (recursiveTree.truncated) {
      await walk(commit.tree.sha, '');
    } else {
      for (const entry of recursiveTree.tree) {
        if (entry.type === 'blob' && validPath(entry.path)) objects.set(entry.path, entry.sha);
      }
    }
    const snapshot = { head: commitSha, tree: commit.tree.sha, objects };
    this.snapshots.set(commitSha, snapshot);
    if (this.snapshots.size > 16) this.snapshots.delete(this.snapshots.keys().next().value);
    while (this.trees.size > 256) this.trees.delete(this.trees.keys().next().value);
    return snapshot;
  }
  cacheText(sha, text) {
    this.cachedBytes -= this.blobSizes.get(sha) || 0;
    this.blobs.set(sha, Promise.resolve(text));
    this.blobSizes.set(sha, text.length * 2);
    this.cachedBytes += text.length * 2;
    // Base64 image envelopes can be large; bound retained strings for phones.
    while (this.cachedBytes > 16 * 1024 * 1024 || this.blobs.size > 256) {
      const oldest = this.blobs.keys().next().value;
      this.cachedBytes -= this.blobSizes.get(oldest) || 0;
      this.blobSizes.delete(oldest); this.blobs.delete(oldest);
    }
  }
  async text(sha) {
    if (!this.blobs.has(sha)) {
      const pending = this.api('/git/blobs/' + sha).then(blob => {
        if (blob.encoding !== 'base64') throw new StoreError('Formato de arquivo inesperado na base.');
        const text = new TextDecoder('utf-8', { fatal: true }).decode(decode64(blob.content));
        this.cacheText(sha, text);
        return text;
      }).catch(error => { this.blobs.delete(sha); throw error; });
      this.blobs.set(sha, pending);
    }
    return this.blobs.get(sha);
  }
  async begin() { return new Transaction(this, await this.snapshot()); }
}
export class Transaction {
  constructor(store, snapshot) { this.store = store; this.snapshot = snapshot; this.changes = new Map(); this.reads = new Map(); this.listings = new Map(); }
  async get(path) {
    if (!validPath(path)) throw new StoreError('Caminho de dados inválido.');
    if (!this.reads.has(path)) this.reads.set(path, this.snapshot.objects.get(path));
    const staged = this.changes.get(path);
    if (staged === null) return null;
    const sha = staged?.sha || this.snapshot.objects.get(path);
    if (!sha) return null;
    const text = staged?.text ?? await this.store.text(sha);
    return { etag: sha, text: async () => text, json: async () => JSON.parse(text) };
  }
  async head(path) { return this.get(path); }
  async put(path, text, options = {}) {
    const current = await this.get(path);
    if (options.onlyIf?.etagMatches && current?.etag !== options.onlyIf.etagMatches) return null;
    if (options.onlyIf?.etagDoesNotMatch === '*' && current) return null;
    let envelope;
    try { envelope = JSON.parse(text); } catch { throw new StoreError('JSON inválido.'); }
    if (![1, 2].includes(envelope.version) || typeof envelope.iv !== 'string' || typeof envelope.body !== 'string' || (envelope.version === 2 && envelope.algorithm !== 'AES-256-GCM'))
      throw new StoreError('A base aceita somente envelopes JSON cifrados.');
    const sha = await blobSha(text);
    this.changes.set(path, { text, sha });
    return { etag: sha };
  }
  async delete(path) { await this.get(path); this.changes.set(path, null); }
  async list({ prefix: pathPrefix, cursor, limit = 1000 }) {
    const original = [...this.snapshot.objects.keys()].filter(p => p.startsWith(pathPrefix)).sort();
    this.listings.set(pathPrefix, JSON.stringify(original));
    const paths = new Set(original);
    for (const [path, value] of this.changes) if (path.startsWith(pathPrefix)) value === null ? paths.delete(path) : paths.add(path);
    const sorted = [...paths].sort(), offset = cursor ? Number(cursor) : 0;
    return { objects: sorted.slice(offset, offset + limit).map(key => ({ key })), truncated: offset + limit < sorted.length, cursor: String(offset + limit) };
  }
  check(snapshot) {
    for (const [path, sha] of this.reads) if (snapshot.objects.get(path) !== sha) throw new Conflict();
    for (const [pathPrefix, names] of this.listings) if (JSON.stringify([...snapshot.objects.keys()].filter(p => p.startsWith(pathPrefix)).sort()) !== names) throw new Conflict();
  }
  async commit(message = 'Atualizar dados do protótipo') {
    if (!this.changes.size) return this.snapshot.head;
    const api = this.store.api.bind(this.store), entries = [];
    for (const [path, value] of this.changes) {
      let sha = null;
      if (value) {
        const blob = await api('/git/blobs', { method: 'POST', body: JSON.stringify({ content: encode64(encoder.encode(value.text)), encoding: 'base64' }) });
        if (blob.sha !== value.sha) throw new StoreError('O GitHub devolveu uma revisão inesperada.');
        this.store.cacheText(blob.sha, value.text);
        sha = blob.sha;
      }
      if (value || this.snapshot.objects.has(path)) entries.push({ path, mode: '100644', type: 'blob', sha });
    }
    if (!entries.length) return this.snapshot.head;
    let current = this.snapshot;
    for (let attempt = 0; attempt < 3; attempt++) {
      this.check(current);
      const tree = await api('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: current.tree, tree: entries }) });
      const commit = await api('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [current.head] }) });
      try {
        await api('/git/refs/heads/' + encodeURIComponent(this.store.config.branch), { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
        return commit.sha;
      } catch (error) {
        // A lost response may mean the update succeeded. Never repeat the action
        // blindly: confirm ancestry before deciding whether to retry.
        const fresh = await this.store.snapshot();
        if (fresh.head === commit.sha) return commit.sha;
        if (!error.githubStatus) {
          const comparison = await api(`/compare/${commit.sha}...${fresh.head}`);
          if (comparison.status === 'ahead' || comparison.status === 'identical') return commit.sha;
          throw error;
        }
        if (![409, 422].includes(error.githubStatus)) throw error;
        this.check(fresh);
        current = fresh;
      }
    }
    throw new Conflict('Há alterações simultâneas. Tente salvar novamente; seus campos foram preservados.');
  }
}
