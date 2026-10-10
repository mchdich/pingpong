import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MotionModel, qaxis, qmul, qconj } from '../web/motion.js';
import { phonePower } from '../web/phonepower.js';
import { makeSynth, CALIBRATE, quatFromM } from './fake-bridge.mjs';

const source = readFileSync(new URL('../server/game.js', import.meta.url), 'utf8');
const physics = Function('process', 'abuse', source.slice(source.indexOf('const COURT ='), source.indexOf('function createRoom(')) + '\nreturn {solve,G,R,COURT,effort,gOf,flight};')({env:{}}, {MATCH_WIDE:[]});
const sign = side => side % 2 ? -1 : 1;
const aim = degrees => Math.max(-1,Math.min(1,degrees/45));
function shot({side=0,n=.5,dir=1,aimX=0,x=0,y=1.1,z=6.5,lob=0,slice=0}={}) {
  const p=[x,y,z*sign(side)], result=physics.solve(p,side,n,dir,lob,slice,null,1,aimX);
  const tn=-p[2]/result.v[2], g=physics.gOf(result.spin);
  const net=tn>0&&tn<result.T?p[1]+result.v[1]*tn-.5*g*tn*tn:null;
  const legal=net>physics.COURT.net+physics.R && result.land[1]*sign(side)<0 && Math.abs(result.land[0])<=physics.COURT.halfW+physics.R && Math.abs(result.land[1])<=physics.COURT.halfL+physics.R;
  return {...result,net,legal,p};
}
function phoneGrip(heading) {
  const h=heading*Math.PI/180,up=[0,0,1],right=[Math.sin(h),-Math.cos(h),0],forward=[Math.cos(h),Math.sin(h),0];
  const q=quatFromM([0,1,2].map(i=>[up[i],forward[i],-right[i]]));
  const g=qmul(qconj(qaxis(up,h)),q), n=Math.hypot(...g.slice(0,3));
  return [...g.slice(0,3).map(v=>v/n),2*Math.atan2(n,g[3])];
}
function measuredStroke(duration,wing,heading=137) {
  const synth=makeSynth({heading,grip:phoneGrip(heading),script:[...CALIBRATE,{T:.4},{T:duration,axis:[0,wing,0],deg:170},{T:.5}]});
  const model=new MotionModel({RATE_GAIN:1.5}); let settled, calibrated=false;
  for(let i=0;i<Math.ceil((synth.dur+.2)*50);i++) {const sample=synth.next(); for(const e of model.feed(sample,sample.t*1000)) {if(e.type==='calibrated')calibrated=true;if((e.type==='swing'||e.type==='swingFix')&&e.final)settled=e;}}
  assert.ok(calibrated&&settled,'original staged phone calibration and actual swing detector complete');
  return {...settled,power:phonePower(settled),n:physics.effort(Math.max(0,Math.min(1,(phonePower(settled)-6)/28)))};
}

test('ordinary calibrated phone weak swings fail from the baseline while comfortable swings remain legal',()=>{
  for(const side of [0,1,2,3]) for(const wing of [-1,1]) {
    const slow=measuredStroke(.70,wing),normal=measuredStroke(.45,wing),strong=measuredStroke(.20,wing);
    assert.ok(slow.n>.20&&slow.n<.27,'fixture is a plausible slow wide phone stroke, not a fabricated zero-strength report');
    assert.ok(normal.n>.45&&normal.n<.55);
    const weak=shot({side,n:slow.n,dir:slow.dir}),comfortable=shot({side,n:normal.n,dir:normal.dir}),overhit=shot({side,n:strong.n,dir:strong.dir});
    assert.equal(weak.legal,false,'a slow real sweep cannot be silently rescued over the net');
    assert.ok(weak.net<physics.COURT.net+physics.R,'its outgoing energy puts the baseline shot below the net');
    assert.equal(comfortable.legal,true,'the familiar relaxed real sweep still clears and lands legally');
    assert.ok(Math.abs(overhit.land[1])>physics.COURT.halfL+physics.R,'a full-strength real sweep lands beyond the opponent baseline');
  }
});

test('the same measured weak strength can dink close to the net but cannot clear it from far away',()=>{
  for(const side of [0,1]) for(const lob of [0,.7]) {
    const near=shot({side,n:.236,z:2.6,lob}),far=shot({side,n:.236,z:6.5,lob});
    assert.equal(near.legal,true,'distance permits a deliberately short weak shot');
    assert.equal(far.legal,false,'a weak underhand is also insufficient from the baseline');
    assert.ok(Math.abs(near.land[1])<2,'the close soft shot remains a short dink');
  }
});

test('left and right physical ready aim places legal edge shots independently of forehand/backhand turn',()=>{
  for(const side of [0,1,2,3]) for(const dir of [-1,1]) for(const n of [.4,.5,.65,.8]) {
    const center=shot({side,dir,n,aimX:0}),left=shot({side,dir,n,aimX:aim(-85)}),right=shot({side,dir,n,aimX:aim(85)});
    assert.equal(center.legal,true,'a full forehand or backhand turn with neutral ready aim stays down the court');
    assert.ok(Math.abs(center.land[0])<1e-9,'wing direction cannot manufacture a lateral fault');
    assert.equal(left.legal,true); assert.equal(right.legal,true);
    assert.ok(Math.abs(left.land[0]*sign(side)+2.6)<1e-9);
    assert.ok(Math.abs(right.land[0]*sign(side)-2.6)<1e-9);
    for(const s of [left,right]) {
      const p=[...s.p],v=[...s.v]; physics.flight(p,v,s.T,s.curl,physics.gOf(s.spin),null,0);
      assert.ok(Math.abs(p[0]-s.land[0])<1e-8,'the actual curved flight lands at the announced edge target');
      assert.ok(Math.abs(p[2]-s.land[1])<1e-8);
    }
  }
});

