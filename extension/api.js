import { MINUTE, SOURCE, fresh, normalize, retryAt, timestamp } from './model.js';

export async function fetchSnapshot(fetcher = fetch, now = Date.now()) {
  // Sequential requests: a 429 on either route stops all subsequent requests.
  const payloads = [];
  let expiresAt = Infinity;
  for (const route of ['api/forecast', 'api/timeline']) {
    const response = await fetcher(new URL(route, SOURCE).href, {
      credentials: 'omit', cache: 'no-cache', redirect: 'error', signal: AbortSignal.timeout(12_000),
    });
    if (response.status === 429) {
      const error = new Error('rateLimited');
      error.retryAt = retryAt(response.headers.get('Retry-After'), now);
      throw error;
    }
    if (!response.ok) throw new Error(`消息源返回 HTTP ${response.status}`);
    const checked = response.headers.get('x-published-checked-at');
    const expires = response.headers.get('x-published-expires-at');
    if ((checked && !fresh(checked, now)) || (expires && (!Number.isFinite(timestamp(expires)) || timestamp(expires) <= now))) {
      throw new Error('publishedStale');
    }
    if (expires) expiresAt = Math.min(expiresAt, timestamp(expires));
    const body = await response.text();
    if (body.length > 2_000_000) throw new Error('responseLarge');
    payloads.push(JSON.parse(body));
  }
  const data = normalize(...payloads, now);
  data.expiresAt = Math.min(data.expiresAt, expiresAt);
  return { data, nextFetchAt: now + MINUTE };
}
