import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import WebSocket from 'ws';

const root = new URL('..', import.meta.url);
const source = readFileSync(new URL('server/game.js', root), 'utf8');
const gate = Function('process', 'abuse', source.slice(source.indexOf('const COURT ='), source.indexOf('function createRoom(')) + '\nreturn {requiredWing,matchesWing};')({ env: {} }, { MATCH_WIDE: [] });
const sign = side => side % 2 ? -1 : 1;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = fn(); if (value) return value; await wait(3); }
  assert.ok(fn(), label);
}

test('required wing follows the visible body in all four seats and both dominant hands', () => {
  for (const side of [0, 1, 2, 3]) for (const hand of ['right', 'left']) {
    const s = sign(side), pl = { side, hand, x: s * .5 };
    const h = hand === 'left' ? -1 : 1;
    assert.equal(gate.requiredWing(pl, 0), 'neutral', 'visible avatar body is half a metre beside the paddle base');
    assert.equal(gate.requiredWing(pl, s * h * .6), 'forehand');
    assert.equal(gate.requiredWing(pl, -s * h * .6), 'backhand');
    assert.equal(gate.requiredWing(pl, s * h * .2), 'neutral');
    assert.equal(gate.matchesWing({ wing: 'forehand' }, 'forehand'), true);
    assert.equal(gate.matchesWing({ wing: 'backhand' }, 'forehand'), false);
    assert.equal(gate.matchesWing({ wing: 'neutral' }, 'forehand'), false);
    assert.equal(gate.matchesWing({ wing: 'forehand' }, 'backhand'), false);
    assert.equal(gate.matchesWing({ wing: 'backhand' }, 'backhand'), true);
    assert.equal(gate.matchesWing({ wing: 'neutral' }, 'neutral'), true);
    assert.equal(gate.matchesWing({}, 'forehand'), true, 'legacy source packets remain compatible');
  }
});

test('real socket contacts require the correct measured forehand or backhand', async t => {
  const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port; await new Promise(r => probe.close(r));
  const output = [], clients = [];
  const proc = spawn(process.execPath, ['server/game.js'], { cwd: root, env: { ...process.env, PORT: String(port), PODDLE_DB: ':memory:', AUTOBOT: '0', SWING_SERVE: '1', BLOCK: '0', WIN_AT: '0', READY_S: '0', TIMESCALE: '2', STAMP_S: '0' } });
  proc.stdout.on('data', d => output.push(String(d))); proc.stderr.on('data', d => output.push(String(d)));
  t.after(() => { clients.forEach(c => c.ws.terminate()); proc.kill(); });
  await until(() => output.some(s => s.includes('game server on port')), 'server startup');
  for (let i = 0; i < 2; i++) {
    const c = { log: [], ws: new WebSocket(`ws://127.0.0.1:${port}/?lobby=1&cid=wing-${i}`) };
    clients.push(c);
    c.ws.on('error', () => {});
    c.ws.on('message', raw => { const m = JSON.parse(raw); c.log.push({ ...m, arrived: Date.now() }); if (m.type === 'state') c.st = m; if (m.type === 'welcome') c.welcome = m; if (m.type === 'room') c.room = m; });
    c.send = m => c.ws.send(JSON.stringify(m));
    await until(() => c.log.some(m => m.type === 'lobby'), 'lobby');
    c.send(i ? { type: 'join', code: clients[0].room.code } : { type: 'create', public: false });
    await until(() => c.welcome, 'seat');
    c.send({ type: 'paddle', auto: true, autoY: false, x: 0, y: 1, q: [0, 0, 0, 1], r: 10 });
  }
  const host = clients[0];
  const paddle = (c, extra = {}) => c.send({ type: 'paddle', auto: true, autoY: false, x: 0, y: 1, q: [0, 0, 0, 1], r: 10, ...extra });
  const swing = (c, extra = {}) => c.send({ type: 'swing', power: 20, dir: 0, lob: 0, slice: 0, age: 0, net: 0, rom: 60, off: 30, back: .8, raw: 20, final: true, src: 'phone', pk: 13.2, ...extra });

  async function pointCase({ hand, required, sent, finalWing = null }) {
    for (const c of clients) paddle(c);
    await until(() => host.st?.live && host.st.serving != null, 'waiting serve');
    const start = host.log.length, serving = host.st.serving, receiving = 1 - serving;
    swing(clients[serving], { aimX: 0, wing: 'forehand' });
    await until(() => host.log.slice(start).some(m => m.type === 'hit' && m.side === serving), 'legal ordinary serve');
    await until(() => host.st?.live && host.st.serving == null && host.st.b === 1, 'legal first bounce');
    const s = sign(receiving), h = hand === 'left' ? -1 : 1, across = required === 'forehand' ? 1 : -1;
    const base = host.st.p[0] + s * .5 - s * h * across * .6;
    paddle(clients[receiving], { auto: false, hand, x: base });
    await until(() => {
      const state = host.st, p = state?.paddles?.[receiving];
      return state?.live && state.b === 1 && p && Math.abs(p.x - base) < .01 && Math.abs(state.p[0] - p.x) < 1.6 && Math.abs(state.p[1] - p.y) < 1.1 && -(state.p[2] - p.z) * s < 1.25 && -(state.p[2] - p.z) * s > -.9;
    }, 'genuine incoming ball is inside the original contact box');
    assert.equal(gate.requiredWing({ side: receiving, hand, x: base }, host.st.p[0]), required);
    swing(clients[receiving], { hand, aimX: 0, wing: sent, final: finalWing == null });
    if (finalWing != null) {
      await until(() => host.st?.live && host.st.serving == null && host.st.v.every(v => v === 0), 'original early contact cached');
      assert.equal(host.log.slice(start).filter(m => m.type === 'hit' && m.side === receiving).length, 0, 'early classification cannot release a guessed contact');
      await wait(20);
      swing(clients[receiving], { hand, aimX: 0, wing: finalWing, fix: true, final: true, age: 40 });
    }
    const expected = (finalWing ?? sent) === required;
    const point = await until(() => host.log.slice(start).find(m => m.type === 'point'), 'point completes');
    const hits = host.log.slice(start).filter(m => m.type === 'hit' && m.side === receiving);
    assert.equal(hits.length, expected ? 1 : 0, `required ${required}, reported ${sent} -> ${finalWing ?? sent}, ${hand} hand`);
    assert.equal(point.winner, expected ? receiving : serving);
    assert.equal(host.log.slice(start).filter(m => m.type === 'point').length, 1);
  }

  for (const hand of ['right', 'left']) for (const required of ['forehand', 'backhand']) {
    const opposite = required === 'forehand' ? 'backhand' : 'forehand';
    await t.test(`${hand}: ${required} side accepts the matching settled stroke`, () => pointCase({ hand, required, sent: required }));
    await t.test(`${hand}: ${required} side rejects the opposite settled stroke`, () => pointCase({ hand, required, sent: opposite }));
    await t.test(`${hand}: ${required} side rejects a neutral settled stroke`, () => pointCase({ hand, required, sent: 'neutral' }));
    await t.test(`${hand}: early wrong classification can settle to the correct ${required}`, () => pointCase({ hand, required, sent: opposite, finalWing: required }));
    await t.test(`${hand}: early correct classification cannot override a wrong final ${required}`, () => pointCase({ hand, required, sent: required, finalWing: opposite }));
  }
});
