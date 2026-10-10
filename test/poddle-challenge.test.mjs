import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import WebSocket from 'ws';
import { MotionModel, qaxis, qmul } from '../web/motion.js';

const root = new URL('..', import.meta.url);
const current = readFileSync(new URL('server/game.js', root), 'utf8');
const original = readFileSync(new URL('test/fixtures/poddle-original-physics.txt', root), 'utf8');
function physics(source) {
  const start = source.indexOf('const COURT ='), end = source.indexOf('function createRoom(');
  return Function('process', 'abuse', source.slice(start, end) + '\nreturn {COURT,G,R,ZONE,BOUNCE,SLICE,CURVE,solve,flight,fallLeft,gOf,effort};')({ env: {} }, { MATCH_WIDE: [] });
}
const game = physics(current), sourceGame = physics(original);
const sign = seat => seat % 2 ? -1 : 1;
function trace(p, seat, n, dir = 0, lob = 0, slice = 0) {
  const shot = game.solve(p, seat, n, dir, lob, slice, undefined, 1);
  const g = game.gOf(shot.spin), tn = -p[2] / shot.v[2];
  const net = tn > 0 && tn < shot.T ? p[1] + shot.v[1] * tn - .5 * g * tn * tn : null;
  return { shot, net, legal: net > game.COURT.net + game.R && Math.abs(shot.land[0]) <= game.COURT.halfW + .1 && Math.abs(shot.land[1]) <= game.COURT.halfL + .1 && shot.land[1] * sign(seat) < 0 };
}

test('comfortable legacy Poddle shots preserve the original flight exactly', () => {
  let checks = 0;
  for (const side of [0, 1]) for (const x of [-2, 0, 2]) for (const y of [.6, 1, 1.8]) for (const z of [3, 6.5, 8])
    for (const n of [.35, .5, .65, .8, .84]) for (const dir of [-1, -.8, 0, .8, 1]) for (const lob of [0, .6]) for (const slice of [0, .5, -.5]) {
      const p = [x, y, z * sign(side)];
      assert.deepEqual(game.solve(p, side, n, dir, lob, slice, null, 1), sourceGame.solve(p, side, n, dir, lob, slice, null, 1));
      checks++;
    }
  assert.equal(checks, 8100);
});

test('weak strokes lose forward energy, very hard strokes land long, ordinary full-range aim stays familiar', () => {
  for (const side of [0, 1, 2, 3]) {
    const p = [0, 1.1, 6.5 * sign(side)];
    assert.equal(trace(p, side, .04).legal, false);
    assert.ok(trace(p, side, .04).shot.land[1] * sign(side) > 0, 'a tiny tap stays on the hitter’s side');
    assert.ok(trace(p, side, .12).net < game.COURT.net + game.R, 'weak forward hit reaches the net below its top');
    for (const n of [.3, .35, .5, .65, .8]) assert.equal(trace(p, side, n).legal, true);
    assert.equal(trace(p, side, .236).legal, false, 'an ordinary slow phone sweep now has meaningful weak-shot risk');
    assert.ok(Math.abs(trace(p, side, 1).shot.land[1]) > game.COURT.halfL + .1);
    assert.equal(trace(p, side, .5, 1).legal, true, 'a normal forehand axis must not become a forced wide fault');
    assert.equal(trace(p, side, .5, -1).legal, true, 'a normal backhand axis must not become a forced wide fault');
    let last = null; const speeds = new Set();
    for (let i = 0; i <= 100; i++) {
      const shot = trace(p, side, i / 100).shot;
      assert.ok(shot.v.every(Number.isFinite));
      if (last != null) assert.ok(Math.abs(Math.abs(shot.v[2]) - last) < 2, 'power changes retain the original smooth spectrum');
      speeds.add(Math.abs(shot.v[2]).toFixed(5));
      last = Math.abs(shot.v[2]);
    }
    assert.ok(speeds.size > 95, 'strength is a continuous spectrum rather than discrete shot tiers');
    assert.ok(Math.abs(trace(p, side, .9).shot.curl) > 0, 'original hard-hit curl still accompanies strong shots');
  }
});

