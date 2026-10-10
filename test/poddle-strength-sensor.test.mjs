import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MotionModel, qaxis, qmul, qconj } from '../web/motion.js';
import { phonePower } from '../web/phonepower.js';
import { ShotInput } from '../web/shotinput.js';
import { makeSynth, CALIBRATE, quatFromM } from './fake-bridge.mjs';

// The real phone instruction: top points toward the computer, screen sideways.
// Generate physically consistent attitude, gyro and acceleration samples, run
// the original full calibration, then change actual gesture speed rather than
// injecting power reports or moving the game ball into reach.
function phoneGrip(heading) {
  const h = heading * Math.PI / 180, up = [0, 0, 1];
  const right = [Math.sin(h), -Math.cos(h), 0];
  const forward = [Math.cos(h), Math.sin(h), 0];
  const q = quatFromM([0, 1, 2].map(i => [up[i], forward[i], -right[i]]));
  const g = qmul(qconj(qaxis(up, h)), q), n = Math.hypot(...g.slice(0, 3));
  return [...g.slice(0, 3).map(v => v / n), 2 * Math.atan2(n, g[3])];
}

function stroke({ deg = 170, duration = .45, wing = 1, heading = 137, hz = 50, jitter = false, noise = 0, gain = 1.5, idle = false } = {}) {
  const script = [...CALIBRATE, { T: .4 }, ...(idle ? [{ T: 6 }] : [{ T: duration, axis: [0, wing, 0], deg }, { T: .5 }])];
  const synth = makeSynth({ heading, grip: phoneGrip(heading), script, rateHz: hz, gyroNoise: noise, accNoise: noise / 4, seed: 17 });
  const model = new MotionModel({ RATE_GAIN: gain });
  const reports = [], ends = [];
  let calibrated = false, readyPose;
  for (let i = 0; i < Math.ceil((synth.dur + .2) * hz); i++) {
    const sample = synth.next();
    const arrival = sample.t * 1000 + (jitter ? Math.ceil(sample._t / .08) * 80 - sample._t * 1000 : 0);
    for (const event of model.feed(sample, arrival)) {
      if (event.type === 'calibrated') calibrated = true;
      if (event.type === 'swing' || event.type === 'swingFix') {
        const original = structuredClone(event), pose = model.pose();
        const power = phonePower(event);
        assert.deepEqual(event, original, 'scoring cannot rewrite the original gesture report');
        assert.deepEqual(model.pose(), pose, 'scoring cannot move the hand or change calibration');
        reports.push({ ...event, mappedPower: power, at: sample._t });
      }
      if (event.type === 'swingEnd') ends.push({ ...event, mappedPower: phonePower(event) });
    }
    if (sample._t > 8.1 && sample._t < 8.4) readyPose = model.pose(arrival);
  }
  assert.ok(calibrated, 'the original staged phone calibration must complete');
  const settled = reports.findLast(e => e.final);
  return { model, readyPose, reports, ends, settled };
}

test('faster versions of the same real forehand and backhand have increasing strength', () => {
  for (const heading of [0, 137, 251]) for (const wing of [1, -1]) {
    const gestures = [.70, .45, .30, .20].map(duration => stroke({ duration, wing, heading }));
    const powers = gestures.map(g => g.settled.mappedPower);
    for (let i = 1; i < powers.length; i++) assert.ok(powers[i] > powers[i - 1], `wing ${wing}: increasing physical speed must increase power (${powers})`);
    assert.ok(Math.abs(powers[0] - 12.60) < .4, 'weak wide sweep stays weak');
    assert.ok(Math.abs(powers[1] - 19.54) < .4, 'comfortable swing preserves its previous familiar strength');
    assert.ok(Math.abs(powers[2] - 29.25) < .5, 'fast swing no longer collapses to a tap');
    assert.equal(powers[3], 34, 'strongest swing reaches the overhit end');
    for (const g of gestures) {
      assert.equal(g.reports.filter(e => e.type === 'swing').length, 1, 'same original gesture detector reports one swing');
      assert.ok(Math.sign(g.settled.dir) === -wing, 'original forehand/backhand aim remains unchanged');
      assert.equal(g.ends.length, 1);
      assert.ok(g.ends[0].mappedPower >= g.settled.mappedPower, 'end fallback must not restore the old time-gated tap');
    }
  }
});

test('a short fast phone swing is stronger than a wide slow swing', () => {
  for (const wing of [1, -1]) {
    const short = stroke({ deg: 100, duration: .18, wing });
    const wide = stroke({ deg: 220, duration: .70, wing });
    assert.ok(short.settled.raw > wide.settled.raw);
    assert.ok(short.settled.mappedPower > wide.settled.mappedPower + 8, 'measured speed wins over duration and sweep length');
    assert.equal(short.settled.power, 6, 'fixture reproduces the original fast-to-weak failure');
  }
});

