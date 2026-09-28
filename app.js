const cfg=window.GJR_CONFIG||{};
const app=document.getElementById('app');
const configured=!!(cfg.supabaseUrl&&cfg.supabaseAnonKey);
const sb=configured?window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey):null;
let session=null, me=null, council=null, state={};
let activeView='dashboard', activeThread=null;

document.addEventListener('click',function(e){
  const nav=e.target.closest('[data-view]');
  if(nav){activeView=nav.dataset.view;renderShell();return;}
});

boot();

async function boot(){
  if(!configured){renderSetup();return;}
  const res=await sb.auth.getSession();
  session=res.data.session;
  if(!session){renderLogin();return;}
  await loadMe();
  if(!me){renderLogin('Your account exists, but a Hub profile could not be loaded.');return;}
  await loadAll();
  subscribeMessages();
  renderShell();
}

function renderSetup(){
  app.innerHTML='<div class="login-shell"><section class="login-card"><div class="login-brand"><div class="login-logo">GJR</div><div><strong>GJR S\'gan Hub</strong><span class="muted">Account setup</span></div></div><div class="eyebrow">SUPABASE CONNECTION</div><h1>Almost ready.</h1><p>The Hub code is live, but it still needs the Supabase project URL and public anon key in <b>config.js</b>. The database schema is already included in <b>supabase.sql</b>.</p><div class="status-line" style="margin-top:18px">Once connected, the first person to create an account becomes <b>CCAZA S\'gan NOAH ALTER</b>.</div></section></div>';
}

function renderLogin(message){
  app.innerHTML='<div class="login-shell"><section class="login-card"><div class="login-brand"><div class="login-logo">GJR</div><div><strong>GJR S\'gan Hub</strong><span class="muted">Greater Jersey Region leadership</span></div></div><div class="eyebrow">SECURE ACCESS</div><h1>Welcome back.</h1><p>Sign in to your S\'gan workspace, schedule, messages, and chapter tools.</p><form id="loginForm" class="login-form"><label>Email<input id="loginEmail" type="email" required></label><label>Password<input id="loginPassword" type="password" required></label><button class="primary" type="submit">Sign in</button><div id="loginStatus" class="status-line">'+esc(message||'')+'</div></form></section></div>';
  document.getElementById('loginForm').onsubmit=async function(e){
    e.preventDefault();setStatus('Signing in...');
    const r=await sb.auth.signInWithPassword({email:v('loginEmail'),password:v('loginPassword')});
    if(r.error){setStatus(r.error.message);return;}
    session=r.data.session;await loadMe();await loadAll();subscribeMessages();renderShell();
  };
}
function setStatus(t){const x=document.getElementById('loginStatus');if(x)x.textContent=t}
function v(id){const e=document.getElementById(id);return e?e.value.trim():''}

async function loadMe(){
  if(!session)return;
  let r=await sb.from('profiles').select('*,councils(*)').eq('id',session.user.id).maybeSingle();
  if(!r.data){
    const b=await sb.rpc('bootstrap_admin_profile');
    if(!b.error)r=await sb.from('profiles').select('*,councils(*)').eq('id',session.user.id).maybeSingle();
  }
  me=r.data||null;council=me&&me.councils?me.councils:null;
}

async function loadAll(){
  const cid=me.council_id;
  const today=iso(new Date());
  const queries=[
    sb.from('profiles').select('id,display_name,role,council_id'),
    sb.from('councils').select('*').order('name'),
    sb.from('counterparts').select('*').order('name'),
    sb.from('check_templates').select('*').eq('active',true).or('until_date.is.null,until_date.gte.'+today),
    sb.from('check_completions').select('*').eq('profile_id',me.id),
    sb.from('meetings').select('*').order('start_date').order('start_time'),
    sb.from('chapter_visits').select('*').order('visit_date',{ascending:false}),
    sb.from('one_on_one_requests').select('*').order('requested_date').order('requested_start'),
    sb.from('messages').select('*').or('sender_id.eq.'+me.id+',recipient_id.eq.'+me.id).order('created_at')
  ];
  const out=await Promise.all(queries);
  state.profiles=out[0].data||[];state.councils=out[1].data||[];state.counterparts=out[2].data||[];
  state.templates=out[3].data||[];state.completions=out[4].data||[];state.meetings=out[5].data||[];
  state.visits=out[6].data||[];state.requests=out[7].data||[];state.messages=out[8].data||[];
}

