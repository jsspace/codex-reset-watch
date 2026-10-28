// Render the editable SVG master using an existing Playwright installation.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = await readFile(new URL('../extension/icons/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
try {
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    const data = await page.evaluate(async ({ source, size }) => {
      const image = new Image();
      image.src = `data:image/svg+xml;base64,${btoa(source)}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, size, size);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { source, size });
    await writeFile(new URL(`../extension/icons/${size}.png`, import.meta.url), Buffer.from(data, 'base64'));
  }
  console.log('Rendered 16, 32, 48 and 128px extension icons.');
} finally { await browser.close(); }
