import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, announcement } from './fixtures.js';

test('service worker polling, persistence, dedupe, controls and failure recovery', async () => {
  const listeners = {};
  const event = name => ({ addListener: fn => listeners[name] = fn });
  let stored = {};
  let calls = 0;
  let notifications = 0;
  let badge;
  let lastNotification;
  let title;
  let mode = 'success';
  let alarm;
  let releaseFetch;
  let fetchStarted;
  let startedPromise;
  const now = Date.now();
  const { forecast, timeline } = fixture(now);
  timeline.events.push(announcement(now));
  const previousChrome = globalThis.chrome;
  const previousFetch = globalThis.fetch;
  globalThis.chrome = {
    storage: { local: { get: async () => structuredClone(stored), set: async value => stored = { ...stored, ...structuredClone(value) } } },
    i18n: { getUILanguage: () => 'zh-CN' },
    action: { setBadgeText: async value => badge = value.text, setBadgeBackgroundColor: async () => {}, setTitle: async value => title = value.title },
    alarms: { get: async () => alarm, create: async (_, value) => alarm = value, onAlarm: event('alarm') },
    notifications: { create: async (_, value) => { notifications++; lastNotification = value; }, clear: async () => {}, onButtonClicked: event('button'), onClicked: event('click') },
    runtime: { id: 'test', onMessage: event('message'), onInstalled: event('install'), onStartup: event('startup') },
  };
  globalThis.fetch = async url => {
    calls++;
    if (mode === 'fail') throw new Error('offline');
    if (mode === 'slow') { fetchStarted(); await new Promise(resolve => releaseFetch = resolve); }
    return new Response(JSON.stringify(url.endsWith('forecast') ? forecast : timeline));
  };
  try {
    await import('../extension/background.js');
    const send = (type, extra = {}) => new Promise(resolve => listeners.message({ type, ...extra }, { id: 'test' }, resolve));
    const initial = await send('state');
    assert.equal(initial.state.data, undefined, 'first load can respond before networking');
    await send('refresh');
    assert.equal(stored.state.error, null);
    assert.equal(badge, '今');
    assert.equal(alarm.periodInMinutes, 1);
    assert.equal(calls, 2);
    assert.equal(notifications, 1);
    await Promise.all([send('refresh'), send('state'), send('refresh')]);
    assert.equal(calls, 2, 'rapid refresh cannot bypass one-minute throttle');
    assert.equal(notifications, 1, 'same event does not replay');
    stored.state.nextFetchAt = 0;
    mode = 'slow';
    startedPromise = new Promise(resolve => fetchStarted = resolve);
    const cached = await send('state');
    assert.equal(cached.state.data.p24, 46, 'state read returns cached data without waiting for fetch');
    await startedPromise;
    const anotherRead = await send('state');
    assert.equal(anotherRead.state.data.p24, 46, 'state remains readable while a fetch is in flight');
    mode = 'success';
    releaseFetch();
    await send('refresh');
    await send('snooze');
    assert.ok(stored.state.deliveries['announced:reset-1'].snoozedUntil > now);
    await send('read');
    assert.equal(stored.state.deliveries['announced:reset-1'].read, true);
    await send('settings', { settings: { notifications: false, sound: true, repeatMinutes: 15, threshold: 95 } });
    assert.equal(stored.state.settings.repeatMinutes, 15);
    mode = 'fail';
    stored.state.nextFetchAt = 0;
    const previousData = structuredClone(stored.state.data);
    const previousSuccess = stored.state.lastSuccessAt;
    const failed = await send('refresh');
    assert.equal(failed.state.error, 'offline');
    assert.deepEqual(failed.state.data, previousData, 'failed fetch never overwrites the last successful snapshot');
    assert.equal(failed.state.lastSuccessAt, previousSuccess);
    assert.equal(badge, '?');
    assert.equal(notifications, 1);
    mode = 'success';
    stored.state.nextFetchAt = 0;
    await send('refresh');
    assert.equal(badge, '今');
    assert.equal(stored.state.error, null);
    assert.equal(notifications, 1);
    await send('settings', { settings: { ...stored.state.settings, language: 'ar', sound: false } });
    assert.equal(badge, 'اليوم');
    assert.match(title, /اليوم/);
    const deliveriesBeforeTest = structuredClone(stored.state.deliveries);
    await send('test');
    assert.equal(lastNotification.title, 'تنبيهاتك جاهزة.');
    assert.deepEqual(lastNotification.buttons, []);
    assert.deepEqual(stored.state.deliveries, deliveriesBeforeTest);
    stored.state.data = undefined;
    await send('test');
    assert.equal(lastNotification.title, 'تنبيهاتك جاهزة.');
    assert.equal(stored.state.notificationError, null);
    await send('settings', { settings: { ...stored.state.settings, language: 'en' } });
    assert.equal(stored.languagePreference, 'en');
    stored.state.settings.language = 'auto';
    const restored = await send('state');
    assert.equal(restored.state.settings.language, 'en', 'explicit language survives stale state settings');
    await send('refresh');
  } finally { globalThis.chrome = previousChrome; globalThis.fetch = previousFetch; }
});