function renderShell(){
  const role=me.role;
  const nav=[
    ['dashboard','Overview','⌂'],['schedule','Schedule','◷'],['messages','Messages','✦']
  ];
  if(role!=='counterpart'){nav.push(['people','People','◎']);nav.push(['visits','Visits','↗']);}
  if(role==='admin')nav.push(['admin','Admin','⚙']);
  const body=viewHtml(activeView);
  app.innerHTML='<div class="shell"><header class="topbar"><div class="brand"><div class="logo">GJR</div><div><strong>GJR S\'gan Hub</strong><span>'+esc(council?council.display_name:'Greater Jersey Region')+'</span></div></div><div class="top-actions"><span class="role-pill">'+roleLabel(role)+'</span><span class="pill">'+esc(me.display_name)+'</span><a class="ghost" style="text-decoration:none" href="../">School Flow</a><button id="signOutBtn" class="ghost">Sign out</button></div></header><div class="layout"><aside class="sidebar"><nav class="nav">'+nav.map(function(n){return '<button data-view="'+n[0]+'" class="'+(activeView===n[0]?'active':'')+'">'+n[2]+' &nbsp;'+n[1]+'</button>'}).join('')+'</nav><div class="side-card"><div class="eyebrow">YOUR COUNCIL</div><strong style="margin-top:6px">'+esc(council?council.name:'Region')+'</strong><span>'+esc(council?council.display_name:'Greater Jersey Region')+'</span></div></aside><main class="content">'+body+'</main></div></div>';
  document.getElementById('signOutBtn').onclick=async function(){await sb.auth.signOut();location.reload()};
  wireView();
}

function roleLabel(r){return r==='admin'?'Regional Admin':r==='council_sgan'?'Council S\'gan/S\'ganit':'Counterpart'}
function viewHtml(view){
  if(view==='schedule')return scheduleHtml();
  if(view==='messages')return messagesHtml();
  if(view==='people'&&me.role!=='counterpart')return peopleHtml();
  if(view==='visits'&&me.role!=='counterpart')return visitsHtml();
  if(view==='admin'&&me.role==='admin')return adminHtml();
  return dashboardHtml();
}

function dashboardHtml(){
  const templates=visibleTemplates(),done=templates.filter(isDone).length,pct=templates.length?Math.round(done/templates.length*100):100;
  const next=nextOccurrences(28)[0];
  const needs=state.counterparts.filter(function(c){return c.next_follow_up&&c.next_follow_up<=iso(new Date())}).length;
  const openReq=state.requests.filter(function(r){return r.status==='requested'}).length;
  return '<section class="hero"><div class="hero-copy"><div class="eyebrow">GREATER JERSEY REGION · '+esc(council?council.name:'')+'</div><h1>Lead the week.<br><span>Stay connected.</span></h1><p>'+dashboardSubtitle()+'</p></div><div class="hero-ring" style="--pct:'+pct+'%"><div><strong>'+pct+'%</strong><span>weekly progress</span></div></div></section>'+
  '<section class="stats"><div class="stat"><span>Checklist</span><strong>'+done+'/'+templates.length+'</strong><small>completed</small></div><div class="stat"><span>Next meeting</span><strong>'+(next?fmtTime(next.meeting.start_time):'—')+'</strong><small>'+(next?esc(next.meeting.title):'nothing upcoming')+'</small></div><div class="stat"><span>Follow-ups</span><strong>'+needs+'</strong><small>counterparts due</small></div><div class="stat"><span>1:1 requests</span><strong>'+openReq+'</strong><small>open requests</small></div></section>'+
  '<div class="grid-2"><section class="card"><div class="card-head"><div><div class="eyebrow">CHECKLIST</div><h2>'+ (me.role==='counterpart'?'My Actions':'Leadership Actions') +'</h2></div></div>'+checklistHtml(templates)+'</section><section class="card"><div class="card-head"><div><div class="eyebrow">UP NEXT</div><h2>Schedule</h2></div></div>'+upcomingHtml(6)+'</section></div>'+
  (me.role==='counterpart'?counterpartQuickHtml():'');
}
function dashboardSubtitle(){return me.role==='counterpart'?'Your council schedule, 1:1s, messages, and action items in one place.':'Counterparts, focus chapters, steering, meetings, and council follow-ups in one place.'}

