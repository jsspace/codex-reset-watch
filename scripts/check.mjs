import { readFile, access, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.host_permissions, ['https://codex-reset.com/*']);
for (const file of [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons)]) await access(`extension/${file}`);
for (const file of await readdir('extension')) {
  if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', `extension/${file}`]);
}
const popup = await readFile('extension/popup.html', 'utf8');
const script = await readFile('extension/popup.js', 'utf8');
for (const [, id] of script.matchAll(/\$\('([^']+)'\)/g)) assert.ok(popup.includes(`id="${id}"`), `Missing UI element: ${id}`);
assert.ok(!/<script(?![^>]*src=)[^>]*>\s*\S/.test(popup), 'Inline script violates MV3 CSP');
console.log('Manifest, assets, JavaScript syntax and popup bindings OK');

assert.deepEqual(manifest.action.default_icon, manifest.icons);
for (const [size, path] of Object.entries(manifest.icons)) {
  const png = await readFile(`extension/${path}`);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), Number(size));
  assert.equal(png.readUInt32BE(20), Number(size));
}
await access('extension/icons/icon.svg');
console.log('Toolbar and extension icon sizes OK');
