import playwright, { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { buildPages } from '../build.mjs';
import { makeSeed } from '../seed.mjs';
import { FakeGithub } from './fake-github.mjs';

const realFirefox = process.env.BROWSER === 'firefox';
const directory = await buildPages({preview:true});
const key = randomBytes(32).toString('base64'), seed = await makeSeed(key), github = new FakeGithub();
await github.seed(seed.records);
const config = {owner:'test',repo:'project',branch:'dados-prototipo',token:'fake-upgrade-token',key};
// Reproduce the previous worker's cache policy, which discarded ?v= when
// looking up the unversioned feedback script. Keep this fixture independent
// from future worker changes: it represents an already installed release.
const legacyWorker = `
const scope = new URL(self.registration.scope);
const cacheName = 'conexao-pages:' + scope.pathname + ':legacy-upgrade-test';
const paths = ['offline.html','assets/js/ui-feedback.js'].map(path => new URL(path,scope).href);
self.addEventListener('install',event=>event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll(paths))));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const url = new URL(event.request.url); url.search='';
  if (event.request.method !== 'GET' || url.origin !== scope.origin) return;
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request).catch(()=>caches.match(paths[0])));
  else if(paths.includes(url.href)) event.respondWith(caches.open(cacheName).then(cache=>cache.match(url.href)).then(saved=>saved||fetch(event.request)));
});`;
let legacy = true;
const server = createServer(async (req,res) => {
  const url = new URL(req.url,'http://localhost');
  const name = decodeURIComponent(url.pathname.slice('/conexaocomunidade/'.length)) || 'index.html';
  if (!url.pathname.startsWith('/conexaocomunidade/')) {res.writeHead(404);res.end();return;}
  const send = (body,type='text/javascript')=>{res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);};
  if(name === 'runtime-config.json') return send(JSON.stringify(config),'application/json');
  if(name === 'legacy-install.html') return send('<meta charset="utf-8"><script src="./assets/js/ui-feedback.js"></script><script>navigator.serviceWorker.register("./sw.js")</script><h1>Versão anterior</h1>','text/html');
  if(legacy && name === 'sw.js') return send(legacyWorker);
  if(legacy && name === 'assets/js/ui-feedback.js') return send('window.ccUI={setBusy(){},message(){},refreshWhileVisible(){}};');
  if(name.startsWith('__github/')) {
    const chunks=[];for await(const chunk of req) chunks.push(chunk);
    const result=await github.fetch('https://api.github.com/'+name.slice('__github/'.length)+url.search,{method:req.method,body:Buffer.concat(chunks).toString()||undefined});
    res.writeHead(result.status,{'Content-Type':'application/json'});res.end(await result.text());return;
  }
  const path=resolve(directory,name);
  if(!path.startsWith(directory+'/')){res.writeHead(404);res.end();return;}
  try {const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};send(await readFile(path),types[extname(path)]||'application/octet-stream');}
  catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/conexaocomunidade/`;
let browser;
try {
  browser=realFirefox ? await playwright._bidiFirefox.launch({executablePath:process.env.FIREFOX_PATH||'/usr/bin/firefox',headless:true})
    : await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext();
  await context.addInitScript(base=>{
    const request=window.fetch.bind(window);
    window.fetch=(input,init)=>typeof input==='string'&&input.startsWith('https://api.github.com/')
      ?request(base+'__github/'+input.slice('https://api.github.com/'.length),init):request(input,init);
  },base);
  await context.route('**/*',route=>route.request().url().startsWith(base)||/^(blob:|data:)/.test(route.request().url())?route.continue():route.abort());
  const page=await context.newPage(), errors=[];page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'legacy-install.html');
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  legacy=false;
  const stale=await page.evaluate(async()=>await(await fetch('./assets/js/ui-feedback.js?v=new-release')).text());
  assert(!stale.includes('preserveView'),'the legacy cache ignores a new query version and still serves its old helper');
  await page.goto(base+'teste.html');
  await page.locator('#catalogue .company-card').first().waitFor();
  assert.equal(await page.evaluate(()=>typeof ccUI.preserveView),'function','new document bypasses the old script cache by filename');
  assert.equal(await page.evaluate(()=>typeof ccUI.startOperation),'function');
  assert(await page.evaluate(async()=>(await caches.keys()).some(name=>name.endsWith(':legacy-upgrade-test'))),'old worker cache is still installed during migration');
  await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting);
  await page.goto(base+'comunidade.html');
  await page.locator('#places .place-row').first().waitFor();
  await page.locator('#prototype-update button').waitFor();
  await Promise.all([page.waitForEvent('load'),page.locator('#prototype-update button').click()]);
  await page.locator('#places .place-row').first().waitFor();
  await page.waitForFunction(async()=>!(await caches.keys()).some(name=>name.endsWith(':legacy-upgrade-test')));
  await mkdir(resolve(directory,'../.prototype/ux'),{recursive:true});
  await page.screenshot({path:resolve(directory,`../.prototype/ux/pwa-upgrade-${realFirefox?'firefox':'chromium'}.png`)});
  await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  await context.setOffline(true);
  await page.goto(base+'entrar.html');
  await page.getByRole('heading',{name:'Vamos nos reconectar.'}).waitFor();
  assert.equal(await page.evaluate(()=>typeof ccUI.preserveView),'function','offline page uses its own fingerprinted helper');
  const offlineStyle=await page.evaluate(async()=>(await fetch(document.querySelector('link[href*="ui-feedback"]').href)).status);
  assert.equal(offlineStyle,200);
  assert.deepEqual(errors,[]);
  console.log(`PASS (${realFirefox?'Firefox real':'Chromium'}): upgrade com cache antigo, catálogo e mapa, ativação da nova PWA e recursos offline sem mistura de scripts.`);
} finally {await browser?.close();if(server.listening)await new Promise(resolve=>server.close(resolve));}
