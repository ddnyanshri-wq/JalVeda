// JalVeda dashboard. Three modes: demo (simulator) / serial (real Arduino over USB) / hardware (Flask backend).
const $=id=>document.getElementById(id);
const LOCS={Nashik:[19.9975,73.7898],Pune:[18.5204,73.8567],Mumbai:[19.076,72.8777],Nagpur:[21.1458,79.0882],Delhi:[28.6139,77.209]};
const DEF={dry:30,target:60,wet:80,maxSec:120};
// Sensor calibration: put sensor in air -> RAW_DRY, in water -> RAW_WET (check Serial Monitor numbers)
const RAW_DRY=700, RAW_WET=300;
const MODE=new URLSearchParams(location.search).get('mode');
let S={mode:MODE==='hardware'?'hardware':MODE==='serial'?'serial':'demo',
 connected:true,moisture:42,pump:'OFF',auto:true,lastStart:null,lastStop:null,todaySec:0,irrig:[],events:[],hist:[],cfg:{...DEF}};
if(S.mode==='serial'){S.connected=false;S.moisture=0;S.pump='UNKNOWN';}
let W=null,loc='Nashik',forceRain=false,evId=1e6,first=true;const shown=new Set();
const fmt=t=>t?new Date(t).toLocaleTimeString():'—';
const dur=s=>s>=60?Math.floor(s/60)+'m '+Math.round(s%60)+'s':Math.round(s)+'s';
function ev(type,msg){S.events.unshift({id:++evId,ts:Date.now(),type,msg});S.events=S.events.slice(0,40);}

