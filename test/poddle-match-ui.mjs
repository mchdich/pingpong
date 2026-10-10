// Browser smoke for the original Poddle court, with calibrated phone samples
// driving actual MotionModel serves and returns through the original contact box.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import puppeteer from 'puppeteer-core';
import { makeSynth, CALIBRATE, quatFromM } from './fake-bridge.mjs';
import { qmul, qconj, qaxis, qrot } from '../web/motion.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const shotDir = fileURLToPath(new URL('./ui-shots/poddle-match/', import.meta.url));
fs.mkdirSync(shotDir, { recursive: true });
const port = process.env.MATCH_UI_PORT || '8893';
const site = (process.env.CLIENT_SITE || `http://127.0.0.1:${port}`).replace(/\/$/, '');
const wsSite = site.replace(/^http/, 'ws');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const contexts = [], phones = [], timers = [], observers = [], errors = [], logs = [], results = [];
const heading = 137, headingRad = heading * Math.PI / 180;
const up = [0, 0, 1];
let nextWing = 1;

function phoneGrip() {
  const right = [Math.sin(headingRad), -Math.cos(headingRad), 0];
  const forward = [Math.cos(headingRad), Math.sin(headingRad), 0];
  const q = quatFromM([0, 1, 2].map(i => [up[i], forward[i], -right[i]]));
  return gripFor(q);
}
function gripFor(q) {
  const g = qmul(qconj(qaxis(up, headingRad)), q);
  const n = Math.hypot(...g.slice(0, 3));
  return [...g.slice(0, 3).map(v => v / n), 2 * Math.atan2(n, g[3])];
}
async function until(fn, timeout = 6000, label = 'condition') {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await wait(20); }
  assert.ok(await fn(), `${label} timed out`);
}
const server = process.env.CLIENT_SITE ? null : spawn(process.execPath, ['server/game.js'], {
  cwd: root,
  env: { ...process.env, PORT: port, PODDLE_DB: ':memory:', AUTOBOT: '1',
    READY_S: '0', WIN_AT: process.env.MATCH_UI_WIN_AT || '5', WIN_BY: '2',
    REMATCH_S: '60', STAMP_S: '1', BLOCK: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server?.stdout.on('data', d => logs.push(String(d)));
server?.stderr.on('data', d => logs.push(String(d)));
let browser;

async function click(page, selector) {
  await page.bringToFront();
  await page.waitForSelector(selector, { visible: true, timeout: 12000 });
  await page.click(selector);
}
async function openScreen(name, mode, room, spectator = false) {
  const context = await browser.createBrowserContext(); contexts.push(context);
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('response', r => { if (r.status() >= 400) errors.push(`${name}: ${r.status()} ${r.url()}`); });
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(n => {
    localStorage.setItem('poddle.name', n);
    localStorage.setItem('poddle.tutorial', '1');
    localStorage.setItem('poddle.settings', JSON.stringify({ hand: 'right' }));
    const Native = window.WebSocket;
    window.__matchWire = { state: null, messages: [], sourcePaddles: [], sourceSwings: [], sourceSettled: [] };
    window.WebSocket = class extends Native {
      constructor(url, ...rest) {
        super(url, ...rest);
        window.__matchWire.socket = this;
        this.addEventListener('message', e => {
          try {
            const m = JSON.parse(e.data);
            if (m.type === 'state') window.__matchWire.state = m;
            else window.__matchWire.messages.push(m);
          } catch { /* ignore non-JSON keepalives */ }
        });
      }
      send(raw) {
        try {
          const m = JSON.parse(raw), wire = window.__matchWire;
          if (m.type === 'paddle') {
            wire.sourcePaddles.push(m);
            if (wire.sourcePaddles.length > 80) wire.sourcePaddles.shift();
          }
          if (m.type === 'swing') {
            if (!m.fix) wire.sourceSwings.push(m);
            if (m.final) wire.sourceSettled.push(m);
          }
        } catch { /* allow other messages */ }
        return super.send(raw);
      }
    };
  }, name);
  await page.goto(`${site}/?uitest=1&cam=0${room ? `&court=${room}${spectator ? '&watch=1' : ''}` : ''}`, { waitUntil: 'networkidle0' });
  await click(page, '#btn-start');
  if (!room) {
    await page.waitForFunction(() => __stats.phase === 'lobby');
    await click(page, '#btn-courts'); await click(page, '#btn-create');
    await click(page, `#create-match-mode [data-match="${mode}"]`);
    await click(page, '#seg [data-public="0"]'); await click(page, '#btn-create-go');
    await page.waitForSelector('#lobby-share:not([hidden])');
    room = await page.$eval('#share-code', e => e.textContent.replace(/\s/g, ''));
    await click(page, '#btn-share-go');
  }
  await page.waitForFunction(watch => __stats.room && __stats.phase === (watch ? 'watch' : 'connect'), { timeout: 12000 }, spectator);
  const p = { name, page, context, room, side: null, phone: null, lastSample: null, synth: null, triggerAt: 0 };
  if (!spectator) {
    const code = await page.$eval('#pad-code', e => e.textContent.replace(/^P-/, ''));
    p.phone = new WebSocket(`${wsSite}/?padfor=${code}`); phones.push(p.phone);
    await new Promise((resolve, reject) => { p.phone.once('open', resolve); p.phone.once('error', reject); });
    p.synth = makeSynth({ heading, grip: phoneGrip(), script: CALIBRATE, t0: 100 + contexts.length * 100, seed: contexts.length + 7 });
    p.sampleStart = performance.now(); p.sampleCount = 0;
    p.timer = setInterval(() => {
      if (p.phone.readyState !== WebSocket.OPEN) return;
      // Windows rounds timers to ~31ms here. Keep the physical sample clock at
      // 50Hz, as fake-bridge does, rather than making a .45s swing take .70s.
      const due = Math.floor((performance.now() - p.sampleStart) / 20);
      while (p.sampleCount <= due) {
        const sample = p.synth.next(); p.lastSample = sample; p.sampleCount++;
        p.phone.send(JSON.stringify({ type: 'm', t: sample.t, q: sample.q, r: sample.r, a: sample.a }));
      }
    }, 5);
    timers.push(p.timer);
    // Begin a horizontal forehand or backhand at the current calibrated pose.
    // The swing is a real phone sample stream; only its timing is chosen here.
    p.stroke = (requestedWing, duration = .45) => {
      assert.ok(p.lastSample, `${name}: phone sample stream not started`);
      const wing = requestedWing === 'forehand' ? 1 : requestedWing === 'backhand' ? -1 : nextWing;
      if (!requestedWing) nextWing = -nextWing;
      p.synth = makeSynth({ heading, grip: gripFor(p.lastSample.q), t0: p.lastSample.t + .02,
        script: [{ T: .04 }, { T: duration, axis: [0, wing, 0], deg: 170 },
          { T: .4 }, { T: 2, axis: [0, -wing, 0], deg: 170 }, { T: .5 }] });
      p.sampleStart = performance.now(); p.sampleCount = 0;
      p.triggerAt = Date.now();
    };
  }
  return p;
}
async function observe(room) {
  const o = { ws: new WebSocket(`${wsSite}/?lobby=1&cid=ui-${room}-${Date.now()}`), log: [], st: null };
  observers.push(o);
  o.ws.on('message', data => {
    const m = JSON.parse(data); o.log.push(m);
    if (m.type === 'state') o.st = m;
  });
  await new Promise((resolve, reject) => { o.ws.once('open', resolve); o.ws.once('error', reject); });
  o.ws.send(JSON.stringify({ type: 'watch', code: room, name: 'UI observer' }));
  await until(() => o.st, 6000, 'observer state');
  return o;
}
async function hud(p) {
  return p.page.evaluate(() => ({
    phase: __stats.phase, side: __stats.side, mode: __stats.mode, role: __stats.role,
    calibrated: __stats.calibrated, errors: __stats.errors,
    score: [Number(document.querySelector('#sc-me').textContent), Number(document.querySelector('#sc-them').textContent)],
    audio: __scene.audio.ctx()?.state,
    sourcePaddles: __matchWire.sourcePaddles,
    sourceSwings: __matchWire.sourceSwings,
    sourceSettled: __matchWire.sourceSettled,
    ultimate: { state: __matchWire.state?.ultimates,
      hidden: document.querySelector('#ultimate-card').hidden,
      charge: document.querySelector('#ultimate-charge').textContent },
  }));
}
async function run(mode) {
  const attempts = [];
  const names = mode === '1v1' ? ['Ann', 'Ben'] : ['Cara', 'Dan', 'Eve', 'Finn'];
  const players = [];
  console.log(JSON.stringify({ stage: 'pairing', mode }));
  for (const name of names) players.push(await openScreen(name, mode, players[0]?.room));
  for (const p of players) {
    await p.page.waitForFunction(() => __stats.calibrated && document.body.dataset.screen === 'hud', { timeout: 30000 });
    await p.page.waitForFunction(() => __matchWire.sourcePaddles.length > 0, { timeout: 6000 });
    const h = await hud(p); p.side = h.side;
    assert.equal(h.mode, mode); assert.equal(h.phase, 'play'); assert.equal(h.audio, 'running');
    assert.ok(h.sourcePaddles.length > 0, `${p.name}: original controller sent no paddle pose`);
    assert.ok(h.sourcePaddles.every(m => Number.isFinite(m.x) && Number.isFinite(m.y) && Array.isArray(m.q) && m.q.every(Number.isFinite)), `${p.name}: invalid original paddle pose`);
    if (process.env.EXPECT_ULTIMATES === '1') {
      assert.equal(h.ultimate.state?.need, 5, `${p.name}: live ultimate feature disabled`);
      assert.equal(h.ultimate.hidden, false, `${p.name}: Critical counter hidden`);
      assert.match(h.ultimate.charge, /^0\s*\/\s*5$/, `${p.name}: initial Critical counter`);
    }
  }
  assert.deepEqual(players.map(p => p.side), names.map((_, i) => i));
  const spectator = await openScreen('Spectator', mode, players[0].room, true);
  const observer = await observe(players[0].room);
  await until(() => observer.st?.live && observer.st.serving != null, 12000, 'initial serve');
  await players[0].page.bringToFront();
  await players[0].page.screenshot({ path: `${shotDir}${mode}-court.png` });
  if (process.env.NET_PROBE === '1') {
    for (const p of [...players, spectator]) await p.page.evaluate(() => {
      const sc=__scene, original=sc.onEvent;
      window.__netProbe={contacts:[],frames:[]};
      sc.onEvent=m=>{
        original(m);
        if(m.type!=='net')return;
        __netProbe.contacts.push({m,p:sc._dbg.ball.pos.toArray(),live:sc._dbg.ball.live});
        const start=performance.now();
        function sample(){const d=sc._dbg;if(!d.ball.netHit||performance.now()-start>1200)return;
          let flex=0;const part=d.netFx.parts[0],a=part.mesh.geometry.attributes.position.array;
          for(let i=2;i<a.length;i+=3)flex=Math.max(flex,Math.abs(a[i]-part.base[i]));
          __netProbe.frames.push({p:d.ball.pos.toArray(),age:d.ball.netHit.age,flex});requestAnimationFrame(sample);
        }requestAnimationFrame(sample);
      };
    });
    const start=observer.log.length, seat=observer.st.serving;
    players[seat].stroke('forehand',.70);
    await until(()=>observer.log.slice(start).some(m=>m.type==='point'),12000,'real slow phone net fault');
    const point=observer.log.slice(start).find(m=>m.type==='point');
    if(point.why!=='net')console.log(JSON.stringify({stage:'failed-net-probe',mode,point,events:observer.log.slice(start).filter(m=>m.type!=='state'),wire:await hud(players[seat])}));
    assert.equal(point.why,'net');assert.equal(point.winner,1-seat%2);
    await wait(850);
    const captures=[];
    for(const p of [...players,spectator]){
      const capture=await p.page.evaluate(()=>__netProbe);captures.push({name:p.name,...capture});
      assert.equal(capture.contacts.length,1,`${p.name}: main did not dispatch the net impact exactly once`);
      const hit=capture.contacts[0],home=Math.sign(hit.m.p[2]);assert.deepEqual(hit.p,hit.m.p);assert.equal(hit.live,false);
      assert.ok(capture.frames.length>3&&capture.frames.every(f=>f.p[2]*home>=.11),`${p.name}: ball passed through the net`);
      assert.ok(capture.frames.some(f=>f.flex>.04)&&capture.frames.some(f=>f.p[1]<.25),`${p.name}: missing physical flex/drop`);
    }
    console.log(JSON.stringify({stage:'net-probe',mode,seat,point,captures:captures.map(c=>({name:c.name,frames:c.frames.length,maxFlex:Math.max(...c.frames.map(f=>f.flex)),minY:Math.min(...c.frames.map(f=>f.p[1]))}))}));
    if(process.env.NET_PROBE_ONLY==='1'){
      observer.ws.close();for(const p of [...players,spectator])await p.context.close();return;
    }
  }
  if (process.env.AIM_PROBE === '1') {
    const cases=[];
    for(const {aim,wing} of [{aim:-35,wing:'forehand'},{aim:35,wing:'backhand'},{aim:45,wing:'forehand'},{aim:-45,wing:'backhand'},{aim:-85,wing:'forehand'},{aim:85,wing:'backhand'}]){
      await until(()=>observer.st?.live&&observer.st.serving!=null,12000,'aimed serve');
      const seat=observer.st.serving,p=players[seat],cal=await p.page.evaluate(()=>JSON.parse(localStorage.getItem('poddle.cal')).phone);
      const D=qmul(p.lastSample.q,qconj(cal.calib)),pointer=qrot(D,cal.B.F),dot=(a,b)=>a.reduce((t,v,i)=>t+v*b[i],0);
      const yaw=Math.atan2(dot(pointer,cal.B.R),dot(pointer,cal.B.F))*180/Math.PI;
      const delta=Math.atan2(Math.sin((aim-yaw)*Math.PI/180),Math.cos((aim-yaw)*Math.PI/180))*180/Math.PI,T=Math.max(.8,Math.abs(delta)/45);
      p.synth=makeSynth({heading,grip:gripFor(p.lastSample.q),t0:p.lastSample.t+.02,script:[{T,axis:[0,1,0],deg:-delta},{T:.6}]});
      p.sampleStart=performance.now();p.sampleCount=0;
      await wait((T+.45)*1000);
      const start=observer.log.length;
      p.stroke(wing);
      await until(()=>observer.log.slice(start).some(m=>m.type==='point'),12000,'aimed shot outcome');
      const events=observer.log.slice(start),hit=events.find(m=>m.type==='hit'),launch=events.findLast(m=>m.type==='launch'&&m.land),point=events.find(m=>m.type==='point');
      assert.ok(hit&&launch,'real phone aim did not launch');
      const sign=seat%2?-1:1,target=launch.land[0]*sign;
      if(Math.abs(aim)===45)assert.ok(Math.abs(target)<.04,'returning from a natural take-back cannot keep aiming right/left');
      else assert.ok(target*Math.sign(aim)>2.5,'physical stroke plus agreeing intention reaches the chosen edge');
      assert.notEqual(point.why,'out');assert.notEqual(point.why,'net');
      assert.equal(point.winner,seat%2,'comfortable edge placement must not lose to a lateral fault');
      cases.push({seat,aim,wing,target,why:point.why});
    }
    assert.ok(new Set(cases.map(c=>c.seat%2)).size===2,'aiming probe must exercise both teams');
    console.log(JSON.stringify({stage:'aim-probe',mode,cases}));
    if(process.env.AIM_PROBE_ONLY==='1'){observer.ws.close();for(const p of [...players,spectator])await p.context.close();return;}
  }
  const wanted = mode === '1v1' ? 0 : 1;
  const deadline = Date.now() + 150000;
  let servedFor = -1, attemptedReturnFor = -1, hits = 0, points = 0;
  while (Date.now() < deadline && !observer.log.some(m => m.type === 'matchover')) {
    const st = observer.st;
    if (!st?.live) { await wait(15); continue; }
    const currentServe = observer.log.filter(m => m.type === 'serve').length;
    if (st.serving != null) {
      if (st.reach && (servedFor !== currentServe || Date.now() - players[st.serving].triggerAt > 1800)) {
        players[st.serving].stroke(); servedFor = currentServe;
      }
    } else if (st.turn != null && st.turn % 2 === wanted && currentServe !== attemptedReturnFor) {
      const pl = st.paddles[st.turn], sideSign = st.turn % 2 === 0 ? 1 : -1;
      const ahead = -(st.p[2] - pl.z) * sideSign;
      // Across the public relay, begin the physical gesture as the first
      // bounce approaches. Waiting for its notification burns another network
      // leg before the phone -> server -> desktop -> server path can start.
      // Contact remains the unmodified server's live front-side judgment.
      const g=9.81*(1-.3*(st.spin||0)),floor=(st.v[1]+Math.sqrt(st.v[1]**2+2*g*Math.max(0,st.p[1]-.11)))/g;
      const prepare=st.b>=1||process.env.CLIENT_SITE&&st.v[1]<0&&floor<.22;
      const lead=process.env.CLIENT_SITE?5.2:3.3;
      if (prepare && ahead < lead && ahead > 1.2) {
        const contactTime=Math.max(0,ahead/Math.max(.1,st.v[2]*sideSign)),projectedX=st.p[0]+st.v[0]*contactTime;
        const localX = (projectedX-((pl.homeX||0)-sideSign*.5))*sideSign;
        players[st.turn].stroke(localX >= 0 ? 'forehand' : 'backhand'); attemptedReturnFor = currentServe;
        attempts.push({ t: st.t, side: st.turn, ball: st.p, v: st.v, paddle: { x: pl.x, y: pl.y, z: pl.z }, ahead, preparingBeforeBounce:st.b===0, wing: localX >= 0 ? 'forehand' : 'backhand' });
      }
    }
    const newHits = observer.log.filter(m => m.type === 'hit').length;
    const newPoints = observer.log.filter(m => m.type === 'point').length;
    if (newHits > hits) hits = newHits;
    if (newPoints > points) { points = newPoints; console.log(JSON.stringify({ stage: 'point', mode, points, score: st.score, hits })); }
    await wait(15);
  }
  const over = observer.log.findLast(m => m.type === 'matchover');
  assert.ok(over, `${mode}: match did not finish; score ${observer.st?.score}, hits ${hits}`);
  assert.equal(over.forfeit, false);
  points = observer.log.filter(m => m.type === 'point').length;
  hits = observer.log.filter(m => m.type === 'hit').length;
  assert.equal(points, over.score[0] + over.score[1], `${mode}: each point must reach the match result`);
  assert.equal(over.winner, over.score[0] > over.score[1] ? 0 : 1);
  if (hits <= points) {
    const diagnostics = await Promise.all(players.map(async p => ({ side: p.side, ...(await p.page.evaluate(() => ({
      swings: __matchWire.sourceSwings, settled: __matchWire.sourceSettled,
      whiffs: __matchWire.messages.filter(m => m.type === 'whiff'),
    }))) })));
    console.error(JSON.stringify({ stage: 'no-return-diagnostics', mode, attempts, diagnostics }));
  }
  assert.ok(hits > points, `${mode}: source phone return did not earn a hit beyond serves`);
  const source = await Promise.all(players.map(async p => {
    const h = await hud(p);
    return { side: p.side, swings: h.sourceSwings, settled: h.sourceSettled };
  }));
  assert.ok(source.some(s => s.swings.length > 1), `${mode}: no player produced multiple real phone swing reports`);
  const horizontal = source.flatMap(s => s.settled).filter(m => m.power >= 12 && m.power <= 26 && Math.abs(m.dir) > .85);
  assert.ok(horizontal.some(m => m.dir < 0) && horizontal.some(m => m.dir > 0), `${mode}: calibrated source did not send moderate settled forehand and backhand swings`);
  assert.ok(source.flatMap(s => s.settled).every(m => Number.isFinite(m.aimX) && ['forehand', 'backhand', 'neutral'].includes(m.wing) && m.hand === 'right'), `${mode}: actual controller omitted independent aiming or stroke side`);
  for (const p of [...players, spectator]) {
    await p.page.waitForSelector('#screen-match:not([hidden])', { timeout: 12000 });
    await p.page.waitForFunction(() => !document.querySelector('#screen-match').classList.contains('is-stamp'), { timeout: 12000 });
    const card = await p.page.evaluate(() => ({
      role: __stats.role, side: __stats.side, title: document.querySelector('#result-title').textContent,
      score: [Number(document.querySelector('#tally-sc-me').textContent), Number(document.querySelector('#tally-sc-them').textContent)],
      rematchHidden: document.querySelector('#btn-rematch').hidden,
    }));
    const team = card.role === 'spectator' ? 0 : card.side % 2;
    assert.deepEqual(card.score, [over.score[team], over.score[1 - team]], `${p.name}: result score`);
    assert.ok(card.title, `${p.name}: missing result title`);
    assert.equal(card.rematchHidden, card.role === 'spectator');
  }
  for (const p of players) await click(p.page, '#btn-rematch');
  await until(() => observer.log.some(m => m.type === 'rematchon') && observer.st?.score.every(n => n === 0) && observer.st.live, 12000, 'rematch serve');
  for (const p of [...players, spectator]) await p.page.waitForSelector('#screen-match[hidden]', { timeout: 12000 });
  const outcome = { mode, score: over.score, winner: over.winner, points, hits,
    sourceSwings: source.map(s => s.swings.length), horizontalDirs: horizontal.map(m => +m.dir.toFixed(2)), rematch: true };
  results.push(outcome); console.log(JSON.stringify({ stage: 'match-complete', ...outcome }));
  observer.ws.close();
  for (const p of [...players, spectator]) await p.context.close();
}

try {
  await until(async () => {
    if (server?.exitCode != null) throw new Error(`server exited early: ${logs.join('')}`);
    try { return (await fetch(`${site}/status.json`)).ok; } catch { return false; }
  }, 12000, 'game server');
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
    args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] });
  if (process.env.MATCH_UI_MODE !== '2v2') await run('1v1');
  if (process.env.MATCH_UI_MODE !== '1v1') await run('2v2');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, results }));
} catch (e) {
  console.error(JSON.stringify({ error: e.message, results, errors, logs: logs.slice(-8) }));
  throw e;
} finally {
  for (const t of timers) clearInterval(t);
  for (const p of phones) p.terminate();
  for (const o of observers) o.ws.terminate();
  for (const c of contexts) await c.close().catch(() => {});
  await browser?.close(); server?.kill();
}
