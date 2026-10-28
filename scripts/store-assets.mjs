// Generate Chrome Web Store artwork from actual popup screenshots made by test:ui.
// PLAYWRIGHT_MODULE and CHROME_EXECUTABLE can point to existing installations.
import { createRequire } from 'node:module';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = `${root}store/assets`;
await mkdir(output, { recursive: true });
const png = async path => `data:image/png;base64,${(await readFile(`${root}${path}`)).toString('base64')}`;
const icon = await png('extension/icons/128.png');
await copyFile(`${root}extension/icons/128.png`, `${output}/01-商店图标-128x128.png`);

const scenes = [
  { file: '02-商店截图-英文-首页浅色-1280x800.png', locale: 'en', image: 'docs/compact-overview-en-light.png', eyebrow: 'RESET STATUS', title: 'One glance. The reset picture.', description: 'Today’s public reset record and the next 24 / 48 hour forecast, shown in your browser’s local time.', chips: ['Today’s record', 'Local time', 'Forecast'], theme: 'light' },
  { file: '03-商店截图-英文-首页深色-1280x800.png', locale: 'en', image: 'docs/compact-overview-en-dark.png', eyebrow: 'ALWAYS IN SIGHT', title: 'Keep the next signal close.', description: 'The toolbar badge turns high forecast windows into short day cues. Hover for the actual probability and window.', chips: ['Today / Tomorrow', 'Light + dark', 'Source linked'], theme: 'dark' },
  { file: '04-商店截图-英文-通知设置-1280x800.png', locale: 'en', image: 'docs/compact-settings-en-light.png', eyebrow: 'YOUR PREFERENCES', title: 'Alerts on your terms.', description: 'Choose desktop notifications, sound, language, and appearance. The latest snapshot stays on your device.', chips: ['Notifications', 'Five languages', 'Local cache'], theme: 'light' },
  { file: '05-商店截图-中文-首页浅色-1280x800.png', locale: 'zh-CN', image: 'docs/compact-overview-light.png', eyebrow: '重置状态', title: '一眼看懂重置动向。', description: '今天是否已有重置记录，以及未来 24 / 48 小时预测，均按浏览器本地时间显示。', chips: ['今日记录', '本地时间', '后续预测'], theme: 'light' },
  { file: '06-商店截图-中文-首页深色-1280x800.png', locale: 'zh-CN', image: 'docs/compact-overview-dark.png', eyebrow: '工具栏角标', title: '下一次动向，随时可见。', description: '高概率时间窗用「今」「明」简写；悬停可查看真实概率与滚动时间窗。', chips: ['今 / 明', '深浅主题', '来源可查'], theme: 'dark' },
];

function screenshotHtml(scene, screenshot) {
  const dark = scene.theme === 'dark';
  return `<!doctype html><html lang="${scene.locale}"><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:${dark ? '#f5f6f1' : '#202721'};background:${dark ? '#0c1512' : '#f2f1e9'}}
    .canvas{width:1280px;height:800px;overflow:hidden;position:relative;background:${dark ? 'radial-gradient(circle at 76% 42%,#254236 0%,#14231c 34%,#0c1512 73%)' : 'radial-gradient(circle at 82% 22%,#fff5cd 0%,#f8f7ef 42%,#eeefe8 100%)'}}
    .halo{position:absolute;width:690px;height:690px;right:-105px;top:80px;border:1px solid ${dark ? '#56756855' : '#cfd8ca'};border-radius:50%}
    .halo:after{content:"";position:absolute;inset:55px;border:1px solid ${dark ? '#56756833' : '#d9e2d6'};border-radius:50%}
    .content{position:absolute;left:88px;top:72px;width:560px}.brand{display:flex;align-items:center;gap:12px;font-size:24px;font-weight:750;letter-spacing:-.02em}.brand img{width:50px;height:50px}
    .eyebrow{margin-top:98px;color:${dark ? '#78d8a1' : '#24845c'};font-size:17px;font-weight:780;letter-spacing:.16em}
    h1{font-size:55px;line-height:1.12;letter-spacing:-.055em;margin:18px 0 24px;max-width:550px}
    p{font-size:23px;line-height:1.45;color:${dark ? '#bbc9c0' : '#58655b'};margin:0;max-width:550px}
    .chips{display:flex;gap:10px;flex-wrap:wrap;margin-top:40px}.chip{border:1px solid ${dark ? '#587768' : '#bdcbbd'};background:${dark ? '#193026bb' : '#ffffffbb'};border-radius:999px;padding:9px 15px;font-size:16px;font-weight:650}
    .preview{position:absolute;right:95px;top:135px;width:515px;padding:14px;background:${dark ? '#18271f' : '#ffffff'};border:1px solid ${dark ? '#456452' : '#d9dfd5'};border-radius:25px;box-shadow:0 35px 80px #0005;transform:rotate(-1.3deg)}
    .preview img{display:block;width:100%;height:auto;border-radius:13px}.preview:before{content:"";position:absolute;inset:-11px;border:1px solid ${dark ? '#45645255' : '#c8d5c855'};border-radius:33px;pointer-events:none}
    .foot{position:absolute;left:88px;bottom:43px;color:${dark ? '#819b8b' : '#78867b'};font-size:15px;letter-spacing:.02em}
  </style><div class="canvas"><div class="halo"></div><div class="content"><div class="brand"><img src="${icon}">Codex Reset</div><div class="eyebrow">${scene.eyebrow}</div><h1>${scene.title}</h1><p>${scene.description}</p><div class="chips">${scene.chips.map(chip => `<span class="chip">${chip}</span>`).join('')}</div></div><div class="preview"><img src="${screenshot}"></div><div class="foot">${scene.locale === 'zh-CN' ? '界面示意 · 使用示例数据' : 'Interface preview · illustrative data'}  ·  Data: codex-reset.com</div></div></html>`;
}

