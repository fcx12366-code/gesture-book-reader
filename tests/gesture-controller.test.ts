import test from 'node:test';
import assert from 'node:assert/strict';
import { GestureController, type GestureState } from '../src/gesture.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function environment(getUserMedia: () => Promise<MediaStream>, secure = true) {
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const win = Object.assign(new EventTarget(), { isSecureContext: secure });
  for (const [name, value] of Object.entries({ window: win, document: doc, navigator: { mediaDevices: { getUserMedia } } })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true });
  }
  let stops = 0;
  const track = { stop: () => { stops++; }, onended: null };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  const video = { srcObject: null, muted: false, playsInline: false, pause() {}, play: () => Promise.resolve() } as unknown as HTMLVideoElement;
  const statuses: { text: string; state: GestureState }[] = [];
  const controller = new GestureController(video, { onStatus: (text, state) => statuses.push({ text, state }), onFlip: () => assert.fail('Unexpected flip') });
  return { controller, stream, video, statuses, doc, get stops() { return stops; },
    restore() {
      controller.stop();
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    } };
}

test('constructing the controller never requests camera access', () => {
  let calls = 0;
  const env = environment(async () => { calls++; throw new Error('Must not open'); });
  try { assert.equal(env.controller.active, false); assert.equal(calls, 0); }
  finally { env.restore(); }
});
test('insecure origins fail explicitly without requesting a camera', async () => {
  let calls = 0;
  const env = environment(async () => { calls++; throw new Error('Must not open'); }, false);
  try {
    await env.controller.start();
    assert.equal(calls, 0); assert.equal(env.controller.active, false);
    assert.equal(env.statuses.at(-1)?.state, 'error'); assert.match(env.statuses.at(-1)!.text, /localhost.*HTTPS/);
  } finally { env.restore(); }
});
test('denied permissions produce actionable feedback and never retry automatically', async () => {
  let calls = 0;
  const env = environment(async () => { calls++; throw new DOMException('Denied', 'NotAllowedError'); });
  try {
    await env.controller.start(); await Promise.resolve();
    assert.equal(calls, 1); assert.equal(env.controller.active, false);
    assert.match(env.statuses.at(-1)!.text, /权限被拒绝.*地址栏.*手动/);
  } finally { env.restore(); }
});
test('missing and busy camera failures are distinguished', async () => {
  for (const [name, expected] of [['NotFoundError', /未找到摄像头/], ['NotReadableError', /占用/]] as const) {
    const env = environment(async () => { throw new DOMException('Unavailable', name); });
    try { await env.controller.start(); assert.match(env.statuses.at(-1)!.text, expected); }
    finally { env.restore(); }
  }
});
test('stop while permission is pending immediately cancels startup and closes a late stream', async () => {
  const access = deferred<MediaStream>();
  const env = environment(() => access.promise);
  try {
    const starting = env.controller.start(); assert.equal(env.controller.active, true);
    env.controller.stop(); await starting;
    assert.equal(env.controller.active, false);
    access.resolve(env.stream); await Promise.resolve(); await Promise.resolve();
    assert.equal(env.stops, 1); assert.equal(env.video.srcObject, null);
    assert.equal(env.statuses.at(-1)?.state, 'off');
  } finally { env.restore(); }
});
test('duplicate start calls share the in-progress camera request', async () => {
  let calls = 0;
  const access = deferred<MediaStream>();
  const env = environment(() => { calls++; return access.promise; });
  try {
    const first = env.controller.start(); await env.controller.start();
    assert.equal(calls, 1); env.controller.stop(); await first;
    access.resolve(env.stream); await Promise.resolve();
  } finally { env.restore(); }
});
test('stop after capture begins releases tracks even while video playback is pending', async () => {
  const playback = deferred<void>();
  const env = environment(async () => env.stream);
  env.video.play = () => playback.promise;
  try {
    const starting = env.controller.start(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.equal(env.video.srcObject, env.stream);
    env.controller.stop(); await starting;
    assert.equal(env.stops, 1); assert.equal(env.video.srcObject, null);
    playback.resolve();
  } finally { env.restore(); }
});
test('hiding the page closes capture and does not restart on return', async () => {
  let calls = 0;
  const playback = deferred<void>();
  const env = environment(async () => { calls++; return env.stream; });
  env.video.play = () => playback.promise;
  try {
    const starting = env.controller.start(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    env.doc.hidden = true; env.doc.dispatchEvent(new Event('visibilitychange')); await starting;
    assert.equal(env.stops, 1); assert.equal(env.controller.active, false);
    env.doc.hidden = false; env.doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(calls, 1); assert.match(env.statuses.at(-1)!.text, /手动开启/);
    playback.resolve();
  } finally { env.restore(); }
});
test('rapid stop and restart keeps the new session independent from an old camera request', async () => {
  const first = deferred<MediaStream>(), second = deferred<MediaStream>();
  let requests = 0;
  const env = environment(() => ++requests === 1 ? first.promise : second.promise);
  const playback = deferred<void>(); env.video.play = () => playback.promise;
  try {
    const oldStart = env.controller.start(); env.controller.stop();
    const newStart = env.controller.start(); await oldStart;
    first.resolve(env.stream); await Promise.resolve(); await Promise.resolve();
    assert.equal(env.controller.active, true); assert.equal(env.stops, 1);
    second.resolve(env.stream); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.equal(env.video.srcObject, env.stream);
    env.controller.stop(); await newStart; playback.resolve(); assert.equal(env.stops, 2);
  } finally { env.restore(); }
});
