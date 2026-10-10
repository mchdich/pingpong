// Actual phone/computer DOM and the real phone relay. Charge is supplied by the
// host here; server streak rules are independently exercised in ultimate tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import WebSocket from 'ws';
import puppeteer from 'puppeteer-core';
import { hitPulse } from '../web/haptics.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, ms = 6000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await wait(10); } assert.ok(await fn(), label); }
const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port; await new Promise(r => probe.close(r));
const output = [], errors = [], actions = [];
const server = spawn(process.execPath, ['server/game.js'], { cwd: root, env: { ...process.env, PORT: String(port), PODDLE_DB: ':memory:', AUTOBOT: '0' } });
server.stdout.on('data', d => output.push(String(d))); server.stderr.on('data', d => output.push(String(d)));
let browser, host;
try {
  await until(() => output.some(s => s.includes('game server on port')), 'server startup');
  const site = `http://127.0.0.1:${port}`, code = 'UPWR';
  host = new WebSocket(`ws://127.0.0.1:${port}/?lobby=1&cid=ultimate-ui-host&pad=${code}`);
  host.on('error', () => {}); host.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'ultimate') actions.push(m); });
  await new Promise((resolve, reject) => { host.once('open', resolve); host.once('error', reject); });
  browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
    args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] });
  const phone = await browser.newPage();
  phone.on('pageerror', e => errors.push(`phone: ${e.message}`));
  await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await phone.goto(`${site}/pad.html?k=${code}`, { waitUntil: 'networkidle0' });
  await phone.evaluate(() => {
    window.DeviceMotionEvent ||= class {};
    window.DeviceOrientationEvent ||= class {};
    window.__sensorTimer = setInterval(() => {
      window.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 20, beta: 35, gamma: 5 }));
      window.dispatchEvent(Object.assign(new Event('devicemotion'), { rotationRate: { alpha: 0, beta: 0, gamma: 0 }, acceleration: { x: 0, y: 0, z: 0 }, interval: 16 }));
    }, 16);
  });
  await phone.click('#go');
  await phone.waitForFunction(() => __pad.view === 'live' && __pad.host && __pad.open);
  const push = fields => host.send(JSON.stringify({ type: 'ultimateState', available: true, charge: 0, need: 5, boost: 0, slow: 0, enabled: true, ...fields }));
  const readPhone = () => phone.evaluate(() => ({ charge: document.querySelector('#pad-ultimate-charge').textContent,
    boostDisabled: document.querySelector('#pad-ultimate-boost').disabled, slowDisabled: document.querySelector('#pad-ultimate-slow').disabled,
    note: document.querySelector('#pad-ultimate-status').textContent, progress: document.querySelector('#pad-ultimate-meter').getAttribute('aria-valuenow') }));
  push({ charge: 0 }); await phone.waitForFunction(() => __pad.ultimate.available);
  assert.equal(await phone.$eval('.pad-ultimate-head b', el => el.textContent), 'Critical streak');
  assert.equal((await readPhone()).charge, '0 / 5');
  assert.equal((await readPhone()).boostDisabled, true);
  push({ charge: 4 }); await phone.waitForFunction(() => __pad.ultimate.charge === 4);
  assert.deepEqual(await readPhone(), { charge: '4 / 5', boostDisabled: true, slowDisabled: true, note: '5 orange hits in a row', progress: '4' });
  await phone.evaluate(() => document.querySelector('#pad-ultimate-boost').dispatchEvent(new Event('click')));
  await wait(40); assert.equal(actions.length, 0, 'a premature phone action never reaches the computer');
  push({ charge: 5 }); await phone.waitForFunction(() => !document.querySelector('#pad-ultimate-boost').disabled);
  assert.equal((await readPhone()).charge, '5 / 5');
  assert.equal((await readPhone()).note, 'Ultimate ready — choose a power');
  await phone.click('#pad-ultimate-boost');
  await until(() => actions.length === 1, 'phone boost relay');
  assert.deepEqual(actions[0], { type: 'ultimate', kind: 'boost' });
  await phone.evaluate(() => document.querySelector('#pad-ultimate-slow').dispatchEvent(new Event('click')));
  await wait(40); assert.equal(actions.length, 1, 'one charge cannot activate both choices');
  push({ charge: 0, boost: 6 }); await phone.waitForFunction(() => __pad.ultimate.charge === 0);
  assert.equal((await readPhone()).charge, '0 / 5', 'spending the charge clears the visible critical counter');
  assert.equal((await readPhone()).note, 'Swing faster · 6s');
  assert.equal((await readPhone()).boostDisabled, true);
  push({ charge: 5 }); await phone.waitForFunction(() => !document.querySelector('#pad-ultimate-slow').disabled);
  await phone.click('#pad-ultimate-slow'); await until(() => actions.length === 2, 'phone slow relay');
  assert.deepEqual(actions[1], { type: 'ultimate', kind: 'slow' });
  push({ charge: 3, slow: 4 }); await phone.waitForFunction(() => __pad.ultimate.charge === 3);
  assert.equal((await readPhone()).note, 'Swing + movement slowed · 4s');
  push({ charge: 5, enabled: false }); await phone.waitForFunction(() => __pad.ultimate.charge === 5 && !__pad.ultimate.enabled);
  assert.equal((await readPhone()).boostDisabled, true, 'paused/finished match disables an otherwise full charge');
  push({ charge: 5, available: false }); await phone.waitForFunction(() => !__pad.ultimate.available);
  assert.equal(await phone.$eval('#pad-ultimate', el => el.hidden), true, 'disabled feature hides the entire phone ability panel');
  assert.equal(await phone.$eval('#pad-ultimate', el => el.getClientRects().length), 0, 'disabled phone panel takes no layout space');
  assert.equal((await readPhone()).boostDisabled, true);
  push({ charge: 5 }); await phone.waitForFunction(() => !document.querySelector('#pad-ultimate-slow').disabled);
  await wait(620);
  fs.mkdirSync(new URL('test/ui-shots/ultimate/', new URL('..', import.meta.url)), { recursive: true });
  await phone.screenshot({ path: fileURLToPath(new URL('test/ui-shots/ultimate/phone.png', new URL('..', import.meta.url))) });

  // Real relay -> real phone FX receiver. A lob's white display colour must
  // not soften its physical vibration, nor can settled recolours buzz twice.
  await phone.evaluate(() => {
    window.__hitBuzz = [];
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: pulse => { __hitBuzz.push(pulse); return true; } });
  });
  host.send(JSON.stringify({ type: 'padfx', fx: 'hit', n: 0, b: .95 }));
  await phone.waitForFunction(() => __hitBuzz.length === 1);
  assert.deepEqual(await phone.evaluate(() => __hitBuzz), [hitPulse(.95)]);
  host.send(JSON.stringify({ type: 'padfx', fx: 'tint', n: 1, b: .95 }));
  host.send(JSON.stringify({ type: 'padfx', fx: 'tint', n: 1, b: .95 }));
  host.send(JSON.stringify({ type: 'padfx', fx: 'point' }));
  await wait(50);
  assert.equal(await phone.evaluate(() => __hitBuzz.length), 1);
  host.send(JSON.stringify({ type: 'padfx', fx: 'hit', n: 1, b: 0 }));
  await phone.waitForFunction(() => __hitBuzz.length === 2);
  assert.equal(await phone.evaluate(() => __hitBuzz[1]), 8);
  await phone.evaluate(() => Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined }));
  host.send(JSON.stringify({ type: 'padfx', fx: 'hit', n: .5, b: .8 }));
  await phone.waitForFunction(() => document.querySelector('#haptic-note').textContent.includes('unavailable'));
  await phone.evaluate(() => Object.defineProperty(navigator, 'vibrate', { configurable: true, value: () => { throw Error('unsupported vibration'); } }));
  host.send(JSON.stringify({ type: 'padfx', fx: 'hit', n: .5, b: .8 }));
  await wait(30);
  host.close(); await phone.waitForFunction(() => !__pad.host);
  assert.equal((await readPhone()).boostDisabled, true, 'lost computer disables stale charged controls');

  const desk = await browser.newPage(); desk.on('pageerror', e => errors.push(`desktop: ${e.message}`));
  await desk.setViewport({ width: 1280, height: 800 });
  await desk.evaluateOnNewDocument(() => localStorage.setItem('poddle.tutorial', '1'));
  await desk.goto(`${site}/?uitest=1`, { waitUntil: 'networkidle0' });
  await desk.click('#btn-start');
  await desk.waitForFunction(() => __stats.phase === 'lobby', { timeout: 4000 }).catch(async error => {
    console.error(JSON.stringify({ errors, desktop: await desk.evaluate(() => ({ phase: window.__stats?.phase, screen: document.body.dataset.screen, overlay: document.body.dataset.overlay, text: document.body.innerText.slice(-700) })) }));
    throw error;
  });
  await desk.evaluate(async () => {
    const ui = await import('./ui.js');
    ui.showScreen(null);
    window.__ultimateActions = [];
    ui.onUltimate(kind => __ultimateActions.push(kind));
    ui.setUltimate({ visible: true, charge: 0, need: 5, enabled: true });
  });
  await wait(420);
  assert.equal(await desk.$eval('.ultimate-head b', el => el.textContent), 'Critical streak');
  assert.equal(await desk.$eval('#ultimate-charge', el => el.textContent), '0 / 5');
  await desk.evaluate(async () => (await import('./ui.js')).setUltimate({ visible: true, charge: 4, need: 5, enabled: true }));
  assert.equal(await desk.$eval('#ultimate-charge', el => el.textContent), '4 / 5');
  assert.equal(await desk.$eval('#ultimate-boost', el => el.disabled), true);
  await desk.evaluate(async () => (await import('./ui.js')).setUltimate({ visible: true, charge: 5, need: 5, enabled: true }));
  assert.equal(await desk.$eval('#ultimate-charge', el => el.textContent), '5 / 5');
  assert.equal(await desk.$eval('#ultimate-status', el => el.textContent), 'Ultimate ready — choose a power');
  await desk.click('#ultimate-boost'); await desk.click('#ultimate-slow');
  assert.deepEqual(await desk.evaluate(() => __ultimateActions), ['boost', 'slow']);
  await desk.evaluate(async () => (await import('./ui.js')).setUltimate({ visible: true, charge: 0, need: 5, enabled: true, boost: 6 }));
  assert.equal(await desk.$eval('#ultimate-charge', el => el.textContent), '0 / 5');
  await desk.evaluate(async () => (await import('./ui.js')).setUltimate({ visible: true, charge: 2, need: 5, enabled: true, boost: 5, slow: 2 }));
  assert.equal(await desk.$eval('#ultimate-status', el => el.textContent), 'Swing faster · 5s / Swing + movement slowed · 2s');
  assert.equal(await desk.$eval('#ultimate-meter', el => el.getAttribute('aria-valuenow')), '2');
  await desk.evaluate(async () => (await import('./ui.js')).setUltimate({ visible: true, available: false, charge: 5, need: 5, enabled: true }));
  assert.equal(await desk.$eval('#ultimate-card', el => el.hidden), true, 'disabled feature hides the desktop ability panel');
  assert.equal(await desk.$eval('#ultimate-card', el => el.getClientRects().length), 0, 'disabled desktop panel takes no layout space');
  await desk.evaluate(async () => (await import('./ui.js')).setUltimate({ visible: true, charge: 5, need: 5, enabled: true }));
  await desk.screenshot({ path: fileURLToPath(new URL('test/ui-shots/ultimate/computer.png', new URL('..', import.meta.url))) });
  assert.deepEqual(errors, []);

  // Execute the actual main.js activation functions to check seat, match state,
  // charge, payload and duplicate gating, not a copied controller implementation.
  const main = fs.readFileSync(new URL('web/main.js', new URL('..', import.meta.url)), 'utf8');
  const start = main.indexOf('let ultimateInputUntil ='), end = main.indexOf('const padFx =', start);
  const sent = [], drawn = []; let now = 1000;
  const controller = Function('game', 'ui', 'performance', 'setTimeout', `
    let state = {ultimates:{charges:[4],need:5},paddles:[{ultimate:{}}]}, phase='play', calibrating=false, frozen=false, holding=false, over=null;
    const side=0,padOn=true,seated=()=>true,spec=()=>false;
    ${main.slice(start, end)}
    return { activateUltimate, ultimateInfo, state: value => state=value, pause: value => frozen=value };
  `)({ send: m => sent.push(m) }, { setUltimate: m => drawn.push(m), currentOverlay: () => null, currentScreen: () => null }, { now: () => now }, () => {});
  assert.equal(controller.activateUltimate('boost'), false);
  controller.state({ ultimates: { charges: [5], need: 5 }, paddles: [{ ultimate: {} }] });
  assert.equal(controller.activateUltimate('boost'), true);
  assert.equal(controller.activateUltimate('slow'), false);
  assert.deepEqual(sent.filter(m => m.type === 'ultimate'), [{ type: 'ultimate', kind: 'boost' }]);
  now += 700; controller.pause(true); assert.equal(controller.activateUltimate('slow'), false);
  controller.pause(false); assert.equal(controller.activateUltimate('slow'), true);
  assert.equal(controller.activateUltimate('unknown'), false);
  assert.ok(sent.some(m => m.type === 'ultimateState' && m.need === 5 && m.enabled === false));
  controller.state({ paddles: [{ ultimate: {} }] }); now += 700;
  assert.equal(controller.ultimateInfo().available, false);
  assert.equal(controller.activateUltimate('boost'), false, 'feature absent from server state cannot be activated');
  console.log(JSON.stringify({ passed: true, phoneActions: actions, desktopChoices: ['boost', 'slow'], clientChargeAndPauseGate: true, realPhoneHapticRelay: true, screenshots: ['test/ui-shots/ultimate/phone.png', 'test/ui-shots/ultimate/computer.png'], errors }));
} finally { host?.terminate(); await browser?.close(); server.kill(); }
