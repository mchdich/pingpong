import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MotionModel, qaxis, qmul, qconj, qrot } from '../web/motion.js';
import { phonePose } from '../web/phonepose.js';
import { makeSynth, CALIBRATE, quatFromM } from './fake-bridge.mjs';

const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const error = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180 / Math.PI;

function gripFor(kind, heading) {
  const h = heading * Math.PI / 180, up = [0, 0, 1];
  const right = [Math.sin(h), -Math.cos(h), 0], forward = [Math.cos(h), Math.sin(h), 0];
  const columns = kind === 'screenUp' ? [right, forward, up] : kind === 'screenTowardPlayer' ? [right, up, forward.map(v => -v)] : [up, forward, right.map(v => -v)];
  const q = quatFromM([0, 1, 2].map(i => columns.map(v => v[i])));
  const g = qmul(qconj(qaxis(up, h)), q), n = Math.hypot(...g.slice(0, 3));
  return [...g.slice(0, 3).map(v => v / n), 2 * Math.atan2(n, g[3])];
}

function exercise({ kind, heading, rateHz, jitter, axis, degrees, restored = false, returnLevel = false }) {
  let model = new MotionModel({ RATE_GAIN: 1.5 });
  const synth = makeSynth({ heading, grip: gripFor(kind, heading), rateHz,
    script: [...CALIBRATE, { T: .6 }, ...(returnLevel ? [{ T: .45, axis: [1, 0, 0], deg: -35 }, { T: .6 }] : []), { T: .45, axis, deg: degrees }, { T: 1.1 }] });
  let last, arrival, calData;
  for (let i = 0; i < Math.ceil(synth.dur * rateHz); i++) {
    last = synth.next();
    arrival = last.t * 1000 + (jitter ? [0, 0, 28, 0, 48, 0, 12][i % 7] : 0);
    const events = model.feed(last, arrival);
    if (events.some(e => e.type === 'calibrated')) {
      calData = model.save();
      if (restored) { const fresh = new MotionModel({ RATE_GAIN: 1.5 }); assert.equal(fresh.restore(calData), true); model = fresh; }
    }
  }
  assert.ok(model.calibrated && calData, 'original staged calibration works with every physical starting grip');
  const before = model.pose(arrival), frozen = structuredClone(before), calibration = model.save();
  const corrected = phonePose(model, before);
  assert.deepEqual(before, frozen, 'the render adapter cannot mutate the source pose');
  assert.deepEqual(model.save(), calibration, 'the render adapter cannot mutate calibration or K');
  assert.deepEqual({ ...corrected, Pd: before.Pd }, before, 'hand position, arc, rate, power and core P stay identical');

  // Ground truth originates in the sensor simulator's rotation MATRICES,
  // independent of the adapter's quaternion mount construction.
  const matrix = synth.truth(last._t).M;
  const intoPlayer = world => [dot(world, model.B.R), dot(world, model.B.U), -dot(world, model.B.F)];
  // Restoring can recenter the heading; use the original yaw fix on ground truth.
  const reaimed = axes.map((_, col) => intoPlayer(qrot(model.yawFix, matrix.map(row => row[col]))));
  const expected = reaimed;
  const deviations = axes.map((a, i) => error(qrot(corrected.Pd, a), expected[i]));
  assert.ok(Math.max(...deviations) < .8, `${kind} heading ${heading}, ${rateHz}Hz, ${degrees}°: width/handle/face errors ${deviations}`);
  return { model, corrected, last, deviations };
}

test('the actual calibrated phone matches all rigid paddle axes for three grips and nine 0/90/180 degree poses', () => {
  let worst = 0, cases = 0;
  for (const kind of ['edgeUp', 'screenUp', 'screenTowardPlayer']) for (const heading of [0, 137, 251])
    for (const [rateHz, jitter] of [[50, false], [60, false], [50, true]])
      for (const axis of axes) for (const degrees of [0, 90, 180]) {
        const result = exercise({ kind, heading, rateHz, jitter, axis, degrees });
        worst = Math.max(worst, ...result.deviations); cases++;
      }
  assert.equal(cases, 243);
  assert.ok(worst < .8);
});

test('screen facing up puts the paddle FACE up, with no change to the original recentered or restored hand path', () => {
  const flat = exercise({ kind: 'screenUp', heading: 137, rateHz: 60, jitter: true, axis: [0, 1, 0], degrees: 0, returnLevel: true });
  assert.ok(error(qrot(flat.corrected.Pd, [0, 0, 1]), [0, 1, 0]) < .8, 'screen normal up means paddle FACE up');
  assert.ok(Math.abs(qrot(flat.corrected.Pd, [1, 0, 0])[1]) < .015, 'paddle edge stays horizontal in this explicit screen-up anchor');
  for (const kind of ['edgeUp', 'screenUp', 'screenTowardPlayer']) for (const restored of [false, true]) {
    const { model } = exercise({ kind, heading: 137, rateHz: 60, jitter: true, axis: [0, 1, 0], degrees: 90, restored });
    model.recenter();
    const pose = model.pose(), calibration = model.save();
    const mounted = phonePose(model, pose);
    assert.deepEqual({ ...mounted, Pd: pose.Pd }, pose);
    assert.deepEqual(model.save(), calibration);
  }
  const m = new MotionModel();
  const uncalibrated = m.pose();
  assert.equal(phonePose(m, uncalibrated), uncalibrated, 'uncalibrated setup keeps its original neutral display');
});

test('actual main wire, render and phone inset share the same physical screen axes', () => {
  const source = fs.readFileSync(new URL('../web/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('setInterval(() => {                               // 20Hz:'), end = source.indexOf('// ---------- input', start);
  assert.ok(start > 0 && end > start);
  let tick, message;
  const { model, corrected } = exercise({ kind: 'screenUp', heading: 137, rateHz: 60, jitter: false, axis: [0, 0, 1], degrees: 90 });
  const time = model.last.t * 1000;
  new Function('setInterval', 'tellCal', 'calibrating', 'seated', 'spec', 'onCourt', 'paddlePose', 'model', 'performance', 'game', 'hand', 'autoNow', 'mode', 'bodyX', 'bodyY', 'bodyZ', 's', 'usingBody', source.slice(start, end))(
    cb => { tick = cb; }, () => {}, false, () => true, () => false, () => true, now => phonePose(model, model.pose(now)), model, { now: () => time }, { send: m => { message = m; } }, 'right', () => true, 'auto', 1, 1.2, 6.5, () => 1, () => false);
  tick();
  assert.equal(message.type, 'paddle');
  const buffered = phonePose(model, model.pose(time));
  assert.deepEqual(message.q, buffered.Pd);
  assert.equal(message.x, 1);
  assert.equal(message.y, 1.2);
  assert.equal(message.hand, 'right');
  assert.ok(source.includes('const p = paddlePose(now);'));
  assert.ok(source.includes('pod.update(p.Pd)'));
  const inset = fs.readFileSync(new URL('../web/podview.js', import.meta.url), 'utf8');
  assert.ok(!inset.includes('phone.rotation.y = -Math.PI / 2'), 'inset cannot hide a quarter-turn mismatch');
  for(const axis of axes) assert.ok(error(qrot(corrected.Pd, axis), qrot(buffered.Pd, axis)) < .8);
});