function visibleTemplates(){return state.templates.filter(function(t){return !t.council_id||t.council_id===me.council_id})}
function periodKey(t){const d=new Date();if(t.cadence==='daily')return iso(d);const x=new Date(d);const off=(x.getDay()+6)%7;x.setDate(x.getDate()-off);return iso(x)}
function isDone(t){const p=periodKey(t);return state.completions.some(function(c){return c.template_id===t.id&&c.period_key===p})}
function checklistHtml(ts){
  if(!ts.length)return '<div class="empty">No active checklist items.</div>';
  const groups={};ts.forEach(function(t){(groups[t.group_name]||(groups[t.group_name]=[])).push(t)});
  return Object.keys(groups).map(function(g){return '<div class="check-group"><div class="check-title">'+esc(g)+'</div>'+groups[g].map(function(t){const d=isDone(t);return '<label class="check-row '+(d?'done':'')+'"><input type="checkbox" class="checkToggle" data-id="'+t.id+'" '+(d?'checked':'')+'><div><strong>'+esc(t.title)+'</strong><span>'+esc(t.cadence)+(t.until_date?' · through '+niceDate(t.until_date):'')+'</span></div></label>'}).join('')+'</div>'}).join('');
}

function occurrence(m,date){
  const start=new Date(m.start_date+'T12:00:00'),target=new Date(date.getFullYear(),date.getMonth(),date.getDate(),12);
  if(target<start)return false;const diff=Math.round((target-start)/86400000);
  return m.recurrence==='none'?diff===0:m.recurrence==='weekly'?diff%7===0:diff%14===0;
}
function nextOccurrences(days){
  const out=[],today=new Date();
  for(let i=0;i<days;i++){const d=new Date(today.getFullYear(),today.getMonth(),today.getDate()+i,12);state.meetings.forEach(function(m){const visible=(m.visible_regionwide&&me.role!=='counterpart')||m.council_id===me.council_id||m.owner_profile_id===me.id;if(visible&&occurrence(m,d))out.push({meeting:m,date:d})})}
  return out.sort(function(a,b){return iso(a.date).localeCompare(iso(b.date))||String(a.meeting.start_time).localeCompare(String(b.meeting.start_time))});
}
function upcomingHtml(n){const list=nextOccurrences(35).slice(0,n);if(!list.length)return '<div class="empty">Nothing upcoming.</div>';return '<div class="list">'+list.map(function(x){const m=x.meeting;return '<div class="item"><div><strong>'+esc(m.title)+'</strong><span>'+niceDate(iso(x.date))+' · '+fmtTime(m.start_time)+(m.end_time?'–'+fmtTime(m.end_time):'')+' · '+esc(m.mode)+(m.recurrence!=='none'?' · '+(m.recurrence==='weekly'?'Weekly':'Every other week'):'')+'</span></div><div class="actions">'+(m.url?'<a class="join" target="_blank" rel="noopener" href="'+esc(m.url)+'">Join ↗</a>':'')+'</div></div>'}).join('')+'</div>'}

