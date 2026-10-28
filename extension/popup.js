import { viewOf, settingsFrom } from './model.js';
import { resolveLanguage, translator, formatDate, relativeTime, isSameLocalDay, localTimeZone, resolveTheme } from './i18n.js';

const $ = id => document.getElementById(id);
let state;
let stateRevision = 0;
let pendingLanguage;
let explicitLanguage;
let language = resolveLanguage();
let t = translator(language);
let settingsLoaded = false;
let activePage = 'overview';
let feedbackKey;
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  document.documentElement.dataset.theme = resolveTheme(state?.settings?.theme, systemTheme.matches);
  if (state) { $('theme').value = state.settings.theme || 'auto'; syncPreferenceMenus(); }
}
systemTheme.addEventListener('change', applyTheme);
applyTheme();
function localize() {
  language = resolveLanguage(pendingLanguage ?? explicitLanguage ?? state?.settings?.language);
  t = translator(language);
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  for (const element of document.querySelectorAll('[data-t]')) element.textContent = t(element.dataset.t);
  for (const element of document.querySelectorAll('[data-label]')) {
    element.setAttribute('aria-label', t(element.dataset.label));
    element.title = t(element.dataset.label);
  }
  for (const element of document.querySelectorAll('[data-minutes]')) element.textContent = t('minutes', { n: element.dataset.minutes });
  $('overview-page').setAttribute('aria-label', t('outlook'));
  $('example-set').textContent = t('badgeSet');
  syncLanguagePicker();
  syncPreferenceMenus();
  feedback(feedbackKey);
}
const languageOptions = [...document.querySelectorAll('#language-options [role=option]')];
function syncLanguagePicker() {
  const value = resolveLanguage(pendingLanguage ?? explicitLanguage ?? state?.settings?.language);
  $('language').value = value;
  for (const option of languageOptions) option.setAttribute('aria-selected', String(option.dataset.value === value));
  const selected = languageOptions.find(option => option.dataset.value === value);
  $('language-value').textContent = selected.querySelector('span').textContent;
  $('language').title = $('language-value').textContent;
}
function closeLanguagePicker(restoreFocus = false) {
  $('language-options').hidden = true;
  $('language').setAttribute('aria-expanded', 'false');
  if (restoreFocus) $('language').focus();
}
function openLanguagePicker(edge) {
  if ($('language').disabled) return;
  $('language-options').hidden = false;
  $('language').setAttribute('aria-expanded', 'true');
  const selected = languageOptions.find(option => option.getAttribute('aria-selected') === 'true');
  (edge === 'first' ? languageOptions[0] : edge === 'last' ? languageOptions.at(-1) : selected).focus();
}
$('language').addEventListener('click', () => {
  if ($('language-options').hidden) openLanguagePicker();
  else closeLanguagePicker();
});
$('language').addEventListener('keydown', event => {
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    openLanguagePicker(event.key === 'Home' ? 'first' : ['End', 'ArrowUp'].includes(event.key) ? 'last' : undefined);
  }
});
async function chooseLanguage(option) {
  if ($('language').disabled) return;
  const previousLanguage = explicitLanguage;
  pendingLanguage = option.dataset.value;
  closeLanguagePicker(true);
  localize();
  render();
  $('language').disabled = true;
  let persisted = false;
  try {
    await chrome.storage.local.set({ languagePreference: pendingLanguage });
    explicitLanguage = pendingLanguage;
    persisted = true;
    await stateReady;
    if (!state) throw new Error('backgroundFailed');
    await send('settings', { settings: { ...state.settings, language: pendingLanguage } });
  } catch {
    if (!persisted) explicitLanguage = previousLanguage;
    feedback('backgroundFailed');
  } finally {
    pendingLanguage = undefined;
    localize();
    render();
    $('language').disabled = false;
    $('language').focus();
  }
}
for (const option of languageOptions) {
  option.addEventListener('click', () => chooseLanguage(option));
  option.addEventListener('keydown', event => {
    const index = languageOptions.indexOf(option);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? languageOptions.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + languageOptions.length) % languageOptions.length;
      languageOptions[next].focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      chooseLanguage(option);
    }
  });
}
document.addEventListener('pointerdown', event => {
  if (!$('language-picker').contains(event.target)) closeLanguagePicker();
});
$('language-picker').addEventListener('focusout', event => {
  if (!$('language-picker').contains(event.relatedTarget)) closeLanguagePicker();
});
$('language-picker').addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('language-options').hidden) {
    event.stopPropagation();
    event.preventDefault();
    closeLanguagePicker(true);
  }
});
function feedback(key) {
  feedbackKey = key;
  $('feedback').textContent = key ? t(key) : '';
  $('feedback').hidden = !key;
}
function showPage(page) {
  activePage = page;
  preferenceMenus.forEach(menu => menu.close());
  for (const name of ['overview', 'settings', 'info']) $(`${name}-page`).hidden = name !== page;
  $('info').setAttribute('aria-pressed', String(page === 'info'));
  $('open-settings').setAttribute('aria-pressed', String(page === 'settings'));
  const heading = $(page === 'overview' ? 'status-title' : page === 'settings' ? 'settings-title' : 'guide-title');
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
  feedback(null);
}
function render() {
  if (!state) return;
  const view = viewOf(state, Date.now(), { allowCached: true });
  const data = view.data;
  const recordAt = Math.max(...[data?.lastResetAt, data?.lastAnnouncement?.at].map(value => Date.parse(value)).filter(Number.isFinite), 0);
  const recordedToday = data && isSameLocalDay(recordAt);
  const kind = !data ? 'unknown' : recordedToday ? 'announced' : data.event?.kind === 'signal' ? 'signal' : 'forecast';
  $('status-card').dataset.kind = kind;
  $('status-title').textContent = t({ unknown: 'todayUnavailable', announced: 'todayRecorded', signal: 'todaySignal', forecast: 'todayPending' }[kind]);
  $('today-value').textContent = !data ? '—' : recordedToday ? formatDate(recordAt, language, { hour: '2-digit', minute: '2-digit' }) : `${data.p24}%`;
  $('reset-detail').hidden = !recordAt || !data;
  $('today-note').hidden = Boolean(recordedToday);
  $('today-note').textContent = t(!data ? 'noFreshData' : recordedToday ? 'announcementOnly' : 'next24Short');
  $('p24').textContent = data ? `${data.p24}%` : '—';
  $('p48').textContent = data ? `${data.p48}%` : '—';
  $('last-reset').textContent = data ? `${recordedToday ? '' : t('lastReset') + ' · '}${formatDate(recordAt, language, { month: 'short', day: 'numeric', ...(recordedToday ? {} : { hour: '2-digit', minute: '2-digit' }) })}` : '—';
  $('last-relative').textContent = recordedToday ? relativeTime(recordAt, language) : '';
  $('last-relative').hidden = !recordedToday;
  $('relative-separator').hidden = !recordedToday;
  $('time-zone').textContent = localTimeZone(language, recordAt || Date.now());
  $('event-link').hidden = !data?.event?.url;
  if (data?.event?.url) $('event-link').href = data.event.url;
  else $('event-link').removeAttribute('href');
  $('connection').classList.toggle('offline', !data || view.cached);
  $('connection').title = t(data && !view.cached ? 'live' : 'paused');
  const updatedAt = state.lastSuccessAt || (view.cached ? data.updatedAt : state.lastAttemptAt);
  $('checked').textContent = updatedAt ? t('checked', { time: relativeTime(updatedAt, language) }) : t('notChecked');
  if (!settingsLoaded) {
    $('notifications').checked = state.settings.notifications;
    $('sound').checked = state.settings.sound;
    $('threshold').value = state.settings.threshold;
    $('repeat').value = state.settings.repeatMinutes;
    settingsLoaded = true;
    syncPreferenceMenus();
  }
}
async function send(type, extra = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...extra });
  if (result?.error || !result?.state) throw new Error('backgroundFailed');
  acceptState(result.state);
}
function acceptState(nextState) {
  stateRevision++;
  const previousLanguage = state?.settings?.language;
  state = { ...nextState, settings: settingsFrom(nextState.settings), deliveries: nextState.deliveries || {} };
  if (explicitLanguage) state.settings.language = explicitLanguage;
  if (previousLanguage !== state.settings.language) localize();
  applyTheme();
  render();
  if (state.notificationError) feedback(state.notificationError);
}

