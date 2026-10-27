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
    for (let offset = 0; offset < page.objects.length; offset += 4) {
      // Settle the whole batch before returning an error: reads share the
      // operation context, which must not be released while they are running.
      const rows = await Promise.allSettled(page.objects.slice(offset, offset + 4).map(async ({ key: path }) => {
        const id = decodeURIComponent(path.slice(prefix.length, -5));
        const row = await read(kind, id);
        return row ? { id, ...row } : null;
      }));
      for (const row of rows) {
        if (row.status === 'rejected') throw row.reason;
        if (row.value) result.push(row.value);
      }
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
