import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { MotionModel } from '../web/motion.js';
import { phonePower } from '../web/phonepower.js';
import { makeSynth, CALIBRATE } from './fake-bridge.mjs';

const source = readFileSync(new URL('../server/game.js', import.meta.url), 'utf8');
const physics = Function('process', 'abuse', source.slice(source.indexOf('const COURT ='), source.indexOf('function createRoom(')) + '\nreturn {solve,solveSpike,canSpike,G,R,COURT,effort,gOf,flight,bounceV};')({ env: {} }, { MATCH_WIDE: [] });
const sign = side => side % 2 ? -1 : 1;
function spike({ side = 0, n = .5, y = 1.8, z = 2.6, aimX = 0, dir = 1, chop = .8, slice = 0 } = {}) {
  const p = [0, y, z * sign(side)], sol = physics.solveSpike(p, side, n, dir, slice, aimX, chop);
  const t = -p[2] / sol.v[2], net = p[1] + sol.v[1] * t - .5 * physics.gOf(sol.spin) * t * t;
  const legal = t < sol.T && net > physics.COURT.net + physics.R && sol.land[1] * sign(side) < 0 &&
    Math.abs(sol.land[0]) <= physics.COURT.halfW + physics.R && Math.abs(sol.land[1]) <= physics.COURT.halfL + physics.R;
  return { ...sol, p, net, legal };
}

test('spikes require a high ball near the net and an actual downward chop', () => {
  for (const side of [0, 1, 2, 3]) {
    assert.ok(physics.canSpike([0, 1.7, sign(side) * 3.5], .55));
    assert.equal(physics.canSpike([0, 1.699, sign(side) * 3.5], 1), false);
    assert.equal(physics.canSpike([0, 2.3, sign(side) * 3.501], 1), false);
    assert.equal(physics.canSpike([0, 2.3, sign(side) * 6.5], 1), false);
    assert.equal(physics.canSpike([0, 2.3, sign(side) * 2.6], .549), false);
    assert.equal(physics.canSpike([0, 2.3, sign(side) * 2.6], undefined), false);
  }
});

test('a spike starts downward, follows real gravity, and rebounds from the floor', () => {
  for (const side of [0, 1, 2, 3]) for (const dir of [-1, 1]) {
    const shot = spike({ side, dir }), p = [...shot.p], v = [...shot.v];
    assert.ok(shot.v[1] < -4 && shot.T < .4);
    assert.ok(shot.legal, 'a committed normal spike clears and lands legally');
    physics.flight(p, v, shot.T, shot.curl, physics.gOf(shot.spin), null, 0);
    assert.ok(Math.abs(p[1] - physics.R) < 1e-9);
    assert.ok(Math.abs(p[0] - shot.land[0]) < 1e-9 && Math.abs(p[2] - shot.land[1]) < 1e-9);
    assert.ok(v[1] < -6, 'the actual floor contact has a steep downward component');
    physics.bounceV(v, shot.spin, shot.kick);
    assert.ok(v[1] > 0 && v[2] * sign(side) < 0, 'existing floor bounce sends it upward and onward');
  }
});

test('soft spikes can hit the net, hard ones can go long, and horizontal aim stays safely inside', () => {
  for (const side of [0, 1, 2, 3]) for (const dir of [-1, 1]) {
    const weak = spike({ side, dir, n: .1 }), normal = spike({ side, dir }), hard = spike({ side, dir, n: 1 });
    assert.equal(weak.legal, false); assert.ok(weak.net < physics.COURT.net + physics.R);
    assert.ok(normal.legal);
    assert.equal(hard.legal, false); assert.ok(Math.abs(hard.land[1]) > physics.COURT.halfL + physics.R);
    for (const aimX of [-1, 1]) {
      const wide = spike({ side, dir, aimX });
      assert.equal(wide.legal, true);
      assert.ok(Math.abs(wide.land[0]-sign(side)*aimX*2.6)<1e-9, 'spikes use the same safe horizontal placement');
    }
  }
});

test('spike effort is continuous and every eligible geometry has a physically possible clearing strength', () => {
  let previous;
  for (let i = 0; i <= 1000; i++) {
    const shot = spike({ n: i / 1000 });
    assert.ok(shot.v.every(Number.isFinite) && shot.land.every(Number.isFinite));
    if (previous) {
      assert.ok(Math.abs(shot.v[2] - previous.v[2]) < .05);
      assert.ok(Math.abs(shot.v[1] - previous.v[1]) < .004);
    }
    previous = shot;
  }
  for (const y of [1.7, 1.8, 2.3, 3]) for (const z of [.5, 2.6, 3, 3.5]) for (const chop of [.55, .8, 1]) {
    assert.ok(Array.from({ length: 101 }, (_, i) => spike({ y, z, chop, n: i / 100 })).some(s => s.net > physics.COURT.net + physics.R && s.land[1] < 0), 'eligible height/distance never forces all strengths into the net');
  }
});

