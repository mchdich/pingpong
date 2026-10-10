import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MotionModel, qaxis, qmul, qconj } from '../web/motion.js';
import { ShotInput, strokeWing } from '../web/shotinput.js';
import { phonePower } from '../web/phonepower.js';
import { makeSynth, CALIBRATE, quatFromM } from './fake-bridge.mjs';

const serverSource = readFileSync(new URL('../server/game.js', import.meta.url), 'utf8');
const physics = Function('process', 'abuse', serverSource.slice(serverSource.indexOf('const COURT ='), serverSource.indexOf('function createRoom(')) + '\nreturn { solve, COURT, R, effort };')({ env: {} }, { MATCH_WIDE: [] });

function gripFor(heading) {
  const h = heading * Math.PI / 180, up = [0, 0, 1];
  const right = [Math.sin(h), -Math.cos(h), 0], forward = [Math.cos(h), Math.sin(h), 0];
  const q = quatFromM([0, 1, 2].map(i => [up[i], forward[i], -right[i]]));
  const g = qmul(qconj(qaxis(up, h)), q), n = Math.hypot(...g.slice(0, 3));
  return [...g.slice(0, 3).map(v => v / n), 2 * Math.atan2(n, g[3])];
}

function play({ heading = 137, aim = 0, aimHold = .5, wing = 1, hand = 'right', duration = .45, sweep = 170, two = false, axis = null } = {}) {
  const model = new MotionModel({ RATE_GAIN: 1.5 }), input = new ShotInput();
  const script = [...CALIBRATE, { T: .4 }, ...(aim ? [{ T: .8, axis: [0, 1, 0], deg: -aim }, { T: aimHold }] : []),
    { T: duration, axis: axis || [0, wing, 0], deg: sweep }, { T: .5 },
    ...(two ? [{ T: duration, axis: [0, -wing, 0], deg: sweep }, { T: .5 }] : [])];
  const synth = makeSynth({ heading, grip: gripFor(heading), script }), reports = [];
  for (let i = 0; i < Math.ceil((synth.dur + .2) * 50); i++) {
    const sample = synth.next();
    input.observe(model, sample);
    for (const event of model.feed(sample, sample.t * 1000)) if (['swing', 'swingFix', 'swingEnd'].includes(event.type)) {
      const original = structuredClone(event), pose = model.pose();
      const shot = input.report(event, hand, model);
      assert.deepEqual(event, original);
      assert.deepEqual(model.pose(), pose, 'aim cannot alter accepted hand motion');
      reports.push({ ...event, ...shot });
    }
  }
  return { model, input, reports };
}

test('mirrored physical swings produce mirrored destinations instead of a fixed right target',()=>{
  for(const heading of [0,137,251])for(const duration of [.2,.45,.7]) {
    const left=play({heading,duration,wing:1}).reports.findLast(r=>r.final),right=play({heading,duration,wing:-1}).reports.findLast(r=>r.final);
    assert.ok(left&&right);assert.ok(left.aimX<-.6&&right.aimX>.6);assert.ok(Math.abs(left.aimX+right.aimX)<.002);
    for(const r of [left,right])for(const side of [0,1,2,3]) {
      const sign=side%2?-1:1,shot=physics.solve([0,1.1,6.5*sign],side,.5,r.dir,0,0,null,1,r.aimX);
      assert.ok(shot.land[0]*sign*r.dir>0&&Math.abs(shot.land[0])<physics.COURT.halfW);
    }
  }
});

test('a held forehand or backhand take-back cannot lock all following shots to that side',()=>{
  for(const heading of [0,137,251])for(const aim of [-40,40]) {
    const returning=play({heading,aim,wing:Math.sign(aim)}).reports.findLast(r=>r.final);
    const outward=play({heading,aim,wing:-Math.sign(aim)}).reports.findLast(r=>r.final);
    assert.ok(returning.back>.8&&outward.back<-.8);
    assert.ok(Math.abs(returning.aimX)<.12,'normal 40-degree preparation plus a stroke toward the net stays near center');
    assert.ok(outward.aimX*Math.sign(aim)>.9,'swinging toward the pointed side still makes an intentional edge shot');
  }
});

test('pointing adjusts the same measured stroke continuously and either wing can place left or right',()=>{
  for(const heading of [0,137,251])for(const hand of ['right','left'])for(const wing of [-1,1]) {
    const aims=[-90,-40,0,40,90].map(aim=>play({heading,hand,wing,aim}).reports.findLast(r=>r.final));
    assert.ok(aims.every(Boolean));assert.ok(aims[0].aimX<-.6&&aims.at(-1).aimX>.6,'pointing can deliberately place either side on either wing');
    for(let i=1;i<aims.length;i++)assert.ok(aims[i].aimX>=aims[i-1].aimX);
    for(const r of aims)for(const side of [0,1,2,3]) {
      const sign=side%2?-1:1,shot=physics.solve([0,1.1,6.5*sign],side,.5,r.dir,0,0,null,1,r.aimX);
      assert.ok(Math.abs(shot.land[0])<=physics.COURT.halfW-.45+1e-9);
    }
  }
});

test('a completed follow-through does not silently replace the pointing trim on a reverse swing',()=>{
  for(const aim of [-80,-60,-40,40,60,80])for(const heading of [0,137,251]) {
    const sweep=Math.abs(aim)*2,{reports}=play({heading,aim,wing:Math.sign(aim),sweep,duration:.45*sweep/170,two:true});
    const settled=reports.filter(r=>r.final);assert.equal(settled.length,2);
    assert.ok(Math.abs(settled[0].aimX-settled[1].aimX)>.1,'the reverse measured stroke changes destination');
    assert.ok(Math.sign(settled[1].aimX)===Math.sign(aim),'the original pointing trim is retained rather than flipped by the previous endpoint');
    assert.equal(reports.at(-1).aimX,settled.at(-1).aimX,'end fallback keeps the latest measured destination');
  }
});

test('dominant hand mirrors wing interpretation without mirroring the physical shot direction',()=>{
  for(const wing of [-1,1]) {
    const right=play({wing,aim:40,hand:'right'}).reports.findLast(r=>r.final),left=play({wing,aim:40,hand:'left'}).reports.findLast(r=>r.final);
    assert.equal(right.aimX,left.aimX);assert.notEqual(right.wing,left.wing);assert.equal(left.hand,'left');
  }
  assert.equal(strokeWing({dir:0}),'neutral');assert.equal(strokeWing({axis:'missing'}),'neutral');
});

test('vertical strokes use physical preparation to choose their wing, and neutral ones have no sideways bias',()=>{
  for(const axis of [[1,0,0],[-1,0,0]])for(const hand of ['right','left']) {
    const settled=play({axis,hand}).reports.findLast(r=>r.final);assert.ok(settled);assert.equal(settled.wing,'forehand');assert.ok(Math.abs(settled.aimX)<.025);
    const crossed=play({axis,hand,aim:hand==='left'?40:-40});assert.ok(crossed.reports.every(r=>r.wing==='backhand'));
  }
});

test('recenter clears pointing without changing original calibration and a short held trim remains responsive',()=>{
  const {model,input}=play({aim:40});const saved=model.save();input.reset();assert.equal(input.aimX,0);assert.deepEqual(model.save(),saved);
  for(const wing of [-1,1])for(const aim of [-35,35]) {
    const a=play({wing,aim,aimHold:.2}).reports.findLast(r=>r.final),b=play({wing,aim,aimHold:.5}).reports.findLast(r=>r.final);
    assert.ok(a&&b&&Math.abs(a.aimX-b.aimX)<.02);
  }
});
