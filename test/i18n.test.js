import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES, MESSAGES, resolveLanguage, translator, formatDate, relativeTime, isSameLocalDay, resolveTheme } from '../extension/i18n.js';
import { settingsFrom, viewOf } from '../extension/model.js';
import { NOW } from './fixtures.js';

test('all five dictionaries cover every key and interpolation token', () => {
  const keys = Object.keys(MESSAGES.en).sort();
  for (const [language, messages] of Object.entries(MESSAGES)) {
    assert.deepEqual(Object.keys(messages).sort(), keys, language);
    for (const key of keys) {
      assert.ok(messages[key].trim(), `${language}.${key}`);
      assert.deepEqual(messages[key].match(/\{\w+\}/g), MESSAGES.en[key].match(/\{\w+\}/g), `${language}.${key}`);
    }
  }
});
test('detects browser locales, explicit preference and unsupported languages', () => {
  for (const [system, result] of [['zh-TW', 'zh-CN'], ['en-US', 'en'], ['ja-JP', 'ja'], ['es-MX', 'es'], ['ar-SA', 'ar'], ['fr-FR', 'en']]) {
    assert.equal(resolveLanguage('auto', system), result);
  }
  assert.equal(resolveLanguage('ja', 'en-US'), 'ja');
  assert.equal(resolveLanguage('__proto__', 'en'), 'en');
  assert.equal(settingsFrom({ language: 'fr' }).language, 'auto');
  assert.equal(settingsFrom({ language: 'ar' }).language, 'ar');
});
test('formats translated templates, dates and relative time', () => {
  assert.equal(translator('es')('minutes', { n: 15 }), 'Cada 15 minutos');
  for (const language of Object.keys(LANGUAGES)) {
    assert.notEqual(formatDate(NOW, language), '—');
    assert.ok(relativeTime(NOW - 60_000, language, NOW));
    assert.equal(formatDate(null, language), '—');
    assert.equal(viewOf({ settings: { language }, error: 'offline' }).detail, MESSAGES[language].fetchFailed);
  }
});
test('every static popup label and manifest locale is translated', async () => {
  const html = await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8');
  for (const [, key] of html.matchAll(/data-(?:t|label)="([^"]+)"/g)) assert.ok(MESSAGES.en[key], key);
  for (const language of Object.keys(LANGUAGES)) {
    const locale = language.replace('-', '_');
    const messages = JSON.parse(await readFile(new URL(`../extension/_locales/${locale}/messages.json`, import.meta.url)));
    assert.ok(messages.appName.message);
    assert.ok(messages.appDescription.message);
  }
});

test('today follows the browser timezone instead of source UTC day', () => {
  const reset = '2026-10-28T06:35:38Z';
  const now = Date.parse('2026-10-28T08:00:00Z');
  assert.equal(isSameLocalDay(reset, now, 'Asia/Shanghai'), true);
  assert.equal(isSameLocalDay(reset, now, 'America/Los_Angeles'), false);
  assert.equal(isSameLocalDay(null, now, 'Asia/Shanghai'), false);
});

test('theme defaults to system and explicit preferences override system appearance', () => {
  assert.equal(settingsFrom().theme, 'auto');
  assert.equal(settingsFrom({ theme: 'invalid' }).theme, 'auto');
  assert.equal(resolveTheme('auto', true), 'dark');
  assert.equal(resolveTheme('auto', false), 'light');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});
