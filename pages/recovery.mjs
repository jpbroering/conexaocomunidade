import { openJson, openBytes, decode64 } from '../lib/vault.mjs';
export async function validateSnapshot(store, snapshot) {
  if (!snapshot.objects.size) throw Error('O commit não contém uma base de dados.');
  const records = new Map(), data = new Map();
  for (const [path, sha] of snapshot.objects) {
    const text = await store.text(sha), envelope = JSON.parse(text);
    records.set(path, text);
    if (envelope.version === 1) data.set(path, await openJson(store.config.key, path, envelope));
    else if (envelope.version !== 2 || envelope.algorithm !== 'AES-256-GCM') throw Error('Envelope inválido: ' + path);
  }
  const validatedImages = new Set();
  for (const [path, meta] of data) if (/\/v1\/(company-images|about-assets|photos)\//.test(path)) {
    const id = decodeURIComponent(path.split('/').pop().slice(0, -5));
    if (!records.has(meta.binaryKey)) throw Error('Imagem ausente: ' + path);
    const envelope = JSON.parse(records.get(meta.binaryKey));
    await openBytes(store.config.key, meta.tenant || meta.company_id, id, decode64(envelope.iv), decode64(envelope.body));
    validatedImages.add(meta.binaryKey);
  }
  for (const path of records.keys()) if (path.includes('/image-files/') && !validatedImages.has(path)) throw Error('Imagem sem metadados: ' + path);
  const recordKey = (kind, id) => `private-json/v1/${kind}/${encodeURIComponent(id)}.json`;
  for (const [path, row] of data) {
    if (path.includes('/companies/') && !row.deleted) for (const id of [row.company.logo, row.company.facade, ...(row.company.gallery || [])].filter(Boolean)) {
      const asset = data.get(recordKey('company-images', id));
      if (!asset || asset.company_id !== path.split('/').pop().slice(0, -5)) throw Error('Vínculo de imagem inválido: ' + path);
    }
    if (path.includes('/about-slots/') && row.image && !data.has(recordKey('about-assets', row.image))) throw Error('Foto institucional ausente.');
  }
  return records;
}
export async function restoreSnapshot(store, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha || '')) throw Error('Informe o SHA completo do commit a restaurar.');
  const saved = await store.snapshotAt(sha), records = await validateSnapshot(store, saved);
  const current = await store.begin();
  // Observe the entire current namespace, so a concurrent insertion cannot be
  // silently left out of a full restore.
  await current.list({ prefix: 'private-json/v1/' });
  for (const path of current.snapshot.objects.keys()) if (!saved.objects.has(path)) await current.delete(path);
  for (const [path, text] of records) await current.put(path, text);
  return current.commit('Restaurar base do protótipo a partir de ' + sha);
}