test('sample frequency, bursty arrivals and cached phone gain do not reverse strength', () => {
  for (const hz of [50, 60]) for (const wing of [1, -1]) {
    const baseline = stroke({ duration: .45, hz, wing });
    const bunched = stroke({ duration: .45, hz, wing, jitter: true });
    const otherGain = stroke({ duration: .45, hz, wing, gain: 3 });
    assert.equal(bunched.settled.mappedPower, baseline.settled.mappedPower, 'sample timestamps determine speed, not packet arrival spacing');
    assert.equal(otherGain.settled.mappedPower, baseline.settled.mappedPower, 'raw phone speed receives no second gain');
    const faster = stroke({ duration: .30, hz, wing, jitter: true, noise: .02 });
    assert.ok(faster.settled.mappedPower > baseline.settled.mappedPower + 8);
  }
});

test('original idle sensor stream stays idle and scoring rejects tiny twitch credit', () => {
  const idle = stroke({ idle: true, noise: .02 });
  assert.equal(idle.reports.length, 0, 'no new gestures are manufactured from a held phone');
  assert.equal(idle.ends.length, 0);
  assert.equal(phonePower({ raw: 30, rom: 4 }), 6, 'a tiny sensor twitch cannot become a smash');
  assert.equal(phonePower({ raw: NaN, rom: 100 }), 6);
  assert.equal(phonePower({ raw: Infinity, rom: 100 }), 6);
});

test('the actual main.js sample handler sends measured strength on every report and end fallback', () => {
  const source = readFileSync(new URL('../web/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('function onSample('), end = source.indexOf('const SCENE_EVENTS', start);
  assert.ok(start > 0 && end > start);
  const makeHandler = Function('model', 'phonePower', 'game', 'scene', 'performance', 'ShotInput', 'dominant', 'stateInput', `
    let src = 'phone', lastT = -1e9, phase = 'play', lastSample = 0, unsettled = null, rejectedStroke = false;
    const state = stateInput, s = () => 1;
    const shotInput = new ShotInput(), hand = dominant;
    const stats = { calibrated: true, swings: 0 };
    const ui = { setStat() {} }, calibrating = false, frozen = false, holding = false, side = 0;
    const spec = () => false, seated = () => true, pw = raw => raw * 1.5;
    const net = { lag: () => 0 }, logSwing = () => {};
    ${source.slice(start, end)}
    return onSample;
  `);
  for (const duration of [.70, .45, .30, .20]) for (const missingFinal of [false, true]) for (const hand of ['right', 'left']) for (const aim of [-40, 0, 40]) for (const wing of [1, -1]) for (const visual of ['unknown', 'ahead', 'behind', 'serve']) {
    const model = new MotionModel({ RATE_GAIN: 1.5 }), sent = [];
    const synth = makeSynth({ heading: 137, grip: phoneGrip(137), script: [...CALIBRATE, { T: .4 }, ...(aim ? [{ T: .8, axis: [0, 1, 0], deg: -aim }, { T: .5 }] : []), { T: duration, axis: [0, wing, 0], deg: 170 }, { T: .5 }] });
    let arrival = 0;
    let visualReads = 0;
    const scene = { onEvent() {}, ...(visual === 'unknown' ? {} : { canReturn() { visualReads++; return visual === 'ahead' && visualReads === 1; } }) };
    const state = visual === 'unknown' ? null : { live: true, serving: visual === 'serve' ? 0 : null, v: [0, 0, 4] };
    const handler = makeHandler(model, phonePower, { send: m => sent.push(m) }, scene, { now: () => arrival }, ShotInput, hand, state);
    if (missingFinal) {
      const feed = model.feed.bind(model);
      model.feed = (...args) => feed(...args).filter(e => !(e.type === 'swingFix' && e.final));
    }
    for (let i = 0; i < Math.ceil((synth.dur + .2) * 50); i++) {
      const sample = synth.next(); arrival = sample.t * 1000;
      if (sample._t < 8.5) model.feed(sample, arrival);
      else handler(sample, 'phone');
    }
    const reports = sent.filter(m => m.type === 'swing');
    if (visual === 'behind') {
      assert.equal(reports.length, 0, 'new visibly late swing and its corrections cannot claim a passed ball');
      continue;
    }
    if (visual === 'ahead') assert.equal(visualReads, 1, 'a valid initial stroke retains its settled corrections even if the visual ball subsequently passes');
    if (visual === 'serve') assert.equal(visualReads, 0, 'serves bypass the incoming-return visual filter');
    assert.ok(reports.length >= 2, 'original initial and settled reports must both reach the wire');
    assert.ok(reports.some(m => m.final));
    for (const report of reports) {
      assert.equal(report.power, phonePower({ raw: report.pk, rom: report.rom }), 'wire power uses ungained speed rather than the obsolete time gate');
      assert.equal(report.raw, report.pk * 1.5, 'original serve-intent gain remains independent');
      assert.equal(report.src, 'phone');
      assert.ok(Number.isFinite(report.power));
      assert.equal(report.hand, hand);
      assert.equal(report.wing, wing * (hand === 'left' ? -1 : 1) > 0 ? 'forehand' : 'backhand');
      const expectedAim = Math.max(-1, Math.min(1, .65 * (report.dir + (aim / 45))));
      assert.ok(Math.abs(report.aimX - expectedAim) < .025, 'left/right aim survives both swing directions without forced centering');
      assert.ok(Math.abs(report.aimX)<=1, 'measured swing aim stays safe through initial, correction and end packets');
    }
  }
});
