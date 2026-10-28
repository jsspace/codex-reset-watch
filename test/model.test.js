import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, viewOf, alertKey, shouldNotify, settingsFrom, safeUrl, retryAt, MAX_AGE, MINUTE } from '../extension/model.js';
import { NOW, fixture, announcement } from './fixtures.js';

function snapshot(change) {
  const { forecast, timeline } = fixture();
  change?.(forecast, timeline);
  return normalize(forecast, timeline, NOW);
}
function state(data, extra = {}) { return { data, settings: settingsFrom({ language: 'zh-CN' }), deliveries: {}, ...extra }; }

test('uses documented rounded probability, never the 93-point signal score', () => {
  const data = snapshot();
  assert.equal(viewOf(state(data), NOW).badge, '46%');
  assert.equal(data.p48, 71);
});
test('a reset recorded today stays on the badge when no later high forecast exists', () => {
  const data = snapshot((_, t) => t.events.push(announcement()));
  const later = NOW + 90 * MINUTE;
  data.expiresAt = later + MAX_AGE;
  assert.equal(viewOf(state(data), later, { timeZone: 'Asia/Shanghai' }).badge, '今');
  assert.equal(viewOf(state(data), later, { timeZone: 'America/Los_Angeles' }).badge, '46%');
  assert.equal(data.event.kind, 'announced');
});
test('high rolling-window probabilities use day shorthand, with the 24-hour window first', () => {
  const today = snapshot(f => f.probabilities = { rounded_24h: 90, rounded_48h: 98 });
  const tomorrow = snapshot(f => f.probabilities = { rounded_24h: 46, rounded_48h: 90 });
  assert.equal(viewOf(state(today), NOW).badge, '今');
  assert.equal(viewOf(state(tomorrow), NOW).badge, '明');
  assert.match(viewOf(state(tomorrow), NOW).detail, /包含今天/);
  assert.equal(viewOf(state(snapshot()), NOW).badge, '46%');
});
test('tomorrow takes priority after a reset today if the later forecast reaches 90%', () => {
  const high = snapshot((f, t) => {
    f.probabilities = { rounded_24h: 92, rounded_48h: 95 };
    t.events.push(announcement());
  });
  const later = NOW + 90 * MINUTE;
  high.expiresAt = later + MAX_AGE;
  high.forecastAt = new Date(later).toISOString();
  assert.equal(viewOf(state(high), later, { timeZone: 'Asia/Shanghai' }).badge, '明');
  assert.equal(viewOf(state(high), later, { timeZone: 'America/Los_Angeles' }).badge, '今');
  high.forecastAt = new Date(NOW - 2 * MINUTE).toISOString();
  assert.equal(viewOf(state(high), later, { timeZone: 'Asia/Shanghai' }).badge, '今');
});
test('pending, banked, unknown, future and unsafe events never become reset announcements', () => {
  for (const overrides of [{ announcement_state: 'none' }, { group: 'credits' }, { group: 'unknown' },
    { announced_at: new Date(NOW + MINUTE).toISOString() }, { url: 'javascript:alert(1)' }]) {
    assert.equal(snapshot((_, t) => t.events.push(announcement(NOW, overrides))).event, null);
  }
});
test('history is sorted and old announcements stay off badge', () => {
  const data = snapshot((_, t) => t.events.push(announcement(NOW - 48 * 60 * MINUTE)));
  assert.equal(data.event, null);
  assert.ok(data.lastAnnouncement);
  const sorted = snapshot((_, t) => t.events.push(announcement(NOW, { id: 'old', announced_at: new Date(NOW - 3 * MINUTE).toISOString() }), announcement()));
  assert.equal(sorted.event.key, 'announced:reset-1');
});
test('official signal is separate from a verified announcement and retires after reset', () => {
  const signal = { tweet_id: 'signal-1', at: new Date(NOW - MINUTE).toISOString(), summary: 'A signal', url: 'https://x.com/thsottiaux/status/456' };
  const data = snapshot(f => f.official_signal = signal);
  assert.equal(data.event.kind, 'signal');
  assert.equal(viewOf(state(data), NOW).badge, '46%');
  assert.equal(snapshot(f => { f.official_signal = signal; f.last_reset_at = new Date(NOW).toISOString(); }).event, null);
});
test('network failure and local expiry immediately hide old data', () => {
  const data = snapshot();
  assert.equal(viewOf(state(data, { error: 'offline' }), NOW).badge, '?');
  assert.equal(viewOf(state(data), NOW + MAX_AGE).data, null);
});
test('rejects stale, missing timestamps, clock skew and malformed probabilities', () => {
  for (const change of [f => f.updated_at = 'invalid', f => f.updated_at = new Date(NOW - MAX_AGE - 1).toISOString(),
    f => f.updated_at = new Date(NOW + 6 * MINUTE).toISOString(), f => f.stale = true,
    f => f.probabilities.rounded_24h = null, f => f.probabilities.rounded_24h = 101,
    f => f.probabilities.rounded_48h = 10, (_, t) => t.events = null]) assert.throws(() => snapshot(change));
});
test('same forecast cycle deduplicates changing probabilities', () => {
  const data = snapshot(f => f.probabilities = { rounded_24h: 95, rounded_48h: 99 });
  const s = state(data);
  const key = alertKey(data, s.settings);
  assert.equal(shouldNotify(s, NOW), true);
  s.deliveries[key] = { notifiedAt: NOW - MINUTE };
  data.p24 = 99;
  assert.equal(shouldNotify(s, NOW), false);
  assert.equal(alertKey(data, s.settings), key);
});
test('repeat, read, snooze, notification disable and expiration rules', () => {
  const data = snapshot((_, t) => t.events.push(announcement()));
  const s = state(data);
  const key = alertKey(data, s.settings);
  s.deliveries[key] = { notifiedAt: NOW - 6 * MINUTE };
  s.settings.repeatMinutes = 5;
  assert.equal(shouldNotify(s, NOW), true);
  s.deliveries[key].read = true;
  assert.equal(shouldNotify(s, NOW), false);
  s.deliveries[key] = { snoozedUntil: NOW + MINUTE };
  assert.equal(shouldNotify(s, NOW), false);
  assert.equal(shouldNotify(s, NOW + MINUTE), true);
  s.settings.notifications = false;
  assert.equal(shouldNotify(s, NOW + MINUTE), false);
  s.settings.notifications = true;
  assert.equal(shouldNotify(s, NOW + MAX_AGE), false);
});
test('new announcement after a signal has an independent alert key', () => {
  const data = snapshot((_, t) => t.events.push(announcement()));
  const s = state(data, { deliveries: { 'signal:reset-1': { read: true } } });
  assert.equal(shouldNotify(s, NOW), true);
});
test('validates settings and source links', () => {
  assert.deepEqual(settingsFrom({ repeatMinutes: -1, threshold: 101 }), settingsFrom());
  for (const url of ['javascript:alert(1)', 'http://example.com/', 'https://user:secret@example.com/']) assert.equal(safeUrl(url), null);
});
test('Retry-After handles seconds, HTTP date and invalid input with minimum one minute', () => {
  assert.equal(retryAt('300', NOW), NOW + 5 * MINUTE);
  assert.equal(retryAt('1', NOW), NOW + MINUTE);
  assert.equal(retryAt(new Date(NOW + 10 * MINUTE).toUTCString(), NOW), NOW + 10 * MINUTE);
  assert.equal(retryAt('bad', NOW), NOW + 5 * MINUTE);
});


