import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import puppeteer from 'puppeteer-core';

const root=fileURLToPath(new URL('..',import.meta.url)), shots=path.join(root,'test/ui-shots/poddle-net');fs.mkdirSync(shots,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.css':'text/css','.woff2':'font/woff2'};
const server=createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));if(!file.startsWith(root)){res.writeHead(403);res.end();return;}fs.readFile(file,(e,d)=>{if(e){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(d);});});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const errors=[];
try {
  browser=await puppeteer.launch({executablePath:process.env.CHROME_BIN||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--use-gl=angle','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  async function page(reduced=false){
    const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));await p.setViewport({width:1280,height:800});
    if(reduced)await p.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
    await p.goto(`http://127.0.0.1:${server.address().port}/test/scene-preview.html?side=0&opp=human&t=2.5&clean=1`,{waitUntil:'networkidle0'});await p.waitForFunction(()=>document.title.startsWith('ready'));
    await p.evaluate(()=>{window.__netNow=1e7;const sc=__scene;sc.setMenu(false);sc.setSide(null);sc.setView('broadcast');for(let i=0;i<4;i++)sc.updatePaddle(i,{x:i<2?-1.4:1.4,y:1,z:i%2?-6.5:6.5,q:[0,0,0,1],bot:false,name:['Mehdi','Noura','Rami','Lina'][i]});for(let i=0;i<8;i++)sc.render(__netNow+=50);sc.hideBall();window.__netDiff=()=>sc._dbg.netFx.parts.map(part=>{const a=part.mesh.geometry.attributes.position.array;let max=0,forward=0,back=0,edges=0;for(let i=0;i<a.length;i+=3){const d=a[i+2]-part.base[i+2];max=Math.max(max,Math.abs(d));forward=Math.max(forward,d);back=Math.min(back,d);if(Math.abs(part.base[i])>sc._dbg.netFx.width-.001)edges=Math.max(edges,Math.abs(d));}return{max,forward,back,edges};});});return p;
  }
  const p=await page(), outcomes=[];
  for(const view of [0,1,null]) for(const home of [1,-1]) {
    const waiting=await p.evaluate(({view,home})=>{const sc=__scene,d=sc._dbg;sc.hideBall();sc.setSide(view);if(view===null)sc.setView('broadcast');sc.updateBall([1.2,.55,home*.3],[.4,-.1,-home*6],true,__netNow,0,{b:0});for(let i=0;i<8;i++)sc.render(__netNow+=20);return{p:d.ball.pos.toArray(),v:d.ball.vel.toArray(),live:d.ball.live,active:d.netFx.age<1.2,mesh:__netDiff()};},{view,home});
    assert.ok(waiting.live&&!waiting.active&&waiting.p[2]*home>=.11);assert.deepEqual(waiting.v,[0,0,0]);assert.ok(waiting.mesh.every(a=>a.max===0));
    const contact=await p.evaluate(home=>{const sc=__scene,d=sc._dbg;sc.onEvent({type:'net',side:home>0?0:1,p:[1.2,.53,home*.13],v:[.1,-.6,home*.9],incoming:[.4,-.1,-home*6]});sc.onEvent({type:'point',winner:home>0?1:0,why:'net',final:false});sc.updateBall([1.2,.53,home*.13],[.1,-.6,home*.9],false,__netNow,0,{b:0});sc.render(__netNow+=20);const held=d.ball.pos.toArray();for(let i=0;i<3;i++)sc.render(__netNow+=20);return{held,p:d.ball.pos.toArray(),arc:d.ball.arc,live:d.ball.live,parts:__netDiff(),scale:d.ballMesh.scale.toArray()};},home);
    assert.deepEqual(contact.held,[1.2,.53,home*.13]);assert.equal(contact.live,false);assert.equal(contact.arc,null);assert.deepEqual(contact.scale,[1,1,1]);assert.ok(contact.p[2]*home>=.13);
    assert.ok(contact.parts[0].max>.08&&contact.parts[1].max>.02,'mesh and white tape visibly react');assert.ok(contact.parts.every(a=>a.edges<1e-5),'posts stay anchored');
    assert.ok(home>0?contact.parts[0].back<-.08:contact.parts[0].forward>.08,'mesh first bends in the incoming direction');
    if(view===null&&home===1){
      await p.screenshot({path:path.join(shots,'net-impact-court.png')});
      await p.evaluate(()=>{const d=__scene._dbg;d.camera.position.set(4,1.8,4);d.camera.lookAt(1,.4,0);d.camera.fov=48;d.camera.updateProjectionMatrix();d.renderer.render(d.scene,d.camera);});
      await p.screenshot({path:path.join(shots,'net-impact-close.png')});
    }
    const drop=await p.evaluate(home=>{const sc=__scene,d=sc._dbg,out=[];for(let i=0;i<18;i++){sc.render(__netNow+=20);out.push(d.ball.pos.toArray());}return{out,parts:__netDiff()};},home);
    assert.ok(drop.out.every(a=>a[2]*home>=.13&&a[1]>=.11));assert.ok(drop.out.some(a=>a[1]<.25),'ball falls to the floor on the hitter’s side');
    const settled=await p.evaluate(()=>{for(let i=0;i<28;i++)__scene.render(__netNow+=50);return __netDiff();});assert.ok(settled.every(a=>a.max===0),'net returns exactly to rest before the next serve');
    outcomes.push({view,home,meshDeflection:contact.parts[0].max,tapeDeflection:contact.parts[1].max});
  }
  const aimed=await p.evaluate(()=>{
    const sc=__scene,d=sc._dbg,shots=[];
    for(const home of [1,-1])for(const target of [-2,2]){
      sc.hideBall();sc.setSide(home>0?0:1);
      sc.onEvent({type:'net',p:[0,.5,home*.13],v:[0,-.6,home*.9],incoming:[0,0,-home*8],side:home>0?0:1});
      sc.onEvent({type:'serve',by:home>0?0:1});
      const p=[0,1.1,home*6.5],v=[target,4.905-.99,-home*10.5],start=__netNow;
      sc.updateBall(p,v,true,start,0,{b:0});sc.onEvent({type:'hit',p,v,n:.5,side:home>0?0:1});
      let at=.0;
      for(let i=0;i<40;i++){
        sc.updateBall([target*at,1.1+v[1]*at-4.905*at*at,home*(6.5-10.5*at)],[target,v[1]-9.81*at,v[2]],true,__netNow,0,{b:0});
        sc.render(__netNow+=20);at+=.02;
      }
      shots.push({home,target,p:d.ball.pos.toArray(),live:d.ball.live,net:!!d.ball.netHit,face:d.pads[home>0?0:1].group.quaternion.toArray()});
    }
    return shots;
  });
  assert.ok(aimed.every(s=>s.live&&!s.net&&s.p[0]*s.target>0&&Math.abs(s.p[0])>1.4&&s.p[2]*s.home<0),'net contact must not steer or retain the following aimed flight');
  const alignment=await p.evaluate(()=>{
    const sc=__scene,d=sc._dbg,out=[];
    for(const side of [0,1,2,3]){sc.setSide(side);sc.updatePaddle(side,{x:0,y:1,z:side%2?-6.5:6.5,q:[-Math.SQRT1_2,0,0,Math.SQRT1_2],offset:[0,0,0],bot:false});sc.render(__netNow+=20);const face=new THREE.Vector3(0,0,1).applyQuaternion(d.pads[side].group.quaternion);out.push({side,face:face.toArray()});}
    return out;
  });assert.ok(alignment.every(a=>Math.abs(a.face[1])>.999),'a physical face-up quaternion must render the paddle flat for every player');
  const cleanup=await p.evaluate(()=>{const sc=__scene,d=sc._dbg,buffers=d.netFx.parts.map(p=>p.mesh.geometry.attributes.position.array),nodes=d.scene.children.length,hit={type:'net',p:[0,.6,.13],v:[0,-.7,.9],incoming:[0,-1,-8],side:0};for(let i=0;i<60;i++){sc.onEvent(hit);sc.render(__netNow+=20);}const pooled=nodes===d.scene.children.length&&d.netFx.parts.every((p,i)=>p.mesh.geometry.attributes.position.array===buffers[i]);sc.setFrozen(true);const t=d.netFx.age,ballAge=d.ball.netHit.age;for(let i=0;i<4;i++)sc.render(__netNow+=50);const paused=t===d.netFx.age&&ballAge===d.ball.netHit.age;sc.setFrozen(false);sc.onEvent({type:'serve',by:0});const serve=!d.ball.netHit&&__netDiff().every(p=>p.max===0);sc.onEvent(hit);sc.render(__netNow+=20);sc.setCourt({halfW:3.05,halfL:6.7,kitchen:2.13,net:.91});const rebuilt=d.netFx.parts.length===4&&__netDiff().every(p=>p.max===0);sc.onEvent(hit);sc.render(__netNow+=20);sc.hideBall();const hidden=!d.ball.netHit&&!d.ball.seen&&__netDiff().every(p=>p.max===0);sc.onEvent(hit);sc.render(__netNow+=20);sc.setMenu(true);const menu=__netDiff().every(p=>p.max===0);return{pooled,paused,serve,rebuilt,hidden,menu};});assert.ok(Object.values(cleanup).every(Boolean),JSON.stringify(cleanup));
  const sound=await p.evaluate(()=>{const sc=__scene;sc.setMenu(false);sc.unlockAudio();const ac=sc.audio.ctx(),create=ac.createOscillator.bind(ac);let voices=0;ac.createOscillator=(...a)=>{voices++;return create(...a);};const hit={type:'net',p:[0,.6,.13],v:[0,-.7,.9],incoming:[0,-1,-8],side:0};sc.audio.setMute(true);sc.onEvent(hit);const muted=voices;sc.audio.setMute(false);sc.onEvent(hit);const audible=voices-muted;ac.createOscillator=create;return{muted,audible};});assert.equal(sound.muted,0);assert.equal(sound.audible,2);
  const reduced=await page(true), still=await reduced.evaluate(()=>{const sc=__scene,d=sc._dbg;sc.onEvent({type:'net',p:[1.2,.53,.13],v:[0,-.6,.9],incoming:[0,-1,-30],side:0});for(let i=0;i<4;i++)sc.render(__netNow+=20);return{parts:__netDiff(),shake:d.cam.shake,filter:d.renderer.domElement.style.filter};});assert.ok(still.parts.every(p=>p.max<.05));assert.equal(still.shake,0);assert.equal(still.filter,'');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,outcomes,aimed,alignment,cleanup,sound,reducedMotion:true,errors,screenshots:shots}));
} finally {await browser?.close();await new Promise(r=>server.close(r));}
