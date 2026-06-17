import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const APP = 'http://localhost:5174/#runner';
const PORT = 9244;
const OUT = 'docs/run-new-preview';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const profile = '/tmp/wedding-shot-chrome';
fs.rmSync(profile, { recursive: true, force: true });
const args = ['--headless=new','--disable-gpu',`--remote-debugging-port=${PORT}`,'--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,'about:blank'];
spawn('/bin/zsh', ['-lc', `open -n -a 'Google Chrome' --args ${args.map(a=>`'${a}'`).join(' ')}`], { stdio:'ignore' });

async function getTarget(){
  for(let i=0;i<40;i++){ try{ const r=await fetch(`http://localhost:${PORT}/json/new?about:blank`,{method:'PUT'}); if(r.ok) return r.json(); }catch{} await sleep(250);} throw new Error('no chrome');
}
const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let id=0;
ws.onmessage = e => { const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){pending.get(m.id)(m.result);pending.delete(m.id);} };
await new Promise(r=>ws.onopen=r);
const send=(method,params={})=>new Promise(res=>{const cid=++id;pending.set(cid,res);ws.send(JSON.stringify({id:cid,method,params}));});

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
ws.addEventListener('message', e=>{const m=JSON.parse(e.data); if(m.method==='Log.entryAdded'){const x=m.params.entry; if(x.level==='error'||/load|error|404/i.test(x.text)) console.log('LOG>',x.level,x.text);} if(m.method==='Runtime.consoleAPICalled'){console.log('CON>',m.params.args.map(a=>a.value).join(' '));}});
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
await send('Page.navigate',{url:APP});
await send('Runtime.evaluate',{expression:`new Promise((res)=>{ if(window.__ready)return res(1); window.addEventListener('wedding-game-ready',()=>res(1),{once:true}); setTimeout(()=>res(0),40000); })`,awaitPromise:true});
await sleep(1500); // let RunnerScene mount + run anim play a beat
for(let i=0;i<6;i++){
  const img=await send('Page.captureScreenshot',{format:'png',fromSurface:true});
  fs.writeFileSync(`${OUT}/ingame-${i}.png`,Buffer.from(img.data,'base64'));
  await sleep(95); // ~ one run frame at 11fps
}
console.log('saved ingame-0..5 to', OUT);
spawnSync('pkill',['-f',profile]);
process.exit(0);
