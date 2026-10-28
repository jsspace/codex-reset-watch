import { LANGUAGES, translator, isSameLocalDay } from './i18n.js';

export const SOURCE = 'https://codex-reset.com/';
export const MINUTE = 60_000;
export const MAX_AGE = 15 * MINUTE;
export const DAY_BADGE_THRESHOLD = 90;
export const DEFAULT_SETTINGS = { notifications: true, sound: false, repeatMinutes: 0, threshold: 90, language: 'auto', theme: 'auto' };

export function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function timestamp(value) {
  return typeof value === 'string' ? Date.parse(value) : NaN;
}

export function fresh(value, now) {
  const time = timestamp(value);
  return Number.isFinite(time) && time <= now + 5 * MINUTE && now - time <= MAX_AGE;
}

export function settingsFrom(input = {}) {
  return {
    theme: ['auto', 'light', 'dark'].includes(input.theme) ? input.theme : 'auto',
    language: input.language === 'auto' || Object.hasOwn(LANGUAGES, input.language) ? input.language : 'auto',
    notifications: typeof input.notifications === 'boolean' ? input.notifications : true,
    sound: input.sound === true,
    repeatMinutes: [0, 5, 15, 30, 60].includes(input.repeatMinutes) ? input.repeatMinutes : 0,
    threshold: [80, 90, 95, 99].includes(input.threshold) ? input.threshold : 90,
  };
}

// Only documented fields are used. A site's verified announcement is not
// evidence that execution has completed for the user's account.
export function normalize(forecast, timeline, now = Date.now()) {
  if (!forecast || !timeline || !fresh(forecast.updated_at, now) ||
      !fresh(timeline.updated_at, now) || forecast.stale === true || timeline.stale === true) {
    throw new Error('dataStale');
  }
  const p24 = forecast.probabilities?.rounded_24h;
  const p48 = forecast.probabilities?.rounded_48h;
  if (![p24, p48].every(p => Number.isInteger(p) && p >= 0 && p <= 100) || p48 < p24 ||
      !Array.isArray(timeline.events)) throw new Error('dataFormat');
  const updatedAt = new Date(Math.min(timestamp(forecast.updated_at), timestamp(timeline.updated_at))).toISOString();
  const resets = timeline.events.filter(event => event && typeof event.id === 'string' &&
    event.group === 'reset' && event.announcement_state === 'announced' &&
    Number.isFinite(timestamp(event.announced_at)) && timestamp(event.announced_at) <= now &&
    safeUrl(event.url)).sort((a, b) => timestamp(b.announced_at) - timestamp(a.announced_at));
  const last = resets[0];
  // Keep historical resets in the detail panel, not on today's badge.
  const recent = last && now - timestamp(last.announced_at) <= 24 * 60 * MINUTE ? last : null;
  const signal = forecast.official_signal;
  const signalTime = timestamp(signal?.at);
  const lastTime = Math.max(timestamp(last?.announced_at) || 0, timestamp(forecast.last_reset_at) || 0);
  const activeSignal = signal && typeof signal.tweet_id === 'string' && safeUrl(signal.url) &&
    signalTime > lastTime && signalTime <= now && now - signalTime <= 24 * 60 * MINUTE;
  let event = null;
  if (activeSignal) event = { key: `signal:${signal.tweet_id}`, kind: 'signal', at: signal.at,
    summary: String(signal.summary || '').slice(0, 1000), url: safeUrl(signal.url) };
  if (recent && (!event || timestamp(recent.announced_at) >= signalTime)) {
    event = { key: `announced:${recent.id}`, kind: 'announced', at: recent.announced_at,
      summary: String(recent.summary || '').slice(0, 1000), url: safeUrl(recent.url) };
  }
  return { p24, p48, updatedAt, forecastAt: forecast.updated_at, confidence: String(forecast.confidence || 'unknown'),
    lastResetAt: forecast.last_reset_at || null,
    lastAnnouncement: last ? { at: last.announced_at, url: safeUrl(last.url), summary: String(last.summary || '').slice(0, 1000) } : null,
    event, expiresAt: timestamp(updatedAt) + MAX_AGE };
}