function scheduleHtml(){
  const week=weekDays(new Date()),occ=nextOccurrences(60);
  let html='<section class="card"><div class="card-head"><div><div class="eyebrow">SCHEDULE</div><h2>Your BBYO week</h2></div></div><div class="schedule-board">'+week.map(function(d){const list=occ.filter(function(x){return iso(x.date)===iso(d)});return '<div class="day-col"><h4>'+dayName(d)+' · '+(d.getMonth()+1)+'/'+d.getDate()+'</h4>'+ (list.length?list.map(function(x){return '<div class="meeting-mini"><strong>'+esc(x.meeting.title)+'</strong><span>'+fmtTime(x.meeting.start_time)+(x.meeting.end_time?'–'+fmtTime(x.meeting.end_time):'')+'</span></div>'}).join(''):'<span class="muted" style="font-size:9px">Open</span>')+'</div>'}).join('')+'</div></section>';
  if(me.role!=='counterpart'){
    html+='<section class="card" style="margin-top:15px"><div class="eyebrow">ADD MEETING</div><h2>Build your schedule</h2><form id="meetingForm" class="form-grid"><label class="wide">Meeting name<input id="mTitle" required></label><label>Type<select id="mMode"><option>Online</option><option>In-Person</option></select></label><label>Repeats<select id="mRepeat"><option value="none">One time</option><option value="weekly">Weekly</option><option value="biweekly">Every other week</option></select></label><label>Date<input id="mDate" type="date" required></label><label>Starts<input id="mStart" type="time" required></label><label>Ends<input id="mEnd" type="time"></label><label>Location<input id="mLocation"></label><label class="wide">Meeting link<input id="mUrl" type="url"></label><button class="primary">Add meeting</button></form></section>';
    html+=requestsLeaderHtml();
  }else{
    html+=requestOneOnOneHtml();
  }
  return html;
}
function requestOneOnOneHtml(){
  const leaders=state.profiles.filter(function(p){return p.council_id===me.council_id&&(p.role==='admin'||p.role==='council_sgan')});
  return '<section class="card" style="margin-top:15px"><div class="eyebrow">1:1 WITH YOUR COUNCIL S\'GAN</div><h2>Request a time</h2><form id="oneForm" class="form-grid"><label class="wide">Council S\'gan/S\'ganit<select id="oneLeader">'+leaders.map(function(p){return '<option value="'+p.id+'">'+esc(p.display_name)+'</option>'}).join('')+'</select></label><label>Date<input id="oneDate" type="date" required></label><label>Start<input id="oneStart" type="time" required></label><label>End<input id="oneEnd" type="time"></label><label class="full">Notes<textarea id="oneNotes" rows="2"></textarea></label><button class="primary">Request 1:1</button></form></section>';
}
function requestsLeaderHtml(){
  const reqs=state.requests.filter(function(r){return r.council_sgan_profile_id===me.id||me.role==='admin'});
  if(!reqs.length)return '';
  return '<section class="card" style="margin-top:15px"><div class="eyebrow">1:1 REQUESTS</div><h2>Counterpart requests</h2><div class="list">'+reqs.map(function(r){const p=profile(r.counterpart_profile_id);return '<div class="item"><div><strong>'+esc(p?p.display_name:'Counterpart')+'</strong><span>'+niceDate(r.requested_date)+' · '+fmtTime(r.requested_start)+(r.requested_end?'–'+fmtTime(r.requested_end):'')+' · '+esc(r.status)+'</span><small>'+esc(r.notes||'')+'</small></div><div class="actions">'+(r.status==='requested'?'<button class="tiny-btn reqAction" data-id="'+r.id+'" data-status="accepted">Accept</button><button class="tiny-btn reqAction" data-id="'+r.id+'" data-status="declined">Decline</button>':'')+'</div></div>'}).join('')+'</div></section>';
}

function peopleHtml(){
  const cps=state.counterparts.filter(function(c){return me.role==='admin'||c.council_id===me.council_id});
  const councilField=me.role==='admin'
    ? '<label>Council<select id="cpCouncil">'+state.councils.map(function(c){return '<option value="'+c.id+'" '+(c.id===me.council_id?'selected':'')+'>'+esc(c.name)+' — '+esc(c.display_name)+'</option>'}).join('')+'</select></label>'
    : '';
  return '<section class="hero"><div class="hero-copy"><div class="eyebrow">COUNTERPART CRM</div><h1>Know your people.</h1><p>Track check-ins, follow-ups, account access, and chapter context.</p></div></section>'+
  '<section class="card" style="margin-top:15px"><div class="card-head"><div><div class="eyebrow">ADD COUNTERPART</div><h2>Add someone to your council</h2></div></div><form id="counterpartForm" class="form-grid"><label class="wide">Full name<input id="cpName" placeholder="Counterpart name" required></label><label class="wide">Chapter<input id="cpChapter" placeholder="Chapter name" required></label>'+councilField+'<label class="wide">Notes<input id="cpNotes" placeholder="Optional notes"></label><button class="primary">Add counterpart</button></form></section>'+
  '<section class="card" style="margin-top:15px"><div class="card-head"><div><div class="eyebrow">COUNTERPARTS</div><h2>'+cps.length+' people</h2></div></div><div class="people-grid">'+cps.map(counterpartCard).join('')+'</div></section>';
}
function counterpartCard(c){
  const initials=c.name.split(' ').map(function(x){return x[0]}).join('').slice(0,2);
  const linked=c.linked_profile_id?profile(c.linked_profile_id):null;
  return '<article class="person-card"><div class="person-head"><div class="avatar">'+esc(initials)+'</div><div><strong>'+esc(c.name)+'</strong><span>'+esc(c.chapter)+'</span></div></div><div class="person-fields"><label>Last check-in<input class="cpField" data-id="'+c.id+'" data-field="last_check_in" type="date" value="'+(c.last_check_in||'')+'"></label><label>Next follow-up<input class="cpField" data-id="'+c.id+'" data-field="next_follow_up" type="date" value="'+(c.next_follow_up||'')+'"></label></div><label class="note-label">Notes<textarea class="cpField" data-id="'+c.id+'" data-field="notes" rows="2">'+esc(c.notes||'')+'</textarea></label><div style="margin-top:10px">'+(linked?'<span class="pill">Account: '+esc(linked.display_name)+'</span>':'<button class="primary createCp" data-id="'+c.id+'">Create their account</button>')+'</div></article>';
}

