// Optional browser checks: npm install --no-save playwright, then npm run test:ui.
// PLAYWRIGHT_MODULE and CHROME_EXECUTABLE may point to existing installations.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { fixture, announcement } from '../test/fixtures.js';
import { normalize, settingsFrom } from '../extension/model.js';
import { MESSAGES } from '../extension/i18n.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const now = Date.now();
const { forecast, timeline } = fixture(now);
timeline.events.push(announcement(now, { summary: "And it's done. See you tomorrow for some good news." }));
forecast.last_reset_at = new Date(now - 60000).toISOString();
const state = { data: normalize(forecast, timeline, now), settings: settingsFrom({ language: 'auto' }), deliveries: {}, nextFetchAt: now + 60000, lastAttemptAt: now, lastSuccessAt: now - 60000 };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (!/^\/(?:[a-z0-9-]+\.(?:html|css|js)|icons\/(?:icon\.svg|(?:16|32|48|128)\.png))$/.test(path)) { res.writeHead(404).end(); return; }
  try {
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.svg') ? 'image/svg+xml' : path.endsWith('.png') ? 'image/png' : 'text/html');
    res.end(await readFile(`${root}extension${path}`));
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 360, height: 680 }, deviceScaleFactor: 2, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(initial => {
    window.testState = JSON.parse(localStorage.getItem('mockState') || 'null') || initial;
    window.testNotifications = 0;
    const storageListeners = [];
    window.emitStorageUpdate = next => {
      window.testState = next;
      localStorage.setItem('mockState', JSON.stringify(next));
      for (const listener of storageListeners) listener({ state: { newValue: structuredClone(next) } }, 'local');
    };
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => window.copiedText = text } });
    window.chrome = { storage: { local: {
      get: async () => ({ state: structuredClone(window.testState), languagePreference: localStorage.getItem('languagePreference') || undefined }),
      set: async value => { if (value.languagePreference) localStorage.setItem('languagePreference', value.languagePreference); },
    }, onChanged: { addListener: listener => storageListeners.push(listener) } }, i18n: { getUILanguage: () => 'zh-CN' }, runtime: { sendMessage: async message => {
      const staleState = message.type === 'refresh' && window.staleRefresh ? structuredClone(window.testState) : null;
      if (message.type === 'settings' && window.settingsFailure) throw new Error('settings unavailable');
      if (message.type === 'refresh') {
        window.refreshCalls = (window.refreshCalls || 0) + 1;
        if (window.refreshDelay) await new Promise(resolve => setTimeout(resolve, window.refreshDelay));
        if (window.refreshFailure) throw new Error('offline');
      }
      if (message.type === 'state') { await new Promise(resolve => setTimeout(resolve, 800)); window.stateResponseReady = true; }
      const s = window.testState;
      if (message.type === 'read') s.deliveries[s.data.event.key] = { read: true };
      if (message.type === 'snooze') s.deliveries[s.data.event.key] = { snoozedUntil: Date.now() + 900000 };
      if (message.type === 'settings') s.settings = message.settings;
      if (message.type === 'test') window.testNotifications++;
      localStorage.setItem('mockState', JSON.stringify(s));
      return { state: staleState || structuredClone(s) };
    } } };
  }, state);
  await page.goto(`http://127.0.0.1:${server.address().port}/popup.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#p24').filter({ hasText: '46%' }).waitFor();
  assert.notEqual(await page.evaluate(() => window.stateResponseReady), true, 'cached content paints before background replies');
  // A choice made before the initial background reply must apply and persist.
  await page.locator('#language').click();
  await page.locator('#language-ja').click();
  assert.equal(await page.locator('html').getAttribute('lang'), 'ja');
  assert.equal(await page.locator('#language-value').textContent(), '日本語');
  await page.waitForFunction(() => testState.settings.language === 'ja' && !document.getElementById('language').disabled);
  await page.locator('#language').click();
  await page.locator('#language-zh').click();
  await page.waitForFunction(() => testState.settings.language === 'zh-CN' && !document.getElementById('language').disabled);
  await page.locator('#status-title').filter({ hasText: MESSAGES['zh-CN'].todayRecorded }).waitFor();
  assert.equal(await page.locator('#p24').textContent(), '46%');
  await page.waitForFunction(() => !document.getElementById('refresh').disabled);
  // Slow, cached and failed requests all give feedback and release the button.
  await page.evaluate(() => window.refreshDelay = 850);
  await page.locator('#refresh').click();
  assert.equal(await page.locator('#refresh').getAttribute('aria-busy'), 'true');
  assert.equal(await page.locator('#refresh svg').evaluate(icon => getComputedStyle(icon).animationName), 'refresh-turn');
  await page.evaluate(() => document.getElementById('refresh').click());
  assert.equal(await page.evaluate(() => window.refreshCalls), 1);
  await page.waitForFunction(() => !document.getElementById('refresh').disabled);
  await page.evaluate(() => { window.refreshDelay = 0; window.refreshFailure = true; });
  await page.locator('#refresh').click();
  assert.equal(await page.locator('#refresh').getAttribute('aria-busy'), 'true');
  await page.waitForFunction(() => !document.getElementById('refresh').disabled);
  assert.equal(await page.locator('#refresh').getAttribute('aria-busy'), 'false');
  assert.equal(await page.locator('#refresh').evaluate(button => button.classList.contains('is-refreshing')), false);
  await page.evaluate(() => window.refreshFailure = false);
  await page.locator('#refresh').click();
  await page.waitForFunction(() => !document.getElementById('refresh').disabled);

  await page.locator('main').screenshot({ path: `${root}docs/popup-preview.png` });
  assert.ok((await page.locator('main').boundingBox()).height < 500, 'overview fits without scrolling');
  assert.match(await page.locator('#time-zone').textContent(), /GMT|UTC/);
  const choosePreference = async (id, value) => {
    await page.locator(`#${id}-trigger`).click();
    await page.locator(`#${id}-options [data-value=\"${value}\"]`).click();
    assert.equal(await page.locator(`#${id}`).inputValue(), value);
    assert.equal(await page.locator(`#${id}-options`).isVisible(), false);
    await page.waitForFunction(controlId => !document.getElementById(`${controlId}-trigger`).disabled, id);
  };
  await page.locator('#open-settings').click();
  await page.locator('#threshold-trigger').click();
  assert.equal(await page.locator('#threshold-options').isVisible(), true);
  await page.locator('main').screenshot({ path: `${root}docs/settings-dropdown-preview.png` });
  await page.locator('#settings-title').click();
  assert.equal(await page.locator('#threshold-options').isVisible(), false);
  await choosePreference('theme', 'dark');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await choosePreference('theme', 'light');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await choosePreference('theme', 'dark');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.evaluate(() => window.settingsFailure = true);
  await choosePreference('theme', 'light');
  assert.equal(await page.locator('#theme-trigger').isEnabled(), true, 'failed save unlocks the visible theme control');
  await page.evaluate(() => window.settingsFailure = false);
  await choosePreference('theme', 'dark');
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.locator('main').screenshot({ path: `${root}docs/dark-preview.png` });
  await page.emulateMedia({ colorScheme: 'light' });
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.locator('#open-settings').click();
  await choosePreference('theme', 'auto');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.locator('#repeat-trigger').focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#repeat-options').isVisible(), true);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#repeat').inputValue(), '60');
  await page.locator('#repeat-trigger').focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#repeat-options').isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#repeat-options').isVisible(), false);
  await page.locator('#settings-page [data-home]').click();

  const chooseLanguage = async language => {
    await page.locator('#language').click();
    await page.locator(`#language-options [data-value="${language}"]`).click();
    await page.waitForFunction(value => !document.getElementById('language').disabled && document.getElementById('language').value === value, language);
    assert.equal(await page.locator('#language-options').isVisible(), false);
  };
  // A late refresh response and failed worker reply must not undo a saved choice.
  await page.evaluate(() => { window.staleRefresh = true; window.refreshDelay = 1000; });
  await page.locator('#refresh').click();
  await chooseLanguage('en');
  await page.waitForFunction(() => !document.getElementById('refresh').disabled);
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await page.evaluate(() => { window.staleRefresh = false; window.refreshDelay = 0; window.settingsFailure = true; });
  await chooseLanguage('ja');
  assert.equal(await page.locator('html').getAttribute('lang'), 'ja');
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('refresh').disabled);
  assert.equal(await page.locator('html').getAttribute('lang'), 'ja');
  await chooseLanguage('zh-CN');
  assert.equal(await page.locator('#language-value').textContent(), '简体中文');
  assert.equal(await page.locator('#language-options [data-value=auto]').count(), 0);
  await page.locator('#language').focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#language').getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('#language-options').evaluate(el => getComputedStyle(el).position), 'absolute');
  await page.locator('main').screenshot({ path: `${root}docs/language-menu-preview.png` });
  await page.keyboard.press('End');
  assert.equal(await page.locator('#language-ar').evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => testState.settings.language === 'en');
  await page.waitForFunction(() => !document.getElementById('language').disabled);
  assert.equal(await page.locator('#language-value').textContent(), 'English');
  await page.locator('#language').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#language-options').isVisible(), false);
  assert.equal(await page.locator('#language').evaluate(el => el === document.activeElement), true);
  await page.locator('#language').click();
  await page.locator('.brand').click();
  assert.equal(await page.locator('#language-options').isVisible(), false);
  await page.locator('#language').click();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#language-options').isVisible(), false);

  const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  for (const language of ['en', 'ja', 'es', 'ar', 'zh-CN']) {
    await chooseLanguage(language);
    await page.waitForFunction(lang => document.documentElement.lang === lang, language);
    assert.equal(await page.locator('html').getAttribute('dir'), language === 'ar' ? 'rtl' : 'ltr');
    assert.equal(await page.locator('#status-title').textContent(), MESSAGES[language].todayRecorded);
    await noOverflow();
    await page.locator('#open-settings').click();
    assert.equal(await page.locator('#settings-title').textContent(), MESSAGES[language].settings);
    assert.equal(await page.locator('footer').isVisible(), false);
    await noOverflow();
    if (language === 'zh-CN') await page.locator('main').screenshot({ path: `${root}docs/settings-preview.png` });
    await page.locator('#test-notification').click();
    await page.locator('#feedback').filter({ hasText: MESSAGES[language].testSent }).waitFor();
    await page.locator('#info').click();
    assert.equal(await page.locator('#guide-title').textContent(), MESSAGES[language].info);
    assert.equal(await page.locator('#info-page .guide-done').count(), 1);
    assert.equal(await page.locator('.design-credit').textContent(), 'Design by yimin');
    assert.equal(await page.locator('footer').isVisible(), false);
    await noOverflow();
    if (language === 'ar') await page.locator('main').screenshot({ path: `${root}docs/arabic-preview.png` });
    await page.locator('.guide-done').click();
  }
  assert.equal(await page.locator('#unread, #read, #snooze, .forecast-meta').count(), 0);
  await page.locator('#open-settings').click();
  await choosePreference('threshold', '95');
  await page.locator('#settings button[type=submit]').click();
  assert.equal(await page.evaluate(() => testState.settings.threshold), 95);
  await chooseLanguage('ar');
  await page.reload();
  await page.waitForFunction(() => document.documentElement.lang === 'ar');
  assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
  // The extension keeps its compact window width and single-row header.
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    for (const width of [360, 800]) {
      await page.setViewportSize({ width, height: 680 });
      for (const language of ['zh-CN', 'en', 'ja', 'es', 'ar']) {
        await chooseLanguage(language);
        await page.waitForFunction(lang => document.documentElement.lang === lang, language);
        const home = page.locator('[data-home]:visible').first();
        if (await home.count()) await home.click();
        for (const pageId of ['overview', 'settings', 'info']) {
          if (pageId === 'settings') await page.locator('#open-settings').click();
          if (pageId === 'info') await page.locator('#info').click();
          await noOverflow();
          assert.equal(await page.locator('body').evaluate(body => body.getBoundingClientRect().width), 360);
          assert.equal(await page.locator('.toolbar').evaluate(toolbar =>
            [...toolbar.querySelectorAll('button, select')].every(control => {
              const box = control.getBoundingClientRect();
              return box.width >= 28 && box.height >= 32;
            })), true, 'toolbar keeps usable controls in a single row');
          assert.equal(await page.evaluate(() => {
            const brand = document.querySelector('.brand').getBoundingClientRect();
            const toolbar = document.querySelector('.toolbar').getBoundingClientRect();
            return (brand.right <= toolbar.left || toolbar.right <= brand.left) && Math.abs((brand.top + brand.bottom) / 2 - (toolbar.top + toolbar.bottom) / 2) < 1;
          }), true, 'brand and toolbar do not overlap');
          if (language === 'zh-CN' && width === 360) {
            await page.locator('main').screenshot({ path: `${root}docs/compact-${pageId}-${theme}.png` });
          }
          if (language === 'en' && width === 360 && (pageId === 'overview' || (pageId === 'settings' && theme === 'light'))) {
            await page.locator('main').screenshot({ path: `${root}docs/compact-${pageId}-en-${theme}.png` });
          }
        }
      }
    }
  }
  // Larger text must still reflow inside a small phone viewport.
  await page.setViewportSize({ width: 360, height: 680 });
  const enlargedText = await page.addStyleTag({ content: await page.evaluate(() =>
    [...document.querySelectorAll('main, main *')].map((element, index) => {
      element.dataset.textScale = index;
      return `[data-text-scale="${index}"] { font-size: ${parseFloat(getComputedStyle(element).fontSize) * 1.2}px !important; }`;
    }).join('\n')) });
  await noOverflow();
  await enlargedText.evaluate(style => style.remove());
  await chooseLanguage('ar');
  await page.locator('.guide-done').click();
  await page.evaluate(() => testState.error = 'offline');
  await page.locator('#refresh').click();
  await page.waitForFunction(() => !document.getElementById('refresh').disabled);
  assert.equal(await page.locator('#p24').textContent(), '46%', 'offline refresh retains cached probability');
  assert.equal(await page.locator('#event-link').isVisible(), true);
  assert.equal(await page.locator('#connection').evaluate(element => element.classList.contains('offline')), true);
  const previousChecked = await page.locator('#checked').textContent();
  await page.evaluate(() => {
    const next = structuredClone(testState);
    next.error = null;
    next.data.p24 = 62;
    next.lastSuccessAt = Date.now();
    next.lastAttemptAt = Date.now();
    emitStorageUpdate(next);
  });
  await page.locator('#p24').filter({ hasText: '62%' }).waitFor();
  assert.notEqual(await page.locator('#checked').textContent(), previousChecked, 'timestamp advances only after a successful update');
  await page.evaluate(() => testState.data.p24 = 46);
  await page.evaluate(() => {
    testState.error = null;
    testState.data.lastResetAt = new Date(Date.now() - 48 * 3600000).toISOString();
    testState.data.event = null;
    testState.data.lastAnnouncement = null;
  });
  await page.locator('#refresh').click();
  await page.locator('#status-title').filter({ hasText: MESSAGES.ar.todayPending }).waitFor();
  assert.equal(await page.locator('#today-value').textContent(), '46%');
  assert.equal(await page.locator('#today-note').textContent(), MESSAGES.ar.next24Short);
  await chooseLanguage('zh-CN');
  await page.setViewportSize({ width: 360, height: 680 });
  await page.locator('main').screenshot({ path: `${root}docs/forecast-preview.png` });
  assert.deepEqual(errors, []);
  console.log('Chrome UI checks passed: 5 languages × 3 views, RTL, persistence, notifications, saved preferences, fixed 360px popup, single-row toolbar, larger text, compact height, local timezone, light/dark/system themes, immediate cache paint, offline retention and live storage updates.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
