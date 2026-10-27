import { createClient } from './api';
import { StoreError, validateConfig } from './github-store.mjs';
const baseUrl = new URL('./', (document.currentScript as HTMLScriptElement).src);
const sessionKey = 'conexao-prototype-session-v1';
const sessions = {
  get: () => sessionStorage.getItem(sessionKey) || localStorage.getItem(sessionKey),
  set(token: string, remember: boolean) { sessions.clear(); (remember ? localStorage : sessionStorage).setItem(sessionKey, token); },
  clear() { sessionStorage.removeItem(sessionKey); localStorage.removeItem(sessionKey); releaseImages(); },
};
const client = fetch(new URL('runtime-config.json', baseUrl), { cache: 'no-store' }).then(async response => {
  if (!response.ok) throw new StoreError('O protótipo ainda não foi configurado pela equipe.');
  let config;
  try { config = await response.json(); }
  catch { throw new StoreError('A configuração publicada do protótipo está inválida. Recarregue a página; se continuar, avise a equipe responsável.'); }
  return createClient(validateConfig(config), { sessions, baseUrl });
});
// Attach a rejection handler immediately, including on presentation-only pages.
client.catch(() => {});
async function ccFetch(path: string, options?: RequestInit) {
  try { return await (await client).request(path, options); }
  catch (error: any) { return Response.json({ error: error.message || 'O protótipo está indisponível.' }, { status: 503 }); }
}
const imagePrefix = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=#cc-image=';
function ccImage(path: string) { return imagePrefix + encodeURIComponent(path); }
const images = new Map<HTMLImageElement, string>();
const pending = new WeakSet<HTMLImageElement>();
function releaseImages() { for (const [img, url] of images) { URL.revokeObjectURL(url); img.removeAttribute('src'); } images.clear(); }
async function resolveImage(img: HTMLImageElement) {
  const raw = img.getAttribute('src');
  if (!raw?.startsWith(imagePrefix) || pending.has(img)) return;
  pending.add(img);
  try {
    const response = await ccFetch(decodeURIComponent(raw.slice(imagePrefix.length)));
    if (!response.ok) { const data = await response.json(); throw Error(data.error); }
    const blob = await response.blob();
    if (!img.isConnected || img.getAttribute('src') !== raw) return;
    const old = images.get(img); if (old) URL.revokeObjectURL(old);
    const url = URL.createObjectURL(blob); images.set(img, url); img.src = url;
  } catch (error: any) { img.title = error.message; img.alt = img.alt || 'Imagem indisponível'; }
  finally { pending.delete(img); }
}
const visible = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) { visible!.unobserve(entry.target); resolveImage(entry.target as HTMLImageElement); }
}, { rootMargin: '200px' }) : null;
function scan(node: Node) {
  if (!(node instanceof Element)) return;
  const found = node instanceof HTMLImageElement ? [node] : [...node.querySelectorAll('img')];
  for (const img of found) if (img.getAttribute('src')?.startsWith(imagePrefix)) visible ? visible.observe(img) : resolveImage(img);
}
new MutationObserver(records => {
  for (const record of records) record.type === 'attributes' ? scan(record.target) : record.addedNodes.forEach(scan);
  for (const [img, url] of images) if (!img.isConnected || img.src !== url) { URL.revokeObjectURL(url); images.delete(img); }
}).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
window.addEventListener('pagehide', releaseImages);
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
Object.assign(window, { ccFetch, ccImage, ccPath: (path: string) => new URL(path.replace(/^\//, ''), baseUrl).href });
if ('serviceWorker' in navigator) window.addEventListener('load', () => {
  navigator.serviceWorker.register(new URL('sw.js', baseUrl), { scope: baseUrl.pathname }).then(registration => {
    const offerUpdate = () => {
      if (!registration.waiting || document.getElementById('prototype-update')) return;
      const notice = document.createElement('aside'); notice.id = 'prototype-update'; notice.className = 'notice'; notice.setAttribute('role', 'status');
      const message = document.createElement('p'); message.textContent = 'Há uma nova versão. Salve seus formulários antes de atualizar.';
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = 'Atualizar aplicativo';
      button.onclick = () => {
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
        registration.waiting?.postMessage({ type: 'ACTIVATE' });
      };
      notice.append(message, button); document.body.prepend(notice);
    };
    offerUpdate();
    registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', () => { if (navigator.serviceWorker.controller) offerUpdate(); });
    });
  }).catch(() => {});
});
