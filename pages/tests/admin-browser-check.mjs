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
const directory = await buildPages({ preview: true }), key = randomBytes(32).toString('base64');
const seed = await makeSeed(key), github = new FakeGithub(); await github.seed(seed.records);
const config = { owner: 'test', repo: 'project', branch: 'dados-prototipo', token: 'fake-browser-token', key };
const errors = [], failed = [], external = [];
const openPages = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/conexaocomunidade/')) { res.writeHead(404); res.end(); return; }
  if (url.pathname.startsWith('/conexaocomunidade/__github/')) {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const response = await github.fetch('https://api.github.com/' + url.pathname.split('/__github/')[1] + url.search, {method:req.method, body:Buffer.concat(chunks).toString() || undefined});
    res.writeHead(response.status, {'Content-Type':'application/json'}); res.end(await response.text()); return;
  }
  const name = decodeURIComponent(url.pathname.slice('/conexaocomunidade/'.length)) || 'index.html';
  const path = resolve(directory, name);
  if (!path.startsWith(directory + '/')) { res.writeHead(404); res.end(); return; }
  try {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }); res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/conexaocomunidade/`;
let browser;
try {
  browser = realFirefox
    ? await playwright._bidiFirefox.launch({executablePath:process.env.FIREFOX_PATH || '/usr/bin/firefox', headless:true})
    : await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const installClock = page => realFirefox ? Promise.resolve() : page.clock.install();
  const advance = page => realFirefox ? page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))) : page.clock.runFor(30001);
  const createContext = async () => {
    const context = await browser.newContext();
    // The experimental Firefox BiDi interceptor does not expose POST bodies.
    // A local HTTP proxy keeps actual request bodies intact in the real browser.
    if (realFirefox) await context.addInitScript(base => {
      const request = window.fetch.bind(window);
      window.fetch = (input, init) => {
        if (typeof input === 'string' && input.startsWith('https://api.github.com/')) {
          return request(base + '__github/' + input.slice('https://api.github.com/'.length), init);
        }
        return request(input, init);
      };
    }, base);

    context.on('page', page => { openPages.push(page); page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message)); page.on('response', response => { if (response.url().startsWith(base) && response.status() >= 400) failed.push(response.url()); }); });
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (url === base + 'runtime-config.json') return route.fulfill({ json: config });
      if (url.startsWith('https://api.github.com/')) {
        const request = route.request();
        const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-GitHub-Api-Version", "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS" };
        if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
        const response = await github.fetch(url, { method: request.method(), body: request.postData() || undefined });
        return route.fulfill({ status: response.status, headers: cors, contentType: 'application/json', body: await response.text() });
      }
      if (url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
      external.push(url); return route.abort();
    });
    return context;
  };

  const adminContext = await createContext(), visitorContext = await createContext();
  const admin = await adminContext.newPage(), visitor = await visitorContext.newPage();
  const call = (page, path, method = 'GET', body) => page.evaluate(async ({path, method, body}) => {
    const response = await ccFetch(path, {method, ...(body ? {headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)} : {})});
    const data = await response.json(); if (!response.ok) throw Error(data.error); return data;
  }, {path, method, body});
  await admin.goto(base + 'entrar.html');
  const account = seed.accounts.find(a => a.role === 'company-admin');
  await admin.locator('#login [name=username]').fill(account.username);
  await admin.locator('#login [name=password]').fill(account.password);
  await admin.locator('#login button').click();
  await admin.waitForURL(/teste\.html/);
  const company = (await call(admin, '/api/companies')).companies.find(c => c.mine);
  async function upload(kind = 'gallery', replace = null) {
    const current = (await call(admin, '/api/companies')).companies.find(c => c.id === company.id);
    return admin.evaluate(async ({company, kind, replace}) => {
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAIAAAAUMWhjAAAAJElEQVR4nGOQmxZAU8QwasGoBaMWjFowasGoBaMWjFowNCwAANLeDC6aod+eAAAAAElFTkSuQmCC'), c => c.charCodeAt(0));
      const data = new FormData(); data.set('company', company.id); data.set('revision', company.revision); data.set('kind', kind); if (replace) data.set('replace', replace); data.set('image', new File([bytes], 'teste.png', {type:'image/png'}));
      const response = await ccFetch('/api/company-image', {method:'POST', body:data});
      const result = await response.json(); if (!response.ok) throw Error(result.error); return result;
    }, {company:current, kind, replace});
  }
  await upload(); await upload();
  await admin.goto(base + 'admin-imagens.html');
  const panel = admin.locator('#images > section').filter({has: admin.getByRole('heading', {name:company.name, exact:true})});
  await panel.locator('.moderation-photo').nth(1).waitFor();
  await installClock(visitor);
  await visitor.goto(base);
  await visitor.locator(`.company-card[data-id="${company.id}"]`).click();
  await visitor.locator('.detail-gallery img').last().scrollIntoViewIfNeeded();
  await visitor.waitForFunction(() => [...document.querySelectorAll('.detail-gallery img')].filter(img => img.naturalWidth > 1 || img.src.startsWith('blob:')).length === 2);
  const removedId = await panel.locator('.moderation-photo').first().getAttribute('data-id');
  const retainedUrl = await visitor.locator(`.detail-gallery img:not([data-media-id="${removedId}"])`).getAttribute('src');
  await visitor.locator('route-guide').getByRole('combobox').selectOption('walking');
  let accept = false;
  admin.on('dialog', dialog => accept ? dialog.accept() : dialog.dismiss());
  const writesBeforeCancel = github.updates;
  await panel.locator('.moderation-photo').first().getByRole('button', {name:'Excluir', exact:true}).click();
  assert.equal(github.updates, writesBeforeCancel, 'cancel does not write');
  assert.equal(await admin.locator('.cc-operation-notice:visible').count(), 0, 'cancel does not show progress or success');
  accept = true;
  await admin.evaluate(() => {
    const request = window.ccFetch;
    let release; const gate = new Promise(resolve => { release = resolve; });
    window.releaseDelete = release;
    window.ccFetch = async (path, init) => { if (init?.method === 'DELETE') await gate; return request(path, init); };
  });
  await panel.locator('.moderation-photo').first().getByRole('button', {name:'Excluir', exact:true}).click();
  await admin.locator('.cc-operation-notice').filter({hasText:'Excluindo imagem'}).waitFor();
  assert.equal(await panel.locator('.moderation-photo').first().getByRole('button', {name:'Excluindo imagem…'}).isDisabled(), true);
  const progress = await admin.locator('.cc-operation-notice').boundingBox();
  assert(progress.y >= 0 && progress.y + progress.height <= 720, 'feedback is visible without scrolling to the top');
  await admin.evaluate(() => releaseDelete());
  await admin.locator('#status').filter({hasText:'Alteração salva. Lista atualizada.'}).waitFor();
  await advance(visitor);
  await visitor.waitForFunction(() => document.querySelectorAll('.detail-gallery img').length === 1, {timeout:12000});
  assert.equal(await visitor.locator('#details').evaluate(dialog => dialog.open), true);
  assert.equal(await panel.locator('.moderation-photo').count(), 1);

  assert.equal(await visitor.locator('.detail-gallery img').getAttribute('src'), retainedUrl, 'the remaining image keeps its live object URL');
  assert.equal(await visitor.locator('route-guide').getByRole('combobox').inputValue(), 'walking', 'route selection survives refresh');
  const mapPage = await visitorContext.newPage();
  await installClock(mapPage);
  await mapPage.goto(base + 'comunidade.html');
  await mapPage.locator('#places .place-row').filter({hasText:company.name}).click();
  await mapPage.locator('#details-body img').scrollIntoViewIfNeeded();
  await panel.locator('.moderation-photo').getByRole('button', {name:'Excluir', exact:true}).click();
  await panel.locator('.moderation-photo').waitFor({state:'detached'});
  await advance(visitor); await advance(mapPage);
  await visitor.locator('.cc-empty-gallery').waitFor();
  await mapPage.locator('.cc-empty-gallery').waitFor();
  assert.equal(await mapPage.locator('#place-details').evaluate(dialog => dialog.open), true);
  assert.equal(await visitor.locator('.detail-gallery img').count(), 0);
  // A transient binary-blob failure stays retryable, without masquerading as deletion.
  const uploaded = await upload();
  const binarySha = [...github.files()].find(([path]) => path.includes('image-files/') && path.includes(uploaded.id))[1];
  github.failure = path => path.endsWith(binarySha) ? Response.json({message:'temporary failure'}, {status:503}) : null;
  await visitor.evaluate(id => {
    const img = document.createElement('img'); img.id = 'failed-image'; img.src = ccImage('/api/company-image?id=' + id);
    document.querySelector('.detail-gallery').append(img);
  }, uploaded.id);
  await visitor.locator('.cc-image-error').getByRole('button').waitFor();
  assert.equal(await visitor.locator('#failed-image').isVisible(), false);
  github.failure = null;
  await visitor.locator('.cc-image-error button').click();
  await visitor.waitForFunction(() => document.getElementById('failed-image').dataset.imageState === 'ready');
  await visitor.evaluate(() => document.getElementById('failed-image').remove());
  // A source changed during a held blob request must eventually resolve the newer image.
  const delayed = await upload(), newer = await upload();
  const delayedSha = [...github.files()].find(([path]) => path.includes('image-files/') && path.includes(delayed.id))[1];
  let releaseImage;
  const imageGate = new Promise(resolve => { releaseImage = resolve; });
  await visitorContext.route('**/git/blobs/' + delayedSha, async route => { await imageGate; await route.fallback(); });
  await visitor.evaluate(id => {
    const img = document.createElement('img'); img.id = 'changing-image'; img.src = ccImage('/api/company-image?id=' + id);
    document.querySelector('.detail-gallery').append(img);
  }, delayed.id);
  await visitor.waitForFunction(() => document.getElementById('changing-image').dataset.imageState === 'loading');
  await visitor.evaluate(id => { document.getElementById('changing-image').src = ccImage('/api/company-image?id=' + id); }, newer.id);
  releaseImage();
  await visitor.waitForFunction(() => document.getElementById('changing-image').dataset.imageState === 'ready');
  assert((await visitor.locator('#changing-image').getAttribute('data-cc-source')).includes(newer.id));
  await visitor.evaluate(() => document.getElementById('changing-image').remove());
  // Approval and replacement also update an already open gallery.
  await advance(visitor);
  await visitor.locator(`[data-media-id="${uploaded.id}"]`).waitFor();
  async function review(id, approval) {
    const data = await call(admin, '/api/admin-images');
    const image = data.companies.flatMap(c => c.images).find(image => image.id === id);
    await call(admin, '/api/company-image', 'PATCH', {id, revision:image.revision, approval});
  }
  await review(uploaded.id, 'rejected'); await advance(visitor);
  await visitor.locator(`.detail-gallery [data-media-id="${uploaded.id}"]`).waitFor({state:'detached'});
  await review(uploaded.id, 'approved'); await advance(visitor);
  await visitor.locator(`.detail-gallery [data-media-id="${uploaded.id}"]`).waitFor();
  const replacement = await upload('gallery', uploaded.id); await advance(visitor);
  await visitor.locator(`.detail-gallery [data-media-id="${uploaded.id}"]`).waitFor({state:'detached'});
  await visitor.locator(`.detail-gallery [data-media-id="${replacement.id}"]`).waitFor();
  const logo = await upload('logo'), facade = await upload('facade');
  await advance(visitor); await advance(mapPage);
  await mapPage.locator(`[data-media-id="${facade.id}"]`).waitFor();
  const latest = (await call(admin, '/api/companies')).companies.find(c => c.id === company.id);
  await call(admin, '/api/company-image', 'DELETE', {company:company.id, revision:latest.revision, id:facade.id});
  await advance(mapPage);
  await mapPage.locator(`[data-media-id="${facade.id}"]`).waitFor({state:'detached'});
  await mapPage.locator(`[data-media-id="${logo.id}"]`).waitFor();
  // Local unsaved fields survive a remote change and a rejected stale write.
  const editor = await adminContext.newPage(); await installClock(editor);
  await editor.goto(base + 'entrar.html');
  await call(editor, '/api/auth', 'POST', account);
  await editor.goto(base + 'teste.html?area=business-panel');
  await editor.locator(`#owned [data-id="${company.id}"]`).click();
  await editor.locator('#company-form [name=name]').fill('Minha edição não salva');
  const saved = (await call(admin, '/api/companies')).companies.find(c => c.id === company.id);
  await call(admin, '/api/companies', 'POST', {id:company.id, revision:saved.revision, data:{...saved, name:'Nome atualizado remotamente'}});
  await advance(editor);
  await editor.locator('#remote-company-change').waitFor();
  assert.equal(await editor.locator('#company-form [name=name]').inputValue(), 'Minha edição não salva');
  await editor.locator('#save-company').click();
  await editor.locator('#message').filter({hasText:/alterada|mudou|versão/}).waitFor();
  assert.equal(await editor.locator('#company-form [name=name]').inputValue(), 'Minha edição não salva');
  editor.on('dialog', dialog => dialog.accept());
  await editor.locator('#remote-company-change button').click();
  assert.equal(await editor.locator('#company-form [name=name]').inputValue(), 'Nome atualizado remotamente');
  await editor.close();
  // Shared feedback remains above an open modal and expires only after success.
  await visitor.evaluate(() => { window.finishModalOperation = ccUI.startOperation(null, 'Atualizando detalhes…'); });
  await visitor.locator('.cc-operation-notice:visible').waitFor();
  assert.equal(await visitor.locator('.cc-operation-notice').evaluate(element => element.matches(':popover-open')), true);
  await visitor.evaluate(() => finishModalOperation('Detalhes atualizados.'));
  if (!realFirefox) {
    await visitor.clock.runFor(5001);
    assert.equal(await visitor.locator('.cc-operation-notice').isVisible(), false);
  }
  await visitor.close(); await mapPage.close();
  // Coordination serializes form values before disabling inputs for the request.
  const coordinator = await adminContext.newPage(); await installClock(coordinator);
  await coordinator.goto(base + 'entrar.html');
  await call(coordinator, '/api/auth', 'POST', seed.accounts.find(a => a.role === 'coordination'));
  await coordinator.goto(base + 'coordenacao.html');
  const coordinationCard = coordinator.locator(`#coordination-list [data-id="${company.id}"]`);
  await coordinationCard.getByText('Editar dados básicos', {exact:true}).click();
  await coordinationCard.locator('[name=name]').fill('Cadastro conferido pela coordenação');
  await coordinationCard.getByRole('button', {name:'Salvar alterações', exact:true}).click();
  await coordinationCard.getByText('Alterações salvas.', {exact:true}).waitFor();
  const confirmed = (await call(admin, '/api/companies')).companies.find(c => c.id === company.id);
  assert.equal(confirmed.name, 'Cadastro conferido pela coordenação');
  await coordinator.close();
  // Real page layouts, including empty states and auth forms, at the agreed widths.
  const evidence = resolve(directory, '../.prototype/ux', realFirefox ? 'firefox' : 'chromium');
  await mkdir(evidence, {recursive:true});
  const widths = [360,390,768,1280];
  const guest = await visitorContext.newPage();
  for (const pageName of ['admin-imagens.html','admin-relatos.html','admin-logs.html','contas.html','teste.html','comunidade.html','entrar.html','cadastro.html','relatar.html','recuperar.html','redefinir.html','coordenacao.html']) {
    const layoutPage = ['entrar.html','cadastro.html','relatar.html','recuperar.html','redefinir.html'].includes(pageName) ? guest : admin;
    await layoutPage.goto(base + pageName);
    await layoutPage.waitForFunction(() => typeof ccUI === 'object');
    if (pageName === 'admin-imagens.html') await admin.locator('#images section').first().waitFor();
    for (const width of widths) {
      await layoutPage.setViewportSize({width, height:width === 1280 ? 600 : 844});
      const overflow = await layoutPage.evaluate(() => ({scroll:document.documentElement.scrollWidth, width:innerWidth}));
      assert(overflow.scroll <= overflow.width + 1, `${pageName} overflows at ${width}px: ${JSON.stringify(overflow)}`);
      await layoutPage.screenshot({path:resolve(evidence, `${pageName}-${width}.png`)});
    }
  }
  await admin.setViewportSize({width:1280,height:600});
  await admin.evaluate(() => { document.documentElement.style.zoom = '2'; });
  assert(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '200% CSS zoom keeps the page within the viewport');
  await admin.screenshot({path:resolve(evidence, 'zoom-200.png')});
  await admin.evaluate(() => { document.documentElement.style.zoom = ''; });
  assert.deepEqual(errors, []);
  console.log('PASS: exclusão entre sessões, última foto, mapa aberto, URL preservada, cancelamento, progresso visível, retry de imagem, respostas atrasadas, conflito sem perda de campos e responsividade em 12 páginas/4 larguras.');
} catch (error) { console.error(JSON.stringify({pageErrors:errors, states:await Promise.all(openPages.filter(p=>!p.isClosed()).map(p=>p.evaluate(()=>({url:location.pathname,status:document.querySelector('#status, #message')?.textContent})).catch(()=>null)))})); throw error; } finally { await browser?.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