export function cachedDataOf(state) {
  const data = state?.data;
  if (!data || !Number.isFinite(timestamp(data.updatedAt)) || !Number.isFinite(timestamp(data.forecastAt)) ||
      !Number.isFinite(data.expiresAt) || ![data.p24, data.p48].every(p => Number.isInteger(p) && p >= 0 && p <= 100) || data.p48 < data.p24) return null;
  if (data.event && (!['signal', 'announced'].includes(data.event.kind) || !safeUrl(data.event.url) ||
      !Number.isFinite(timestamp(data.event.at)) || typeof data.event.key !== 'string')) return null;
  if (data.lastAnnouncement && !safeUrl(data.lastAnnouncement.url)) return null;
  return data;
}

export function viewOf(state, now = Date.now(), { allowCached = false, timeZone } = {}) {
  const t = translator(state.settings?.language);
  const data = cachedDataOf(state);
  if (state.error || !data || now >= data.expiresAt) return {
    badge: '?', color: '#64748b', title: t('unknown'),
    detail: state.error ? t(['dataStale', 'dataFormat', 'rateLimited', 'publishedStale', 'responseLarge'].includes(state.error) ? state.error : 'fetchFailed') : t(data ? 'dataStale' : 'loading'), data: allowCached ? data : null, cached: Boolean(allowCached && data),
  };
  // These are rolling 24/48-hour windows, so the day words are shorthand for
  // a high-probability forecast, never a confirmed calendar-day schedule.
  const recordAt = Math.max(timestamp(data.lastResetAt) || 0, timestamp(data.lastAnnouncement?.at) || 0);
  const recordedToday = recordAt > 0 && recordAt <= now && isSameLocalDay(recordAt, now, timeZone);
  const horizon = data.p24 >= DAY_BADGE_THRESHOLD ? 24 : data.p48 >= DAY_BADGE_THRESHOLD ? 48 : 0;
  // Once today's reset is recorded, a high upcoming forecast takes priority;
  // otherwise keep today's confirmed record visible on the badge.
  const laterForecast = horizon && timestamp(data.forecastAt) >= recordAt;
  const day = recordedToday ? (laterForecast ? 'tomorrow' : 'recorded') : horizon === 24 ? 'today' : horizon === 48 ? 'tomorrow' : 'probability';
  return { badge: day === 'today' || day === 'recorded' ? t('badgeSet') : day === 'tomorrow' ? t('badgeTomorrow') : `${data.p24}%`,
    color: day === 'probability' ? '#38bdf8' : '#10b981',
    title: t(day === 'recorded' ? 'badgeRecordedTodayTitle' : day === 'today' ? 'badgeTodayTitle' : day === 'tomorrow' ? 'badgeTomorrowTitle' : 'forecastBadgeTitle'),
    detail: day === 'recorded' ? t('badgeRecordedTodayDetail') : t(day === 'tomorrow' ? 'badgeWindow48' : 'badgeWindow24', { p: day === 'tomorrow' ? data.p48 : data.p24 }), data, cached: false };
}

export function alertKey(data, settings) {
  if (!data) return null;
  if (data.event) return data.event.key;
  // One alert per forecast cycle, rather than per fetch or percentage change.
  return data.p24 >= settings.threshold ? `forecast:${data.lastResetAt || 'unknown'}` : null;
}

export function shouldNotify(state, now = Date.now()) {
  const data = viewOf(state, now).data;
  const settings = settingsFrom(state.settings);
  const key = alertKey(data, settings);
  if (!settings.notifications || !key) return false;
  const delivery = state.deliveries?.[key];
  if (delivery?.read || (delivery?.snoozedUntil || 0) > now) return false;
  if (delivery?.snoozedUntil) return true;
  if (!delivery?.notifiedAt) return true;
  return settings.repeatMinutes > 0 && now - delivery.notifiedAt >= settings.repeatMinutes * MINUTE;
}

export function retryAt(value, now = Date.now()) {
  const seconds = value && /^\d+$/.test(value) ? Number(value) : NaN;
  const date = Number.isFinite(seconds) ? now + seconds * 1000 : timestamp(value);
  return Number.isFinite(date) ? Math.max(now + MINUTE, date) : now + 5 * MINUTE;
}
