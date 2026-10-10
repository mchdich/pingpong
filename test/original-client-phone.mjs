// Exercises the actual original Poddle entry, room menu, staged MotionModel calibration and phone relay.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';
import { makeSynth, CALIBRATE, SESSION_LOOP } from './fake-bridge.mjs';
const site=process.env.CLIENT_SITE||'http://127.0.0.1:8610';
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--use-gl=angle','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows']});
const pages=[], phones=[], timers=[], errors=[];
try {
 const page=await browser.newPage();pages.push(page);await page.setViewport({width:1440,height:900});
 page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`)});
 await page.evaluateOnNewDocument(()=>{localStorage.setItem('poddle.name','Ann');localStorage.setItem('poddle.tutorial','1');sessionStorage.removeItem('cid');sessionStorage.removeItem('pad');const Native=window.WebSocket;window.__socketUrls=[];window.WebSocket=class extends Native{constructor(url,...rest){window.__socketUrls.push(String(url));super(url,...rest)}}});
 await page.goto(site+'/?uitest=1',{waitUntil:'networkidle0'});await page.click('#btn-start');await page.waitForFunction(()=>document.body.dataset.screen==='lobby');
 await page.click('#btn-courts');await page.waitForSelector('#btn-create',{visible:true});await page.click('#btn-create');await page.waitForSelector('#lobby-create:not([hidden])');
 await page.click('#create-match-mode [data-match="2v2"]');await page.click('#seg [data-public="0"]');await page.click('#btn-create-go');
 await page.waitForSelector('#lobby-share:not([hidden])');
 const room=await page.$eval('#share-code',e=>e.textContent.replace(/\s/g,''));assert.equal(room.length,4);
 await page.click('#btn-share-go');await page.waitForSelector('#screen-connect:not([hidden])');
 const code=await page.$eval('#pad-code',e=>e.textContent.replace(/^P-/,''));assert.equal(code.length,4);
 const phone=new WebSocket(site.replace('http:','ws:').replace('https:','wss:')+'/?padfor='+code);phones.push(phone);await new Promise((r,j)=>{phone.once('open',r);phone.once('error',j)});
 const synth=makeSynth({heading:137,script:CALIBRATE,loop:SESSION_LOOP,gyroNoise:.02,accNoise:.005,seed:7});let samples=0;
 timers.push(setInterval(()=>{if(phone.readyState!==1)return;const m=synth.next();delete m._t;phone.send(JSON.stringify({type:'m',...m}));samples++;},20));
 await page.waitForFunction(()=>window.__stats?.calibrated&&document.body.dataset.screen==='hud',{timeout:25000});
 const before=await page.evaluate(()=>({q:__scene._dbg.pads[0].group.quaternion.toArray(),p:__scene._dbg.pads[0].group.position.toArray(),mode:__stats.room,side:__scene.getView().side}));
 await new Promise(r=>setTimeout(r,1600));
 const after=await page.evaluate(()=>({q:__scene._dbg.pads[0].group.quaternion.toArray(),p:__scene._dbg.pads[0].group.position.toArray(),url:__socketUrls,phase:__stats.phase,calibrated:__stats.calibrated,swings:__stats.swings,hit:__stats.myHits,hand:document.querySelector('#hand-seg [aria-checked="true"]').dataset.hand}));
 assert.equal(after.calibrated,true);assert.equal(after.phase,'play');assert.equal(after.hand,'right');assert.ok(after.url.every(u=>!u.includes('8787')),'no helper bridge socket');assert.notDeepEqual(before.q,after.q,'original paddle orientation changes with sample replay');
 await page.screenshot({path:'test/ui-shots/original-client-phone.png'});
 await page.keyboard.press('Escape');await page.waitForSelector('#settings:not([hidden])');await page.click('#hand-seg [data-hand="left"]');
 const left=await page.evaluate(()=>({value:document.querySelector('#hand-seg [aria-checked="true"]').dataset.hand,saved:JSON.parse(localStorage.getItem('poddle.settings')).hand}));assert.deepEqual(left,{value:'left',saved:'left'});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,room,code,samples,before,after,left,errors}));
} catch(e) { const pg=pages[0]; console.error(JSON.stringify({error:e.message,errors,state:await pg.evaluate(()=>({screen:document.body.dataset.screen,lobby:window.__ui?.lobbyView(),name:document.querySelector('#name-input')?.value,title:document.title,body:document.body.innerText.slice(-2500),stats:window.__stats})).catch(()=>null)})); await pg.screenshot({path:'test/ui-shots/original-client-phone-failure.png'}); throw e; } finally {for(const t of timers)clearInterval(t);for(const p of phones)p.close();await browser.close()}
