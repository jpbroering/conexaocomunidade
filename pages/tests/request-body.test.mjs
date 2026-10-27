import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

let readJsonBody, readImageForm, RequestError;
before(async () => {
  const output = new URL('../.test-build/request-body.mjs', import.meta.url);
  await mkdir(new URL('./', output), { recursive: true });
  await build({ entryPoints: [new URL('../../lib/request-body.ts', import.meta.url).pathname], outfile: output.pathname, platform: 'node', format: 'esm', target: 'es2022', logLevel: 'warning' });
  ({ readJsonBody, readImageForm, RequestError } = await import(output.href));
});

function request(body, withoutStream, headers = { 'Content-Type': 'application/json' }) {
  const result = new Request('https://prototype.local/api/auth', { method: 'POST', headers, body });
  if (withoutStream) Object.defineProperty(result, 'body', { value: undefined });
  return result;
}

function failure(status, message) {
  return error => error instanceof RequestError && error.status === status && error.message === message;
}

for (const withoutStream of [false, true]) {
  const mode = withoutStream ? 'without Request.body (Firefox)' : 'with a body stream';
  test(`JSON decoding and exact byte limits ${mode}`, async () => {
    const data = { name: 'João', note: 'ação 🧵' }, body = JSON.stringify(data);
    const size = new TextEncoder().encode(body).byteLength;
    assert.deepEqual(await readJsonBody(request(body, withoutStream), size), data);
    await assert.rejects(readJsonBody(request(body, withoutStream), size - 1), failure(413, 'Conteúdo muito grande.'));
    const announced = request(body, withoutStream, { 'Content-Type': 'application/json', 'Content-Length': String(size) });
    await assert.rejects(readJsonBody(announced, size - 1), failure(413, 'Conteúdo muito grande.'));
    assert.equal(announced.bodyUsed, false, 'reject an excessive Content-Length before reading');
  });

  test(`JSON errors retain their status and message ${mode}`, async () => {
    await assert.rejects(readJsonBody(request('{}', withoutStream, {}), 100), failure(415, 'Envie os dados em JSON.'));
    for (const body of ['', '{', new Uint8Array([0xff])]) {
      await assert.rejects(readJsonBody(request(body, withoutStream), 100), failure(400, 'Dados JSON inválidos.'));
    }
    for (const body of ['null', '[]', 'true', '12', '"texto"']) {
      await assert.rejects(readJsonBody(request(body, withoutStream), 100), failure(400, 'Dados inválidos.'));
    }
  });

  test(`multipart images and errors ${mode}`, async () => {
    const bytes = new Uint8Array([0, 1, 2, 255]), form = new FormData();
    form.set('company', 'test-company');
    form.set('image', new File([bytes], 'test.png', { type: 'image/png' }));
    const decoded = await readImageForm(request(form, withoutStream, {}));
    assert.equal(decoded.get('company'), 'test-company');
    assert.equal(decoded.get('image').name, 'test.png');
    assert.deepEqual(new Uint8Array(await decoded.get('image').arrayBuffer()), bytes);
    await assert.rejects(readImageForm(request('{}', withoutStream)), failure(415, 'Envie a imagem pelo formulário.'));
    await assert.rejects(readImageForm(request('invalid', withoutStream, { 'Content-Type': 'multipart/form-data; boundary=test' })), failure(400, 'Formulário de imagem inválido.'));
  });
}

test('stream overflow cancels reading and releases the lock', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"name":"too large"}')); },
    cancel() { cancelled = true; },
  });
  const input = new Request('https://prototype.local/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, duplex: 'half' });
  await assert.rejects(readJsonBody(input, 2), failure(413, 'Conteúdo muito grande.'));
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});

test('stream read errors propagate and release the lock', async () => {
  const cause = new Error('read failed');
  const stream = new ReadableStream({ start(controller) { controller.error(cause); } });
  const input = new Request('https://prototype.local/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, duplex: 'half' });
  await assert.rejects(readJsonBody(input, 100), error => error === cause);
  assert.equal(stream.locked, false);
});
