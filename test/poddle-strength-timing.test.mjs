import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import WebSocket from 'ws';
import { MotionModel, qaxis, qmul } from '../web/motion.js';

const root = new URL('..', import.meta.url), wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, why, ms = 10000) { const end = Date.now() + ms; while (Date.now() < end) { const result = fn(); if (result) return result; await wait(5); } throw new Error(why); }
function recordedStrokes() {
  const rows = readFileSync(new URL('data/live-play-1.jsonl', root), 'utf8').trim().split('\n').map(JSON.parse).filter(r => r.q && r.r);
  const source = readFileSync(new URL('web/main.js', root), 'utf8');
  const a = source.indexOf('const roll = Math.max('), b = source.indexOf("game.send({ type: 'swing'", a);
  const clientFields = Function('e', source.slice(a, b) + '; return {slice, lob};');
  const model = new MotionModel(), start = rows[0].t - 8;
  for (let i = 0; i < 400; i++) {
    const k = i * .02, t = start + k, tip = k < 5.4 ? 0 : k < 6 ? .6 * (k - 5.4) / .6 : .6;
    model.feed({ t, q: qmul(qaxis([1, 0, 0], tip), rows[0].q), r: [0, 0, 0], a: [0, 0, 0] }, t * 1000);
  }
  const movements = []; let movement;
  for (const row of rows) for (const e of model.feed({ ...row }, row.t * 1000)) {
    if (e.type === 'swing') { movement = []; movements.push(movement); }
    if (movement && ['swing', 'swingFix'].includes(e.type)) movement.push({ e, t: row.t, ...clientFields(e) });
    if (e.type === 'swingEnd') movement = null;
  }
  return {
    stronger: movements.find(m => m[0].e.power === 6 && m.at(-1).e.final && m.at(-1).e.power > 20 && m.at(-1).e.power < 24 && m.at(-1).lob < .4),
    weaker: movements.find(m => m[0].e.power > 20 && m.at(-1).e.final && m.at(-1).e.power === 6 && m.at(-1).lob < .4)
  };
}
const strokes = recordedStrokes();
const physicsSource = readFileSync(new URL('server/game.js', root), 'utf8');
const physics = Function('process', 'abuse', physicsSource.slice(physicsSource.indexOf('const COURT ='), physicsSource.indexOf('function createRoom(')) + '\nreturn {solve,effort};')({ env: {} }, { MATCH_WIDE: [] });
const strength = p => physics.effort(Math.max(0, Math.min(1, (p - 6) / 28)));
const packet = entry => ({ ...entry.e, type: 'swing', slice: entry.slice, lob: entry.lob, fix: entry.e.type === 'swingFix', net: 0, src: 'phone', pk: entry.e.raw });

