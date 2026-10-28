import { MINUTE } from '../extension/model.js';

export const NOW = Date.parse('2026-10-28T06:40:00Z');
export function fixture(now = NOW) {
  return {
    forecast: { updated_at: new Date(now).toISOString(), probabilities: { rounded_24h: 46, rounded_48h: 71, signal_percent: 93 },
      confidence: 'medium', last_reset_at: new Date(now - 48 * 60 * MINUTE).toISOString(), official_signal: null },
    timeline: { updated_at: new Date(now).toISOString(), events: [] },
  };
}
export function announcement(now = NOW, overrides = {}) {
  return { id: 'reset-1', group: 'reset', announcement_state: 'announced',
    announced_at: new Date(now - MINUTE).toISOString(), summary: 'Fixture announcement', url: 'https://x.com/thsottiaux/status/123', ...overrides };
}
