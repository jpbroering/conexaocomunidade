import { context } from '../pages/context.mjs';
import { read, write, key } from './json-store';
import { encode64 } from './vault.mjs';
export const COOKIE = '__Host-conexao-session';
export async function digest(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), x => x.toString(16).padStart(2, '0')).join(''); }
export const normalizeUsername = (value: string) => value.trim().toLowerCase();
export const usernameKey = (value: string) => digest('username:' + normalizeUsername(value));
export async function sessionUser() {
  const token = context().token;
  if (!token) return null;
  const session = await read('sessions', await digest(token));
  if (!session || session.data.expires_at < Date.now()) { context().sessionChange = { token: null }; return null; }
  const user = await read('users', session.data.usernameKey);
  if (!user || !user.data.active || user.data.authVersion !== session.data.authVersion) { context().sessionChange = { token: null }; return null; }
  return { userId: user.data.id, displayName: user.data.name, email: user.data.email || '', fullName: user.data.name, role: user.data.role, auth: 'local' as const, usernameKey: session.data.usernameKey };
}
export async function newSession(user: any, userKey: string, remember = false) {
  const token = encode64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const duration = remember ? 30 * 86400 : 8 * 3600;
  await write('sessions', await digest(token), { usernameKey: userKey, authVersion: user.authVersion, expires_at: Date.now() + duration * 1000 }, null);
  context().sessionChange = { token, remember };
  return `${COOKIE}=${token}; Path=/${remember ? `; Max-Age=${duration}` : ''}`;
}
export async function removeSession(_request: Request) {
  const token = context().token;
  if (token) await context().transaction.delete(key('sessions', await digest(token)));
  context().sessionChange = { token: null };
  return `${COOKIE}=; Max-Age=0; Path=/`;
}
// A convenience limit for this browser, not an authoritative anti-abuse service.
export async function consumeAttempt(id: string, limit = 10) {
  const attempts = context().attempts, now = Date.now();
  const entry = attempts.get(id)?.until > now ? attempts.get(id) : { count: 0, until: now + 900000 };
  attempts.set(id, entry);
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}
