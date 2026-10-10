import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root=fileURLToPath(new URL('..',import.meta.url)), shots=path.join(root,'test/ui-shots/poddle-ultimates');fs.mkdirSync(shots,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.css':'text/css','.woff2':'font/woff2'};
const server=createServer((req,res)=>{const filename=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));if(!filename.startsWith(root)){res.writeHead(403);res.end();return;}fs.readFile(filename,(error,data)=>{if(error){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',mime[path.extname(filename)]||'application/octet-stream');res.end(data);});});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try {
  browser=await puppeteer.launch({executablePath:process.env.CHROME_BIN||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--use-gl=angle','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1280,height:800});
  await page.goto(`http://127.0.0.1:${server.address().port}/test/scene-preview.html?side=0&opp=human&t=2.5&clean=1`,{waitUntil:'networkidle0'});await page.waitForFunction(()=>document.title.startsWith('ready'));
  await page.evaluate(()=>{window.__powerNow=1e7;const sc=__scene;sc.setSide(null);sc.setView('broadcast');for(let i=0;i<4;i++)sc.updatePaddle(i,{x:i<2?-1.4:1.4,y:1,z:i%2?-6.5:6.5,q:[0,0,0,1],bot:i===3,name:['Mehdi','Noura','Rami','Matt'][i],ultimate:{boost:0,slow:0}});for(let i=0;i<8;i++)sc.render(__powerNow+=50);});
  const names=await page.evaluate(()=>__scene._dbg.pads.map(p=>({name:p.nameTag.userData.labelText,visible:p.nameTag.visible})));
  assert.deepEqual(names.map(p=>p.name),['Mehdi','Noura','Rami','Matt']);assert.ok(names.every(p=>p.visible),'all four actual avatar names are shown overhead');
  await page.screenshot({path:path.join(shots,'original-court.png')});
  let state=await page.evaluate(()=>{__scene.onEvent({type:'ultimate',side:0,kind:'boost',targetTeam:0});for(let i=0;i<4;i++)__scene.render(__powerNow+=50);return __scene._dbg.powerFx.map(f=>({root:f.root.visible,boost:f.boost.visible,slow:f.slow.visible,cubes:f.cubes.visible,count:f.cubes.count}));});
  assert.deepEqual(state.map(s=>s.root),[true,false,true,false]);assert.deepEqual(state.map(s=>s.boost),[true,false,true,false]);assert.ok(state[0].cubes&&state[2].cubes&&state[0].count===64);
  await page.screenshot({path:path.join(shots,'boost-blue-cube-burst.png')});
  state=await page.evaluate(()=>{__scene.onEvent({type:'ultimate',side:0,kind:'slow',targetTeam:1});for(let i=0;i<4;i++)__scene.render(__powerNow+=50);return __scene._dbg.powerFx.map(f=>({root:f.root.visible,boost:f.boost.visible,slow:f.slow.visible,cubes:f.cubes.visible,links:f.links.length}));});
  assert.deepEqual(state.map(s=>s.root),[true,true,true,true]);assert.deepEqual(state.map(s=>s.slow),[false,true,false,true]);assert.equal(state[1].links,20);
  await page.screenshot({path:path.join(shots,'boost-and-slow-purple-orange-chains.png')});
  const sound=await page.evaluate(()=>{const sc=__scene;sc.unlockAudio();const ac=sc.audio.ctx(),original=ac.createOscillator.bind(ac);let voices=0;ac.createOscillator=(...args)=>{voices++;return original(...args);};sc.audio.setMute(true);sc.onEvent({type:'ultimate',side:1,kind:'boost',targetTeam:1});const muted=voices;sc.audio.setMute(false);sc.onEvent({type:'ultimate',side:1,kind:'slow',targetTeam:0});const audible=voices-muted;ac.createOscillator=original;return{muted,audible};});
  assert.equal(sound.muted,0);assert.equal(sound.audible,6);
  const retained=await page.evaluate(()=>{__scene.updatePaddle(0,{x:-1.4,y:1,z:6.5,q:[0,0,0,1],bot:false});for(let i=0;i<8;i++)__scene.render(__powerNow+=50);return __scene._dbg.powerFx[0].root.visible;});assert.ok(retained,'normal per-frame local hand updates must not erase ultimate status');
  const expired=await page.evaluate(()=>{for(let i=0;i<140;i++)__scene.render(__powerNow+=50);return __scene._dbg.powerFx.map(f=>({root:f.root.visible,cubes:f.cubes.visible}));});assert.ok(expired.every(f=>!f.root&&!f.cubes),'all effects and activation cubes expire');
  const hydrated=await page.evaluate(()=>{__scene.updatePaddle(3,{x:1.4,y:1,z:-6.5,q:[0,0,0,1],bot:false,ultimate:{boost:0,slow:2}});__scene.render(__powerNow+=50);return __scene._dbg.powerFx[3].slow.visible&&__scene._dbg.powerFx[3].root.visible;});assert.ok(hydrated,'authoritative state can hydrate a late spectator without replaying activation');
  const cleared=await page.evaluate(()=>{__scene.onEvent({type:'point',winner:0,final:true});__scene.render(__powerNow+=50);return __scene._dbg.powerFx.map(f=>({boost:f.boost.visible,slow:f.slow.visible,win:f.win.visible,cubes:f.cubes.visible}));});
  assert.ok(cleared.every(f=>!f.boost&&!f.slow),'point clears old activation effects');assert.deepEqual(cleared.map(f=>f.win),[true,false,true,false]);assert.deepEqual(cleared.map(f=>f.cubes),[true,false,true,false]);
  const serveCleanup=await page.evaluate(()=>{__scene.onEvent({type:'serve',p:[0,1,6.5],v:[0,0,0],by:0});__scene.render(__powerNow+=50);return __scene._dbg.powerFx.every(f=>!f.root.visible&&!f.cubes.visible&&!f.win.visible);});assert.ok(serveCleanup,'next serve clears the point celebration');
  const labels=await page.evaluate(()=>{
    const sc=__scene,p=sc._dbg.pads[0],old=p.nameTag.material.map;let disposed=0;const dispose=old.dispose.bind(old);old.dispose=()=>{disposed++;dispose();};
    sc.updatePaddle(0,{x:-1.4,y:1,z:6.5,q:[0,0,0,1],name:'Mehdi new',bot:false});const changed=p.nameTag.material.map;
    sc.updatePaddle(0,{x:-1.4,y:1,z:6.5,q:[0,0,0,1],name:'Mehdi new',bot:false});sc.render(__powerNow+=50);
    const result={disposed,reused:p.nameTag.material.map===changed,replaced:changed!==old,name:p.nameTag.userData.labelText};
    sc.updatePaddle(2,null);sc.render(__powerNow+=50);result.emptyHidden=!sc._dbg.pads[2].nameTag.visible;return result;
  });assert.equal(labels.disposed,1);assert.ok(labels.reused&&labels.replaced&&labels.emptyHidden);assert.equal(labels.name,'Mehdi new');
  const visualGuard=await page.evaluate(()=>{
    const sc=__scene,d=sc._dbg,results=[];sc.setSide(0);sc.updatePaddle(0,{x:0,y:1,z:6.5,q:[0,0,0,1],bot:false});for(let i=0;i<5;i++)sc.render(__powerNow+=50);
    for(const [z,vz] of [[6,4],[7,4],[7,-4]]){d.ball.snap=true;sc.updateBall([0,1,z],[0,0,vz],true,__powerNow);sc.render(__powerNow+=17);const before=[d.ballMesh.position.z,d.pads[0].pos.z];results.push({allowed:sc.canReturn(0),drawn:before,readonly:before[0]===d.ballMesh.position.z&&before[1]===d.pads[0].pos.z});}
    sc.hideBall();return{results,unknown:sc.canReturn(0)};
  });assert.deepEqual(visualGuard.results.map(r=>r.allowed),[true,false,true]);assert.ok(visualGuard.results.every(r=>r.readonly)&&visualGuard.unknown);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,nameLabels:['Mehdi','Noura','Rami','Matt'],nameTextureDisposalPassed:true,drawnBallGuardPassed:true,boostTeams:[0,2],slowTeams:[1,3],burstCubesPerAvatar:64,linksPerSlowedAvatar:20,mutedVoices:sound.muted,specialChimeVoices:sound.audible,expiryPassed:true,stateHydrationPassed:true,pointCleanupPassed:true,serveCleanupPassed:true,screenshots:shots}));
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