function visitsHtml(){
  const list=state.visits.filter(function(x){return me.role==='admin'||x.council_id===me.council_id});
  return '<section class="card"><div class="card-head"><div><div class="eyebrow">CHAPTER VISITS</div><h2>Visit Tracker</h2></div></div><form id="visitForm" class="form-grid"><label>Chapter<input id="vChapter" required></label><label>Date<input id="vDate" type="date" required></label><label class="wide">What went well?<input id="vGood"></label><label class="wide">What do they need help with?<input id="vHelp"></label><label class="wide">Follow-up / next step<input id="vNext"></label><button class="primary">Log visit</button></form></section><section class="card" style="margin-top:15px"><div class="visit-grid">'+(list.length?list.map(function(x){return '<article class="visit-card"><div class="eyebrow">'+niceDate(x.visit_date)+'</div><h3>'+esc(x.chapter)+'</h3><p><b>Went well:</b> '+esc(x.went_well||'—')+'</p><p><b>Needs help:</b> '+esc(x.needs_help||'—')+'</p><p><b>Next:</b> '+esc(x.follow_up||'—')+'</p></article>'}).join(''):'<div class="empty">No visits logged yet.</div>')+'</div></section>';
}

function adminHtml(){
  return '<section class="hero"><div class="hero-copy"><div class="eyebrow">REGIONAL ADMIN</div><h1>Build the network.</h1><p>Create councils, add Council S\'ganim/S\'ganiot, and manage account access.</p></div></section><div class="grid-2"><section class="card"><div class="eyebrow">NEW COUNCIL</div><h2>Add a council</h2><form id="councilForm" class="form-grid"><label>Code<input id="cCode" placeholder="e.g. NNJAZA" required></label><label class="wide">Display name<input id="cName" required></label><button class="primary">Create council</button></form></section><section class="card"><div class="eyebrow">COUNCIL S\'GAN/S\'GANIT</div><h2>Create leader account</h2><form id="leaderForm" class="form-grid"><label class="wide">Display name<input id="lName" required></label><label>Council<select id="lCouncil">'+state.councils.map(function(c){return '<option value="'+c.id+'">'+esc(c.name)+'</option>'}).join('')+'</select></label><label>Email<input id="lEmail" type="email" required></label><label>Password<input id="lPass" type="text" required></label><button class="primary">Create Council S\'gan/S\'ganit</button></form></section></div><section class="card" style="margin-top:15px"><div class="eyebrow">COUNCILS</div><h2>Regional structure</h2><div class="council-grid">'+state.councils.map(function(c){const leads=state.profiles.filter(function(p){return p.council_id===c.id&&(p.role==='admin'||p.role==='council_sgan')});return '<article class="council-card"><strong>'+esc(c.name)+'</strong><span class="muted" style="display:block;font-size:10px;margin:3px 0 9px">'+esc(c.display_name)+'</span><div class="list">'+(leads.length?leads.map(function(p){return '<div class="item"><div><strong>'+esc(p.display_name)+'</strong><span>'+roleLabel(p.role)+'</span></div></div>'}).join(''):'<div class="empty">No S\'gan assigned yet.</div>')+'</div></article>'}).join('')+'</div></section>';
}