async function action(type, extra, success) {
  try { await send(type, extra); if (success && !state.notificationError) feedback(success); }
  catch { feedback('backgroundFailed'); }
}
function formSettings() {
  return { ...state.settings, language: $('language').value, theme: $('theme').value, notifications: $('notifications').checked,
    sound: $('sound').checked, threshold: Number($('threshold').value), repeatMinutes: Number($('repeat').value) };
}
// Render the three settings selects with the same in-popup menu behavior as language.
const preferenceMenus = [];
for (const id of ['theme', 'threshold', 'repeat']) {
  const select = $(id);
  const label = select.closest('label');
  const labelText = label.querySelector('span');
  labelText.id = `${id}-label`;
  const control = document.createElement('div');
  control.className = 'preference-select';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'preference-trigger';
  trigger.id = `${id}-trigger`;
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', `${id}-options`);
  trigger.setAttribute('aria-labelledby', `${id}-label ${id}-value`);
  const value = document.createElement('span');
  value.id = `${id}-value`;
  const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevron.setAttribute('aria-hidden', 'true');
  chevron.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'm6 9 6 6 6-6');
  chevron.append(path);
  trigger.append(value, chevron);
  const menu = document.createElement('div');
  menu.className = 'preference-options';
  menu.id = `${id}-options`;
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-labelledby', `${id}-label`);
  menu.hidden = true;
  const options = [...select.options].map((source, index) => {
    const option = document.createElement('div');
    option.id = `${id}-option-${index}`;
    option.setAttribute('role', 'option');
    option.tabIndex = -1;
    option.dataset.value = source.value;
    menu.append(option);
    return option;
  });
  control.append(trigger, menu);
  select.after(control);
  const close = (restore = false) => {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restore) trigger.focus();
  };
  const sync = () => {
    value.textContent = select.selectedOptions[0]?.textContent || '';
    trigger.title = value.textContent;
    trigger.disabled = select.disabled;
    options.forEach((option, index) => {
      option.textContent = select.options[index].textContent;
      option.setAttribute('aria-selected', String(option.dataset.value === select.value));
    });
  };
  const open = edge => {
    if (trigger.disabled) return;
    preferenceMenus.forEach(other => { if (other.id !== id) other.close(); });
    closeLanguagePicker();
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    const selectedIndex = Math.max(0, options.findIndex(option => option.dataset.value === select.value));
    options[edge === 'first' ? 0 : edge === 'last' ? options.length - 1 : selectedIndex].focus();
  };
  const choose = option => {
    select.value = option.dataset.value;
    sync();
    close(true);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  trigger.addEventListener('click', () => menu.hidden ? open() : close());
  trigger.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      open(event.key === 'Home' ? 'first' : ['ArrowUp', 'End'].includes(event.key) ? 'last' : undefined);
    }
  });
  options.forEach((option, index) => {
    option.addEventListener('click', () => choose(option));
    option.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 :
          (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        options[next].focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        choose(option);
      } else if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        close(true);
      }
    });
  });
  control.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) {
      event.stopPropagation();
      event.preventDefault();
      close(true);
    }
  });
  control.addEventListener('focusout', event => {
    if (!control.contains(event.relatedTarget)) close();
  });
  document.addEventListener('pointerdown', event => {
    if (!control.contains(event.target)) close();
  });
  select.addEventListener('change', sync);
  preferenceMenus.push({ id, close, sync });
  sync();
}
function syncPreferenceMenus() { preferenceMenus.forEach(menu => menu.sync()); }

