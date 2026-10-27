import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
export const originalCommit = 'ef3c2443ad2eebdeb74ca29fc1e20c48c0d2a291';
export async function archiveInventory(root, create = false) {
  const inventoryPath = resolve(root, 'archive/inventory.json');
  if (create) {
    const paths = ['lib/local-directory-seed.json'];
    async function walk(dir) { for (const e of await readdir(resolve(root, dir), { withFileTypes: true })) e.isDirectory() ? await walk(dir + '/' + e.name) : paths.push(dir + '/' + e.name); }
    await walk('private-json');
    const files = [];
    for (const path of paths.sort()) { const bytes = await readFile(resolve(root, path)); files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
    await mkdir(resolve(root, 'archive'), { recursive: true });
    await writeFile(inventoryPath, JSON.stringify({ version: 1, originalCommit, note: 'Acervo cifrado anterior, sem as chaves. Não integra a base fictícia nem o pacote do Pages.', files }, null, 2) + '\n');
  }
  const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
  for (const file of inventory.files) {
    const bytes = await readFile(resolve(root, file.path));
    if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw Error('O acervo original foi alterado: ' + file.path);
  }
  return inventory;
}
