import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sealJson, openJson, sealBytes, openBytes, encode64, decode64 } from '../lib/vault.mjs';
import { recordKey } from './seed.mjs';
const collections = new Set(['users', 'clients', 'companies', 'company-images', 'about-assets', 'about-slots', 'photos', 'reports', 'entries', 'ideas', 'local-directory']);
function validateRecord(path, data) {
  const kind = path.split('/')[2];
  if (!collections.has(kind) || !data || typeof data !== 'object' || Array.isArray(data)) throw Error('Registro inválido: ' + path);
  const text = (value, max) => typeof value === 'string' && value.length <= max;
  if (kind === 'users' && (!text(data.id, 200) || !text(data.username, 40) || !['owner', 'company-admin', 'coordination', 'company', 'client'].includes(data.role) || data.password?.algorithm !== 'scrypt-v1' || decode64(data.password.salt).length !== 16 || decode64(data.password.hash).length !== 32)) throw Error('Conta inválida: ' + path);
  if (kind === 'clients' && (!text(data.owner, 200) || data.profile && (!text(data.profile.name, 100) || !text(data.profile.neighborhood, 120)))) throw Error('Perfil inválido: ' + path);
  if (kind === 'companies' && !data.deleted && (!text(data.owner, 200) || !text(data.company?.name, 120) || !Array.isArray(data.company.gallery) || data.company.gallery.length + (data.company.facade ? 1 : 0) > 10)) throw Error('Empresa inválida: ' + path);
  if (kind === 'reports' && (!text(data.title, 120) || !text(data.address, 250) || !text(data.description, 3000) || !Array.isArray(data.images) || data.images.length > 3)) throw Error('Relato inválido: ' + path);
  if (kind === 'local-directory' && (!Array.isArray(data.main) || !Array.isArray(data.complementary))) throw Error('Levantamento inválido: ' + path);
}
export async function importArchive(source, oldKey, newKey, directoryKey) {
  if (!oldKey || decode64(oldKey).length !== 32) throw Error('Forneça OLD_MASTER_KEY_V1 para decifrar o acervo.');
  const paths = [];
  async function walk(dir) { for (const e of await readdir(resolve(source, dir), { withFileTypes: true })) e.isDirectory() ? await walk(dir + '/' + e.name) : paths.push(dir + '/' + e.name); }
  await walk('private-json/v1');
  const imported = new Map(), decoded = new Map();
  for (const path of paths.filter(p => p.endsWith('.json') && !p.includes('/image-files/') && !/\/(sessions|login-limits|password-resets)\//.test(p) && !p.endsWith('/migration-complete.json'))) {
    const envelope = JSON.parse(await readFile(resolve(source, path), 'utf8'));
    if (envelope.version !== 1) throw Error('Envelope não suportado: ' + path);
    const data = await openJson(oldKey, path, envelope);
    validateRecord(path, data);
    decoded.set(path, data);
  }
  for (const [path, meta] of decoded) {
    const match = path.match(/^private-json\/v1\/(company-images|about-assets|photos)\/([^/]+)\.json$/);
    if (!match) continue;
    const [, kind, encodedId] = match, id = decodeURIComponent(encodedId);
    const oldPath = meta.binaryKey || id;
    if (oldPath.includes('..') || oldPath.startsWith('/')) throw Error('Caminho legado inválido.');
    const raw = await readFile(resolve(source, oldPath));
    const tenant = meta.tenant || meta.company_id || 'client:' + meta.owner;
    let bytes;
    if (meta.storage === 'encrypted-json') {
      const envelope = JSON.parse(raw.toString('utf8'));
      if (envelope.version !== 2 || envelope.algorithm !== 'AES-256-GCM') throw Error('Imagem cifrada inválida.');
      bytes = await openBytes(oldKey, tenant, id, decode64(envelope.iv), decode64(envelope.body));
    } else bytes = meta.encrypted ? await openBytes(oldKey, tenant, id, raw.subarray(0, 12), raw.subarray(12)) : raw;
    const binaryKey = `private-json/v1/image-files/${kind}/${encodeURIComponent(tenant)}/${id}.json`;
    const sealed = await sealBytes(newKey, tenant, id, bytes);
    imported.set(binaryKey, JSON.stringify({ version: 2, algorithm: 'AES-256-GCM', iv: encode64(sealed.iv), body: encode64(sealed.bytes) }));
    decoded.set(path, { ...meta, tenant, binaryKey, storage: 'encrypted-json', encrypted: true });
  }
  let seed;
  try { seed = JSON.parse(await readFile(resolve(source, 'lib/local-directory-seed.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (seed && ![...decoded.keys()].some(p => p.startsWith('private-json/v1/local-directory/'))) {
    if (!directoryKey) throw Error('Forneça OLD_DIRECTORY_KEY_V1 para importar o levantamento cifrado.');
    const key = await crypto.subtle.importKey('raw', decode64(directoryKey), 'AES-GCM', false, ['decrypt']);
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode64(seed.iv), additionalData: new TextEncoder().encode(seed.aad) }, key, decode64(seed.body));
    const directory = JSON.parse(new TextDecoder().decode(bytes));
    if (directory.version !== 1 || directory.main?.length !== 467 || directory.complementary?.length !== 10) throw Error('Levantamento incompleto.');
    decoded.set(recordKey('local-directory', 'frei-damiao-brejaru-2026-10-08-v1'), directory);
  }
  for (const [path, data] of decoded) {
    if (path.includes('/companies/') && !data.deleted) {
      if (!data.owner || !data.company?.name) throw Error('Empresa inválida: ' + path);
      for (const id of [data.company.logo, data.company.facade, ...(data.company.gallery || [])].filter(Boolean)) if (!decoded.has(recordKey('company-images', id))) throw Error('A exportação não contém todos os metadados das imagens: ' + id);
    }
    if (path.includes('/entries/')) for (const id of [data.photo, ...(data.gallery || [])].filter(Boolean)) if (!decoded.has(recordKey('photos', id))) throw Error('Foto legada ausente: ' + id);
    if (path.includes('/about-slots/') && data.image && !decoded.has(recordKey('about-assets', data.image))) throw Error('Foto institucional ausente.');
    imported.set(path, JSON.stringify({ version: 1, ...await sealJson(newKey, path, data) }));
  }
  return imported;
}