test('real original motion capture reports span weak, comfortable, and overhit shots without modifying calibration', () => {
  const categories = { weak: 0, comfortable: 0, overhit: 0 };
  for (const file of readdirSync(new URL('data/', root)).filter(f => f.endsWith('.jsonl'))) {
    const rows = readFileSync(new URL(`data/${file}`, root), 'utf8').trim().split('\n').map(JSON.parse).filter(r => r.q && r.r);
    const model = new MotionModel(), start = rows[0].t - 8;
    for (let i = 0; i < 400; i++) {
      const t = start + i * .02, k = i * .02, tip = k < 5.4 ? 0 : k < 6 ? .6 * (k - 5.4) / .6 : .6;
      model.feed({t, q: qmul(qaxis([1, 0, 0], tip), rows[0].q), r: [0, 0, 0], a: [0, 0, 0]}, t * 1000);
    }
    assert.ok(model.calibrated);
    for (const row of rows) for (const event of model.feed({...row}, row.t * 1000)) if (event.type === 'swingFix' && event.final) {
      const n = game.effort(Math.max(0, Math.min(1, (event.power - 6) / 28)));
      const result = trace([0, 1.1, 6.5], 0, n);
      if (n <= .04) { categories.weak++; assert.equal(result.legal, false); }
      if (n >= .35 && n <= .8) {
        categories.comfortable++; assert.equal(result.legal, true);
        const measured = trace([0, 1.1, 6.5], 0, n, event.dir, event.lob, event.slice);
        assert.deepEqual(measured.shot, sourceGame.solve([0, 1.1, 6.5], 0, n, event.dir, event.lob, event.slice, undefined, 1), 'comfortable actual forehand/backhand report retains Poddle’s flight');
        assert.equal(measured.legal, true, 'actual comfortable capture must not gain an artificial wide fault');
      }
      if (n >= .95) { categories.overhit++; assert.ok(Math.abs(result.shot.land[1]) > game.COURT.halfL + .1); }
    }
  }
  assert.ok(categories.weak > 10, JSON.stringify(categories));
  assert.ok(categories.comfortable > 10, JSON.stringify(categories));
  assert.ok(categories.overhit > 0, JSON.stringify(categories));
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, ms = 8000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return; await wait(5); } assert.ok(fn(), label); }
async function unusedPort() { const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }

