import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import WebSocket from 'ws';

const wait = ms => new Promise(r => setTimeout(r, ms)), sign = sd => sd % 2 ? -1 : 1;
async function until(fn, why, ms = 7000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return; await wait(3); } assert.ok(fn(), why); }
async function unusedPort() { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }

for (const mode of ['1v1', '2v2']) test(`${mode}: only current front-side contact counts; passed and finished balls never rewind`, async t => {
  const port = await unusedPort(), clients = [], out = [];
  const proc = spawn(process.execPath, ['server/game.js'], {cwd: new URL('..', import.meta.url), env: {...process.env, PORT: String(port), AUTOBOT: '0', SWING_SERVE: '1', BLOCK: '0', WIN_AT: '0', READY_S: '0', STAMP_S: '0', TIMESCALE: '2'}});
  proc.stdout.on('data', d => out.push(String(d))); proc.stderr.on('data', d => out.push(String(d)));
  t.after(() => { for (const c of clients) c.ws.terminate(); proc.kill(); });
  await until(() => out.some(s => s.includes('game server on port')), 'server starts');
  for (let i = 0; i < (mode === '2v2' ? 4 : 2); i++) {
    const c = {log: [], ws: new WebSocket(`ws://127.0.0.1:${port}/?lobby=1&cid=front-contact-${i}`)}; clients.push(c);
    c.send = m => c.ws.send(JSON.stringify(m)); c.ws.on('error', () => {});
    c.ws.on('message', raw => { const m = JSON.parse(raw); c.log.push({...m, arrived: Date.now()}); if (m.type === 'state') c.st = m; if (m.type === 'welcome') c.side = m.side; if (m.type === 'room') c.room = m; });
    await until(() => c.log.some(m => m.type === 'lobby'), 'lobby');
    c.send(i ? {type: 'join', code: clients[0].room.code} : {type: 'create', mode, public: false});
    await until(() => c.side === i, 'seat');
    c.send({type: 'paddle', auto: true, q: [0, 0, 0, 1], r: 12, hand: 'right'});
  }
  const host = clients[0], hits = () => host.log.filter(m => m.type === 'hit');
  function swing(sd, extra = {}) {
    const p = host.st.paddles[sd], hand = extra.hand || 'right';
    const rel = (host.st.p[0] - (p.x - sign(sd) * .5)) * sign(sd) * (hand === 'left' ? -1 : 1);
    clients[sd].send({type: 'swing', power: 20, raw: 20, rom: 60, off: 30, back: .8, dir: 0, lob: 0, slice: 0, age: 0, net: 0, final: true, src: 'phone', pk: 12, hand, wing: rel < -.2 ? 'backhand' : 'forehand', ...extra});
  }
  async function serve(power = 20) {
    await until(() => host.st?.live && host.st.serving != null, 'waiting serve');
    const sd = host.st.serving, start = host.log.length, before = hits().length;
    swing(sd, {power, raw: power, slice: power === 20 ? 1 : 0});
    await until(() => hits().length === before + 1, 'serve hit');
    await until(() => host.st.serving == null && Number.isInteger(host.st.turn), 'position-based receiver');
    return {sd, start, receiver: host.st.turn};
  }
  async function finishes(start) { await until(() => host.log.slice(start).some(m => m.type === 'point'), 'point completes'); assert.equal(host.log.slice(start).filter(m => m.type === 'point').length, 1); }
  async function contactCase({behind = false, age = 0, hand = 'right', settleAfter = 0}) {
    const p = await serve(), sd = p.receiver;
    await until(() => {
      const s = host.st, pl = s.paddles[sd], ahead = -(s.p[2] - pl.z) * sign(sd);
      return s.live && s.b === 1 && Math.abs(s.p[0] - pl.x) < 1.55 && Math.abs(s.p[1] - pl.y) < 1.15 && (behind ? ahead < -.1 && ahead > -.7 : ahead > .35 && ahead < .8);
    }, behind ? 'ball has genuinely passed the paddle' : 'ball is currently reachable in front');
    const snapshot = host.st, before = hits().length;
    swing(sd, {age, net: age ? 250 : 0, hand, final: !settleAfter});
    if (settleAfter) {
      await wait(settleAfter); assert.equal(hits().length, before, 'a real front contact waits for measured strength');
      swing(sd, {age: age + settleAfter, hand, fix: true, final: true});
    }
    await wait(mode === '2v2' ? 180 : 80);
    assert.equal(hits().length - before, behind ? 0 : 1, behind ? 'reported sensor/network age cannot rescue a passed ball' : 'current contact strikes once');
    if (!behind) {
      const hit = hits().at(-1), ahead = -(hit.p[2] - snapshot.paddles[sd].z) * sign(sd);
      assert.equal(hit.side, sd); assert.ok(ahead >= 0, 'the ball releases at its actual accepted front contact');
    }
    await finishes(p.start);
  }
  await contactCase({age: 0});
  await contactCase({age: 300, hand: 'left'});
  await contactCase({age: 80, settleAfter: 80});
  await contactCase({behind: true, age: 0});
  await contactCase({behind: true, age: 300, hand: 'left'});
  for (const power of [20, 34]) {
    const p = await serve(power); await finishes(p.start);
    const events = host.log.slice(p.start), point = events.find(m => m.type === 'point'), bounces = events.filter(m => m.type === 'bounce');
    const last = bounces.at(-1);
    assert.equal(point.why, power === 20 ? 'double bounce' : 'out');
    assert.equal(bounces.length, power === 20 ? 2 : 1);
    assert.ok(last && point.arrived - last.arrived < 50, 'a terminal bounce scores immediately');
    const before = hits().length; swing(p.receiver, {age: 300, net: 250}); await wait(180);
    assert.equal(hits().length, before, 'a terminal bounce cannot be resurrected by an old phone report');
    assert.equal(host.log.slice(p.start).filter(m => m.type === 'point').length, 1);
  }
});
