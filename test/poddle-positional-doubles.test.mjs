import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import WebSocket from 'ws';

const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, why, ms = 8000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return; await wait(3); } assert.ok(fn(), why); }
const sign = sd => sd % 2 ? -1 : 1;
async function room(t) {
  const net = createServer(); await new Promise(r => net.listen(0, '127.0.0.1', r)); const port = net.address().port; await new Promise(r => net.close(r));
  const out = [], clients = [];
  const proc = spawn(process.execPath, ['server/game.js'], {cwd: new URL('..', import.meta.url), env: {...process.env, PORT: String(port), AUTOBOT: '0', READY_S: '0', SWING_SERVE: '1', WIN_AT: '0', BLOCK: '0', STAMP_S: '0'}});
  proc.stdout.on('data', d => out.push(String(d))); proc.stderr.on('data', d => out.push(String(d)));
  t.after(() => { for (const c of clients) c.ws.terminate(); proc.kill(); });
  await until(() => out.some(s => s.includes('game server on port')), 'server starts');
  for (let i = 0; i < 4; i++) {
    const c = {log: [], ws: new WebSocket(`ws://127.0.0.1:${port}/?lobby=1&cid=positional-${i}`)}; clients.push(c);
    c.send = m => c.ws.send(JSON.stringify(m)); c.ws.on('error', () => {});
    c.ws.on('message', raw => { const m = JSON.parse(raw); c.log.push(m); if (m.type === 'state') c.st = m; if (m.type === 'room') c.room = m; if (m.type === 'welcome') c.side = m.side; });
    await until(() => c.log.some(m => m.type === 'lobby'), 'lobby');
    c.send(i ? {type: 'join', code: clients[0].room.code} : {type: 'create', public: false, mode: '2v2'});
    await until(() => c.side === i, 'four doubles seats');
    c.send({type: 'paddle', auto: true, q: [0, 0, 0, 1], r: 12, hand: 'right'});
  }
  const host = clients[0], hits = () => host.log.filter(m => m.type === 'hit');
  function wing(sd, state = host.st) { const p = state.paddles[sd]; return (state.p[0] - (p.x - sign(sd) * .5)) * sign(sd) < -.2 ? 'backhand' : 'forehand'; }
  function swing(sd, extra = {}) { clients[sd].send({type: 'swing', power: 20, raw: 20, rom: 60, off: 30, back: .8, dir: 0, aimX: 0, lob: 0, slice: 0, age: 0, net: 0, final: true, src: 'phone', pk: 12, hand: 'right', wing: wing(sd), ...extra}); }
  function reachable(sd, s = host.st, front = .65) { const p = s?.paddles[sd]; if (!s?.live || s.serving != null || s.b !== 1 || !p) return false; const ahead = -(s.p[2] - p.z) * sign(sd); return ahead > .25 && ahead < front && Math.abs(s.p[0] - p.x) < 1.6 && Math.abs(s.p[1] - p.y) < 1.15; }
  async function serve(aimX) {
    await until(() => host.st?.live && host.st.serving != null, 'waiting serve');
    const start = host.log.length, sd = host.st.serving, before = hits().length;
    swing(sd, {aimX}); await until(() => hits().length === before + 1, 'serve releases once');
    await until(() => host.st.serving == null && Number.isInteger(host.st.turn), 'projected receiver');
    return {sd, start};
  }
  async function point(start) { await until(() => host.log.slice(start).some(m => m.type === 'point'), 'rally scores'); assert.equal(host.log.slice(start).filter(m => m.type === 'point').length, 1); }
  return {host, clients, hits, swing, reachable, serve, point, wing};
}

test('doubles chooses by the projected ball position and allows the same teammates to return repeatedly', async t => {
  const h = await room(t), first = await h.serve(-.35);
  assert.equal(first.sd, 0); assert.equal(h.host.st.turn, 3, 'left-world shot belongs to the nearer left-world opponent, not nextSeat(0)=1');
  const untouched = h.host.st.paddles[1].homeX;
  for (const [sd, aimX] of [[3, .35], [0, -.35], [3, .35]]) {
    await until(() => h.reachable(sd), 'geometrically selected player can reach the bounced shot');
    assert.equal(h.host.st.turn, sd);
    if (sd === 3) assert.ok(Math.abs(h.host.st.paddles[1].x - untouched) < .1, 'the other auto teammate remains in their home lane');
    const before = h.hits().length; h.swing(sd, {aimX}); await until(() => h.hits().length === before + 1, 'selected legal swing returns once');
  }
  assert.deepEqual(h.hits().slice(0, 4).map(m => m.side), [0, 3, 0, 3], 'rally does not force partner alternation');
  await h.point(first.start);
  for (const [serving, aimX, receiver] of [[1, -.35, 2], [2, .35, 1], [3, .35, 0]]) {
    const p = await h.serve(aimX); assert.equal(p.sd, serving); assert.equal(h.host.st.turn, receiver, 'every lane can be the closest receiver'); await h.point(p.start);
  }
});

