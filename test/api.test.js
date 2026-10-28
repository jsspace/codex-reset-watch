import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSnapshot } from '../extension/api.js';
import { NOW, fixture } from './fixtures.js';
import { MINUTE } from '../extension/model.js';

test('fetches only documented read-only endpoints without credentials', async () => {
  const { forecast, timeline } = fixture();
  const calls = [];
  const result = await fetchSnapshot(async (url, options) => {
    calls.push(url);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify(calls.length === 1 ? forecast : timeline));
  }, NOW);
  assert.deepEqual(calls, ['https://codex-reset.com/api/forecast', 'https://codex-reset.com/api/timeline']);
  assert.equal(result.data.p24, 46);
  assert.equal(result.nextFetchAt, NOW + MINUTE);
});
test('429 stops subsequent requests and carries backoff', async () => {
  let calls = 0;
  await assert.rejects(fetchSnapshot(async () => {
    calls++;
    return new Response('', { status: 429, headers: { 'Retry-After': '600' } });
  }, NOW), error => error.retryAt === NOW + 10 * MINUTE);
  assert.equal(calls, 1);
});
test('publication headers override otherwise fresh JSON', async () => {
  for (const headers of [
    { 'x-published-checked-at': '2020-01-01T00:00:00Z' },
    { 'x-published-expires-at': new Date(NOW - 1).toISOString() },
  ]) await assert.rejects(fetchSnapshot(async () => new Response(JSON.stringify(fixture().forecast), { headers }), NOW));
});
test('honors the earliest publication expiry', async () => {
  const { forecast, timeline } = fixture();
  let calls = 0;
  const result = await fetchSnapshot(async () => new Response(JSON.stringify(++calls === 1 ? forecast : timeline), {
    headers: { 'x-published-expires-at': new Date(NOW + calls * MINUTE).toISOString() },
  }), NOW);
  assert.equal(result.data.expiresAt, NOW + MINUTE);
});
test('rejects HTTP errors, broken JSON and failed networking', async () => {
  await assert.rejects(fetchSnapshot(async () => new Response('', { status: 503 }), NOW));
  await assert.rejects(fetchSnapshot(async () => new Response('not json'), NOW));
  await assert.rejects(fetchSnapshot(async () => { throw new Error('offline'); }, NOW));
});