test('real socket serves/returns use original forgiving zones and faults/winners score once in singles and doubles', async t => {
  const port = await unusedPort(), clients = [], output = [];
  const child = spawn(process.execPath, ['server/game.js'], {cwd: root, env: {...process.env, PORT: String(port), AUTOBOT: '0', SWING_SERVE: '1', BLOCK: '0', WIN_AT: '11', READY_S: '0', TIMESCALE: '3', STAMP_S: '0'}});
  child.stdout.on('data', d => output.push(String(d))); child.stderr.on('data', d => output.push(String(d)));
  t.after(() => { for (const c of clients) c.ws.terminate(); child.kill(); });
  await until(() => output.some(s => s.includes('game server on port')), 'server did not start');
  async function client(cid) {
    const c = {log: [], ws: new WebSocket(`ws://127.0.0.1:${port}/?lobby=1&cid=${cid}`)}; clients.push(c);
    c.ws.on('error', () => {});
    c.ws.on('message', raw => { const p = JSON.parse(raw); c.log.push(p); if (p.type === 'state') c.st = p; if (p.type === 'welcome') c.welcome = p; if (p.type === 'room') c.room = p; });
    c.send = m => c.ws.send(JSON.stringify(m));
    await until(() => c.log.some(m => m.type === 'lobby'), 'lobby did not open'); return c;
  }
  const paddle = (c, extra = {}) => c.send({type: 'paddle', auto: true, autoY: false, x: 0, y: 1, q: [0, 0, 0, 1], r: 10, ...extra});
  const swing = (c, extra = {}) => c.send({type: 'swing', power: 20, dir: 0, lob: 0, slice: 0, age: 80, net: 0, rom: 60, off: 30, back: .8, raw: 20, final: true, src: 'phone', pk: 12, ...extra});
  for (const mode of ['1v1', '2v2']) await t.test(mode, async () => {
    const players = [];
    for (let i = 0; i < (mode === '2v2' ? 4 : 2); i++) {
      const c = await client(`${mode}-${i}`); players.push(c);
      c.send(i ? {type: 'join', code: players[0].room.code} : {type: 'create', public: false, mode});
      await until(() => c.welcome, 'original court did not seat player');
      assert.equal(c.welcome.side, i); assert.equal(c.welcome.capacity, mode === '2v2' ? 4 : 2);
      paddle(c);
    }
    const host = players[0];
    async function pointCase({power = 20, dir = 0, aimX, returns = 0, fixPower = null}) {
      await until(() => host.st?.live && host.st.serving != null, 'waiting original serve missing');
      const start = host.log.length, seat = host.st.serving, server = players[seat];
      assert.equal(host.st.reach, true, 'original serve is reachable from its resting position');
      swing(server, {power, raw: power, dir, aimX, final: fixPower == null ? true : false});
      // A phone's measured report follows its initial guess independently of
      // contact feedback. Waiting for the hit here would invert that protocol.
      if (fixPower != null) { await wait(20); swing(server, {power: fixPower, raw: fixPower, dir, aimX, fix: true}); }
      await until(() => host.log.slice(start).some(m => m.type === 'hit'), 'ordinary source swing did not serve');
      for (let r = 0; r < returns; r++) {
        const hit = host.log.filter(m => m.type === 'hit').at(-1);
        let receiving;
        await until(() => { const st=host.st; if (!st?.live || st.serving!=null || st.v[2]*sign(hit.side)>=0) return false; receiving = mode === '2v2' ? st.turn : 1-hit.side; return receiving!=null && receiving%2!==hit.side%2; }, 'closest receiving teammate was not selected after the settled hit');
        await until(() => {
          const s = host.st, p = s?.paddles?.[receiving];
          return s?.live && s.serving == null && s.b >= 1 && p && Math.abs(s.p[0] - p.x) < 1 && Math.abs(s.p[1] - p.y) < .8 && -(s.p[2] - p.z) * sign(receiving) < 1.3;
        }, 'original auto footwork did not make incoming ball comfortably returnable');
        // No physical millimetre sweep: same ordinary phone event Poddle accepts.
        const before = host.log.filter(m => m.type === 'hit').length;
        swing(players[receiving]);
        await until(() => host.log.filter(m => m.type === 'hit').length > before, 'return in original box failed');
        assert.equal(host.log.filter(m => m.type === 'hit').at(-1).side, receiving);
      }
      await until(() => host.log.slice(start).some(m => m.type === 'point'), 'a settled flight did not finish its point');
      const points = host.log.slice(start).filter(m => m.type === 'point'), point = points[0], hits = host.log.slice(start).filter(m => m.type === 'hit');
      assert.equal(points.length, 1); return {point, hits, seat, events: host.log.slice(start), nets: host.log.slice(start).filter(m => m.type === 'net'), bounces: host.log.slice(start).filter(m => m.type === 'bounce')};
    }
    const win = await pointCase({returns: 4});
    assert.equal(win.hits.length, 5, 'serve plus four familiar returns: '+JSON.stringify(win.hits.map(h=>({side:h.side,t:h.t,n:h.n}))));
    assert.equal(win.point.winner, win.hits.at(-1).side % 2);
    assert.ok(['double bounce', 'passed'].includes(win.point.why));
    assert.ok(win.bounces.length >= 5, 'ordinary rally bounces remain legal');
    const weak = await pointCase({power: 7.5});
    assert.equal(weak.point.winner, 1 - weak.seat % 2); assert.ok(['net', 'out'].includes(weak.point.why));
    const net = await pointCase({power: 12.6});
    assert.equal(net.point.why, 'net'); assert.equal(net.point.winner, 1 - net.seat % 2);
    assert.equal(net.nets.length, 1, 'one authoritative physical net impact per fault');
    const impact = net.nets[0], home = sign(net.seat);
    assert.ok(impact.p[2] * home >= game.R, 'contact stays on the incoming mesh face');
    assert.ok(impact.p[1] <= game.COURT.net + game.R);
    assert.ok(impact.v[2] * home > 0 && impact.incoming[2] * home < 0, 'the stopped ball recoils toward its hitter');
    assert.ok(impact.v[1] < 0 && Math.abs(impact.v[2]) < Math.abs(impact.incoming[2]), 'mesh absorbs the flight and drops the ball');
    assert.ok(net.events.indexOf(impact) < net.events.indexOf(net.point), 'every client receives contact before the point');
    assert.equal(win.nets.length, 0, 'legal crossings produce no net contact');
    const hard = await pointCase({power: 34});
    assert.equal(hard.nets.length, 0, 'a long fault is not a net hit');
    assert.equal(hard.point.winner, 1 - hard.seat % 2); assert.equal(hard.point.why, 'out');
    const aimed = await pointCase({dir: 1});
    assert.equal(aimed.point.winner, aimed.seat % 2, 'full forehand direction is a normal original shot');
    assert.ok(['double bounce', 'passed'].includes(aimed.point.why));
    for(const aimX of [-1,1,-1,1]) {
      const edge=await pointCase({aimX,dir:-aimX});
      assert.equal(edge.point.winner,edge.seat%2,'horizontal placement cannot give the opponent an out point');
      assert.ok(['double bounce','passed'].includes(edge.point.why));
      assert.ok(Math.abs(edge.bounces[0].p[0]-sign(edge.seat)*aimX*2.6)<1e-6,'real first bounce reaches the chosen safe edge');
      assert.equal(edge.nets.length,0);
    }
    const correctedWeak = await pointCase({power: 24, fixPower: 7.5});
    assert.equal(correctedWeak.point.winner, 1 - correctedWeak.seat % 2, 'early bet must not rescue a weak final phone report');
    const correctedHard = await pointCase({power: 24, fixPower: 34});
    assert.equal(correctedHard.point.winner, 1 - correctedHard.seat % 2, 'early bet must not rescue a too-strong final phone report');
    assert.equal(correctedHard.point.why, 'out');
    for (const c of players) c.send({type: 'leave'});
  });
});
