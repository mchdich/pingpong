import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = fileURLToPath(new URL('../web/', import.meta.url));
const stamp = Date.parse('2026-10-08T04:00:00.000Z');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8'));
manifest.publishedAt = new Date(stamp).toISOString();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname === '/release.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(manifest)); return; }
  const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, data) => { if (error) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream'); res.end(data); });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument((published) => {
    let saved;
    try { saved = sessionStorage.getItem('__releaseTestNow'); } catch {}
    window.__releaseNow = Number(saved) || published + 300000;
    Date.now = () => window.__releaseNow;
    const original = window.setTimeout;
    window.setTimeout = (fn, ms, ...args) => {
      if (fn.name === 'checkExpiry') { window.__releaseExpire = fn; window.__releaseDelay = ms; return -123; }
      return original(fn, ms, ...args);
    };
  }, stamp);
  const url = `http://127.0.0.1:${server.address().port}/`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#release-notes');
  assert.deepEqual(await page.$$eval('#release-notes li', items => items.map(item => item.textContent)), manifest.changes);
  assert.equal(await page.$eval('#release-notes', card => getComputedStyle(card).pointerEvents), 'none');
  assert.equal(await page.$eval('.release-notes-close', button => getComputedStyle(button).pointerEvents), 'auto');
  const screen = path.resolve(root, '../test/ui-shots/release-notes.png');
  fs.mkdirSync(path.dirname(screen), { recursive: true });
  await page.screenshot({ path: screen });
  assert.equal(await page.evaluate(() => window.__releaseDelay), 10000);
  await page.evaluate(() => { window.__releaseNow += 5000; sessionStorage.setItem('__releaseTestNow', window.__releaseNow); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#release-notes');
  assert.equal(await page.evaluate(() => window.__releaseDelay), 5000, 'reload keeps only the remaining five seconds');
  await page.evaluate(() => { window.__releaseNow += 4999; window.__releaseExpire(); });
  assert.ok(await page.$('#release-notes'), 'card remains visible one millisecond before expiry');
  await page.evaluate(() => { window.__releaseNow += 1; sessionStorage.setItem('__releaseTestNow', window.__releaseNow); document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.$('#release-notes'), null, 'open card vanishes ten seconds after first view');
  await page.evaluate(async () => { const { showRelease } = await import('/release-notes.js'); showRelease(await (await fetch('/release.json')).json()); });
  assert.equal(await page.$('#release-notes'), null, 'expired release cannot render again');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(await page.$('#release-notes'), null, 'expired version cannot appear on reload');
  manifest.id = 'next-release';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#release-notes');
  assert.equal(await page.evaluate(() => window.__releaseDelay), 10000, 'new version gets a new ten-second window');
  await page.waitForFunction(() => window.__stats?.phase === 'title');
  assert.equal(await page.evaluate(() => window.__stats.phase), 'title');
  await page.click('.release-notes-close');
  assert.equal(await page.$('#release-notes'), null);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(await page.evaluate(() => window.__stats.phase), 'title', 'dismissing the update cannot also press Play on the title screen');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(await page.$('#release-notes'), null, 'dismissal survives reload');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, actualIndex: true, sevenChanges: true, firstViewTenSeconds: true, reloadKeepsRemaining: true, expiredNeverRenders: true, newVersionGetsNewWindow: true, dismissalSurvivesReload: true, dismissalKeepsTitleScreen: true, errors, screenshot: screen }));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
