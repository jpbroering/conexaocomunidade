export { encode64, decode64 } from './encoding.mjs';
import { encode64, decode64 } from './encoding.mjs';
const utf8 = new TextEncoder();
export async function tenantKey(master, tenant) {
  const raw = decode64(master);
  if (raw.length !== 32) throw Error('Invalid encryption key');
  const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: utf8.encode(tenant), info: utf8.encode('conexao-company-v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function sealBytes(master, tenant, aad, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return { iv, bytes: new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(aad) }, await tenantKey(master, tenant), bytes)) };
}
export async function openBytes(master, tenant, aad, iv, bytes) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(aad) }, await tenantKey(master, tenant), bytes));
}
export async function sealJson(master, tenant, data) { const e = await sealBytes(master, tenant, tenant, utf8.encode(JSON.stringify(data))); return { body: encode64(e.bytes), iv: encode64(e.iv) }; }
export async function openJson(master, tenant, row) { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await openBytes(master, tenant, tenant, decode64(row.iv), decode64(row.body)))); }
