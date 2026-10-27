import { list } from './json-store';
export async function localDirectory() {
  const rows = await list('local-directory');
  return rows[0]?.data || { main: [], complementary: [], sourceDate: null };
}
export function directoryEntry(c: any) { return { ...c, title: c.name, kind: 'service', created_at: 0, status: 'Levantamento público', photo: null, mine: false, revision: undefined }; }
