import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../dist-pages');
const base = process.env.PAGES_BASE_PATH || '/conexaocomunidade/';
if (!/^\/[\w/-]*\/$/.test(base) && base !== '/') throw Error('PAGES_BASE_PATH deve começar e terminar com /.');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/' && base !== '/') { response.writeHead(302, { Location: base }); response.end(); return; }
    if (!['GET', 'HEAD'].includes(request.method) || !url.pathname.startsWith(base)) throw Error();
    const relative = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html';
    const path = resolve(directory, relative);
    if (!path.startsWith(directory + sep) || !(await stat(path)).isFile()) throw Error();
    response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : await readFile(path));
  } catch { response.writeHead(404); response.end('Página não encontrada.'); }
});
server.listen(Number(process.env.PORT || 5173), '127.0.0.1', () => console.log(`Prévia: http://127.0.0.1:${server.address().port}${base}`));