$('info').addEventListener('click', () => showPage(activePage === 'info' ? 'overview' : 'info'));
$('open-settings').addEventListener('click', () => showPage(activePage === 'settings' ? 'overview' : 'settings'));
for (const button of document.querySelectorAll('[data-home]')) button.addEventListener('click', () => showPage('overview'));
// Keep even a cached response visible for one turn; slow requests keep spinning.
async function refreshView(type) {
  const button = $('refresh');
  if (button.disabled) return;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.classList.add('is-refreshing');
  const started = performance.now();
  try { await action(type); }
  finally {
    const minimum = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650;
    const remaining = minimum - (performance.now() - started);
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    button.classList.remove('is-refreshing');
    button.setAttribute('aria-busy', 'false');
    button.disabled = false;
  }
}
$('refresh').addEventListener('click', () => refreshView('refresh'));
$('theme').addEventListener('change', async () => {
  if (!state) return;
  const theme = $('theme').value;
  $('theme').disabled = true;
  syncPreferenceMenus();
  try { await action('settings', { settings: { ...state.settings, theme } }); }
  finally {
    $('theme').disabled = false;
    syncPreferenceMenus();
  }
});
$('test-notification').addEventListener('click', async () => {
  $('test-notification').disabled = true;
  try { await action('test', {}, 'testSent'); } finally { $('test-notification').disabled = false; }
});
$('settings').addEventListener('submit', event => {
  event.preventDefault();
  if (state) action('settings', { settings: formSettings() }, 'saved');
});
localize();
$('status-title').textContent = t('loading');
// The last successful snapshot is useful even while a request is slow or offline.
// Listen before reading disk so a background update cannot be missed between the two.
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area !== 'local' || !changes.state?.newValue) return;
  acceptState(changes.state.newValue);
});
const stateReady = (async () => {
  const revisionBeforeRead = stateRevision;
  try {
    const { state: savedState, languagePreference } = await chrome.storage.local.get(['state', 'languagePreference']);
    if (!explicitLanguage && languageOptions.some(option => option.dataset.value === languagePreference)) explicitLanguage = languagePreference;
    if (savedState && stateRevision === revisionBeforeRead) acceptState(savedState);
  } catch { /* Background state remains available if local storage cannot be read. */ }
  localize();
  await refreshView('state');
})();
await stateReady;
setInterval(() => render(), 1000);
setInterval(() => refreshView('state'), 60_000);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && activePage !== 'overview') showPage('overview'); });
