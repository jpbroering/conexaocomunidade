import { context } from '../pages/context.mjs';
import { encode64, decode64 } from './encoding.mjs';
let worker, nextId = 0;
const pending = new Map();
function derive(password, salt) {
  if (context().derive) return context().derive(password, salt);
  if (!worker) {
    worker = new Worker(new URL('./password-worker.js', context().baseUrl));
    worker.onmessage = ({ data }) => {
      const job = pending.get(data.id); if (!job) return;
      clearTimeout(job.timeout); pending.delete(data.id);
      data.error ? job.reject(Error(data.error)) : job.resolve(new Uint8Array(data.hash));
    };
    worker.onerror = () => {
      for (const job of pending.values()) { clearTimeout(job.timeout); job.reject(Error('Não foi possível iniciar a verificação de senha.')); }
      pending.clear(); worker.terminate(); worker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(Error('A verificação de senha demorou demais. Tente novamente.')); }, 60000);
    pending.set(id, { resolve, reject, timeout }); worker.postMessage({ id, password, salt });
  });
}
export async function passwordHash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { algorithm: 'scrypt-v1', salt: encode64(salt), hash: encode64(await derive(password, salt)) };
}
export async function passwordMatches(password, stored) {
  if (stored?.algorithm !== 'scrypt-v1') return false;
  const hash = await derive(password, decode64(stored.salt)), expected = decode64(stored.hash);
  let difference = hash.length ^ expected.length;
  for (let i = 0; i < hash.length; i++) difference |= hash[i] ^ (expected[i] || 0);
  return difference === 0;
}
export const validPassword = value => typeof value === 'string' && [...value].length >= 15 && [...value].length <= 128;