test('popup can display stale cache while badge and alerts remain strict', () => {
  const data = snapshot((_, t) => t.events.push(announcement()));
  const s = state(data, { error: 'offline' });
  const cached = viewOf(s, NOW, { allowCached: true });
  assert.equal(cached.data.p24, 46);
  assert.equal(cached.cached, true);
  assert.equal(cached.badge, '?');
  assert.equal(viewOf(s, NOW).data, null);
  assert.equal(shouldNotify(s, NOW), false);
  s.error = null;
  assert.equal(viewOf(s, NOW + MAX_AGE, { allowCached: true }).data, data);
  assert.equal(shouldNotify(s, NOW + MAX_AGE), false);
  assert.equal(viewOf(s, NOW).cached, false);
});

test('missing or corrupted cache never becomes display data', () => {
  const data = snapshot();
  for (const corrupted of [null, {}, { ...data, p24: '95' }, { ...data, p48: -1 }, { ...data, updatedAt: 'bad' },
    { ...data, event: { kind: 'announced', at: new Date(NOW).toISOString(), key: 'bad', url: 'javascript:alert(1)' } },
    { ...data, forecastAt: undefined }, { ...data, expiresAt: null }]) {
    assert.equal(viewOf(state(corrupted), NOW, { allowCached: true }).data, null);
  }
});
