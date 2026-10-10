import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import puppeteer from 'puppeteer-core';

const root = fileURLToPath(new URL('..', import.meta.url)), shots = path.join(root, 'test/ui-shots/poddle-impact'); fs.mkdirSync(shots, {recursive: true});
const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.css':'text/css','.woff2':'font/woff2'};
const server = createServer((req,res) => {const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url,'http://local').pathname)); if (!file.startsWith(root)) {res.writeHead(403); res.end(); return;} fs.readFile(file,(e,d) => {if(e){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(d);});});
await new Promise(r => server.listen(0,'127.0.0.1',r)); let browser;
try {
  browser = await puppeteer.launch({executablePath:process.env.CHROME_BIN || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--use-gl=angle','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const errors = [];
  async function page(reduced = false) {
    const p = await browser.newPage(); p.on('pageerror',e => errors.push(e.message)); await p.setViewport({width:1280,height:800});
    if(reduced) await p.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
    await p.goto(`http://127.0.0.1:${server.address().port}/test/scene-preview.html?side=0&opp=human&t=2.5&clean=1`,{waitUntil:'networkidle0'}); await p.waitForFunction(() => document.title.startsWith('ready'));
    await p.evaluate(() => {window.__fxNow=1e7; const sc=__scene;sc.setSide(null);sc.setView('broadcast'); for(let i=0;i<4;i++)sc.updatePaddle(i,{x:i<2?-1.4:1.4,y:1,z:i%2?-6.5:6.5,q:[0,0,0,1],bot:false,name:['Mehdi','Noura','Rami','Lina'][i]});for(let i=0;i<8;i++)sc.render(__fxNow+=50);sc.hideBall();});
    return p;
  }
  const p = await page();
  const strength = await p.evaluate(() => {const sc=__scene,d=sc._dbg, out=[];for(const n of [.15,.5,.95]){d.cam.shake=d.cam.kickX=d.cam.kickY=0;sc.onEvent({type:'hit',side:0,n,p:[-1,1,6],v:[0,2,-8],kind:'drive'});out.push({n,shake:d.cam.shake,impulse:Math.abs(d.cam.kickX),kind:d.powerFx[0].burstKind});}sc.render(__fxNow+=12);return{out,filter:d.renderer.domElement.style.filter,p:d.ball.p.slice(),v:d.ball.v.slice()};});
  assert.ok(strength.out[0].shake < strength.out[1].shake && strength.out[1].shake < strength.out[2].shake);
  assert.ok(strength.out[2].impulse > strength.out[0].impulse && strength.out[2].kind==='impact'); assert.match(strength.filter,/contrast/);
  await p.screenshot({path:path.join(shots,'hard-impact-frame.png')});
  const impactExpired = await p.evaluate(() => {for(let i=0;i<10;i++)__scene.render(__fxNow+=17);return __scene._dbg.renderer.domElement.style.filter;}); assert.equal(impactExpired,'','impact frame is transient, never a simulation freeze');
  await p.screenshot({path:path.join(shots,'hard-impact-energy-explosion.png')});
  const force = await p.evaluate(()=>{const sc=__scene,d=sc._dbg;d.cam.shake=0;sc.onEvent({type:'hit',side:0,n:.25,force:.75,p:[-1,1,6],v:[0,2,-8],kind:'drive'});const separated={power:d.ball.power,force:d.pads[0].hitForce,shake:d.cam.shake,impact:d.impact.strength,burst:d.powerFx[0].burstKind};d.cam.shake=0;sc.onEvent({type:'hit',side:0,n:.75,p:[-1,1,6],v:[0,2,-8],kind:'drive'});return{...separated,legacyShake:d.cam.shake};});
  assert.equal(force.power,.25,'flight heat keeps the actual outgoing strength');assert.equal(force.force,.75);assert.equal(force.impact,.75);assert.equal(force.burst,'impact');assert.equal(force.shake,force.legacyShake,'physical force controls the impact independently of flight shaping');
  const spike = await p.evaluate(()=>{const sc=__scene,d=sc._dbg;sc.onEvent({type:'hit',side:0,n:.94,force:.94,p:[-.6,2.2,1.8],v:[0,-6,-25],kind:'spike'});const physics=JSON.stringify([d.ball.p,d.ball.v]);sc.render(__fxNow+=17);const f=d.powerFx[0],before={kind:f.burstKind,column:f.spikeColumn.visible,orange:f.spikeColumn.material.color.getHex(),downward:f.velocities[1]<0,power:d.ball.power};sc.onEvent({type:'bounce',p:[-.6,.04,-1.2]});const bounced=d.ball.spikeBounced;sc.render(__fxNow+=17);return{...before,bounced,physicsUnchanged:physics===JSON.stringify([d.ball.p,d.ball.v])};});
  assert.equal(spike.kind,'spike');assert.ok(spike.column&&spike.downward&&spike.bounced&&spike.physicsUnchanged);assert.equal(spike.orange,0xff7730);assert.equal(spike.power,.94,'hard spikes may show the red flight tier');
  await p.screenshot({path:path.join(shots,'spike-downward-column-first-bounce.png')});
  const spikeExpired=await p.evaluate(()=>{for(let i=0;i<16;i++)__scene.render(__fxNow+=50);return __scene._dbg.powerFx.every(f=>!f.spikeColumn.visible&&!f.cubes.visible);});assert.ok(spikeExpired,'spike column and debris expire');
  for(const team of [0,1]) {
    const state = await p.evaluate(team => {const sc=__scene,d=sc._dbg;const before=JSON.stringify([d.ball.p,d.ball.v]);sc.onEvent({type:'point',winner:team,final:true});sc.render(__fxNow+=17);return{avatars:d.powerFx.map(f=>({win:f.win.visible,root:f.root.visible,cubes:f.cubes.visible,count:f.cubes.count,kind:f.burstKind,crown:f.crown.visible,boost:f.boost.visible,slow:f.slow.visible})),physicsUnchanged:before===JSON.stringify([d.ball.p,d.ball.v])};},team);
    assert.deepEqual(state.avatars.map(a=>a.win),team ? [false,true,false,true] : [true,false,true,false]);assert.ok(state.physicsUnchanged);
    assert.ok(state.avatars.filter(a=>a.win).every(a=>a.root&&a.cubes&&a.count===64&&a.kind==='point'&&a.crown));assert.ok(state.avatars.every(a=>!a.boost&&!a.slow));
    await p.evaluate(()=>{for(let i=0;i<4;i++)__scene.render(__fxNow+=50);});
    await p.screenshot({path:path.join(shots,`team-${team}-point-crowns-confetti.png`)});
  }
  const cleanup = await p.evaluate(() => {const sc=__scene,d=sc._dbg, nodes=d.scene.children.length, buffers=d.powerFx.map(f=>f.cubes.instanceMatrix.array);for(let i=0;i<40;i++)sc.render(__fxNow+=50);const expired=d.powerFx.every(f=>!f.win.visible&&!f.cubes.visible);for(let i=0;i<40;i++){sc.onEvent({type:'hit',side:i%4,n:.9,p:[0,1,6],v:[0,2,-8]});sc.onEvent({type:'point',winner:i%2,final:true});sc.render(__fxNow+=17);}const pooled=nodes===d.scene.children.length&&d.powerFx.every((f,i)=>f.cubes.instanceMatrix.array===buffers[i]&&f.velocities.length===192);sc.setMenu(true);sc.render(__fxNow+=50);return{expired,pooled,menu:d.powerFx.every(f=>!f.win.visible&&!f.cubes.visible),filter:d.renderer.domElement.style.filter,shake:d.cam.shake};});
  assert.ok(cleanup.expired&&cleanup.pooled&&cleanup.menu);assert.equal(cleanup.filter,'');assert.equal(cleanup.shake,0);
  const sound = await p.evaluate(() => {const sc=__scene;sc.setMenu(false);sc.setSide(0);sc.unlockAudio();const ac=sc.audio.ctx(),create=ac.createOscillator.bind(ac);let voices=0;ac.createOscillator=(...a)=>{voices++;return create(...a);};sc.audio.setMute(true);sc.onEvent({type:'point',winner:0,final:false});const muted=voices;sc.audio.setMute(false);sc.onEvent({type:'point',winner:0,final:false});const audible=voices-muted;ac.createOscillator=create;return{muted,audible};});assert.equal(sound.muted,0);assert.equal(sound.audible,6);
  const hitSound=await p.evaluate(()=>{const sc=__scene,ac=sc.audio.ctx(),create=ac.createOscillator.bind(ac);let voices=0,frequencies=[];ac.createOscillator=(...a)=>{voices++;const o=create(...a),set=o.frequency.setValueAtTime.bind(o.frequency);o.frequency.setValueAtTime=(v,t)=>{frequencies.push(v);return set(v,t);};return o;};const hit={type:'hit',side:0,n:.25,force:.75,p:[0,2.2,1.8],v:[0,-6,-25],kind:'spike'};sc.audio.setMute(true);sc.onEvent(hit);const muted=voices;sc.audio.setMute(false);sc.onEvent({...hit,kind:'drive'});const ordinary=voices-muted,bodyFrequency=frequencies[0];sc.onEvent(hit);const spike=voices-muted-ordinary;ac.createOscillator=create;return{muted,ordinary,spike,bodyFrequency};});
  assert.equal(hitSound.muted,0);assert.equal(hitSound.ordinary,3);assert.equal(hitSound.spike,5);assert.equal(hitSound.bodyFrequency,215,'pock pitch follows physical .75 force, not .25 assisted flight');
  const reduced = await page(true);
  const still = await reduced.evaluate(() => {const sc=__scene,d=sc._dbg;sc.onEvent({type:'hit',side:0,n:1,force:1,p:[0,2.2,1.8],v:[0,-6,-25],kind:'spike'});sc.render(__fxNow+=12);const spikeOpacity=d.powerFx[0].spikeColumn.material.opacity;sc.onEvent({type:'point',winner:0,final:true});sc.onEvent({type:'ultimate',side:0,kind:'boost',targetTeam:0});sc.render(__fxNow+=12);return{shake:d.cam.shake,kickX:d.cam.kickX,kickY:d.cam.kickY,filter:d.renderer.domElement.style.filter,cheers:d.pads.map(a=>a.cheer),spikeOpacity};});
  assert.equal(still.shake,0);assert.equal(still.kickX,0);assert.equal(still.kickY,0);assert.equal(still.filter,'');assert.ok(still.cheers.every(c=>c===0));assert.deepEqual(errors,[]);
  assert.ok(still.spikeOpacity<=.16);
  console.log(JSON.stringify({passed:true,continuousShake:strength.out,physicalForceSeparated:force,spike,hitSound,impactExpires:true,pointTeams:[[0,2],[1,3]],cubeCapacityPerAvatar:64,pooled:true,expiryBeforeServe:true,mutedVoices:sound.muted,winningStingerVoices:sound.audible,reducedMotionPassed:true,physicsUnchanged:true,screenshots:shots}));
} finally {await browser?.close();await new Promise(r=>server.close(r));}
