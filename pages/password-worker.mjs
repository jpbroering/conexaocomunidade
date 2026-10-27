import { scryptAsync } from '@noble/hashes/scrypt.js';
self.onmessage = async ({ data: { id, password, salt } }) => {
  try {
    const hash = await scryptAsync(new TextEncoder().encode(password), new Uint8Array(salt), { N: 16384, r: 8, p: 5, dkLen: 32, maxmem: 32 * 1024 * 1024 });
    self.postMessage({ id, hash });
  } catch { self.postMessage({ id, error: 'Não foi possível verificar a senha. Tente novamente.' }); }
};