test('either physically reachable teammate may return even when the other is the suggested receiver', async t => {
  const h = await room(t);
  await until(() => h.host.st?.serving === 0, 'first serve');
  h.clients[0].send({type: 'paddle', auto: false, x: -.05, y: 1, q: [0, 0, 0, 1], r: 12, hand: 'right'});
  await wait(1200); assert.ok(h.host.st.reach, 'original hanging serve follows an ordinary body position');
  const before = h.hits().length, start = h.host.log.length, aimX = h.host.st.p[0] / 5;
  h.swing(0, {aimX}); await until(() => h.hits().length === before + 1, 'center serve');
  await until(() => h.host.st.serving == null && Number.isInteger(h.host.st.turn), 'center suggested receiver');
  const suggested = h.host.st.turn, other = (suggested + 2) % 4;
  await until(() => h.reachable(other), 'the nonselected teammate is still physically within original reach');
  const at = h.hits().length; h.swing(other, {aimX: 0}); await until(() => h.hits().length === at + 1, 'nonselected reachable teammate returns');
  assert.equal(h.hits().at(-1).side, other);
  await h.point(start);
});

async function sharedBall(h) {
  await until(() => h.host.st?.serving === 0, 'shared-ball serve');
  h.clients[0].send({type: 'paddle', auto: false, x: -.05, y: 1, q: [0, 0, 0, 1], r: 12, hand: 'right'});
  await wait(1200);
  const start = h.host.log.length, count = h.hits().length, aimX = h.host.st.p[0] / 5;
  h.swing(0, {aimX}); await until(() => h.hits().length === count + 1, 'shared ball served');
  await until(() => h.host.st.serving == null && Number.isInteger(h.host.st.turn), 'shared receiver');
  const first = h.host.st.turn, second = (first + 2) % 4;
  h.clients[second].send({type: 'paddle', auto: false, x: h.host.st.paddles[second].homeX, y: 1, z: 8.2, q: [0, 0, 0, 1], r: 12, hand: 'right'});
  await until(() => h.reachable(first) && h.reachable(second, h.host.st, 1.5), 'both teammates currently have front-side contact reach');
  return {start, first, second, count: h.hits().length};
}

for (const predicted of [false, true]) test(`simultaneous reachable doubles swings both miss (${predicted ? 'phone predictions settle' : 'known measured strokes'})`, async t => {
  const h = await room(t), b = await sharedBall(h);
  h.swing(b.first, {final: !predicted}); await wait(15);
  h.swing(b.second, {final: !predicted, wing: predicted ? 'neutral' : h.wing(b.second)});
  if (predicted) {
    await wait(65);
    assert.equal(h.hits().length, b.count, 'a prediction cannot emit hit feedback before both measured reports arrive');
    h.swing(b.first, {fix: true, final: true}); h.swing(b.second, {fix: true, final: true});
  }
  await until(() => [b.first, b.second].every(sd => h.clients[sd].log.some(m => m.type === 'whiff' && m.why === 'collision')), 'both teammates receive the collision miss');
  assert.equal(h.hits().length, b.count, 'neither simultaneous swing strikes the ball');
  await h.point(b.start);
  assert.equal(h.host.log.slice(b.start).filter(m => m.type === 'point').at(-1).winner, 0, 'normal unreturned incoming ball wins, once');
});

test('a distant teammate swing does not cancel a legal doubles return', async t => {
  const h = await room(t), b = await sharedBall(h);
  h.clients[b.second].send({type: 'paddle', auto: false, x: -3.7, y: 1, q: [0, 0, 0, 1], r: 12, hand: 'right'}); await wait(25);
  h.swing(b.first); await wait(15); h.swing(b.second);
  await until(() => h.hits().length === b.count + 1, 'one legal nearby return');
  assert.equal(h.hits().at(-1).side, b.first);
  assert.equal(h.clients[b.first].log.filter(m => m.type === 'whiff' && m.why === 'collision').length, 0);
  await h.point(b.start);
});

test('a later teammate stroke does not retroactively cancel an already returned ball', async t => {
  const h = await room(t), b = await sharedBall(h);
  h.swing(b.first); await wait(180); h.swing(b.second);
  assert.equal(h.hits().length, b.count + 1);
  assert.equal(h.hits().at(-1).side, b.first);
  assert.equal(h.clients[b.first].log.filter(m => m.type === 'whiff' && m.why === 'collision').length, 0);
  await h.point(b.start);
});
