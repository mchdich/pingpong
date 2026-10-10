import test from 'node:test';
import assert from 'node:assert/strict';
import { SwingResponse } from '../web/swingresponse.js';
import { qaxis, qmul, qconj, qangle } from '../web/motion.js';

const pose=(degrees=0,swinging=false)=>({calibrated:true,Pd:qaxis([0,1,0],degrees*Math.PI/180),offset:[.1,.2,.3],rate:3,swinging,x:1.2,y:1.1});
test('ordinary swings and idle grips remain exactly the physical phone pose',()=>{
  const r=new SwingResponse();
  for(let i=0;i<30;i++){const p=pose(i*7,i>2&&i<25),v=r.update(p,1,i*20);assert.deepEqual(v.Pd,p.Pd);assert.deepEqual(v.offset,p.offset);assert.equal(v.rate,p.rate);assert.equal(v.x,p.x);assert.equal(v.y,p.y);}
});
test('speedup and slowdown change the actual angular speed and arm travel in both directions',()=>{
  for(const gain of [1.35,.45])for(const direction of [-1,1]) {
    const r=new SwingResponse();r.update(pose(),gain,0);let last=pose().Pd;
    for(let i=1;i<=40;i++) {
      const p=pose(direction*i*6,true),v=r.update(p,gain,i*20);
      assert.ok(Math.abs(qangle(qmul(v.Pd,qconj(last)))-6*Math.PI/180*gain)<1e-7,'per-frame rotation scales smoothly, including crossing 180 degrees');
      assert.ok(Math.abs(v.rate-3*gain)<1e-9);assert.equal(v.x,p.x);assert.equal(v.y,p.y);
      p.offset.forEach((n,j)=>assert.ok(Math.abs(v.offset[j]-n*gain)<1e-9));last=v.Pd;
    }
  }
});
test('expiry cannot alter a stroke halfway through and the paddle returns to exact physical alignment afterwards',()=>{
  const r=new SwingResponse();r.update(pose(),.45,0);r.update(pose(20,true),.45,20);
  const still=r.update(pose(40,true),1,40);assert.ok(Math.abs(still.rate-1.35)<1e-9);
  let v;for(let i=3;i<=35;i++)v=r.update(pose(40,false),1,i*20);
  assert.deepEqual(v.Pd,pose(40).Pd);assert.deepEqual(v.offset,pose().offset);
});
test('calibration/reset and idle ultimate activation cannot move the resting paddle or body',()=>{
  const r=new SwingResponse(),cal={};const p=pose(45,false);assert.deepEqual(r.update(p,.45,0,cal).Pd,p.Pd);
  r.update(pose(80,true),.45,20,cal);const q=r.update(pose(0,false),1,40,{});assert.deepEqual(q.Pd,pose().Pd);assert.equal(q.x,p.x);
  r.reset();assert.deepEqual(r.update(pose(90,false),1.35,60).Pd,pose(90).Pd);
});
