import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { buildPages } from '../build.mjs';
import { makeSeed } from '../seed.mjs';
import { FakeGithub } from './fake-github.mjs';
const directory = await buildPages({ preview: true }), key = randomBytes(32).toString('base64');
const seed = await makeSeed(key), github = new FakeGithub(); await github.seed(seed.records);
const config = { owner: 'test', repo: 'project', branch: 'dados-prototipo', token: 'fake-browser-token', key };
const errors = [], failed = [], external = [];
const openPages = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/conexaocomunidade/')) { res.writeHead(404); res.end(); return; }
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
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const createContext = async () => {
    const context = await browser.newContext();
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
  const firstContext = await createContext(), secondContext = await createContext();
  const referenceRoute = '**/git/ref/heads/dados-prototipo';
  async function holdPageReads(context, pageName) {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const handler = async route => {
      if (new URL(route.request().frame().url()).pathname.endsWith('/' + pageName)) await gate;
      await route.fallback();
    };
    await context.route(referenceRoute, handler);
    return async () => { release(); await context.unroute(referenceRoute, handler); };
  }
  // Exercise Firefox's missing Request.body with both JSON and image forms.
  const withoutRequestStream = () => Object.defineProperty(Request.prototype, 'body', { configurable: true, get: () => undefined });
  await firstContext.addInitScript(withoutRequestStream);
  const first = await firstContext.newPage(), second = await secondContext.newPage();
  const signupContext = await createContext(), signup = await signupContext.newPage();
  await signupContext.addInitScript(withoutRequestStream);
  await signup.goto(base + 'cadastro.html');
  const signupForm = signup.locator('#signup-company');
  const signupUsername = signupForm.locator('[name=username]');
  await signupUsername.fill('usuário inválido');
  assert.equal(await signupUsername.evaluate(input => input.validity.patternMismatch), true);
  for (const [name, value] of Object.entries({ name: 'Empresa criada pelo formulário', email: 'teste@example.com', username: 'cadastro.navegador-teste', password: 'Senha longa do cadastro fictício!', confirmPassword: 'Senha longa do cadastro fictício!' })) {
    await signupForm.locator(`[name=${name}]`).fill(value);
  }
  await signupForm.locator('[name=confirmPassword]').fill('Confirmação diferente e longa!');
  await signupForm.locator('button').click();
  await signup.getByRole('alert').filter({ hasText: 'As senhas precisam ser iguais' }).waitFor();
  await signup.locator('.cc-page-loading').waitFor({ state: 'hidden' });
  assert.equal(await signupUsername.inputValue(), 'cadastro.navegador-teste');
  assert.equal(await signupForm.locator('button').isEnabled(), true);
  await signupForm.locator('[name=confirmPassword]').fill('Senha longa do cadastro fictício!');
  const releaseSignup = await holdPageReads(signupContext, 'cadastro.html');
  const releaseAccount = await holdPageReads(signupContext, 'teste.html');
  try {
    await signupForm.locator('button').click();
    await signup.locator('.cc-page-loading').filter({ hasText: 'Criando sua conta' }).waitFor();
    await releaseSignup();
    await signup.waitForURL(/teste\.html\?area=business/);
    await signup.locator('.cc-page-loading').filter({ hasText: 'Carregando sua conta' }).waitFor();
    assert.equal(await signup.locator('#business-entry').isDisabled(), true);
    assert.equal(await signup.locator('#business-login').isDisabled(), true);
    await mkdir(resolve(directory, '../.prototype'), { recursive: true });
    await signup.screenshot({ path: resolve(directory, '../.prototype/account-loading-check.png'), fullPage: true });
  } finally { await releaseSignup(); await releaseAccount(); }
  await signup.locator('#company-form').waitFor();
  await signup.locator('.cc-page-loading').waitFor({ state: 'hidden' });
  const heading = signup.locator('.company-form-heading');
  await heading.waitFor();
  const desktopHeading = await heading.evaluate(element => {
    const title = element.querySelector('#form-title').getBoundingClientRect();
    const back = element.querySelector('a').getBoundingClientRect();
    return { title, back };
  });
  assert(desktopHeading.title.right < desktopHeading.back.left, 'company title remains left of the back button');
  assert(Math.abs((desktopHeading.title.top + desktopHeading.title.bottom) / 2 - (desktopHeading.back.top + desktopHeading.back.bottom) / 2) < 2, 'company title and back button share a desktop row');
  await signup.setViewportSize({ width: 390, height: 844 });
  const mobileHeading = await heading.evaluate(element => {
    const title = element.querySelector('#form-title').getBoundingClientRect();
    const back = element.querySelector('a').getBoundingClientRect();
    return { title, back, titleText: element.querySelector('#form-title').textContent };
  });
  assert(mobileHeading.title.bottom + 11 <= mobileHeading.back.top, 'mobile back button follows the title with 12px spacing');
  assert(Math.abs(mobileHeading.title.left - mobileHeading.back.left) < 1, 'mobile title and back button are left aligned');
  assert.match(mobileHeading.titleText, /Cadastre seu negócio/);
  await signup.locator('.company-form-heading a').focus();
  assert.equal(await signup.evaluate(() => document.activeElement?.textContent.trim()), '← Voltar ao perfil', 'back button remains keyboard focusable');
  await signup.setViewportSize({ width: 1280, height: 720 });
  await signupContext.close();
  let releaseCatalogue;
  const catalogueGate = new Promise(resolve => { releaseCatalogue = resolve; });
  await firstContext.route(referenceRoute, async route => { await catalogueGate; await route.fallback(); });
  try {
    await first.goto(base);
    await first.locator('#catalogue-status').filter({ hasText: 'Carregando empresas' }).waitFor();
    await first.getByRole('button', { name: 'Sou empresa', exact: true }).click();
    await first.locator('.cc-page-loading').filter({ hasText: 'Carregando sua conta' }).waitFor();
    assert.equal(await first.locator('#business-entry').isDisabled(), true);
    assert.equal(await first.locator('#business-login').isDisabled(), true);
    assert.equal(await first.locator('#business-login').evaluate(link => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))), false, 'disabled account links cannot navigate');
    await first.getByRole('button', { name: 'Sou cliente', exact: true }).click();
    assert.equal(await first.locator('#empty').isVisible(), false, 'do not show an empty catalogue before it loads');
    assert.equal(await first.locator('#catalogue-status').evaluate(element => getComputedStyle(element, '::before').animationName), 'cc-spin');
    const loadingBox = await first.locator('#catalogue-status').boundingBox();
    assert(loadingBox.height >= 144);
    assert.equal(await first.locator('#catalogue-status').evaluate(element => getComputedStyle(element).textAlign), 'center');
    await first.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await first.locator('#catalogue-status').evaluate(element => getComputedStyle(element, '::before').animationName), 'none');
    await first.emulateMedia({ reducedMotion: 'no-preference' });
    await mkdir(resolve(directory, '../.prototype'), { recursive: true });
    await first.screenshot({ path: resolve(directory, '../.prototype/loading-check.png'), fullPage: true });
  } finally { releaseCatalogue(); }
  await first.locator('#catalogue .company-card').first().waitFor();
  assert.equal(await first.locator('#catalogue-status').isVisible(), false);
  assert.equal(await first.locator('#business-entry').isEnabled(), true);
  assert.equal(await first.locator('#business-login').isEnabled(), true);
  await firstContext.unroute(referenceRoute);
  const account = seed.accounts.find(a => a.role === 'company');
  await first.goto(base + 'entrar.html');
  await first.locator('#login [name=username]').fill(account.username);
  await first.locator('#login [name=password]').fill(account.password);
  const releaseLogin = await holdPageReads(firstContext, 'entrar.html');
  try {
    await first.locator('#login button').click();
    await first.locator('.cc-page-loading').filter({ hasText: 'Entrando na sua conta' }).waitFor();
  } finally { await releaseLogin(); }
  await first.waitForURL(/teste\.html/); // Uses the real browser scrypt Worker.
  await first.locator('#business-account-nav').click();
  await first.locator('#company-form [name=name]').fill('Empresa fictícia conferida no navegador');
  await first.locator('#save-company').click();
  await first.locator('#message').filter({ hasText: 'Empresa salva' }).waitFor();
  await second.goto(base);
  await second.getByText('Empresa fictícia conferida no navegador', { exact: true }).first().waitFor();
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/TsAAAAASUVORK5CYII=','base64');
  await first.locator('#facade-file').setInputFiles({ name: 'teste.png', mimeType: 'image/png', buffer: image });
  await first.locator('#message').filter({ hasText: 'Imagem salva' }).waitFor();
  await first.locator('.facade-preview-image').scrollIntoViewIfNeeded();
  await first.waitForFunction(() => [...document.querySelectorAll('#company-form img')].some(img => img.src.startsWith('blob:')));
  const scope = await first.evaluate(async () => { const registration = await navigator.serviceWorker.ready; return registration.scope; });
  assert.equal(scope, base);
  const manifest = await (await second.request.get(base + 'manifest.webmanifest')).json(); assert.equal(new URL(manifest.scope, base).href, base);
  const releaseMap = await holdPageReads(secondContext, 'comunidade.html');
  try {
    await second.getByRole('link', { name: 'Mapa comunitário', exact: true }).click();
    await second.locator('.cc-page-loading').filter({ hasText: 'Carregando o mapa comunitário' }).waitFor();
    assert.equal(await second.locator('#community-status').isVisible(), false, 'keep only the popup while the map loads');
    await second.screenshot({ path: resolve(directory, '../.prototype/map-loading-check.png'), fullPage: true });
  } finally { await releaseMap(); }
  await second.locator('#community-status').waitFor({ state: 'hidden' });
  await second.locator('.cc-page-loading').waitFor({ state: 'hidden' });
  await second.goto(base + 'recuperar.html'); await second.getByText('Solicite à administração', { exact: false }).waitFor();
  await first.getByRole('button', { name: 'Sou empresa', exact: true }).click();
  const releaseBusiness = await holdPageReads(firstContext, 'teste.html');
  try {
    await first.locator('#business-entry').click();
    await first.waitForURL(/teste\.html\?area=business/);
    await first.locator('.cc-page-loading').filter({ hasText: 'Carregando sua conta' }).waitFor();
  } finally { await releaseBusiness(); }
  await first.locator('#company-form').waitFor();
  await first.locator('.cc-page-loading').waitFor({ state: 'hidden' });
  const releaseSession = await holdPageReads(firstContext, 'teste.html');
  try {
    await first.goto(base + 'teste.html?area=client');
    await first.locator('.cc-page-loading').filter({ hasText: 'Carregando sua conta' }).waitFor();
    assert.equal(await first.locator('#business-entry').isDisabled(), true);
  } finally { await releaseSession(); }
  await first.locator('#catalogue .company-card').first().waitFor();
  await first.locator('.cc-page-loading').waitFor({ state: 'hidden' });
  assert.equal(await first.locator('#business-login').isVisible(), false);
  assert.equal(await first.locator('#business-entry').getAttribute('aria-disabled'), 'false');
  assert.equal(await first.locator('#business-access h2').textContent(), 'Sua conta está conectada.');
  await mkdir(resolve(directory, '../.prototype'), { recursive: true });
  await first.screenshot({ path: resolve(directory, '../.prototype/browser-check.png'), fullPage: true });
  const unavailableContext = await createContext();
  await unavailableContext.route(referenceRoute, route => route.fulfill({ status: 401, headers: { 'Access-Control-Allow-Origin': '*' }, json: { message: 'Bad credentials' } }));
  const unavailable = await unavailableContext.newPage();
  await unavailable.goto(base);
  await unavailable.locator('#catalogue-status').filter({ hasText: 'Não foi possível carregar' }).waitFor();
  assert.equal(await unavailable.locator('#empty').isVisible(), false, 'a failed load is not an empty catalogue');
  assert.equal(await unavailable.locator('#business-entry').isDisabled(), true);
  await unavailableContext.unroute(referenceRoute);
  await unavailable.locator('#search').fill('Padaria');
  await unavailable.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await unavailable.locator('#catalogue .company-card').first().waitFor();
  assert.equal(await unavailable.locator('#search').inputValue(), 'Padaria');
  assert.equal(await unavailable.locator('#retry-catalogue').isVisible(), false);
  await unavailableContext.close();
  assert.deepEqual(errors, [], 'Browser errors'); assert.deepEqual(failed, [], 'Missing local assets');
  assert(!external.some(url => /chatgpt\.site|pages-bridge/.test(url)));
  await first.waitForFunction(() => !!navigator.serviceWorker.controller);
  // Chromium may still fetch from a Service Worker when Playwright marks its
  // context offline. Stop the origin too, so the navigation must use the cache.
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await firstContext.setOffline(true); await first.goto(base + 'entrar.html');
  await first.getByRole('heading', { name: /reconectar|conexão|offline|internet/i }).waitFor();
  assert.equal(await first.evaluate(() => typeof ccUI.setBusy), 'function', 'versioned feedback script is available offline');
  assert.equal(await first.evaluate(async () => { const url = document.querySelector('link[href*="ui-feedback"]').href; return (await fetch(url)).status; }), 200, 'the offline cache serves the exact fingerprinted style used by the document');
  console.log('PASS: cadastro pelo formulário, validação de usuário, interface em subpasta, scrypt no Worker, login, gravação entre dois navegadores, imagem decifrada, mapa, recuperação administrativa, escopo PWA e página offline.');
} catch (error) { console.error(JSON.stringify({ pageErrors: errors, failedAssets: failed, githubCalls: github.calls.slice(-8), messages: await Promise.all(openPages.map(p => p.evaluate(() => document.getElementById("message")?.textContent).catch(() => "closed"))) })); throw error; } finally { await browser?.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