test('modest physical aiming covers the width smoothly, saturates safely and preserves strong-shot curl',()=>{
  for(const dir of [-1,1]) for(const side of [0,1]) {
    let previous=null;
    for(let deg=0;deg<=90;deg++) {
      const s=shot({side,dir,n:.65,aimX:aim(deg)});
      if(previous) assert.ok(Math.abs(s.land[0]-previous.land[0])<.058,'one degree of real aim changes the landing continuously');
      assert.ok(s.legal,'even extreme aim has no sideline fault');
      if(deg>=45) assert.ok(Math.abs(Math.abs(s.land[0])-2.6)<1e-9);
      previous=s;
    }
    for(const n of [.85,.9,1]) {
      const curved=shot({side,dir,n,aimX:1});
      assert.ok(Math.abs(curved.curl)>0,'strong source curve is retained');
      assert.ok(Math.abs(Math.abs(curved.land[0])-2.6)<1e-9,'curve preserves the safe physically aimed target');
    }
  }
});

test('weak-to-comfortable-to-overhit power remains a continuous range',()=>{
  const unique=new Set(); let previous;
  for(let i=0;i<=1000;i++) {
    const n=i/1000,s=shot({n}); unique.add(s.v[2].toFixed(6));
    assert.ok(s.v.every(Number.isFinite)&&s.land.every(Number.isFinite));
    if(previous) {
      assert.ok(Math.abs(s.v[2]-previous.v[2])<(n<=.35?.2:1.2),'new weak carry has no discrete step and original upper flight limits remain bounded');
      assert.ok(Math.abs(s.v[1]-previous.v[1])<(n<=.35?.2:1.2),'new lifting energy changes smoothly at the weak threshold');
    }
    previous=s;
  }
  assert.ok(unique.size>990);
  assert.equal(shot({n:.2}).legal,false);
  assert.equal(shot({n:.5}).legal,true);
  assert.equal(shot({n:1}).legal,false);
});

test('centered hard phone shots curve with the measured swing, never a fixed rightward default',()=>{
  for(const side of [0,1,2,3])for(const n of [.84,.9,1]) {
    const left=shot({side,n,dir:-1,aimX:0}),right=shot({side,n,dir:1,aimX:0}),straight=shot({side,n,dir:0,aimX:0});
    assert.ok(left.curl*sign(side)<0&&right.curl*sign(side)>0);
    assert.ok(Math.abs(left.curl+right.curl)<1e-9&&Math.abs(left.v[0]+right.v[0])<1e-9);
    assert.equal(Math.abs(straight.curl),0);assert.equal(Math.abs(straight.v[0]),0);
  }
});

// Execute the actual production bounce/bounds section with already flown ball
// states. This covers sideline crossings independently of the safe aim target.
const scoringSource=source.slice(source.indexOf('    if (ball.live && !contactPending && ball.rest > 0)'),source.indexOf('  // what the lobby list says'));
const scoreFlight=Function('ball','COURT','R','PASSED','bounceV','flight','broadcast','team','chargeShot','point','waitForReportedContact',
  'const contactPending=null,now=0,G=9.81;'+scoringSource.slice(0,scoringSource.lastIndexOf('  }')));
test('actual bounce and terminal bounds never fault sideways travel, while long and wrong-side landings still fault',()=>{
  for(const seat of [0,1,2,3])for(const x of [-20,-3.8,3.8,20]) {
    const ball={live:true,lastHit:seat,p:[x,physics.R,-3*sign(seat)],v:[0,-1,-sign(seat)],rest:.001,bounces:0,spin:0,kick:0};
    const events=[];let charge=0;
    const end=(winner,why)=>{events.push({winner,why});ball.live=false;};
    const score=()=>scoreFlight(ball,physics.COURT,physics.R,5.5,()=>{},()=>{},()=>{},side=>side%2,()=>charge++,end,(side,why)=>end(side%2,why));
    score();assert.ok(ball.live,'first opponent-side bounce never loses the point for its x coordinate');assert.equal(charge,1);assert.deepEqual(events,[]);
    ball.rest=.001;score();assert.deepEqual(events,[{winner:seat%2,why:'double bounce'}],'unreturned sideways flight scores for the hitter');
    for(const z of [3*sign(seat),-(physics.COURT.halfL+.2)*sign(seat)]) {
      Object.assign(ball,{live:true,p:[x,physics.R,z],rest:.001,bounces:0});events.length=0;score();
      assert.deepEqual(events,[{winner:1-seat%2,why:'out'}],'wrong-side and long faults remain');
    }
    Object.assign(ball,{live:true,p:[x,1,-(physics.COURT.halfL+5.6)*sign(seat)],rest:0,bounces:0});events.length=0;score();
    assert.deepEqual(events,[{winner:1-seat%2,why:'out'}],'a ball beyond the far baseline still faults before bouncing');
  }
});
