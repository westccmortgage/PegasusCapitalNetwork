// Capture real mobile screenshots at 360 / 390 / 430 px in English and Simplified
// Chinese (landing, trust panel, chat) using the pre-installed Chromium. Serves
// dist/ over a tiny static server so no external preview process is needed.
//
//   npm run build && node e2e/screenshots.mjs   → e2e/screenshots/*.png

import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'e2e', 'screenshots');
const CHROMIUM = process.env.WCCI_CHROMIUM || '/opt/pw-browsers/chromium';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

if (!existsSync(DIST)) { console.error('Run `npm run build` first.'); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = join(DIST, p);
  try { res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' }); res.end(readFileSync(file)); }
  catch { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(readFileSync(join(DIST, 'index.html'))); }
});

const SIZES = [{ w: 360, h: 800 }, { w: 390, h: 844 }, { w: 430, h: 932 }];

await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch({ executablePath: CHROMIUM });
const shots = [];

async function shoot(page, name) { const f = join(OUT, name); await page.screenshot({ path: f, fullPage: false }); shots.push(name); }

for (const s of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await shoot(page, `landing-en-${s.w}.png`);

  // Simplified Chinese
  await page.getByRole('button', { name: /Language: 中文/ }).click();
  await page.waitForTimeout(150);
  await shoot(page, `landing-zh-${s.w}.png`);

  // Trust panel (zh)
  await page.getByRole('button', { name: /公司与执照信息/ }).first().click();
  await page.waitForTimeout(150);
  await shoot(page, `trust-zh-${s.w}.png`);
  await page.getByRole('button', { name: '关闭' }).click();

  // Chat (zh) via step-by-step
  await page.getByRole('button', { name: '逐步输入信息' }).click();
  await page.waitForTimeout(200);
  await shoot(page, `chat-zh-${s.w}.png`);

  await ctx.close();
}

await browser.close();
server.close();
console.log(`✓ captured ${shots.length} screenshots → e2e/screenshots/\n  ${shots.join('\n  ')}`);
