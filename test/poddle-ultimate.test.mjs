import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import WebSocket from 'ws';

const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, ms = 6000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return; await wait(4); } assert.ok(fn(), label); }
async function freePort() { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }

for (const mode of ['1v1', '2v2']) test(`${mode}: ultimates earn charge through legal shots, activate by team and expire without changing shot faults`, async t => {
  const port = await freePort(), clients = [], out = [], capacity = mode === '2v2' ? 4 : 2;
  const child = spawn(process.execPath, ['server/game.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), PODDLE_DB: ':memory:', ULTIMATES: '1', AUTOBOT: '0', SWING_SERVE: '1', BLOCK: '0', WIN_AT: '0', READY_S: '0', STAMP_S: '0', TIMESCALE: '3' } });
  child.stdout.on('data', d => out.push(String(d))); child.stderr.on('data', d => out.push(String(d)));
  t.after(() => { clients.forEach(c => c.ws.terminate()); child.kill(); });
  await until(() => out.some(v => v.includes('game server on port')), 'server starts');
  for (let i = 0; i < capacity; i++) {
    const c = { ws: new WebSocket(`ws://127.0.0.1:${port}/?lobby=1&cid=ult-${mode}-${i}`), log: [] }; clients.push(c);
    c.send = m => c.ws.send(JSON.stringify(m)); c.ws.on('error', () => {});
    c.ws.on('message', d => { const m = JSON.parse(d); c.log.push(m); if (m.type === 'state') c.st = m; if (m.type === 'welcome') c.welcome = m; if (m.type === 'room') c.room = m; });
    await until(() => c.log.some(m => m.type === 'lobby'), 'lobby');
    c.send(i ? { type: 'join', code: clients[0].room.code } : { type: 'create', mode, public: false });
    await until(() => c.welcome, 'seat'); c.send({ type: 'paddle', auto: true, q: [0, 0, 0, 1], r: 10 });
  }
  const host = clients[0], swings = (c, extra = {}) => c.send({ type: 'swing', power: 20, dir: 0, aimX: 0, lob: 0, slice: 0, rom: 60, off: 30, back: .8, raw: 20, final: true, src: 'phone', pk: 12, ...extra });
  await until(() => host.st?.ultimates, 'charge metadata');
  assert.deepEqual(host.st.ultimates.charges, Array(capacity).fill(0));
  host.send({ type: 'ultimate', kind: 'boost' }); await wait(30);
  assert.equal(host.log.filter(m => m.type === 'ultimate').length, 0, 'an unearned ultimate cannot activate');
  async function rally(extra = {}) {
    await until(() => host.st?.live && host.st.serving != null, 'next reachable serve');
    const start = host.log.length, seat = host.st.serving; swings(clients[seat], extra);
    await until(() => host.log.slice(start).some(m => m.type === 'point'), 'point resolves');
    await wait(12);
    return { seat, point: host.log.slice(start).find(m => m.type === 'point'), events: host.log.slice(start) };
  }
  for (const [extra, reason] of [[{ power: 34 }, 'out'], [{ power: 12.6 }, 'net']]) {
    const r = await rally(extra); assert.equal(r.point.why, reason);
    assert.deepEqual(host.st.ultimates.charges, Array(capacity).fill(0), 'faults cannot farm ultimate charge');
  }
  const guessed = await rally({ power: 34, final: false });
  assert.ok(['double bounce', 'passed'].includes(guessed.point.why), 'the capped prediction may still release a legal fallback shot');
  assert.equal(guessed.point.winner, guessed.seat % 2, 'the unmeasured fallback actually lands legally and wins the unreturned point');
  assert.equal(guessed.events.find(m => m.type === 'hit').n, .76);
  assert.ok(guessed.events.some(m => m.type === 'bounce'), 'charge remains zero after a real legal bounce');
  assert.deepEqual(host.st.ultimates.charges, Array(capacity).fill(0), 'an unmeasured orange prediction earns no charge after its timeout');
  // Keep the other doubles lanes physically away. The two active players must
  // build their own streak by genuinely returning the moving ball five times.
  if (capacity === 4) for (const seat of [2, 3]) clients[seat].send({ type: 'paddle', auto: false, x: seat === 2 ? 4 : -4, y: 1, z: 9, q: [0, 0, 0, 1] });
  async function startOrange() {
    for (let i = 0; i <= capacity; i++) {
      await until(() => host.st?.live && host.st.serving != null, 'orange serve');
      if (host.st.serving === 0) break;
      assert.ok(i < capacity, 'service rotates back to the first player');
      await rally({ power: 12.6 });
    }
    if (capacity === 4) for (const seat of [2, 3]) clients[seat].send({ type: 'paddle', auto: false, x: seat === 2 ? 4 : -4, y: 1, z: 9, q: [0, 0, 0, 1] });
    const count = host.log.filter(m => m.type === 'hit').length;
    swings(host, { power: 26 });
    await until(() => host.log.filter(m => m.type === 'hit').length > count, 'orange serve hit');
  }
  async function returnShot(power = 26, extra = {}) {
    const pointCount=host.log.filter(m=>m.type==='point').length;
    await until(() => {
      const ended=host.log.filter(m=>m.type==='point');
      assert.equal(ended.length,pointCount,'the same legal rally must continue; do not count the next automatic serve: '+JSON.stringify(ended.at(-1)));
      const last=host.log.filter(m=>m.type==='hit').at(-1), s = host.st, p = s?.paddles[s.turn], sign = s?.turn % 2 ? -1 : 1;
      const ahead = p ? -(s.p[2] - p.z) * sign : 99;
      return s?.live && s.serving == null && s.b === 1 && p && last && s.turn%2!==last.side%2 && s.v[2]*sign>0 && ahead > .15 && ahead < 1.35 && Math.abs(s.p[0] - p.x) < 1.5 && Math.abs(s.p[1] - p.y) < .9;
    }, 'genuine front contact');
    const seat = host.st.turn, count = host.log.filter(m => m.type === 'hit').length;
    swings(clients[seat], { power, ...extra });
    await until(() => {assert.equal(host.log.filter(m=>m.type==='point').length,pointCount,'a reported orange contact cannot be replaced by a new point serve');return host.log.filter(m => m.type === 'hit').length > count;}, 'return releases once');
    assert.equal(host.log.filter(m=>m.type==='hit').at(-1).side,seat,'the requested receiving player actually returns this ball');
    return seat;
  }
  await startOrange(); await returnShot(); await returnShot();
  await until(() => host.st.ultimates.charges[0] >= 1 && host.st.ultimates.charges[1] >= 1, 'orange hits advance both streaks');
  const predictedSeat = await returnShot(34, { final: false });
  assert.equal(host.log.filter(m => m.type === 'hit').at(-1).n, .76, 'the missing final actually exercises the orange-capped prediction');
  await until(() => host.st.ultimates.charges[predictedSeat] === 0, 'an unmeasured timeout resets an unfinished measured streak');
  const softSeat = await returnShot(20);
  await until(() => host.st.ultimates.charges[softSeat] === 0, 'weaker hit resets the consecutive streak');
  const hardSeat = await returnShot(34);
  await until(() => host.log.at(-1)?.type === 'point' || !host.st.live, 'hardest hit faults');
  assert.equal(host.st.ultimates.charges[hardSeat], 0, 'the hardest tier resets the streak');
  await startOrange();
  for (let i = 0; i < 14 && !(host.st.ultimates.charges[0] === 5 && host.st.ultimates.charges[1] === 5); i++) {
    await returnShot();
    console.log(JSON.stringify({ mode, return: i, charge: host.st.ultimates.charges }));
  }
  await until(() => host.st.ultimates.charges[0] === 5 && host.st.ultimates.charges[1] === 5, 'five consecutive legal orange hits unlock both ultimates');
  await until(() => !host.st.live, 'completed charge rally');
  assert.ok(host.st.ultimates.charges.every(n => n <= 5), 'earned charge caps at five');
  host.send({ type: 'ultimate', kind: 'bogus' }); await wait(20);
  assert.equal(host.log.filter(m => m.type === 'ultimate').length, 0, 'only the two supported abilities can spend charge');
  for(let seat=0;seat<capacity;seat+=2)clients[seat].send({type:'paddle',auto:false,x:0,y:1,z:8.4,hand:'right',q:[0,0,0,1],r:10});
  await until(()=>host.st.paddles.filter((_,i)=>i%2===0).every(p=>Math.abs(p.z)>8.3),'receivers start far from the wide landing');
  host.send({ type: 'ultimate', kind: 'boost' });
  await until(() => host.st.ultimates.charges[0] === 0 && host.st.paddles[0].ultimate.boost > 0, 'boost activates');
  assert.ok(host.st.paddles.filter((_, i) => i % 2 === 0).every(p => p.ultimate.boost > 0), 'boost helps the whole own team');
  assert.ok(host.st.paddles.filter((_,i)=>i%2===0).every(p=>p.ultimate.swingRate===1.35),'speedup changes the actual swing rate');
  assert.ok(host.st.paddles.filter((_, i) => i % 2 === 1).every(p => p.ultimate.boost === 0), 'boost cannot buff the opponent');
  host.send({ type: 'ultimate', kind: 'boost' }); await wait(20);
  assert.equal(host.log.filter(m => m.type === 'ultimate').length, 1, 'charge is spent once');
  clients[1].send({ type: 'ultimate', kind: 'slow' });
  await until(() => host.st.ultimates.charges[1] === 0 && host.st.paddles[0].ultimate.slow > 0, 'opponent slowdown activates');
  assert.ok(host.st.paddles.filter((_, i) => i % 2 === 0).every(p => p.ultimate.slow > 0), 'slow affects the opposing team');
  assert.ok(host.st.paddles.filter((_, i) => i % 2 === 1).every(p => p.ultimate.slow === 0), 'slow leaves its caster team alone');
  assert.ok(host.st.paddles.filter((_,i)=>i%2===0).every(p=>Math.abs(p.ultimate.swingRate-1.35*.45)<1e-9),'slowdown also weakens the swing, including an already boosted team');
  for(let seat=0;seat<capacity;seat+=2)clients[seat].send({type:'paddle',auto:true,hand:'right',q:[0,0,0,1],r:10});
  const u = host.log.filter(m => m.type === 'ultimate');
  assert.deepEqual(u.map(m => [m.side, m.kind, m.targetTeam]), [[0, 'boost', 0], [1, 'slow', 0]]);
  // Serve into the distant left lane while the receiving team is slowed. Keep
  // sending physically matching strokes while the ball remains in front: the
  // inability to return must come from actual travel, not a missed test input.
  host.send({type:'paddle',auto:true,hand:'right',q:[0,0,0,1],r:10});
  await until(()=>host.st?.live&&host.st.serving===1,'opponent wide serve');
  const beforeWide=host.log.length;swings(clients[1],{aimX:1});let attempts=0;
  const strokeTimer=setInterval(()=>{
    const s=host.st,p=s?.paddles[0];if(!s?.live||s.serving!=null||s.v[2]<=0||s.p[2]>=p.z)return;
    const wing=s.p[0]-(p.x-.5)<-.2?'backhand':'forehand';swings(host,{wing});attempts++;
  },18);
  try{await until(()=>host.log.slice(beforeWide).some(m=>m.type==='point'),'slowed team misses distant shot');}finally{clearInterval(strokeTimer);}
  const wideEvents=host.log.slice(beforeWide),widePoint=wideEvents.find(m=>m.type==='point');
  if(widePoint.winner!==1)console.log(JSON.stringify({mode,failedWideProbe:wideEvents.filter(m=>m.type!=='state'),paddles:host.st.paddles}));
  assert.ok(attempts>0);assert.equal(widePoint.winner,1);assert.ok(['double bounce','passed'].includes(widePoint.why));
  assert.equal(wideEvents.filter(m=>m.type==='hit').length,1,'slowed movement never reaches the wide ball despite matching swings');
  const frontStates=wideEvents.filter(s=>s.type==='state'&&s.live&&s.serving==null&&s.v[2]>0&&s.paddles[0].z-s.p[2]>0&&s.paddles[0].z-s.p[2]<1.6);
  assert.ok(frontStates.length>0&&frontStates.every(s=>Math.abs(s.p[0]-s.paddles[0].x)>1.15+.5*1.35*.45),'while the ball is physically in front, the slowed player remains beyond the measured swing reach');
  const moving=wideEvents.filter(s=>s.type==='state'&&s.live&&s.serving==null&&s.paddles[0].ultimate.slow>0);
  for(let i=1;i<moving.length;i++)assert.ok(Math.abs(moving[i].paddles[0].x-moving[i-1].paddles[0].x)<=5.5*.12*(moving[i].t-moving[i-1].t)+.001,'actual running speed is reduced by 88%');
  console.log(JSON.stringify({mode,slowedWideMiss:true,matchingAttempts:attempts,movementRate:.12,swingRate:1.35*.45}));
  const measured=await rally({power:34,gain:999,swingRate:999});
  const altered=measured.events.find(m=>m.type==='hit');
  assert.ok(altered.force<.7&&altered.force>.5,'server-owned swing slowdown changes actual outgoing force once; clients cannot spoof it');
  await until(() => host.st.paddles.every(p => p.ultimate.boost === 0 && p.ultimate.slow === 0), 'both six-second effects expire');
  assert.ok(host.st.paddles.every(p=>p.ultimate.swingRate===1));
  assert.ok(host.st.ultimates.charges.every(n => n >= 0 && n <= 5));
  // Paired phone transport carries only supported actions and bounded status.
  const code = mode === '1v1' ? 'ACFH' : 'BCFK'; host.send({ type: 'padcode', code });
  const phone = { ws: new WebSocket(`ws://127.0.0.1:${port}/?padfor=${code}`), log: [] }; clients.push(phone);
  phone.ws.on('error', () => {}); phone.ws.on('message', d => phone.log.push(JSON.parse(d)));
  await until(() => phone.log.some(m => m.type === 'padhost' && m.on), 'paired phone');
  host.send({ type: 'ultimateState', charge: 99, need: 99, boost: 99, slow: -2, enabled: true, available: true });
  await until(() => phone.log.some(m => m.type === 'ultimateState'), 'phone status relay');
  assert.deepEqual(phone.log.find(m => m.type === 'ultimateState'), { type: 'ultimateState', charge: 5, need: 5, boost: 6, slow: 0, enabled: true, available: true });
  const before = host.log.length;
  phone.ws.send(JSON.stringify({ type: 'ultimate', kind: 'slow', targetTeam: 99 }));
  await until(() => host.log.slice(before).some(m => m.type === 'ultimate'), 'phone action relay');
  assert.deepEqual(host.log.slice(before).find(m => m.type === 'ultimate'), { type: 'ultimate', kind: 'slow' });
  console.log(JSON.stringify({ mode, requiredStreak: 5, ultimates: u.map(m => m.kind), faultsPreserved: true }));
});