function promoHtml(width, height) {
  const large = width > 500;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}.canvas{width:${width}px;height:${height}px;overflow:hidden;position:relative;color:#f6fff8;background:radial-gradient(circle at 85% 10%,#317858 0%,#123a2b 44%,#0b201a 100%)}
    .ring{position:absolute;border:${large ? 4 : 2}px solid #78f1aa55;border-radius:50%;width:${large ? 660 : 310}px;height:${large ? 660 : 310}px;right:${large ? -60 : -72}px;top:${large ? -55 : -15}px}
    .ring:after{content:"";position:absolute;inset:${large ? 70 : 38}px;border:${large ? 3 : 2}px solid #7ff5ae44;border-radius:50%}
    .icon{position:absolute;left:${large ? 92 : 29}px;top:${large ? 97 : 28}px;width:${large ? 118 : 69}px;height:${large ? 118 : 69}px}
    h1{position:absolute;left:${large ? 245 : 111}px;top:${large ? 94 : 35}px;margin:0;font-size:${large ? 77 : 35}px;letter-spacing:-.05em;line-height:1.07}
    p{position:absolute;left:${large ? 250 : 31}px;top:${large ? 210 : 119}px;font-size:${large ? 32 : 24}px;line-height:1.2;color:#c3efce;margin:0}
    .signal{position:absolute;left:${large ? 250 : 31}px;bottom:${large ? 105 : 32}px;display:flex;gap:10px}.signal span{font-weight:750;font-size:${large ? 24 : 18}px;padding:${large ? '11px 19px' : '8px 13px'};border:1px solid #84d9aa88;border-radius:999px;background:#ffffff16}
    .signal span:first-child{background:#9cebb1;color:#123825;border-color:#9cebb1}
  </style><div class="canvas"><div class="ring"></div><img class="icon" src="${icon}"><h1>Codex Reset</h1><p>Reset status at a glance.</p><div class="signal"><span>Today</span><span>Tomorrow</span><span>24 / 48h</span></div></div></html>`;
}

const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
try {
  for (const scene of scenes) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await page.setContent(screenshotHtml(scene, await png(scene.image)), { waitUntil: 'load' });
    await page.screenshot({ path: `${output}/${scene.file}` });
    await page.close();
  }
  for (const [file, width, height] of [['07-宣传图-通用小图-440x280.png', 440, 280], ['08-宣传图-通用横幅-1400x560.png', 1400, 560]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(promoHtml(width, height), { waitUntil: 'load' });
    await page.screenshot({ path: `${output}/${file}` });
    await page.close();
  }
} finally { await browser.close(); }
console.log(`Created ${scenes.length + 3} store images in ${output}`);
