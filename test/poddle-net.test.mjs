import test from 'node:test';
import assert from 'node:assert/strict';
import {netIntercept, ballTake, ballState, coast} from '../web/scene.js';

const vec = () => ({x: 0, y: 0, z: 0, set(x,y,z) {Object.assign(this,{x,y,z});return this;}, copy(v) {return this.set(v.x,v.y,v.z);}});
const flight = (home, extra={}) => ({p:[1,.55,home*.3], v:[.4,-.1,-home*6], held:false, spin:0, bounces:0, kick:0, curl:0, w:null, tS:0, ...extra});

test('low net flights wait at the incoming face through delayed packets on either side',()=>{
  for(const home of [-1,1]) for(const spin of [0,.8]) for(const bounces of [0,1]) {
    const b=flight(home,{spin,bounces}), before=JSON.stringify(b);
    assert.equal(netIntercept(b,.005),null,'an approaching ball is not stopped before contact');
    for(const age of [.04,.08,.2,.6]) {
      const p=netIntercept(b,age);assert.ok(p&&p[2]*home>=.11&&p[1]<=1.02);
    }
    assert.equal(JSON.stringify(b),before,'presentation clipping cannot mutate server flight');
  }
});

test('legal clearance, outside-post flight, serves, outgoing flights and floor faults are never net-clipped',()=>{
  for(const home of [-1,1]) {
    for(const extra of [{p:[1,1.6,home*.3]},{p:[3.3,.55,home*.3]},{held:true},{v:[.4,-.1,home*6]},{p:[1,.13,home*2],v:[0,-2,-home*6]}])
      assert.equal(netIntercept(flight(home,extra),.6),null,JSON.stringify(extra));
  }
});

test('the guard follows actual spin, curl and late re-aim bends at the net',()=>{
  for(const home of [-1,1]) {
    const b=flight(home,{p:[2.5,.55,home*.6],v:[-2,-.1,-home*5],curl:-3,spin:.6,w:[.3,-home*2,.2,0],tS:.06});
    const contact=netIntercept(b,.6); assert.ok(contact&&contact[2]*home>0&&contact[0]<2.5);
    assert.equal(netIntercept({...b,p:[3.4,.55,home*.6],v:[4,-.1,-home*5],curl:3},.6),null,'curved flight outside the posts is still allowed past the net');
  }
});

test('authoritative contact clears old arcs and survives dead state packets, then the next serve clears it',()=>{
  for(const home of [-1,1]) {
    const b={...flight(home),pos:vec(),core:vec(),vel:vec(),arc:{t0:3},turn:{},blend:true,pulse:1,betN:.9,live:true};
    const m={type:'net',p:[1,.53,home*.13],v:[.1,-.6,home*.9]};
    ballTake(b,m,()=>999);
    assert.equal(b.live,false);assert.equal(b.seen,true);assert.equal(b.arc,null);assert.equal(b.turn,null);assert.equal(b.pulse,0);assert.equal(b.power,0);
    const held=b.netHit;ballState(b,[...m.p],[...m.v],false,1000,0,{b:0});assert.equal(b.netHit,held);
    const p=vec(),v=vec();for(let t=0;t<3;t+=.016){coast(p,v,held.p,held.v,t,0,0,0);assert.ok(p.z*home>=.13);assert.ok(p.y>=.11);}
    ballTake(b,{type:'serve'},()=>1000);assert.equal(b.netHit,null);
    ballTake(b,m,()=>999);ballState(b,[0,1,home*6],[0,0,0],true,1000,0,{serving:home>0?0:1});assert.equal(b.netHit,null);
  }
});
