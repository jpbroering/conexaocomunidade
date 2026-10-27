import { context } from '../pages/context.mjs';
import { Conflict, StoreError } from '../pages/github-store.mjs';
import { RequestError } from './request-body';
import { sealJson, openJson } from './vault.mjs';
export { Conflict };
export const uuid = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export const key = (kind: string, id: string) => `private-json/v1/${kind}/${encodeURIComponent(id)}.json`;
export async function read(kind: string, id: string) {
  const path = key(kind, id), object = await context().transaction.get(path);
  if (!object) return null;
  try {
    const envelope = await object.json();
    if (envelope.version !== 1) throw Error('Unsupported envelope');
    return { data: await openJson(context().config.key, path, envelope), revision: object.etag };
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError('Não foi possível decifrar um cadastro. A chave pode estar incorreta ou o arquivo está danificado.');
  }
}
export async function write(kind: string, id: string, data: unknown, revision: string | null) {
  const path = key(kind, id), encrypted = await sealJson(context().config.key, path, data);
  const result = await context().transaction.put(path, JSON.stringify({ version: 1, ...encrypted }), {
    onlyIf: revision ? { etagMatches: revision } : { etagDoesNotMatch: '*' },
  });
  if (!result) throw new Conflict();
  return result.etag;
}
export async function list(kind: string) {
  const prefix = key(kind, '').replace('.json', ''), result: any[] = [];
  let cursor: string | undefined;
  do {
    const page = await context().transaction.list({ prefix, cursor, limit: 100 });
    for (const { key: path } of page.objects) {
      const id = decodeURIComponent(path.slice(prefix.length, -5)), row = await read(kind, id);
      if (row) result.push({ id, ...row });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return result;
}
export async function client(owner: string) {
  let row = await read('clients', owner);
  if (!row) { await write('clients', owner, { owner, profile: null, created_at: Date.now() }, null); row = await read('clients', owner); }
  return row!;
}
export function failed(error: any, message: string) {
  const expected = error instanceof RequestError || error instanceof StoreError;
  return Response.json({ error: expected ? error.message : message }, { status: expected ? error.status : 503 });
}
