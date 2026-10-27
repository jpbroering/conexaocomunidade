import { createHash } from 'node:crypto';
import { blobSha } from '../github-store.mjs';
const hash = value => createHash('sha1').update(value).digest('hex');
export class FakeGithub {
  constructor() { this.blobs = new Map(); this.trees = new Map(); this.commits = new Map(); this.head = null; this.calls = []; this.updates = 0; this.beforeUpdate = null; this.failure = null; }
  tree(files) {
    const groups = new Map(), entries = [];
    for (const [path, sha] of files) {
      const slash = path.indexOf('/');
      if (slash < 0) entries.push({ path, sha, type: 'blob', mode: '100644' });
      else { const name = path.slice(0, slash); if (!groups.has(name)) groups.set(name, new Map()); groups.get(name).set(path.slice(slash + 1), sha); }
    }
    for (const [name, children] of groups) entries.push({ path: name, sha: this.tree(children), type: 'tree', mode: '040000' });
    entries.sort((a,b) => a.path.localeCompare(b.path));
    const sha = hash(JSON.stringify(entries)); this.trees.set(sha, entries); return sha;
  }
  flatten(sha, prefix = '', result = new Map()) { for (const entry of this.trees.get(sha) || []) entry.type === 'tree' ? this.flatten(entry.sha, prefix + entry.path + '/', result) : result.set(prefix + entry.path, entry.sha); return result; }
  files() { return this.head ? this.flatten(this.commits.get(this.head).tree.sha) : new Map(); }
  commit(tree, parents = []) { const sha = hash(JSON.stringify({ tree, parents, n: this.commits.size })); this.commits.set(sha, { tree: { sha: tree }, parents: parents.map(sha => ({ sha })) }); return sha; }
  async seed(records) { const files = new Map(); for (const [path, text] of records) { const sha = await blobSha(text); this.blobs.set(sha, text); files.set(path, sha); } this.head = this.commit(this.tree(files)); }
  async mutate(path, text) { const files = this.files(); const sha = await blobSha(text); this.blobs.set(sha, text); files.set(path, sha); this.head = this.commit(this.tree(files), [this.head]); }
  fetch = async (input, init = {}) => {
    const url = new URL(input), path = url.pathname.replace('/repos/test/project', ''), method = init.method || 'GET';
    this.calls.push({ method, path });
    if (this.failure) { const result = this.failure(path, method); if (result) return result; }
    const body = init.body ? JSON.parse(init.body) : {};
    const fail = status => Response.json({ message: 'simulated GitHub response' }, { status });
    if (path.startsWith('/git/ref/heads/') && method === 'GET') return this.head ? Response.json({ object: { sha: this.head } }) : fail(404);
    if (path.startsWith('/git/refs/heads/') && method === 'PATCH') {
      if (this.beforeUpdate) { const callback = this.beforeUpdate; this.beforeUpdate = null; await callback(); }
      if (body.force !== false || this.commits.get(body.sha)?.parents[0]?.sha !== this.head) return fail(409);
      this.head = body.sha; this.updates++; return Response.json({ object: { sha: this.head } });
    }
    if (path === '/git/blobs' && method === 'POST') { const text = body.encoding === 'base64' ? Buffer.from(body.content, 'base64').toString('utf8') : body.content; const sha = await blobSha(text); this.blobs.set(sha, text); return Response.json({ sha }); }
    if (path.startsWith('/git/blobs/') && method === 'GET') { const text = this.blobs.get(path.split('/').pop()); return text === undefined ? fail(404) : Response.json({ content: Buffer.from(text).toString('base64'), encoding: 'base64' }); }
    if (path === '/git/trees' && method === 'POST') { const files = body.base_tree ? this.flatten(body.base_tree) : new Map(); for (const entry of body.tree) entry.sha === null ? files.delete(entry.path) : files.set(entry.path, entry.sha); return Response.json({ sha: this.tree(files) }); }
    if (path.startsWith('/git/trees/') && method === 'GET') {
      const sha = path.split('/').pop();
      const tree = url.searchParams.has('recursive')
        ? [...this.flatten(sha)].map(([path, sha]) => ({ path, sha, type: 'blob', mode: '100644' }))
        : this.trees.get(sha);
      return Response.json({ tree, truncated: false });
    }
    if (path === '/git/commits' && method === 'POST') return Response.json({ sha: this.commit(body.tree, body.parents) });
    if (path.startsWith('/git/commits/') && method === 'GET') return Response.json(this.commits.get(path.split('/').pop()));
    if (path === '/git/refs' && method === 'POST') { if (this.head) return fail(422); this.head = body.sha; return Response.json({ ref: body.ref }); }
    throw Error(`Unexpected fake GitHub operation: ${method} ${path}`);
  };
}
export function sessions() { let token; return { get: () => token, set: value => { token = value; }, clear: () => { token = null; } }; }
