import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hitPulse, vibrateHit } from '../web/haptics.js';
import { shownN } from '../web/scene.js';

const energy = pulse => Array.isArray(pulse) ? pulse.filter((_, i) => !(i % 2)).reduce((a, b) => a + b, 0) : pulse;
const duration = pulse => Array.isArray(pulse) ? pulse.reduce((a, b) => a + b, 0) : pulse;

test('confirmed hit vibration rises continuously with physical strength and stays brief', () => {
  let previous = 0;
  for (let i = 0; i <= 1000; i++) {
    const pulse = hitPulse(i / 1000), power = energy(pulse);
    assert.ok(power >= previous, 'a stronger contact cannot produce a weaker vibration');
    assert.ok(power >= 8 && power <= 90);
    assert.ok(duration(pulse) <= 108);
    previous = power;
  }
  assert.equal(hitPulse(0), 8);
  assert.ok(energy(hitPulse(.5)) >= 25 && energy(hitPulse(.5)) <= 40);
  assert.ok(energy(hitPulse(.85)) >= 60);
  assert.deepEqual(hitPulse(1), [78, 18, 12]);
  assert.equal(hitPulse(NaN), 8);
  assert.deepEqual(hitPulse(5), hitPulse(1));
});

test('the actual phone FX receiver uses physical hit strength, with no second buzz for final recolours or points', () => {
  const source = fs.readFileSync(new URL('../web/pad.js', import.meta.url), 'utf8');
  const start = source.indexOf('function fx(m)'), end = source.indexOf('// ---------- the screen', start);
  assert.ok(start > 0 && end > start);
  const calls = [], flashes = [], note = { textContent: '' }, device = { vibrate: p => { calls.push(p); return true; } };
  const fx = new Function('vibrateHit', '$', 'glow', 'FX_TEXT', 'render', `let fxText=''; ${source.slice(start, end)}; return fx;`)(
    strength => vibrateHit(strength, device), () => note, (n, fresh) => flashes.push({ n, fresh }), { cal: 'Calibrating', play: 'Playing', idle: '' }, () => {});
  fx({ fx: 'hit', n: 0, b: .95 }); // White lob, strong physical contact.
  assert.deepEqual(calls, [hitPulse(.95)]);
  assert.deepEqual(flashes, [{ n: 0, fresh: true }]);
  fx({ fx: 'tint', n: 1, b: .95 });
  fx({ fx: 'tint', n: 1, b: .95 });
  fx({ fx: 'point' });
  fx({ fx: 'play' });
  assert.equal(calls.length, 1, 'settled/final updates never vibrate again');
  fx({ fx: 'hit', n: 1, b: 0 });
  assert.equal(calls[1], 8, 'a weak contact stays weak despite its display colour');
  assert.equal(note.textContent, '');
});

test('unsupported or rejected phone vibration is safe and does not simulate hardware feedback', () => {
  assert.equal(vibrateHit(.8, {}), false);
  assert.equal(vibrateHit(.8, null), false);
  assert.equal(vibrateHit(.8, { vibrate: () => false }), false);
  assert.equal(vibrateHit(.8, { vibrate: () => { throw Error('not supported'); } }), false);
  assert.equal(vibrateHit(.8, { vibrate: () => true }), true);
});

test('the actual main hit handler sends measured contact force despite a softened near-net flight', () => {
  const source = fs.readFileSync(new URL('../web/main.js', import.meta.url), 'utf8');
  const start = source.indexOf("if (m.type === 'hit') { struck = true;"), end = source.indexOf('// Result-card stats', start);
  const padFxLine = source.match(/^const padFx = .*$/m)?.[0];
  assert.ok(start > 0 && end > start && padFxLine);
  const sent = [];
  const receiver = new Function('game', 'shownN', 'spec', 'ui', 'clearTimeout', 'setTimeout', `
    const side=0,padOn=true,stats={hits:0,myHits:0}; let struck=false,myBet=null,myKind='',rally=0;
    ${padFxLine}
    return { receive(m) { ${source.slice(start, end)} }, stats };
  `)({ send: m => sent.push(m) }, shownN, () => false, { setRally() {} }, () => {}, () => 1);
  receiver.receive({ type: 'hit', side: 0, n: .25, force: .75, kind: 'drive' });
  assert.deepEqual(sent[0], { type: 'padfx', fx: 'hit', n: .25, b: .75 });
  assert.ok(energy(hitPulse(sent[0].b)) > energy(hitPulse(sent[0].n)), 'buzz follows the physical contact rather than the shortened flight');
  receiver.receive({ type: 'hit', side: 0, n: .25, force: .75, kind: 'lob' });
  assert.deepEqual(sent[1], { type: 'padfx', fx: 'hit', n: 0, b: .75 }, 'a strong near-net lob can stay visually white while buzzing strongly');
  receiver.receive({ type: 'hit', side: 0, n: .4, kind: 'drive' });
  assert.equal(sent[2].b, .4, 'legacy contacts without force preserve their original strength fallback');
  receiver.receive({ type: 'hit', side: 0, n: .4, force: NaN, kind: 'drive' });
  assert.equal(sent[3].b, .4);
  receiver.receive({ type: 'hit', side: 0, n: .25, force: 2, kind: 'drive' });
  assert.equal(sent[4].b, 1, 'finite force is safely bounded to the physical range');
  receiver.receive({ type: 'hit', side: 1, n: .25, force: .75, kind: 'drive' });
  assert.equal(sent.length, 5, 'another player’s contact cannot buzz my phone');
});
