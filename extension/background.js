import { translator } from './i18n.js';
import { fetchSnapshot } from './api.js';
import { MINUTE, SOURCE, settingsFrom, viewOf, alertKey, shouldNotify } from './model.js';

let queue = Promise.resolve();
function serial(task) {
  const result = queue.then(task);
  queue = result.catch(console.error);
  return result;
}
async function readState() {
  const { state = {}, languagePreference } = await chrome.storage.local.get(['state', 'languagePreference']);
  if (languagePreference) state.settings = { ...state.settings, language: languagePreference };
  return { ...state, settings: settingsFrom(state.settings), deliveries: state.deliveries || {} };
}
async function save(state) { await chrome.storage.local.set({ state }); }
async function badge(state) {
  const view = viewOf(state);
  const t = translator(state.settings.language);
  await chrome.action.setBadgeText({ text: view.badge });
  await chrome.action.setBadgeBackgroundColor({ color: view.color });
  await chrome.action.setTitle({ title: `${view.title} · ${t('data')}: codex-reset.com\n${view.detail}` });
}
async function playSound() {
  if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) {
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: '播放用户开启的重置消息提示音' });
  }
  const result = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'play' });
  if (!result?.ok) throw new Error(result?.error || '提示音未响应');
}
async function notify(state, test = false) {
  if (!test && !shouldNotify(state)) return;
  const data = state.data;
  const key = alertKey(data, state.settings);
  const t = translator(state.settings.language);
  try {
    await chrome.notifications.create(test ? 'reset-watch-test' : 'reset-watch', {
      type: 'basic', iconUrl: 'icons/128.png',
      title: test ? t('testTitle') : data.event?.kind === 'announced' ? t('notificationTitle') : data.event ? t('signalNotification') : t('forecastNotification', { p: data.p24 }),
      message: `${test ? t('testBody') : data.event?.summary || t('predictionNote')}\n${(!test && data.event?.url) || SOURCE}\nData: codex-reset.com · https://codex-reset.com/`.slice(0, 1500),
      contextMessage: t('caveat'),
      requireInteraction: !test, buttons: [],
    });
    if (!test) {
      state.deliveries[key] = { ...state.deliveries[key], notifiedAt: Date.now(), snoozedUntil: 0 };
      state.notificationKey = key;
    }
    state.notificationError = null;
    if (state.settings.sound) {
      try { await playSound(); } catch { state.notificationError = 'soundFailed'; }
    }
  } catch (error) { state.notificationError = 'notificationFailed'; }
}
async function tick() {
  const state = await readState();
  const now = Date.now();
  if (!state.nextFetchAt || now >= state.nextFetchAt) {
    // Persist the throttle before networking, even if the worker is terminated.
    state.nextFetchAt = now + MINUTE;
    state.lastAttemptAt = now;
    await save(state);
    try {
      Object.assign(state, await fetchSnapshot());
      state.error = null;
      state.lastSuccessAt = Date.now();
      await save(state);
    } catch (error) {
      state.error = error.message || '无法读取消息源';
      state.nextFetchAt = error.retryAt || Date.now() + MINUTE;
    }
  }
  await badge(state);
  await notify(state);
  state.deliveries = Object.fromEntries(Object.entries(state.deliveries).slice(-100));
  await save(state);
  return state;
}
async function mark(state, key, snooze = false) {
  if (!key) return;
  state.deliveries[key] = { ...state.deliveries[key], read: !snooze,
    snoozedUntil: snooze ? Date.now() + 15 * MINUTE : 0 };
  await save(state);
  await badge(state);
  await chrome.notifications.clear('reset-watch');
}
async function boot() {
  if (!(await chrome.alarms.get('check'))) await chrome.alarms.create('check', { periodInMinutes: 1 });
  return tick();
}
chrome.runtime.onInstalled.addListener(() => { void serial(boot); });
chrome.runtime.onStartup.addListener(() => { void serial(boot); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'check') void serial(tick); });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.target === 'offscreen') return;
  if (message.type === 'state') {
    // Answer from disk immediately; publishing fresh data is independent of the popup lifetime.
    readState().then(state => respond({ state }), error => respond({ error: error.message }));
    void serial(boot);
    return true;
  }
  serial(async () => {
    if (message.type === 'refresh') return boot();
    const state = await readState();
    if (message.type === 'settings') {
      state.settings = settingsFrom(message.settings);
      if (message.settings?.language && message.settings.language !== 'auto') await chrome.storage.local.set({ languagePreference: state.settings.language });
      await save(state);
      await badge(state);
    } else if (message.type === 'read' || message.type === 'snooze') {
      await mark(state, alertKey(viewOf(state).data, state.settings), message.type === 'snooze');
    } else if (message.type === 'test') {
      await notify(state, true);
      await save(state);
    } else throw new Error('Unknown operation');
    return state;
  }).then(state => respond({ state }), error => respond({ error: error.message }));
  return true;
});
chrome.notifications.onButtonClicked.addListener((id, index) => {
  if (id !== 'reset-watch') return;
  void serial(async () => { const state = await readState(); await mark(state, state.notificationKey, index === 1); });
});
chrome.notifications.onClicked.addListener(id => {
  if (id === 'reset-watch') void chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
});