test('the unchanged calibrated phone detector supplies downward chop and the existing measured strength', () => {
  for (const [axis, expectedChop] of [[[-1, 0, 0], true], [[1, 0, 0], false], [[0, 1, 0], false]]) {
    const model = new MotionModel({ RATE_GAIN: 1.5 });
    const sensor = makeSynth({ script: [...CALIBRATE, { T: .4 }, { T: .45, axis, deg: 170 }, { T: .7 }] });
    let settled;
    for (let i = 0; i < Math.ceil((sensor.dur + .2) * 50); i++) {
      const sample = sensor.next();
      for (const event of model.feed(sample, sample.t * 1000))
        if ((event.type === 'swing' || event.type === 'swingFix') && event.final) settled = event;
    }
    assert.ok(model.calibrated && settled, 'original staged calibration and swing detection complete');
    assert.equal(settled.chop >= .55, expectedChop, 'only the physical downward rotation requests a spike');
    const n = physics.effort(Math.max(0, Math.min(1, (phonePower(settled) - 6) / 28)));
    if (expectedChop) assert.ok(spike({ n, chop: settled.chop, y: 1.9 }).legal, 'a normal measured downward stroke has a legal spike without a strength bonus');
  }
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, why, ms = 5000) { const stop = Date.now() + ms; while (Date.now() < stop) { if (check()) return; await wait(3); } throw Error(why); }

test('real phone socket contacts use final chop once, preserve physical force and retain shot faults', async t => {
  const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const output = [], clients = [], child = spawn(process.execPath, ['server/game.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), PODDLE_DB: ':memory:', AUTOBOT: '0', SWING_SERVE: '1', BLOCK: '0', WIN_AT: '0', READY_S: '0', TIMESCALE: '2', ADDR_ROOMS: '20' } });
  child.stdout.on('data', data => output.push(String(data))); child.stderr.on('data', data => output.push(String(data)));
  t.after(() => { clients.forEach(c => c.ws.terminate()); child.kill(); });
  await until(() => output.some(line => line.includes('game server on port')), 'server did not start');
  let serial = 0;
  async function room({ auto = false } = {}) {
    const players = [];
    for (let side = 0; side < 2; side++) {
      const c = { log: [], ws: new WebSocket(`ws://127.0.0.1:${port}/?lobby=1&cid=spike-${serial++}`) };
      c.ws.on('error', () => {}); c.ws.on('message', raw => { const m = JSON.parse(raw); c.log.push(m); if (m.type === 'state') { c.st = m; if (side === 1 && !auto) c.send({ type: 'paddle', auto: false, autoY: false, x: 0, y: 2.3, z: 2.8, q: [0, 0, 0, 1], r: 10 }); } if (m.type === 'room') c.room = m; });
      c.send = message => c.ws.send(JSON.stringify(message)); clients.push(c); players.push(c);
      await until(() => c.log.some(m => m.type === 'lobby'), 'lobby missing');
      c.send(side ? { type: 'join', code: players[0].room.code } : { type: 'create', public: false });
      await until(() => c.log.some(m => m.type === 'welcome'), 'seat missing');
      c.send(auto ? { type: 'paddle', auto: true, autoY: true, q: [0, 0, 0, 1], r: 10 } : { type: 'paddle', auto: false, autoY: false, x: 0, y: 2.3, z: 2.8, q: [0, 0, 0, 1], r: 10 });
    }
    const [host] = players;
    await until(() => host.st?.serving === 0 && (auto || host.st.p[2] <= 3.3 && host.st.p[1] >= 1.7 && host.st.reach), 'high near-net held serve did not settle into ordinary reach');
    host.send({ type: 'swing', power: auto ? 20 : 14.4, raw: auto ? 20 : 14.4, rom: 60, off: 30, back: .8, dir: 0, aimX: 0, wing: 'forehand', lob: auto ? .8 : .7, chop: 1, src: 'phone', final: true });
    await until(() => host.log.some(m => m.type === 'hit'), 'serve missing hit');
    assert.notEqual(host.log.find(m => m.type === 'hit').kind, 'spike', 'serve keeps its ordinary flight even with a measured chop');
    if (auto) return players;
    await until(() => { const s = host.st, p = s?.paddles?.[1]; const ahead = p ? s.p[2] - p.z : -1; return s?.live && s.serving == null && s.p[2] < -2 && s.p[2] > -3.5 && s.p[1] >= 1.7 && s.p[1] < 2.5 && ahead > .1 && ahead < 1.35; }, 'high moving return did not arrive within the actual near-net paddle reach');
    return players;
  }
  for (const scenario of [
    { name: 'final downward chop', initialChop: 0, finalChop: .8, power: 20, kind: 'spike' },
    { name: 'final level swing', initialChop: .8, finalChop: 0, power: 20, kind: 'drive' },
    { name: 'weak spike', initialChop: .8, finalChop: .8, power: 8.8, kind: 'spike', fault: 'net' },
    { name: 'right edge spike', initialChop: .8, finalChop: .8, power: 20, aimX: 1, kind: 'spike' },
    { name: 'left edge spike', initialChop: .8, finalChop: .8, power: 20, aimX: -1, kind: 'spike' },
    { name: 'overpowered spike', initialChop: .8, finalChop: .8, power: 34, kind: 'spike', fault: 'out' }
  ]) {
    const [host, receiver] = await room(), before = host.log.length;
    const shot = { type: 'swing', power: scenario.power, dir: 0, aimX: scenario.aimX || 0, wing: 'forehand', lob: 0, slice: 0, src: 'phone', pk: 14, age: 0, final: false, chop: scenario.initialChop };
    receiver.send(shot);
    const incoming = structuredClone(host.st);
    try { await until(() => host.st?.live && host.st.v.every(v => v === 0), 'phone contact was not cached'); }
    catch (error) { throw Error(`${scenario.name}: ${error.message}; incoming=${JSON.stringify({p:incoming.p,v:incoming.v,paddle:incoming.paddles[1]})}; events=${JSON.stringify(receiver.log.slice(-12).filter(m=>m.type!=='state'))}`); }
    assert.equal(host.log.slice(before).filter(m => m.type === 'hit').length, 0, 'unmeasured chop cannot commit a predicted flight');
    receiver.send({ ...shot, chop: scenario.finalChop, final: true, fix: true });
    await until(() => host.log.slice(before).some(m => m.type === 'hit'), 'measured spike was not struck');
    const hits = host.log.slice(before).filter(m => m.type === 'hit'), hit = hits[0];
    assert.equal(hits.length, 1); assert.equal(hit.side, 1); assert.equal(hit.kind, scenario.kind, scenario.name);
    const n = physics.effort(Math.max(0, Math.min(1, (scenario.power - 6) / 28)));
    assert.equal(hit.force, n, 'physical force remains measured, independent of special shot kind');
    if (hit.kind === 'spike') {
      const expected = physics.solveSpike(hit.p, 1, n, 0, 0, scenario.aimX || 0, scenario.finalChop);
      assert.ok(hit.v[1] < 0);
      hit.v.forEach((value, i) => assert.ok(Math.abs(value - expected.v[i]) < 1e-8));
    }
    if (scenario.fault) {
      await until(() => host.log.slice(before).some(m => m.type === 'point'), 'spike fault never scored');
      const point = host.log.slice(before).find(m => m.type === 'point');
      assert.equal(point.why, scenario.fault); assert.equal(point.winner, 0);
    }
    await wait(30);
    assert.equal(host.log.slice(before).filter(m => m.type === 'hit').length, 1, 'no duplicate special hit');
    for (const c of [host, receiver]) c.ws.terminate();
  }

  // Real hosted play exposes Auto only. Start at the default baseline and send
  // no x/y/z fields: the unchanged footwork must create and reach the short lob.
  const [autoHost, autoReceiver] = await room({ auto: true });
  await until(() => {
    const s = autoHost.st, p = s?.paddles?.[1], ahead = p ? s.p[2] - p.z : -1;
    return s?.live && s.serving == null && s.b === 1 && s.p[1] >= 1.7 && s.p[1] <= 2.3 && Math.abs(s.p[2]) >= 6 && Math.abs(s.p[2]) <= 7.2 && ahead > .1 && ahead < 1.1;
  }, 'Auto did not reach the high baseline return');
  const beforeShort = autoHost.log.length;
  autoReceiver.send({ type: 'swing', power: 13, dir: 0, aimX: 0, wing: 'forehand', lob: .8, chop: 0, src: 'phone', final: true });
  await until(() => autoHost.log.slice(beforeShort).some(m => m.type === 'hit'), 'Auto high underhand return missed');
  assert.equal(autoHost.log.slice(beforeShort).find(m => m.type === 'hit').side, 1);
  let eligible;
  await until(() => {
    const s = autoHost.st, p = s?.paddles?.[0], ahead = p ? p.z - s.p[2] : -1;
    if (s?.live && s.serving == null && s.v[2] > 0 && physics.canSpike(s.p, .8) && ahead > .05 && ahead < 1.3 && Math.abs(s.p[1] - p.y) < .8) { eligible = structuredClone(s); return true; }
    return false;
  }, 'the genuine short lob never gave Auto an eligible spike contact');
  const beforeSpike = autoHost.log.length;
  autoHost.send({ type: 'swing', power: 20, dir: 0, aimX: 0, wing: 'forehand', lob: 0, chop: .8, src: 'phone', final: true });
  await until(() => autoHost.log.slice(beforeSpike).some(m => m.type === 'hit'), 'Auto high near-net spike did not strike');
  const actual = autoHost.log.slice(beforeSpike).find(m => m.type === 'hit');
  assert.equal(actual.kind, 'spike'); assert.equal(actual.side, 0); assert.ok(actual.v[1] < 0);
  console.log(JSON.stringify({ autoOnlySpike: true, eligibleBall: eligible.p, actualAutoPaddle: eligible.paddles[0], spikeContact: actual.p, downwardVelocity: actual.v[1] }));
});