function messagesHtml(){
  const people=state.profiles.filter(function(p){
    if(p.id===me.id||p.council_id!==me.council_id)return false;
    if(me.role==='counterpart')return p.role==='admin'||p.role==='council_sgan';
    return true;
  });
  if(!activeThread&&people[0])activeThread=people[0].id;
  const other=profile(activeThread);
  const msgs=state.messages.filter(function(m){return (m.sender_id===me.id&&m.recipient_id===activeThread)||(m.sender_id===activeThread&&m.recipient_id===me.id)});
  return '<section class="card"><div class="card-head"><div><div class="eyebrow">MESSAGES</div><h2>Council chat</h2></div></div><div class="message-layout"><div class="thread-list">'+people.map(function(p){return '<button class="thread-btn '+(activeThread===p.id?'active':'')+'" data-thread="'+p.id+'"><strong>'+esc(p.display_name)+'</strong><span>'+roleLabel(p.role)+'</span></button>'}).join('')+'</div><div class="chat"><div class="messages">'+(msgs.length?msgs.map(function(m){return '<div class="bubble '+(m.sender_id===me.id?'mine':'')+'">'+esc(m.body)+'<small>'+new Date(m.created_at).toLocaleString()+'</small></div>'}).join(''):'<div class="empty">Start the conversation.</div>')+'</div>'+(other?'<form id="chatForm" class="chat-form"><input id="chatText" placeholder="Message '+esc(other.display_name)+'..." required><button class="primary">Send</button></form>':'')+'</div></div></section>';
}

function counterpartQuickHtml(){
  return '<section class="card" style="margin-top:15px"><div class="eyebrow">YOUR COUNCIL S\'GAN</div><h2>Need something?</h2><p class="muted">Use Messages to text your council S\'gan directly, or Schedule to request a 1:1 time.</p><div class="actions"><button class="primary" data-view="messages">Open messages</button><button class="ghost" data-view="schedule">Request 1:1</button></div></section>';
}

function wireView(){
  document.querySelectorAll('.checkToggle').forEach(function(cb){cb.onchange=async function(){const t=state.templates.find(function(x){return x.id===cb.dataset.id});const p=periodKey(t);if(cb.checked){await sb.from('check_completions').insert({template_id:t.id,profile_id:me.id,period_key:p})}else{await sb.from('check_completions').delete().eq('template_id',t.id).eq('profile_id',me.id).eq('period_key',p)}await loadAll();renderShell()}});
  document.querySelectorAll('.cpField').forEach(function(el){el.onchange=async function(){const patch={};patch[el.dataset.field]=el.value;await sb.from('counterparts').update(patch).eq('id',el.dataset.id);await loadAll();renderShell()}});
  document.querySelectorAll('.createCp').forEach(function(btn){btn.onclick=function(){createCounterpartAccount(btn.dataset.id)}});
  document.querySelectorAll('[data-thread]').forEach(function(btn){btn.onclick=function(){activeThread=btn.dataset.thread;renderShell()}});
  const chat=document.getElementById('chatForm');if(chat)chat.onsubmit=sendMessage;
  const mf=document.getElementById('meetingForm');if(mf)mf.onsubmit=addMeeting;
  const vf=document.getElementById('visitForm');if(vf)vf.onsubmit=addVisit;
  const of=document.getElementById('oneForm');if(of)of.onsubmit=requestOne;
  document.querySelectorAll('.reqAction').forEach(function(btn){btn.onclick=async function(){await sb.from('one_on_one_requests').update({status:btn.dataset.status}).eq('id',btn.dataset.id);await loadAll();renderShell()}});
  const cf=document.getElementById('councilForm');if(cf)cf.onsubmit=addCouncil;
  const lf=document.getElementById('leaderForm');if(lf)lf.onsubmit=createLeader;
  const cpf=document.getElementById('counterpartForm');if(cpf)cpf.onsubmit=addCounterpart;
}