// ---------- Weather (Open-Meteo, no API key) ----------
async function loadWeather(){
 const [la,lo]=LOCS[loc];
 try{const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&current=temperature_2m,relative_humidity_2m,weather_code&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,precipitation&forecast_hours=24&timezone=auto`);
  const j=await r.json();W={sample:false,t:j.current.temperature_2m,h:j.current.relative_humidity_2m,code:j.current.weather_code,
   times:j.hourly.time.map(x=>x.slice(11,16)),temp:j.hourly.temperature_2m,hum:j.hourly.relative_humidity_2m,rain:j.hourly.precipitation_probability,mm:j.hourly.precipitation};
 }catch(e){ // offline fallback, clearly labelled as sample data
  const n=[...Array(24).keys()];W={sample:true,t:29,h:55,code:2,times:n.map(i=>String(i).padStart(2,'0')+':00'),temp:n.map(i=>27+4*Math.sin(i/4)),hum:n.map(i=>55+10*Math.cos(i/5)),rain:n.map(i=>i>8&&i<12?70:10),mm:n.map(i=>0)};}
 render();
}
const icon=c=>c===0?'☀️':c<=3?'⛅':c<=48?'🌫️':c<=67?'🌧️':c<=77?'❄️':c<=82?'🌦️':'⛈️';

// ---------- Pump start/stop (shared by demo + serial) ----------
function start(reason){S.pump='ON';S.lastStart=Date.now();if(S.mode==='serial')sendCmd('ON');ev('ok','💧 Irrigation Started — '+reason);}
function stop(msg,type='ok'){const now=Date.now();S.irrig.unshift({start:S.lastStart,stop:now,sec:(now-S.lastStart)/1000});S.irrig=S.irrig.slice(0,10);
 S.pump='OFF';S.lastStop=now;if(S.mode==='serial')sendCmd('OFF');ev(type,msg);}

// ---------- Control rules (same for demo + serial) ----------
function control(){
 const c=S.cfg,now=Date.now();
 if(S.pump==='ON'){
  if(S.moisture>=c.wet)stop('⚠️ Soil moisture is high — Watering disabled.','warn');
  else if(S.moisture>=c.target)stop('✅ Irrigation Completed — Target moisture reached.');
  else if((now-S.lastStart)/1000>=c.maxSec)stop('⏱️ Maximum watering time reached — pump stopped.','warn');
 }else if(S.auto){
  const m=S.moisture;
  if(m>=c.dry){S.delayStart=null;return;}            // only consider watering below the dry threshold
  if(S.lastStop&&now-S.lastStop<20000)return;        // minimum OFF time (hysteresis)
  const rain=Math.max(forceRain?90:0,...(W?W.rain.slice(0,3):[0]));
  if(rain>=60&&m>10){                                // rain soon + not urgent -> delay (max 60 s)
   if(!S.delayStart){S.delayStart=now;ev('info','🌧️ Rain Expected — Irrigation temporarily paused.');}
   if(now-S.delayStart<60000)return;                 // never delay forever
  }
  S.delayStart=null;start('Soil moisture is low.');
 }
}

// ---------- DEMO simulator ----------
function demoTick(){
 const now=Date.now();
 if(S.pump==='ON'){S.moisture+=1.6+Math.random()*.6;S.todaySec+=2;}else S.moisture-=.5+Math.random()*.3;
 S.moisture=Math.max(0,Math.min(100,S.moisture));
 S.hist.push({t:now,m:S.moisture});S.hist=S.hist.slice(-90);
 control();
}

// ---------- SERIAL mode: real Arduino over USB (Web Serial, desktop Chrome/Edge) ----------
let writer=null,lastRead=0;
const enc=new TextEncoder();
function sendCmd(t){if(writer)writer.write(enc.encode(t+'\n')).catch(()=>{});}
function rawToPct(raw){return Math.max(0,Math.min(100,Math.round((raw-RAW_DRY)/(RAW_WET-RAW_DRY)*100)));}
function onSerialLine(l){
 const raw=parseInt(l.split(',')[0]);if(isNaN(raw))return;
 const now=Date.now(),dt=lastRead?Math.min(5,(now-lastRead)/1000):0;lastRead=now;
 S.connected=true;S.moisture=rawToPct(raw);
 if(S.pump==='ON'){S.todaySec+=dt;sendCmd('ON');}   // keep-alive: Arduino turns pump off if this stops
 S.hist.push({t:now,m:S.moisture});S.hist=S.hist.slice(-90);
 control();render();
}
async function connectSerial(){
 if(!('serial' in navigator)){alert('Web Serial sirf desktop Chrome/Edge me chalta hai.');return;}
 try{
  const port=await navigator.serial.requestPort();
  await port.open({baudRate:9600});
  writer=port.writable.getWriter();
  S.connected=true;S.pump='OFF';sendCmd('OFF');ev('ok','🔌 Arduino connected.');render();
  const reader=port.readable.pipeThrough(new TextDecoderStream()).getReader();
  let buf='';
  while(true){
   const {value,done}=await reader.read();if(done)break;
   buf+=value;const lines=buf.split('\n');buf=lines.pop();
   lines.forEach(onSerialLine);
  }
 }catch(e){console.error(e);}
 writer=null;S.connected=false;S.pump='UNKNOWN';ev('err','🔌 Device Offline — Arduino disconnected.');render();
}

// ---------- Hardware mode: talk ONLY to the Flask backend ----------
async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error((await r.json()).error||r.status);return r.json();}
async function hwPoll(){
 try{const d=await api('/api/status');S={...S,...d,mode:'hardware',backendDown:false};}
 catch(e){if(!S.backendDown)ev('err','🔌 Device Offline — Displaying last available readings.');S.backendDown=true;S.connected=false;S.pump='UNKNOWN';}
}
async function action(path,body){
 if(S.mode==='hardware'){try{await api(path,body);await hwPoll();}catch(e){ev('err','❌ '+e.message);}render();}
}

// ---------- Rendering ----------
function render(){
 const c=S.cfg,m=S.moisture,hw=S.mode==='hardware',ser=S.mode==='serial',un=S.pump==='UNKNOWN'||!S.connected;
 $('banner').className=(hw||ser)?(S.connected?'hw':'err'):'';
 $('banner').textContent=ser?(S.connected?'LIVE MODE — real readings from Arduino (USB)':'LIVE MODE — click "Connect Arduino" (desktop Chrome/Edge)')
  :!hw?'DEMO MODE — NOT CONNECTED TO HARDWARE.':S.connected?'HARDWARE MODE — live data from Arduino':'HARDWARE MODE — device offline, showing last readings';
 $('conn').textContent=S.connected?'● Connected':'● Offline';$('conn').className='pill '+(S.connected?'ok':'bad');
 $('modeBtn').textContent=S.mode==='demo'?'Switch to Live (USB)':'Switch to Demo';
 $('serialBtn').style.display=ser?'':'none';
 $('tagM').textContent=$('tagC').textContent=hw?'HARDWARE':ser?'LIVE':'SIMULATED';
 $('ring').style.strokeDashoffset=326.7*(1-(m||0)/100);$('mval').textContent=Math.round(m)+'%';
 const cond=m<c.dry?'Dry':m>=c.wet?'Wet':'Optimal';$('cond').textContent=cond;$('cond').className='pill '+(cond==='Optimal'?'ok':'bad');
 $('pump').textContent=un?'UNKNOWN ❓':S.pump==='ON'?'ON 💧':'OFF';
 $('temp').textContent=W?W.t+' °C':'--';$('hum').textContent=W?W.h+' %':'--';
 $('wx').textContent=W?icon(W.code)+(W.sample?' (sample)':''):'--';$('rainp').textContent=W?Math.max(forceRain?90:0,W.rain[0])+' %':'--';
 $('last').textContent=S.lastStart?fmt(S.lastStart)+' → '+(S.pump==='ON'?'running':fmt(S.lastStop)):'—';
 $('today').textContent=dur(S.todaySec);$('modeTxt').textContent=S.auto?'Automatic':'Manual';
 $('autoBtn').className=S.auto?'active':'ghost';$('manBtn').className=S.auto?'ghost':'active';
 $('pumpBtn').textContent=S.pump==='ON'?'Stop pump':'Start pump';$('pumpBtn').disabled=S.auto||!S.connected;
 $('estop').disabled=(hw||ser)&&!S.connected;
 document.querySelectorAll('.demoOnly').forEach(e=>e.style.display=(hw||ser)?'none':'');
 $('irrig').innerHTML=S.irrig.map(i=>`<li>${fmt(i.start)} → ${fmt(i.stop)} (${dur(i.sec)})</li>`).join('')||'<li>No irrigation yet</li>';
 $('notif').innerHTML=S.events.map(e=>`<li><b>${fmt(e.ts)}</b> — ${e.msg}</li>`).join('')||'<li>No notifications</li>';
 S.events.slice().reverse().forEach(e=>{if(!shown.has(e.id)){shown.add(e.id);if(!first)toast(e);}});first=false;
 charts();
}
function toast(e){const d=document.createElement('div');d.className='toast '+e.type;d.textContent=e.msg;$('toasts').appendChild(d);setTimeout(()=>d.remove(),5500);}
let cm,cf;
function charts(){
 const h=S.hist,L=h.map(p=>new Date(p.t).toLocaleTimeString());
 const ds=[{label:'Soil moisture %',data:h.map(p=>p.m),borderColor:'#2e7d4f',backgroundColor:'#a8e6a155',fill:true,tension:.3},
  {label:'Dry',data:h.map(()=>S.cfg.dry),borderColor:'#c0392b',borderDash:[5,5],pointRadius:0},
  {label:'Target',data:h.map(()=>S.cfg.target),borderColor:'#4aa8d8',borderDash:[5,5],pointRadius:0}];
 if(!cm)cm=new Chart($('chartM'),{type:'line',data:{labels:L,datasets:ds},options:{animation:false,scales:{y:{min:0,max:100}}}});
 else{cm.data.labels=L;cm.data.datasets=ds;cm.update();}
 if(!W)return;
 const fd=[{label:'Temp °C',data:W.temp,borderColor:'#e67e22',type:'line'},{label:'Humidity %',data:W.hum,borderColor:'#4aa8d8',type:'line'},
  {label:'Rain probability %',data:W.rain,backgroundColor:'#4aa8d888',type:'bar'}];
 if(!cf)cf=new Chart($('chartF'),{data:{labels:W.times,datasets:fd},options:{scales:{y:{min:0}}}});
 else{cf.data.labels=W.times;cf.data.datasets=fd;cf.update();}
}

// ---------- Buttons ----------
$('autoBtn').onclick=()=>{S.auto=true;S.mode==='hardware'?action('/api/auto',{auto:true}):render();};
$('manBtn').onclick=()=>{S.auto=false;S.mode==='hardware'?action('/api/auto',{auto:false}):render();};
$('pumpBtn').onclick=()=>{
 if(S.mode==='hardware')return action(S.pump==='ON'?'/api/pump/off':'/api/pump/on',{});
 if(S.pump==='ON')stop('✅ Irrigation stopped manually.');
 else if(S.moisture>=S.cfg.wet)ev('warn','⚠️ Soil moisture is high — Watering disabled.');
 else start('Manual start.');render();};
$('estop').onclick=()=>{if(S.mode==='hardware')return action('/api/pump/stop',{});
 if(S.pump==='ON')stop('🛑 EMERGENCY STOP — pump off, auto mode disabled.','err');
 if(S.mode==='serial')sendCmd('OFF');S.auto=false;render();};
$('rainBtn').onclick=()=>{forceRain=!forceRain;ev('info',forceRain?'Demo: rain forecast ON':'Demo: rain forecast OFF');render();};
$('saveCfg').onclick=()=>{const c={dry:+$('cDry').value,target:+$('cTarget').value,wet:+$('cWet').value,maxSec:+$('cMax').value};
 if(!(c.dry<c.target&&c.target<c.wet&&c.wet<=100&&c.maxSec>0))return alert('Need: dry < target < wet ≤ 100, and max seconds > 0');
 if(S.mode==='hardware')action('/api/config',c);else{S.cfg=c;render();}};
$('modeBtn').onclick=()=>{location.search=S.mode==='demo'?'?mode=serial':'';};
$('serialBtn').onclick=connectSerial;
$('locSel').innerHTML=Object.keys(LOCS).map(k=>`<option>${k}</option>`).join('');
$('locSel').onchange=e=>{loc=e.target.value;loadWeather();if(S.mode==='hardware')api('/api/config',{lat:LOCS[loc][0],lon:LOCS[loc][1]}).catch(()=>{});};

// ---------- Start ----------
$('cDry').value=S.cfg.dry;$('cTarget').value=S.cfg.target;$('cWet').value=S.cfg.wet;$('cMax').value=S.cfg.maxSec;
loadWeather();setInterval(loadWeather,15*60*1000);
if(S.mode==='demo'){for(let i=0;i<30;i++){S.moisture+=(i%3?-.4:.2);S.hist.push({t:Date.now()-(30-i)*2000,m:S.moisture});}setInterval(()=>{demoTick();render();},2000);}
else if(S.mode==='hardware')setInterval(async()=>{await hwPoll();render();},2000);
render();
