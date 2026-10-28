import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../../public/assets/js/ui-feedback.js', import.meta.url), 'utf8');
function scheduler() {
  const timers = new Map(), listeners = new Map(), main = {append(node) {this.meta = node;}};
  let next = 0;
  const element = () => ({children:[], append(...nodes) {this.children.push(...nodes);}});
  const document = {visibilityState:'visible', createElement:element, querySelector:() => main,
    addEventListener:(name, handler) => listeners.set(name, handler)};
  const window = {addEventListener() {}};
  runInNewContext(source, {window, document, sessionStorage:{getItem:()=>null, removeItem() {}},
    setTimeout:(fn, delay) => {timers.set(++next,{fn,delay});return next;}, clearTimeout:id=>timers.delete(id)});
  const nextTimer = () => {const [id, timer] = timers.entries().next().value; timers.delete(id); return timer;};
  return {window, document, listeners, main, timers, nextTimer};
}

test('refresh pauses in hidden or busy screens, prevents overlapping reads and backs off on failures', async () => {
  const env = scheduler(); let calls = 0, allowed = true, release;
  let response = () => new Promise(resolve => {release=resolve;});
  env.window.ccUI.refreshWhileVisible(() => {calls++;return response();}, () => allowed);
  const first = env.nextTimer(); assert.equal(first.delay,30000);
  const pending = first.fn();
  await env.listeners.get('visibilitychange')();
  assert.equal(calls,1,'returning to the tab cannot overlap an in-flight read');
  release(true); await pending;
  response = async () => true;
  env.document.visibilityState = 'hidden'; await env.nextTimer().fn();
  assert.equal(calls,1,'hidden pages do not poll');
  env.document.visibilityState = 'visible'; allowed=false;
  await env.listeners.get('visibilitychange')(); assert.equal(calls,1,'writes prevent refresh');
  allowed=true; response=async()=>false;
  await env.listeners.get('visibilitychange')();
  const retry=env.nextTimer(); assert.equal(retry.delay,60000);
  await retry.fn(); assert.equal(env.nextTimer().delay,120000);
  response=async()=>true;
  await env.main.meta.children[1].onclick();
  assert.equal(env.nextTimer().delay,30000,'successful manual retry restores normal cadence');
});