async function createCounterpartAccount(id){
  const cp=state.counterparts.find(function(x){return x.id===id});if(!cp)return;
  const email=prompt('Email for '+cp.name+':');if(!email)return;
  const password=prompt('Temporary password for '+cp.name+' (they can change it later):');if(!password)return;
  const r=await sb.functions.invoke('create-managed-user',{body:{email:email,password:password,display_name:cp.name,role:'counterpart',council_id:cp.council_id,linked_counterpart_id:cp.id}});
  if(r.error){alert(r.error.message);return;}await loadAll();renderShell();alert('Account created for '+cp.name+'.');
}
async function createLeader(e){
  e.preventDefault();
  const r=await sb.functions.invoke('create-managed-user',{body:{email:v('lEmail'),password:v('lPass'),display_name:v('lName'),role:'council_sgan',council_id:v('lCouncil')}});
  if(r.error){alert(r.error.message);return;}await loadAll();renderShell();alert('Council S\'gan/S\'ganit account created.');
}
async function addCouncil(e){e.preventDefault();const r=await sb.from('councils').insert({name:v('cCode').toUpperCase(),display_name:v('cName')});if(r.error){alert(r.error.message);return;}await loadAll();renderShell()}
async function addCounterpart(e){
  e.preventDefault();
  const councilId=me.role==='admin'?(v('cpCouncil')||me.council_id):me.council_id;
  const row={council_id:councilId,name:v('cpName'),chapter:v('cpChapter'),notes:v('cpNotes')};
  if(!row.name||!row.chapter){alert('Name and chapter are required.');return;}
  const r=await sb.from('counterparts').insert(row);
  if(r.error){alert(r.error.message);return;}
  await loadAll();renderShell();
}
async function addMeeting(e){e.preventDefault();const row={council_id:me.council_id,title:v('mTitle'),mode:v('mMode'),start_date:v('mDate'),start_time:v('mStart'),end_time:v('mEnd')||null,recurrence:v('mRepeat'),url:v('mUrl'),location:v('mLocation'),owner_profile_id:me.id};const r=await sb.from('meetings').insert(row);if(r.error){alert(r.error.message);return;}await loadAll();renderShell()}
async function addVisit(e){e.preventDefault();const row={council_id:me.council_id,chapter:v('vChapter'),visit_date:v('vDate'),went_well:v('vGood'),needs_help:v('vHelp'),follow_up:v('vNext'),created_by:me.id};const r=await sb.from('chapter_visits').insert(row);if(r.error){alert(r.error.message);return;}await loadAll();renderShell()}
async function requestOne(e){e.preventDefault();const row={council_id:me.council_id,counterpart_profile_id:me.id,council_sgan_profile_id:v('oneLeader'),requested_date:v('oneDate'),requested_start:v('oneStart'),requested_end:v('oneEnd')||null,notes:v('oneNotes')};const r=await sb.from('one_on_one_requests').insert(row);if(r.error){alert(r.error.message);return;}await loadAll();renderShell();alert('1:1 request sent.')}
async function sendMessage(e){e.preventDefault();const body=v('chatText');if(!body||!activeThread)return;const r=await sb.from('messages').insert({council_id:me.council_id,sender_id:me.id,recipient_id:activeThread,body:body});if(r.error){alert(r.error.message);return;}document.getElementById('chatText').value='';await loadAll();renderShell()}

function subscribeMessages(){
  if(!sb||!me)return;
  sb.channel('gjr-messages-'+me.id).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},async function(payload){const m=payload.new;if(m.sender_id===me.id||m.recipient_id===me.id){await loadAll();if(activeView==='messages')renderShell()}}).subscribe();
}

function profile(id){return state.profiles.find(function(p){return p.id===id})}
function iso(d){if(typeof d==='string')return d.slice(0,10);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function niceDate(s){const d=new Date(String(s).slice(0,10)+'T12:00:00');return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:d.getFullYear()!==new Date().getFullYear()?'numeric':undefined})}
function fmtTime(t){if(!t)return'';const p=String(t).slice(0,5).split(':').map(Number),h=p[0],m=p[1];return ((h+11)%12+1)+':'+String(m).padStart(2,'0')+' '+(h>=12?'PM':'AM')}
function dayName(d){return d.toLocaleDateString('en-US',{weekday:'short'})}
function weekDays(d){const x=new Date(d);const off=(x.getDay()+6)%7;x.setDate(x.getDate()-off);return Array.from({length:7},function(_,i){return new Date(x.getFullYear(),x.getMonth(),x.getDate()+i,12)})}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]})}