test('phone returns commit the measured strength at the original contact, with one hit', async t => {
  assert.ok(strokes.stronger && strokes.weaker, 'real source captures include both directions of prediction error');
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await new Promise(r => probe.once('listening', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const output = [], clients = [], proc = spawn(process.execPath, ['server/game.js'], { cwd: root, env: { ...process.env, PORT: String(port), AUTOBOT: '0', SWING_SERVE: '1', WIN_AT: '0', BLOCK: '1', READY_S: '0', HEARTBEAT: '15000' } });
  proc.stdout.on('data', d => output.push(String(d))); proc.stderr.on('data', d => output.push(String(d)));
  t.after(() => { clients.forEach(c => c.ws.terminate()); proc.kill(); });
  await until(() => output.some(s => s.includes('game server on port')), 'server did not start');
  let serial = 0;
  async function room({ nearBlock = false } = {}) {
    const players = [];
    for (let i = 0; i < 2; i++) {
      const c = { log: [], ws: new WebSocket(`ws://127.0.0.1:${port}/?lobby=1&cid=strength-${serial++}`) }; clients.push(c); players.push(c);
      c.ws.on('error', () => {}); c.ws.on('message', raw => { const m = JSON.parse(raw); c.log.push({ ...m, received: Date.now() }); if (m.type === 'state') { c.st = m; if (nearBlock && i === 1) c.send({type: 'paddle', auto: false, autoY: false, x: m.p[0], y: Math.max(.4, Math.min(2.3,m.p[1])), z: 2.8, q: [0,0,0,1],r:0}); } if (m.type === 'welcome') c.welcome = m; if (m.type === 'room') c.room = m; });
      c.send = m => c.ws.send(JSON.stringify(m));
      await until(() => c.log.some(m => m.type === 'lobby'), 'lobby missing');
      c.send(i ? { type: 'join', code: players[0].room.code } : { type: 'create', public: false });
      await until(() => c.welcome, 'player missing');
      c.send({ type: 'paddle', auto: !nearBlock, autoY: false, x: 0, y: 1, z: nearBlock ? 2.8 : undefined, q: [0, 0, 0, 1], r: nearBlock ? 0 : 10 });
    }
    const [host] = players;
    await until(() => host.st?.live && host.st.serving != null, 'serve missing');
    host.send({ type: 'swing', power: nearBlock ? 12.6 : 20, raw: nearBlock ? 12.6 : 20, rom: 60, off: 30, back: .8, dir: 0, lob: nearBlock ? .7 : 0, final: true, age: 80 });
    await until(() => host.log.some(m => m.type === 'hit'), 'serve not struck');
    if (nearBlock) return players;
    await until(() => { const s = host.st, p = s?.paddles?.[1]; return s?.live && s.serving == null && s.b >= 1 && p && Math.abs(s.p[0] - p.x) < 1 && Math.abs(s.p[1] - p.y) < .6 && Math.abs(s.p[2] - p.z) < 1.1; }, 'incoming ordinary return not reachable');
    return players;
  }
  async function runCase({ movement, finalDelay, expectedWinner, duplicate = false, settledFirst = false, omitFinal = false, oldFixNextServe = false }) {
    const [host, receiver] = await room(), start = host.log.length, sent = Date.now(), timers = [];
    const final = movement.at(-1);
    const reports = settledFirst ? [{ ...final, e: { ...final.e, type: 'swing' } }] : omitFinal ? [movement[0]] : finalDelay == null ? movement : [movement[0], final];
    for (const entry of reports) {
      const delay = settledFirst ? 0 : entry === final && finalDelay != null ? finalDelay : Math.round((entry.t - movement[0].t) * 1000);
      timers.push(setTimeout(() => receiver.send(packet(entry)), delay));
    }
    t.after(() => timers.forEach(clearTimeout));
    const hit = await until(() => host.log.slice(start).find(m => m.type === 'hit' && m.side === 1), 'accepted original contact did not strike');
    if (duplicate) receiver.send({ ...packet(final), power: 6, lob: 0, slice: 0, fix: true, final: true });
    const point = await until(() => host.log.slice(start).find(m => m.type === 'point'), 'return did not finish');
    const log = host.log.slice(start), hits = log.filter(m => m.type === 'hit' && m.side === 1), launches = log.filter(m => m.type === 'launch' && m.by === 1);
    assert.equal(hits.length, 1, 'one measured contact produces one hit and source hit sound');
    assert.equal(launches.length, 1, 'a final phone contact is not followed by a guessed-flight reaim');
    const used = omitFinal ? movement[0] : final, expectedN = strength(used.e.power);
    assert.ok(Math.abs(hit.n - expectedN) < 1e-10, 'hit power/effects use the measured report');
    assert.ok(Math.abs(hit.force - expectedN) < 1e-10, 'phone feedback reports the actual stroke strength');
    const expected = physics.solve(hit.p, 1, expectedN, used.e.dir, used.lob, used.slice, null, 1);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(hit.v[i] - expected.v[i]) < 1e-9, 'the complete outgoing velocity comes from the measured stroke');
    assert.equal(point.winner, expectedWinner);
    if (settledFirst) assert.ok(hit.received - sent < 80, 'already-settled contact retains immediate original release');
    else if (omitFinal) assert.ok(hit.received - sent >= 250 && hit.received - sent < 450, 'a missing final falls back once at the bounded 300 ms deadline');
    else {
      const settleDelay = finalDelay ?? Math.round((final.t - movement[0].t) * 1000);
      assert.ok(hit.received - sent >= settleDelay - 10, 'the initial prediction cannot release or sound a false hit');
      const held = log.filter(m => m.type === 'state' && m.received < hit.received && m.serving == null);
      assert.ok(held.every(m => m.v.every(v => v === 0)), 'accepted contact remains fixed while its measured peak arrives');
    }
    if (oldFixNextServe) {
      await until(() => host.st?.live && host.st.serving === 1, 'next point serve was not reset');
      const boundary = host.log.length; receiver.send({...packet(final),fix:true,final:true});
      await wait(350);
      assert.equal(host.log.slice(boundary).filter(m=>m.type==='hit').length,0,'a prior point correction cannot start the next serve');
      assert.equal(host.st.serving,1,'the new point still waits for an actual new stroke');
    }
    for (const player of [host, receiver]) player.send({ type: 'leave' });
  }
  await t.test('real weak prediction settles to a comfortable drive', () => runCase({ movement: strokes.stronger, expectedWinner: 1 }));
  await t.test('real strong prediction settles to a weak shot', () => runCase({ movement: strokes.weaker, expectedWinner: 0 }));
  await t.test('260 ms final is measured before releasing', () => runCase({ movement: strokes.stronger, finalDelay: 260, expectedWinner: 1 }));
  await t.test('280 ms final is measured before releasing', () => runCase({ movement: strokes.stronger, finalDelay: 280, expectedWinner: 1 }));
  await t.test('already-settled returns still release immediately', () => runCase({ movement: strokes.stronger, settledFirst: true, expectedWinner: 1 }));
  await t.test('late duplicates cannot replace a measured stroke or start the next point serve', () => runCase({ movement: strokes.stronger, expectedWinner: 1, duplicate: true, oldFixNextServe:true }));
  await t.test('an original held block still accepts the subsequent measured phone push', async () => {
    const [host, receiver] = await room({nearBlock:true});
    const blocked = await until(() => host.log.find(m => m.type==='hit' && m.side===1), 'held paddle at net did not block');
    const start=host.log.length;
    receiver.send({type:'swing', power:10, dir:0,lob:.1,src:'phone',final:false,age:80});
    await wait(60);
    receiver.send({type:'swing', power:24,dir:0,lob:.1,src:'phone',final:true,fix:true,age:140});
    const fixed = await until(() => host.log.slice(start).find(m=>m.type==='launch'&&m.by===1&&m.n!=null), 'settled original block push was rejected as another stroke');
    assert.ok(fixed.n>.6, 'the held block responds to the measured strong push');
    assert.equal(host.log.slice(start).filter(m=>m.type==='hit'&&m.side===1).length,0,'a push corrects one held block without a second contact sound');
    assert.ok(blocked.n<.2);
    assert.equal(blocked.force, 0, 'a stationary block reports no physical swing strength');
    assert.ok(blocked.n > blocked.force, 'near-net flight assistance stays separate from physical feedback');
    for (const player of [host, receiver]) player.send({type:'leave'});
  });
  await t.test('a new stroke and an old correction cannot reshape the new measured contact', async () => {
    const [host, receiver] = await room(), start = host.log.length;
    receiver.send(packet(strokes.stronger[0]));
    await until(() => host.log.slice(start).some(m => m.type === 'state' && m.v.every(v => v === 0)), 'initial contact was not cached');
    receiver.send({type:'swing',power:20,dir:0,lob:0,slice:0,src:'phone',final:true,age:0});
    const hit = await until(() => host.log.slice(start).find(m => m.type==='hit' && m.side===1), 'new measured stroke did not release');
    receiver.send({...packet(strokes.weaker.at(-1)),fix:true,final:true});
    const point = await until(() => host.log.slice(start).find(m=>m.type==='point'), 'new measured stroke never finished');
    assert.equal(hit.n,.5); assert.equal(point.winner,1);
    assert.equal(host.log.slice(start).filter(m=>m.type==='hit'&&m.side===1).length,1);
    assert.equal(host.log.slice(start).filter(m=>m.type==='launch'&&m.by===1).length,1);
    for (const player of [host,receiver]) player.send({type:'leave'});
  });
  for (const cancel of ['calibrate','leave']) await t.test(`${cancel} cancels cached contact without a delayed phantom hit`, async () => {
    const [host,receiver]=await room(), start=host.log.length;
    receiver.send(packet(strokes.stronger[0]));
    await until(()=>host.log.slice(start).some(m=>m.type==='state'&&m.v.every(v=>v===0)), 'contact was not cached before cancellation');
    receiver.send(cancel==='calibrate'?{type:'status',cal:true}:{type:'leave'});
    if (cancel==='calibrate') { await wait(80); receiver.send({...packet(strokes.stronger.at(-1)),fix:true,final:true}); }
    await wait(400);
    assert.equal(host.log.slice(start).filter(m=>m.type==='hit'&&m.side===1).length,0,'neither timeout nor a cancelled final can release the old contact');
    for (const player of [host,receiver]) player.send({type:'leave'});
  });
  const missingFinal = [{ e: { power: 20, raw: 20, rom: 60, dir: 0, lob: 0, final: false, type: 'swing', age: 80 }, slice: 0, lob: 0, t: 0 }];
  await t.test('missing final has a bounded fallback and one release', () => runCase({ movement: missingFinal, omitFinal: true, expectedWinner: 1 }));
});
