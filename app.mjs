import { plan, readSheet, levels, townsToCounties, proposedFlow } from './plan.mjs';

const sheetId = '131JVvZgwZlpoWD2xL7hGprbRnEASKf1lR6ZFa2-V-MM';
const backend = 'https://riverwatch.aimeepink17.workers.dev';
const $ = id => document.getElementById(id);
const fmt = n => n === null ? 'Unavailable' : new Intl.NumberFormat('en-IE', { maximumFractionDigits: 2 }).format(n);
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const historyPromise = fetch('./history.json').then(r => { if (!r.ok) throw Error('Stored history unavailable'); return r.json(); });
const dateFmt = new Intl.DateTimeFormat('en-IE',{timeZone:'Europe/Dublin',dateStyle:'medium',timeStyle:'short'});
let sequence = 0;

async function get(url, format) {
  const r = await fetch(url, { cache:'no-store', signal:AbortSignal.timeout(15000) });
  if (!r.ok) throw Error('Source returned HTTP ' + r.status);
  return format === 'text' ? r.text() : r.json();
}
function forecastRows(rows, history, dates) {
  return history.map((h, i) => {
    const row = rows[i], days = row?.daily;
    if (!days || Math.abs(row.latitude-h.modelLatitude)>0.001 || Math.abs(row.longitude-h.modelLongitude)>0.001 || row.daily_units?.river_discharge !== 'm³/s') return null;
    const values = dates.map(date => days.river_discharge[days.time.indexOf(date)]);
    return values.every(v => Number.isFinite(v) && v >= 0) ? {dates,values} : null;
  });
}
function checkedWarnings(rows) {
  if (!Array.isArray(rows) || rows.some(w => w?.type === 'Rain' && w.status === 'Warning' &&
    (!Array.isArray(w.regions) || !Number.isFinite(Date.parse(w.onset)) || !Number.isFinite(Date.parse(w.expiry)) || !['yellow','orange','red'].includes(w.level)))) throw Error('Warning feed format changed');
  return rows;
}
async function load() {
  const ticket=++sequence, now=Date.now();
  $('refresh').disabled=true;
  $('status').textContent='Checking the Team Sheet, discharge forecast and official warnings…';
  try {
    const history = (await historyPromise).towns;
    const dates = [0,1,2].map(d => new Date(now+d*86400000).toISOString().slice(0,10));
    const query = new URLSearchParams({
      latitude:history.map(t=>t.requestLatitude).join(','), longitude:history.map(t=>t.requestLongitude).join(','),
      daily:'river_discharge', models:'seamless_v4', timezone:'GMT', forecast_days:'3'
    });
    const results=await Promise.allSettled([
      get('https://docs.google.com/spreadsheets/d/'+sheetId+'/export?format=csv&gid=0', 'text').then(csv=>readSheet(csv,history)),
      get('https://flood-api.open-meteo.com/v1/flood?'+query).then(rows=>forecastRows(rows,history,dates)),
      get('https://www.met.ie/Open_Data/json/warning_IRELAND.json').then(checkedWarnings)
    ]);
    const [sheet, forecasts, warnings]=results.map(r=>r.status==='fulfilled'?r.value:null);
    const problems=[];
    if (!sheet) problems.push('Team Sheet unavailable. Crew and town recommendations are paused.');
    if (!forecasts?.every(Boolean)) problems.push('One or more forecasts unavailable.');
    if (!warnings) problems.push('Official warning status unavailable. Flow-only levels are provisional.');
    const snapshot={history,sheet,forecasts,warnings,now,towns:sheet?plan(history,sheet,forecasts??history.map(()=>null),warnings,now):[]};
    if(ticket===sequence) render(snapshot,problems);
    return snapshot;
  } catch(error) {
    $('status').className='notice problem';
    $('status').textContent=error.message;
    return null;
  } finally { if(ticket===sequence) $('refresh').disabled=false; }
}
function reason(t){
  const flow=t.peak===null?'Forecast unavailable':fmt(t.peak)+' m³/s peak'+(t.flowOverride?' (rehearsal override)':'');
  const warning=t.entry.warning_override ? 'Rehearsal '+t.entry.warning_override+' warning' : t.warning===null?'Warning check unavailable':t.warning.length?t.warning.map(w=>w.level+' rain').join(', '):'No matching rain warning';
  return flow+' · '+warning;
}
function rank(history){return [...history].sort((a,b)=>b.eventTotal-a.eventTotal||a.town.localeCompare(b.town));}
function study(history) {
  const sorted=rank(history), leaders=sorted.filter(t=>t.eventTotal===sorted[0].eventTotal);
  return leaders.map(t=>t.town+' recorded '+t.eventTotal+' events. 2016/17–2019/20: '+t.firstFour+' events. 2021/22–2024/25: '+t.lastFour+' ('+(t.lastFour>t.firstFour?'more':t.lastFour<t.firstFour?'fewer':'same')+').').join(' ')+
    (leaders.length>1?' The towns are tied on event count.':'')+' The nine-winter total includes 2020/21. The four-winter comparison leaves it out. Event counts cannot show damage or existing defences. Ennis’s modelled discharge has a local validation caveat.';
}
function render(snapshot,problems){
  const {towns,history,now}=snapshot;
  $('status').className='notice'+(problems.length?' problem':'');
  $('status').textContent='Checked '+dateFmt.format(now)+' Dublin time. '+(problems.join(' ')||'Live sources available.');
  $('counts').innerHTML=levels.map((level,i)=>'<article class="card"><strong>'+towns.filter(t=>t.effective===i).length+'</strong><p>'+level+'</p></article>').join('');
  $('counts').hidden=!towns.length;
  $('towns').innerHTML=towns.length?towns.map(renderTown).join(''):'<div class="card">Town recommendations will appear once the live Team Sheet is accessible.</div>';
  $('crew-list').innerHTML=towns.length?['Clonmel','Mallow','Athlone'].map(crew=>'<article class="card"><h3>'+crew+'</h3><p>'+esc(towns.filter(t=>t.crew===crew).map(t=>t.town).join(', ')||'No barrier assignment')+'</p></article>').join(''):'<p class="muted">Crew assignments require the live Sheet.</p>';
  $('history-detail').innerHTML='<div class="card"><p>'+esc(study(history))+'</p><div class="table-wrap"><table><thead><tr><th>Town</th><th>p95 m³/s</th><th>p99 m³/s</th><th>All nine winters</th><th>2016/17–2019/20</th><th>2021/22–2024/25</th></tr></thead><tbody>'+rank(history).map(t=>'<tr><th scope="row">'+esc(t.town)+'</th><td>'+fmt(t.p95)+'</td><td>'+fmt(t.p99)+'</td><td>'+t.eventTotal+'</td><td>'+t.firstFour+'</td><td>'+t.lastFour+'</td></tr>').join('')+'</tbody></table></div></div>';
}
function renderTown(t){
  const name=t.effective===null?'Pending':levels[t.effective];
  const action=t.level===2&&!t.crew ? (t.entry.barrier_sets===0?'No barrier set available.':'No eligible crew slot.')+' Apply Standby measures and flag to Area Manager.' :
    t.crew?'Erect barriers before 18:00. Crew: '+t.crew+'.':t.effective===1?'Confirm staff on call, check pumps and stage sandbags.':'';
  const flow=t.forecast?.dates.map((d,i)=>d+' · '+fmt(t.forecast.values[i])+' m³/s').join(' | ')||'Unavailable';
  const warnings=t.warning?.map(w=>w.headline+' · '+dateFmt.format(Date.parse(w.onset))+' to '+dateFmt.format(Date.parse(w.expiry))).join(' | ');
  return '<details><summary><div class="title-line"><h3>'+esc(t.town)+'</h3><span class="badge '+name.toLowerCase()+'">'+name+'</span></div><p class="muted">'+esc(t.river+' · '+reason(t))+'</p></summary>'+
    '<p><b>Flow thresholds:</b> p95 '+fmt(t.p95)+' · p99 '+fmt(t.p99)+' m³/s. '+(t.base===null?'':'Flow level: '+levels[t.base]+'. ')+(t.uplift?'Orange or red rain rule applied.':'')+'</p>'+
    '<p><b>Forecast (GMT):</b> '+esc(flow)+'</p><p><b>Warning counties:</b> '+esc(townsToCounties[t.town].join(', '))+(warnings?' · '+esc(warnings):'')+'</p>'+
    (action?'<p><b>Action:</b> '+esc(action)+'</p>':'')+
    '<p><b>Sheet:</b> '+t.entry.barrier_sets+' barrier sets · '+t.entry.pumps+' pumps · '+t.entry.sandbags+' sandbags · '+t.entry.staff_on_call+' on call. '+esc(t.entry.notes)+'</p>'+
    (t.town==='Ennis'?'<p><b>Model caveat:</b> The mapped Fergus cell is supported geographically, but its discharge is low against local historical references.</p>':'')+'</details>';
}
$('refresh').addEventListener('click',load);
$('question').addEventListener('submit',async event=>{
  event.preventDefault();
  const button=event.submitter, question=$('prompt').value.trim();
  button.disabled=true; $('answer').textContent='Checking live sources…';
  try {
    const s=await load();
    if(!s) throw Error('The data could not be checked.');
    let verified, answerTowns;
    if(/\b(house|home|insurance|coastal|tidal|road closure)\b/i.test(question)) verified='This is outside the Flood Plan. Refer the question to the council’s Area Office.';
    else if(/study|permanent wall|most events/i.test(question)) verified=study(s.history);
    else if(/what if/i.test(question)){
      const town=s.history.find(t=>question.toLowerCase().includes(t.town.toLowerCase()))??(/\bsuir\b/i.test(question)?s.history[0]:null);
      const flow=proposedFlow(question);
      if(!town) verified='Name the town for the what-if.';
      else if(flow===null) verified='Enter a non-negative flow for '+town.town+'. For example: What if '+town.town+' reaches 150? River flow is in m³/s.';
      else if(!s.sheet) verified='The live Team Sheet is unavailable, so the what-if cannot be confirmed.';
      else {
        const sheet=s.sheet.map(t=>t.town===town.town?{...t,flow_override_m3s:String(flow)}:t);
        const t=plan(s.history,sheet,s.forecasts??s.history.map(()=>null),s.warnings,s.now).find(t=>t.town===town.town);
        verified='What-if for '+t.town+' · '+reason(t)+' · '+levels[t.effective]+'.'+(t.crew?' Crew: '+t.crew+'.':t.level===2?' Apply Standby measures and flag to Area Manager.':'')+(s.warnings===null?' Official warning check unavailable; result provisional.':'');
      }
    } else if(!s.sheet) verified='The live Team Sheet is unavailable, so the plan cannot be confirmed.';
    else {
      const town=s.towns.find(t=>question.toLowerCase().includes(t.town.toLowerCase()));
      if(!town && !/tonight|plan|crew/i.test(question)) verified='The tool can answer questions about tonight’s plan, a named town, flow what-ifs, or the flood-defence study.';
      else verified=(answerTowns=town?[town]:s.towns).map(t=>t.town+': '+(t.effective===null?'Pending':levels[t.effective])+'. '+reason(t)+' · p95 '+fmt(t.p95)+', p99 '+fmt(t.p99)+' m³/s.'+(t.crew?' Crew: '+t.crew+'.':t.level===2?' Barriers requested but '+(t.entry.barrier_sets?'no eligible crew slot.':'no barrier set.')+' Apply Standby measures and flag to the Area Manager.':'')).join('\n');
    }
    const answer = $('answer');
    if (answerTowns) {
      answer.innerHTML = '<h3>Plan results</h3><ul class="answer-towns">'+answerTowns.map(t=>{
        const level=t.effective===null?'Pending':levels[t.effective];
        const action=t.crew?'Crew: '+t.crew : t.level===2?'Standby measures · Flag to Area Manager' : '';
        return '<li><div class="title-line"><strong>'+esc(t.town)+'</strong><span class="badge '+level.toLowerCase()+'">'+level+'</span></div>'+
          '<p>'+esc(reason(t))+'</p><p class="muted">p95 '+fmt(t.p95)+' · p99 '+fmt(t.p99)+' m³/s</p>'+
          (action?'<p>'+esc(action)+'</p>':'')+'</li>';
      }).join('')+'</ul>';
    } else answer.textContent=verified;
    if(backend && !verified.startsWith('Enter a non-negative flow')){
      try{
        const r=await fetch(backend+'/explain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,verified}),signal:AbortSignal.timeout(20000)});
        if(!r.ok) throw Error();
        const x=await r.json();
        const panel=document.createElement('section');
        panel.className='answer-ai';
        panel.innerHTML='<h3>AI explanation</h3>'+x.answer.trim().split(/\n+/).map(block=>
          '<p>'+esc(block).replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')+'</p>').join('')+
          '<p class="answer-usage">'+esc('OpenAI '+x.model+' · '+x.input+' input / '+x.output+' billed output tokens')+'</p>';
        answer.append(panel);
      }catch{ answer.insertAdjacentHTML("beforeend", '<p class="answer-ai">OpenAI explanation unavailable.</p>'); }
    }
  }catch(error){ $('answer').textContent=error.message; }
  finally{button.disabled=false;}
});
load();
