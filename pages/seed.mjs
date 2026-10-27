import { scryptSync, randomBytes, randomUUID } from 'node:crypto';
import { sealJson } from '../lib/vault.mjs';
export const recordKey = (kind, id) => `private-json/v1/${kind}/${encodeURIComponent(id)}.json`;
export function passwordVerifier(password) {
  const salt = randomBytes(16);
  return { algorithm: 'scrypt-v1', salt: salt.toString('base64'), hash: scryptSync(password, salt, 32, { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 }).toString('base64') };
}
export async function makeSeed(master) {
  const records = new Map(), accounts = [], now = Date.now();
  const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
  const put = async (kind, id, data) => { const path = recordKey(kind, id); records.set(path, JSON.stringify({ version: 1, ...await sealJson(master, path, data) })); };
  for (const [username, name, role] of [['admin', 'Administração · demonstração', 'company-admin'], ['escola', 'Coordenação · demonstração', 'coordination'], ['empresa.demo', 'Empresa fictícia', 'company'], ['cliente.demo', 'Cliente fictício', 'client']]) {
    const password = 'Demo-' + randomBytes(18).toString('base64url'), id = randomUUID();
    const usernameKey = await digest('username:' + username);
    await put('users', usernameKey, { id, username, name, role, email: '', active: true, authVersion: 1, password: passwordVerifier(password), created_at: now });
    await put('clients', id, { owner: id, profile: { name, neighborhood: 'Frei Damião' }, created_at: now });
    accounts.push({ username, password, role, id });
  }
  const owner = accounts.find(a => a.role === 'company').id;
  for (const [i, name, category, district] of [[0, 'Padaria Exemplo · fictícia', 'Padaria', 'Frei Damião'], [1, 'Ateliê Exemplo · fictício', 'Costura', 'Brejaru'], [2, 'Horta Exemplo · fictícia', 'Alimentos', 'Frei Damião']]) {
    await put('companies', randomUUID(), { owner, configured: true, created_at: now, updated_at: now, company: { listingType: 'business', name, provider: 'Participante fictício', slogan: 'Exemplo para demonstração', category, district, products: category, description: 'Cadastro fictício criado exclusivamente para testar o protótipo.', address: 'Endereço ilustrativo · ' + district, hours: 'Horário ilustrativo', contact: '', lat: -27.668 - i * 0.002, lng: -48.667 - i * 0.002, logo: null, facade: null, gallery: [], services: [], privateNote: 'Somente dados de demonstração.', published: true } });
  }
  await put('reports', randomUUID(), { anonymous: true, name: '', contact: '', title: 'Relato fictício para demonstração', address: 'Local ilustrativo', description: 'Este relato serve para testar a leitura e a moderação pela equipe.', images: [], location: null, status: 'Aguardando aprovação', approval: 'pending', created_at: now, read_at: null });
  return { records, accounts };
}
