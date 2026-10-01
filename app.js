const cfg=window.GJR_CONFIG||{};
const app=document.getElementById('app');
const configured=!!(cfg.supabaseUrl&&cfg.supabaseAnonKey);
const sb=configured?window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey):null;
let session=null, me=null, council=null, state={};
let activeView='dashboard', activeThread=null, scheduleWeekOffset=0;

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
    sb.from('check_completions').select('*'),
    sb.from('meetings').select('*').order('start_date').order('start_time'),
    sb.from('chapter_visits').select('*').order('visit_date',{ascending:false}),
    sb.from('one_on_one_requests').select('*').order('requested_date').order('requested_start'),
    sb.from('messages').select('*').or('sender_id.eq.'+me.id+',recipient_id.eq.'+me.id).order('created_at'),
    sb.from('program_planning_forms').select('*').order('created_at',{ascending:false}),
    sb.from('meeting_occurrence_notes').select('*').order('occurrence_date',{ascending:false})
  ];
  const out=await Promise.all(queries);
  state.profiles=out[0].data||[];state.councils=out[1].data||[];state.counterparts=out[2].data||[];
  state.templates=out[3].data||[];state.completions=out[4].data||[];state.meetings=out[5].data||[];
  state.visits=out[6].data||[];state.requests=out[7].data||[];state.messages=out[8].data||[];state.programs=out[9].data||[];state.meetingNotes=out[10].data||[];
}

function renderShell(){
  const role=me.role;
  const nav=[
    ['dashboard','Overview','⌂'],['schedule','Schedule','◷'],['notes','Notes','✎'],['programs','Programs','▤'],['messages','Messages','✦']
  ];
  if(role!=='counterpart'){nav.push(['people','People','◎']);nav.push(['visits','Visits','↗']);}
  if(role==='admin')nav.push(['admin','Admin','⚙']);
  const body=viewHtml(activeView);
  app.innerHTML='<div class="shell"><header class="topbar"><div class="brand"><div class="logo">GJR</div><div><strong>GJR S\'gan Hub</strong><span>'+esc(council?council.display_name:'Greater Jersey Region')+'</span></div></div><div class="top-actions"><span class="role-pill">'+roleLabel(role)+'</span><span class="pill">'+esc(me.display_name)+'</span><button id="signOutBtn" class="ghost">Sign out</button></div></header><div class="layout"><aside class="sidebar"><nav class="nav">'+nav.map(function(n){return '<button data-view="'+n[0]+'" class="'+(activeView===n[0]?'active':'')+'">'+n[2]+' &nbsp;'+n[1]+'</button>'}).join('')+'</nav><div class="side-card"><div class="eyebrow">YOUR COUNCIL</div><strong style="margin-top:6px">'+esc(council?council.name:'Region')+'</strong><span>'+esc(council?council.display_name:'Greater Jersey Region')+'</span></div></aside><main class="content">'+body+'</main></div></div>';
  document.getElementById('signOutBtn').onclick=async function(){await sb.auth.signOut();location.reload()};
  wireView();
}

function roleLabel(r){return r==='admin'?'Regional Admin':r==='council_sgan'?'Council S\'gan/S\'ganit':'Counterpart'}
function viewHtml(view){
  if(view==='schedule')return scheduleHtml();
  if(view==='notes')return notesHtml();
  if(view==='programs')return programsHtml();
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
  '<div class="grid-2"><section class="card"><div class="card-head"><div><div class="eyebrow">MY TASKS</div><h2>Personal tasks</h2></div><button id="addTaskBtn" class="primary">+ Add task</button></div>'+checklistHtml(templates)+'</section><section class="card"><div class="card-head"><div><div class="eyebrow">UP NEXT</div><h2>Schedule</h2></div></div>'+upcomingHtml(6)+'</section></div>'+
  (me.role==='counterpart'?counterpartQuickHtml():'')+'<div id="meetingModalHost"></div>';
}
function dashboardSubtitle(){return me.role==='counterpart'?'Your council schedule, 1:1s, messages, and action items in one place.':'Counterparts, focus chapters, steering, meetings, and council follow-ups in one place.'}

function visibleTemplates(){return state.templates.filter(function(t){return t.owner_profile_id===me.id})}
function periodKey(t){const d=new Date();if(t.cadence==='once')return 'once';if(t.cadence==='daily')return iso(d);const x=new Date(d);const off=(x.getDay()+6)%7;x.setDate(x.getDate()-off);return iso(x)}
function isDone(t){const p=periodKey(t);return state.completions.some(function(c){return c.template_id===t.id&&c.period_key===p})}
function checklistHtml(ts){
  if(!ts.length)return '<div class="task-empty"><div class="task-empty-icon">✓</div><strong>Nothing on your plate</strong><span>Your checklist is clear.</span></div>';
  const groups={};ts.forEach(function(t){(groups[t.group_name]||(groups[t.group_name]=[])).push(t)});
  return '<div class="task-board">'+Object.keys(groups).map(function(g){
    const group=groups[g],doneCount=group.filter(isDone).length;
    return '<section class="task-group"><div class="task-group-head"><div><div class="task-group-kicker">CHECKLIST</div><h3>'+esc(g)+'</h3></div><div class="task-group-progress"><strong>'+doneCount+'/'+group.length+'</strong><span>done</span></div></div><div class="task-list">'+group.map(function(t){
      const d=isDone(t),overdue=!d&&t.due_date&&t.due_date<iso(new Date());
      const due=t.due_date?niceDate(t.due_date):'No deadline';
      return '<div class="task-card '+(d?'done ':'')+(overdue?'overdue':'')+'"><label class="task-check"><input type="checkbox" class="checkToggle" data-id="'+t.id+'" '+(d?'checked':'')+'><span></span></label><div class="task-card-copy"><strong>'+esc(t.title)+'</strong><div class="task-meta"><span class="task-badge '+(t.assigned_by?'assigned':'personal')+'">'+(t.assigned_by?'Assigned':'Personal')+'</span><span class="task-due '+(overdue?'overdue':'')+'">'+due+'</span></div></div><button class="task-delete deleteTask" data-id="'+t.id+'" title="Delete task">×</button></div>';
    }).join('')+'</div></section>';
  }).join('')+'</div>';
}

function occurrence(m,date){
  const start=new Date(m.start_date+'T12:00:00'),target=new Date(date.getFullYear(),date.getMonth(),date.getDate(),12);
  if(target<start)return false;const diff=Math.round((target-start)/86400000);
  return m.recurrence==='none'?diff===0:m.recurrence==='weekly'?diff%7===0:diff%14===0;
}
function nextOccurrences(days){
  const out=[],today=new Date();
  for(let i=0;i<days;i++){const d=new Date(today.getFullYear(),today.getMonth(),today.getDate()+i,12);state.meetings.forEach(function(m){if((m.owner_profile_id===me.id||m.attendee_profile_id===me.id)&&occurrence(m,d))out.push({meeting:m,date:d})})}
  return out.sort(function(a,b){return iso(a.date).localeCompare(iso(b.date))||String(a.meeting.start_time).localeCompare(String(b.meeting.start_time))});
}
function meetingContactName(m){if(m.contact_type==='gjr_staff')return 'GJR Staff';const c=state.counterparts.find(function(x){return x.id===m.counterpart_id});if(c)return c.name;if(m.attendee_profile_id){const p=profile(m.attendee_profile_id);if(p)return p.display_name}return m.contact_name||''}
function occurrenceNote(meetingId,date){return (state.meetingNotes||[]).find(function(n){return n.meeting_id===meetingId&&n.occurrence_date===iso(date)})}
function meetingCountWithCounterpart(counterpartId){
  const today=new Date();today.setHours(12,0,0,0);let count=0;
  state.meetings.filter(function(m){return m.owner_profile_id===me.id&&m.counterpart_id===counterpartId}).forEach(function(m){
    const start=new Date(m.start_date+'T12:00:00');if(start>today)return;
    if(m.recurrence==='none'){count+=1;return;}
    const days=Math.floor((today-start)/86400000);
    const step=m.recurrence==='weekly'?7:14;
    count+=Math.floor(days/step)+1;
  });
  return count;
}
function meetingTimeText(m){return m.time_tbd?'Time TBD':fmtTime(m.start_time)+(m.end_time?'–'+fmtTime(m.end_time):'')}
function upcomingHtml(n){const list=nextOccurrences(35).slice(0,n);if(!list.length)return '<div class="empty">Nothing upcoming.</div>';return '<div class="list">'+list.map(function(x){const m=x.meeting,contact=meetingContactName(m);return '<button class="item meeting-row openMeeting" data-meeting="'+m.id+'" data-date="'+iso(x.date)+'"><div><strong>'+esc(m.title)+'</strong><span>'+niceDate(iso(x.date))+' · '+meetingTimeText(m)+' · '+esc(m.mode)+(contact?' · with '+esc(contact):'')+(m.recurrence!=='none'?' · '+(m.recurrence==='weekly'?'Weekly':'Every other week'):'')+'</span></div><div class="meeting-open">View details →</div></button>'}).join('')+'</div>'}

function scheduleBaseDate(){
  const d=new Date();
  d.setDate(d.getDate()+scheduleWeekOffset*7);
  return d;
}
function scheduleHtml(){
  const base=scheduleBaseDate(),week=weekDays(base);
  const contacts=state.counterparts.filter(function(c){return c.council_id===me.council_id});
  const occ=[];
  week.forEach(function(d){
    state.meetings.forEach(function(m){
      if((m.owner_profile_id===me.id||m.attendee_profile_id===me.id)&&occurrence(m,d))occ.push({meeting:m,date:d});
    });
  });
  const label=niceDate(iso(week[0]))+' – '+niceDate(iso(week[6]));
  let html='<section class="card schedule-shell"><div class="schedule-toolbar"><div><div class="eyebrow">SCHEDULE</div><h2>'+label+'</h2></div><div class="schedule-nav"><button class="ghost" id="prevWeekBtn">← Previous</button><button class="ghost" id="todayWeekBtn">This week</button><button class="ghost" id="nextWeekBtn">Next →</button></div></div><div class="schedule-board">'+week.map(function(d){const list=occ.filter(function(x){return iso(x.date)===iso(d)});return '<div class="day-col '+(iso(d)===iso(new Date())?'today':'')+'"><h4>'+dayName(d)+' · '+(d.getMonth()+1)+'/'+d.getDate()+'</h4>'+ (list.length?list.map(function(x){const contact=meetingContactName(x.meeting);return '<button class="meeting-mini openMeeting" data-meeting="'+x.meeting.id+'" data-date="'+iso(x.date)+'"><strong>'+esc(x.meeting.title)+'</strong><span>'+meetingTimeText(x.meeting)+(contact?' · with '+esc(contact):'')+'</span></button>'}).join(''):'<span class="muted" style="font-size:9px">Open</span>')+'</div>'}).join('')+'</div></section>';
  if(me.role!=='counterpart'){
    html+='<section class="card" style="margin-top:15px"><div class="eyebrow">ADD MEETING</div><h2>Build your schedule</h2><form id="meetingForm" class="form-grid"><label class="wide">Meeting name<input id="mTitle" required></label><label class="wide">Who are you meeting with?<select id="mCounterpart"><option value="">No specific contact</option><option value="__GJR_STAFF__">GJR Staff</option>'+contacts.map(function(c){return '<option value="'+c.id+'">'+esc(c.name)+' — '+esc(c.chapter)+'</option>'}).join('')+'</select></label><label>Type<select id="mMode"><option>Online</option><option>In-Person</option></select></label><label>Repeats<select id="mRepeat"><option value="none">One time</option><option value="weekly">Weekly</option><option value="biweekly">Every other week</option></select></label><label>Date<input id="mDate" type="date" required></label><label>Starts<input id="mStart" type="time" required></label><label>Ends<input id="mEnd" type="time"></label><label>Location<input id="mLocation"></label><label class="wide">Meeting link<input id="mUrl" type="url"></label><button class="primary">Add meeting</button></form></section>';
    html+=requestsLeaderHtml();
  }else{
    html+=requestOneOnOneHtml();
  }
  html+='<div id="meetingModalHost"></div>';
  return html;
}
function meetingNotesHtml(){
  const today=new Date();today.setHours(12,0,0,0);
  const start=new Date(today);start.setDate(start.getDate()-30);
  const end=new Date(today);end.setDate(end.getDate()+30);
  const occ=[];
  state.meetings.forEach(function(m){
    if(m.owner_profile_id!==me.id&&m.attendee_profile_id!==me.id)return;
    for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){
      const x=new Date(d);
      if(occurrence(m,x))occ.push({meeting:m,date:x});
    }
  });
  occ.sort(function(a,b){return iso(b.date).localeCompare(iso(a.date))||String(b.meeting.start_time).localeCompare(String(a.meeting.start_time))});
  if(!occ.length)return '<section class="card" style="margin-top:15px"><div class="eyebrow">MEETING NOTES</div><h2>Notes by meeting</h2><div class="empty">No meetings to add notes to yet.</div></section>';
  return '<section class="card" style="margin-top:15px"><div class="eyebrow">MEETING NOTES</div><h2>Notes by meeting</h2><div class="list">'+occ.slice(0,24).map(function(x){
    const m=x.meeting,n=occurrenceNote(m.id,x.date),contact=meetingContactName(m),own=m.owner_profile_id===me.id;
    return '<article class="item" style="display:block"><div><strong>'+esc(m.title)+'</strong><span>'+niceDate(iso(x.date))+' · '+fmtTime(m.start_time)+(contact?' · with '+esc(contact):'')+'</span></div>'+
      (own?'<textarea class="meetingNoteField" data-meeting="'+m.id+'" data-date="'+iso(x.date)+'" rows="3" placeholder="Meeting notes...">'+esc(n?n.notes:'')+'</textarea><div class="actions" style="margin-top:8px"><button class="tiny-btn saveMeetingNote" data-meeting="'+m.id+'" data-date="'+iso(x.date)+'">Save notes</button></div>':
      '<div class="status-line" style="margin-top:8px"><b>Meeting notes:</b> '+esc(n&&n.notes?n.notes:'No notes yet.')+'</div>')+
    '</article>';
  }).join('')+'</div></section>';
}
function notesHtml(){
  const notes=(state.meetingNotes||[]).slice().sort(function(a,b){return String(b.occurrence_date).localeCompare(String(a.occurrence_date))});
  const visible=notes.filter(function(n){
    const m=state.meetings.find(function(x){return x.id===n.meeting_id});
    return !!m&&(m.owner_profile_id===me.id||m.attendee_profile_id===me.id);
  });
  let html='<section class="hero"><div class="hero-copy"><div class="eyebrow">MEETING NOTES</div><h1>Your notes.<br><span>All in one place.</span></h1><p>Jump back into notes from past meetings without digging through your schedule.</p></div></section>';
  if(!visible.length)return html+'<section class="card" style="margin-top:15px"><div class="empty">No meeting notes yet. Open a meeting from Schedule to add your first note.</div></section><div id="meetingModalHost"></div>';
  html+='<section class="card notes-library" style="margin-top:15px"><div class="card-head"><div><div class="eyebrow">NOTES LIBRARY</div><h2>'+visible.length+' saved note'+(visible.length===1?'':'s')+'</h2></div></div><div class="notes-grid">'+visible.map(function(n){
    const m=state.meetings.find(function(x){return x.id===n.meeting_id});if(!m)return '';
    const contact=meetingContactName(m);
    const preview=(n.notes||'').trim();
    return '<button class="note-card openMeeting" data-meeting="'+m.id+'" data-date="'+n.occurrence_date+'"><div class="note-card-top"><div><span class="note-date">'+niceDate(n.occurrence_date)+'</span><strong>'+esc(m.title)+'</strong></div><span class="note-arrow">→</span></div><div class="note-meta">'+meetingTimeText(m)+(contact?' · with '+esc(contact):'')+'</div><p>'+esc(preview||'No notes added yet.')+'</p><span class="note-open">Open meeting details</span></button>';
  }).join('')+'</div></section><div id="meetingModalHost"></div>';
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
  const linkedCount=cps.filter(function(c){return !!c.linked_profile_id}).length;
  const dueCount=cps.filter(function(c){return c.next_follow_up&&c.next_follow_up<=iso(new Date())}).length;
  const councilField=me.role==='admin'
    ? '<label>Council<select id="cpCouncil">'+state.councils.map(function(c){return '<option value="'+c.id+'" '+(c.id===me.council_id?'selected':'')+'>'+esc(c.name)+' — '+esc(c.display_name)+'</option>'}).join('')+'</select></label>'
    : '';
  return '<section class="people-hero"><div><div class="eyebrow">COUNTERPART COMMAND CENTER</div><h1>Your people.<br><span>Your pulse.</span></h1><p>See every Chapter S\'gan at a glance — meetings, tasks, calendar, follow-ups, and account access.</p></div><div class="people-hero-stats"><div><strong>'+cps.length+'</strong><span>Counterparts</span></div><div><strong>'+linkedCount+'</strong><span>Accounts live</span></div><div><strong>'+dueCount+'</strong><span>Follow-ups due</span></div></div></section>'+
  '<section class="people-add-panel"><div class="people-add-copy"><div class="eyebrow">ADD COUNTERPART</div><h2>Bring someone into your council</h2><p>Create their CRM profile first, then create their login when you are ready.</p></div><form id="counterpartForm" class="people-add-form"><label>Full name<input id="cpName" placeholder="Counterpart name" required></label><label>Chapter<input id="cpChapter" placeholder="Chapter name" required></label>'+councilField+'<label>Notes<input id="cpNotes" placeholder="Optional context"></label><button class="primary">+ Add counterpart</button></form></section>'+
  '<section class="people-board"><div class="people-board-head"><div><div class="eyebrow">YOUR COUNTERPARTS</div><h2>'+cps.length+' people in your network</h2></div><span>Open a workspace to see their tasks + calendar</span></div><div class="people-grid premium">'+cps.map(counterpartCard).join('')+'</div></section>'+
  '<div id="counterpartWorkspaceHost"></div>';
}
function counterpartTaskStats(profileId){
  const tasks=state.templates.filter(function(t){return t.owner_profile_id===profileId});
  const done=tasks.filter(function(t){
    const p=periodKey(t);
    return state.completions.some(function(c){return c.template_id===t.id&&c.profile_id===profileId&&c.period_key===p});
  }).length;
  const today=iso(new Date());
  const overdue=tasks.filter(function(t){
    const p=periodKey(t);
    const isDone=state.completions.some(function(c){return c.template_id===t.id&&c.profile_id===profileId&&c.period_key===p});
    return !isDone&&t.due_date&&t.due_date<today;
  }).length;
  return {total:tasks.length,done:done,open:Math.max(0,tasks.length-done),overdue:overdue};
}
function counterpartUpcoming(profileId,days){
  const out=[],today=new Date();
  for(let i=0;i<days;i++){
    const d=new Date(today.getFullYear(),today.getMonth(),today.getDate()+i,12);
    state.meetings.forEach(function(m){
      if(m.owner_profile_id===profileId&&occurrence(m,d))out.push({meeting:m,date:d});
    });
  }
  return out.sort(function(a,b){return iso(a.date).localeCompare(iso(b.date))||String(a.meeting.start_time).localeCompare(String(b.meeting.start_time))});
}
function counterpartCard(c){
  const initials=c.name.split(' ').map(function(x){return x[0]}).join('').slice(0,2);
  const linked=c.linked_profile_id?profile(c.linked_profile_id):null;
  const meetingCount=meetingCountWithCounterpart(c.id);
  const stats=linked?counterpartTaskStats(linked.id):{total:0,done:0,open:0};
  const upcoming=linked?counterpartUpcoming(linked.id,30):[];
  const next=upcoming[0];
  const followDue=c.next_follow_up&&c.next_follow_up<=iso(new Date());
  return '<article class="person-card premium '+(followDue?'follow-due':'')+'"><div class="person-card-glow"></div><div class="person-card-top"><div class="avatar premium">'+esc(initials)+'</div><div class="person-identity"><strong>'+esc(c.name)+'</strong><span>'+esc(c.chapter)+'</span></div><div class="account-dot '+(linked?'live':'offline')+'"><i></i>'+(linked?'Live':'No login')+'</div></div>'+
  '<div class="person-metrics"><div><span>Meetings</span><strong>'+meetingCount+'</strong></div><div><span>Open tasks</span><strong>'+stats.open+'</strong></div><div><span>Next event</span><strong>'+(next?niceDate(iso(next.date)):'—')+'</strong></div></div>'+
  '<div class="person-next"><span>Next follow-up</span><strong>'+(c.next_follow_up?niceDate(c.next_follow_up):'Not set')+'</strong>'+(followDue?'<b>Due</b>':'')+'</div>'+
  '<div class="person-fields premium"><label>Last check-in<input class="cpField" data-id="'+c.id+'" data-field="last_check_in" type="date" value="'+(c.last_check_in||'')+'"></label><label>Next follow-up<input class="cpField" data-id="'+c.id+'" data-field="next_follow_up" type="date" value="'+(c.next_follow_up||'')+'"></label></div>'+
  '<label class="note-label premium">CRM notes<textarea class="cpField" data-id="'+c.id+'" data-field="notes" rows="2" placeholder="Add context about this counterpart...">'+esc(c.notes||'')+'</textarea></label>'+
  '<div class="person-actions premium">'+(linked?
    '<button class="primary openWorkspace" data-id="'+c.id+'">Open workspace →</button><button class="ghost assignTask" data-profile="'+linked.id+'" data-name="'+esc(c.name)+'">+ Assign task</button><button class="danger-btn deleteCounterpart" data-id="'+c.id+'" data-name="'+esc(c.name)+'">Delete</button>':
    '<button class="primary createCp" data-id="'+c.id+'">Create their account</button><button class="danger-btn deleteCounterpart" data-id="'+c.id+'" data-name="'+esc(c.name)+'">Delete</button>')+'</div></article>';
}
function counterpartWorkspaceHtml(counterpartId){
  const c=state.counterparts.find(function(x){return x.id===counterpartId});if(!c)return '';
  const linked=c.linked_profile_id?profile(c.linked_profile_id):null;
  if(!linked)return '';
  const tasks=state.templates.filter(function(t){return t.owner_profile_id===linked.id});
  const upcoming=counterpartUpcoming(linked.id,60).slice(0,12);
  const stats=counterpartTaskStats(linked.id);
  const taskHtml=tasks.length?tasks.map(function(t){
    const p=periodKey(t);
    const done=state.completions.some(function(x){return x.template_id===t.id&&x.profile_id===linked.id&&x.period_key===p});
    const overdue=!done&&t.due_date&&t.due_date<iso(new Date());
    return '<div class="workspace-task premium '+(done?'done ':'')+(overdue?'overdue':'')+'"><div class="workspace-check premium">'+(done?'✓':'')+'</div><div class="workspace-task-copy"><strong>'+esc(t.title)+'</strong><div class="workspace-task-meta"><span>'+(t.assigned_by?'Assigned by council':'Personal task')+'</span><span class="'+(overdue?'overdue':'')+'">'+(t.due_date?'Due '+niceDate(t.due_date):'No deadline')+'</span></div></div><div class="workspace-task-state '+(done?'done':overdue?'overdue':'open')+'">'+(done?'Completed':overdue?'Overdue':'Open')+'</div><button class="task-delete deleteTask" data-id="'+t.id+'" data-workspace="'+counterpartId+'" title="Delete task">×</button></div>';
  }).join(''):'<div class="workspace-empty">No tasks on their checklist yet.</div>';
  const calendarHtml=upcoming.length?upcoming.map(function(x){
    const m=x.meeting;
    return '<div class="workspace-event"><div class="workspace-date"><strong>'+new Date(iso(x.date)+'T12:00:00').getDate()+'</strong><span>'+new Date(iso(x.date)+'T12:00:00').toLocaleDateString('en-US',{month:'short'})+'</span></div><div><strong>'+esc(m.title)+'</strong><span>'+meetingTimeText(m)+' · '+esc(m.mode)+'</span></div></div>';
  }).join(''):'<div class="workspace-empty">No upcoming calendar events.</div>';
  return '<div class="counterpart-workspace-backdrop" id="counterpartWorkspaceBackdrop"><section class="counterpart-workspace"><div class="workspace-head"><div><div class="eyebrow">CHAPTER S\'GAN WORKSPACE</div><h2>'+esc(c.name)+'</h2><p>'+esc(c.chapter)+'</p></div><button class="modal-close" id="counterpartWorkspaceClose">×</button></div>'+
  '<div class="workspace-summary"><div><span>Completed</span><strong>'+stats.done+'/'+stats.total+'</strong></div><div><span>Open tasks</span><strong>'+stats.open+'</strong></div><div><span>Overdue</span><strong>'+stats.overdue+'</strong></div><div><span>Upcoming events</span><strong>'+upcoming.length+'</strong></div></div>'+
  '<div class="workspace-columns"><section><div class="workspace-section-head"><div><div class="eyebrow">CHECKLIST</div><h3>Tasks</h3></div><button class="tiny-btn assignTask" data-profile="'+linked.id+'" data-name="'+esc(c.name)+'">+ Assign task</button></div><div class="workspace-task-list">'+taskHtml+'</div></section>'+
  '<section><div class="workspace-section-head"><div><div class="eyebrow">CALENDAR</div><h3>Upcoming</h3></div></div><div class="workspace-event-list">'+calendarHtml+'</div></section></div>'+
  '</section></div>';
}
function openCounterpartWorkspace(id){
  const host=document.getElementById('counterpartWorkspaceHost');if(!host)return;
  host.innerHTML=counterpartWorkspaceHtml(id);
  const close=document.getElementById('counterpartWorkspaceClose');if(close)close.onclick=closeCounterpartWorkspace;
  const bg=document.getElementById('counterpartWorkspaceBackdrop');if(bg)bg.onclick=function(e){if(e.target.id==='counterpartWorkspaceBackdrop')closeCounterpartWorkspace()};
  document.querySelectorAll('.counterpart-workspace .assignTask').forEach(function(btn){btn.onclick=async function(){await assignCounterpartTask(btn.dataset.profile,btn.dataset.name);openCounterpartWorkspace(id)}});
  document.querySelectorAll('.counterpart-workspace .deleteTask').forEach(function(btn){btn.onclick=deleteTask});
}
function closeCounterpartWorkspace(){const host=document.getElementById('counterpartWorkspaceHost');if(host)host.innerHTML=''}

function visitsHtml(){
  const list=state.visits.filter(function(x){return x.created_by===me.id});
  return '<section class="card"><div class="card-head"><div><div class="eyebrow">CHAPTER VISITS</div><h2>Visit Tracker</h2></div></div><form id="visitForm" class="form-grid"><label>Chapter<input id="vChapter" required></label><label>Date<input id="vDate" type="date" required></label><label class="wide">What went well?<input id="vGood"></label><label class="wide">What do they need help with?<input id="vHelp"></label><label class="wide">Follow-up / next step<input id="vNext"></label><button class="primary">Log visit</button></form></section><section class="card" style="margin-top:15px"><div class="visit-grid">'+(list.length?list.map(function(x){return '<article class="visit-card"><div class="eyebrow">'+niceDate(x.visit_date)+'</div><h3>'+esc(x.chapter)+'</h3><p><b>Went well:</b> '+esc(x.went_well||'—')+'</p><p><b>Needs help:</b> '+esc(x.needs_help||'—')+'</p><p><b>Next:</b> '+esc(x.follow_up||'—')+'</p></article>'}).join(''):'<div class="empty">No visits logged yet.</div>')+'</div></section>';
}

function adminHtml(){
  return '<section class="hero"><div class="hero-copy"><div class="eyebrow">REGIONAL ADMIN</div><h1>Build the network.</h1><p>Create councils, add Council S\'ganim/S\'ganiot, and manage account access.</p></div></section><div class="grid-2"><section class="card"><div class="eyebrow">NEW COUNCIL</div><h2>Add a council</h2><form id="councilForm" class="form-grid"><label>Code<input id="cCode" placeholder="e.g. NNJAZA" required></label><label class="wide">Display name<input id="cName" required></label><button class="primary">Create council</button></form></section><section class="card"><div class="eyebrow">COUNCIL S\'GAN/S\'GANIT</div><h2>Create leader account</h2><form id="leaderForm" class="form-grid"><label class="wide">Display name<input id="lName" required></label><label>Council<select id="lCouncil">'+state.councils.map(function(c){return '<option value="'+c.id+'">'+esc(c.name)+'</option>'}).join('')+'</select></label><label>Email<input id="lEmail" type="email" required></label><label>Password<input id="lPass" type="text" required></label><button class="primary">Create Council S\'gan/S\'ganit</button></form></section></div><section class="card" style="margin-top:15px"><div class="eyebrow">COUNCILS</div><h2>Regional structure</h2><div class="council-grid">'+state.councils.map(function(c){const leads=state.profiles.filter(function(p){return p.council_id===c.id&&(p.role==='admin'||p.role==='council_sgan')});return '<article class="council-card"><strong>'+esc(c.name)+'</strong><span class="muted" style="display:block;font-size:10px;margin:3px 0 9px">'+esc(c.display_name)+'</span><div class="list">'+(leads.length?leads.map(function(p){return '<div class="item"><div><strong>'+esc(p.display_name)+'</strong><span>'+roleLabel(p.role)+'</span></div></div>'}).join(''):'<div class="empty">No S\'gan assigned yet.</div>')+'</div></article>'}).join('')+'</div></section>';
}

function programStatusMeta(status){
  if(status==='accepted')return {label:'Accepted',cls:'accepted',icon:'✓'};
  if(status==='needs_changes')return {label:'Needs updates',cls:'changes',icon:'↻'};
  return {label:'In review',cls:'submitted',icon:'•'};
}
function programsHtml(){
  const allForms=(state.programs||[]).filter(function(x){return me.role==='admin'||x.council_id===me.council_id||x.submitted_by===me.id});
  const forms=me.role==='counterpart'?allForms:allForms.filter(function(x){return !(x.hidden_by_profiles||[]).includes(me.id)});
  if(me.role==='counterpart'){
    const submitted=forms.filter(function(x){return x.status==='submitted'}).length;
    const accepted=forms.filter(function(x){return x.status==='accepted'}).length;
    const changes=forms.filter(function(x){return x.status==='needs_changes'}).length;
    return '<section class="program-hero"><div><div class="eyebrow">PROGRAM PLANNING</div><h1>Send it in.<br><span>We\'ll take it from here.</span></h1><p>Upload your Program Planning Form and track exactly where it stands.</p></div><div class="program-stat-stack"><div><strong>'+submitted+'</strong><span>In review</span></div><div><strong>'+accepted+'</strong><span>Accepted</span></div><div><strong>'+changes+'</strong><span>Needs updates</span></div></div></section>'+
    '<section class="program-submit-card"><div class="program-submit-head"><div><div class="eyebrow">NEW SUBMISSION</div><h2>Submit a Program Planning Form</h2><p>PDF only · up to 10 MB</p></div><div class="program-step-badge">01</div></div>'+
    '<form id="programForm" class="program-form"><div class="program-fields"><label>Program name<input id="pName" placeholder="e.g. Late Night Lip Sync" required></label><label>Chapter<input id="pChapter" placeholder="Your chapter" required></label><label>Program date<input id="pDate" type="date"></label></div>'+
    '<label class="program-upload-zone" for="pFile"><input id="pFile" type="file" accept="application/pdf,.pdf" required><div class="upload-icon">↑</div><div><strong>Drop in your PDF</strong><span>or click to choose your Program Planning Form</span></div><div class="upload-chip">PDF</div></label>'+
    '<div class="program-submit-footer"><div><strong>What happens next?</strong><span>Your Council S\'gan/S\'ganit reviews it and either accepts it or sends constructive fixes.</span></div><button class="primary program-submit-btn">Submit for review →</button></div></form></section>'+
    programListHtml(forms,false);
  }
  const waiting=forms.filter(function(x){return x.status==='submitted'}).length;
  const changes=forms.filter(function(x){return x.status==='needs_changes'}).length;
  const accepted=forms.filter(function(x){return x.status==='accepted'}).length;
  const hidden=allForms.filter(function(x){return (x.hidden_by_profiles||[]).includes(me.id)});
  return '<section class="program-hero leader"><div><div class="eyebrow">PROGRAM REVIEW DESK</div><h1>Review smarter.<br><span>Build better programs.</span></h1><p>Open the PDF, leave useful feedback, and move each submission forward.</p></div><div class="program-stat-stack"><div><strong>'+waiting+'</strong><span>Waiting</span></div><div><strong>'+changes+'</strong><span>Needs updates</span></div><div><strong>'+accepted+'</strong><span>Accepted</span></div></div></section>'+
  programListHtml(forms,true)+hiddenProgramsHtml(hidden);
}
function programListHtml(forms,leader){
  if(!forms.length)return '<section class="program-empty"><div class="program-empty-icon">▤</div><h3>No program forms yet</h3><p>'+(leader?'New chapter submissions will show up here.':'Your submitted forms will show up here.')+'</p></section>';
  const ordered=forms.slice().sort(function(a,b){
    const rank={submitted:0,needs_changes:1,accepted:2};
    return (rank[a.status]||0)-(rank[b.status]||0)||String(b.created_at).localeCompare(String(a.created_at));
  });
  return '<section class="program-board"><div class="program-board-head"><div><div class="eyebrow">'+(leader?'REVIEW QUEUE':'MY SUBMISSIONS')+'</div><h2>'+ordered.length+' program'+(ordered.length===1?'':'s')+'</h2></div><span class="program-board-hint">'+(leader?'Newest and waiting items first':'Tap the PDF anytime to reopen it')+'</span></div><div class="program-grid">'+ordered.map(function(p){
    const submitter=profile(p.submitted_by),meta=programStatusMeta(p.status);
    const submittedDate=p.created_at?new Date(p.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
    const feedback=p.council_feedback?'<div class="program-feedback-box premium"><div class="program-feedback-icon">✦</div><div><div class="program-feedback-label">Council feedback</div><p>'+esc(p.council_feedback)+'</p>'+(p.reviewed_at?'<span class="program-feedback-time">Updated '+new Date(p.reviewed_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})+'</span>':'')+'</div></div>':'';
    const review=leader?'<div class="program-review-panel"><label><span>Review notes / fixes</span><textarea class="programFeedback" data-id="'+p.id+'" rows="4" placeholder="Be specific and constructive — what should they change, add, or clarify?">'+esc(p.council_feedback||'')+'</textarea></label><div class="program-review-actions"><button class="ghost openProgramPdf" data-path="'+esc(p.file_path)+'">Open PDF ↗</button><button class="ghost programDecision needs-changes" data-id="'+p.id+'" data-status="needs_changes">How we can fix this</button><button class="primary programDecision" data-id="'+p.id+'" data-status="accepted">Accept program ✓</button></div><div class="program-management-actions"><button class="ghost hideProgram" data-id="'+p.id+'">Hide from my view</button><button class="danger-btn deleteProgram" data-id="'+p.id+'" data-path="'+esc(p.file_path)+'">Delete program</button></div></div>':'<div class="program-card-actions"><button class="ghost openProgramPdf" data-path="'+esc(p.file_path)+'">Open PDF ↗</button></div>';
    return '<article class="program-card '+meta.cls+'"><div class="program-card-top"><div class="program-doc-icon">PDF</div><div class="program-card-title"><h3>'+esc(p.program_name)+'</h3><div class="program-primary-meta"><div><span>Chapter</span><strong>'+esc(p.chapter_name)+'</strong></div><div><span>Program date</span><strong>'+(p.program_date?niceDate(p.program_date):'TBD')+'</strong></div></div><div class="program-meta">'+(submitter&&leader?esc(submitter.display_name)+' · ':'')+(submittedDate?'Submitted '+submittedDate:'')+'</div></div><div class="program-status '+meta.cls+'"><span>'+meta.icon+'</span>'+meta.label+'</div></div>'+
    feedback+review+'</article>';
  }).join('')+'</div></section>';
}

function hiddenProgramsHtml(forms){
  if(!forms.length)return '';
  return '<section class="program-hidden"><div class="program-hidden-head"><div><div class="eyebrow">HIDDEN FROM YOUR VIEW</div><h3>'+forms.length+' hidden program'+(forms.length===1?'':'s')+'</h3></div></div><div class="program-hidden-list">'+forms.map(function(p){return '<div class="program-hidden-row"><div><strong>'+esc(p.program_name)+'</strong><span>'+esc(p.chapter_name)+(p.program_date?' · '+niceDate(p.program_date):'')+'</span></div><button class="ghost unhideProgram" data-id="'+p.id+'">Restore</button></div>'}).join('')+'</div></section>';
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
  document.querySelectorAll('.deleteTask').forEach(function(btn){btn.onclick=deleteTask});
  document.querySelectorAll('.cpField').forEach(function(el){el.onchange=async function(){const patch={};patch[el.dataset.field]=el.value;await sb.from('counterparts').update(patch).eq('id',el.dataset.id);await loadAll();renderShell()}});
  document.querySelectorAll('.createCp').forEach(function(btn){btn.onclick=function(){createCounterpartAccount(btn.dataset.id)}});
  document.querySelectorAll('.deleteCounterpart').forEach(function(btn){btn.onclick=deleteCounterpart});
  document.querySelectorAll('.assignTask').forEach(function(btn){btn.onclick=function(){assignCounterpartTask(btn.dataset.profile,btn.dataset.name)}});
  document.querySelectorAll('.openWorkspace').forEach(function(btn){btn.onclick=function(){openCounterpartWorkspace(btn.dataset.id)}});
  document.querySelectorAll('[data-thread]').forEach(function(btn){btn.onclick=function(){activeThread=btn.dataset.thread;renderShell()}});
  const chat=document.getElementById('chatForm');if(chat)chat.onsubmit=sendMessage;
  const mf=document.getElementById('meetingForm');if(mf)mf.onsubmit=addMeeting;
  const prevWeek=document.getElementById('prevWeekBtn');if(prevWeek)prevWeek.onclick=function(){scheduleWeekOffset--;renderShell()};
  const todayWeek=document.getElementById('todayWeekBtn');if(todayWeek)todayWeek.onclick=function(){scheduleWeekOffset=0;renderShell()};
  const nextWeek=document.getElementById('nextWeekBtn');if(nextWeek)nextWeek.onclick=function(){scheduleWeekOffset++;renderShell()};
  const vf=document.getElementById('visitForm');if(vf)vf.onsubmit=addVisit;
  const at=document.getElementById('addTaskBtn');if(at)at.onclick=addPersonalTask;
  const of=document.getElementById('oneForm');if(of)of.onsubmit=requestOne;
  document.querySelectorAll('.reqAction').forEach(function(btn){btn.onclick=async function(){await sb.from('one_on_one_requests').update({status:btn.dataset.status}).eq('id',btn.dataset.id);await loadAll();renderShell()}});
  const cf=document.getElementById('councilForm');if(cf)cf.onsubmit=addCouncil;
  const lf=document.getElementById('leaderForm');if(lf)lf.onsubmit=createLeader;
  const cpf=document.getElementById('counterpartForm');if(cpf)cpf.onsubmit=addCounterpart;
  const pf=document.getElementById('programForm');if(pf)pf.onsubmit=submitProgram;
  const pFile=document.getElementById('pFile');if(pFile)pFile.onchange=function(){const zone=document.querySelector('.program-upload-zone');if(!zone)return;const file=pFile.files&&pFile.files[0];zone.classList.toggle('has-file',!!file);const name=zone.querySelector('.upload-chip');if(name&&file)name.textContent=file.name.length>18?file.name.slice(0,15)+'...':file.name;};
  document.querySelectorAll('.openProgramPdf').forEach(function(btn){btn.onclick=async function(){const r=await sb.storage.from('program-planning-forms').createSignedUrl(btn.dataset.path,300);if(r.error){alert(r.error.message);return;}window.open(r.data.signedUrl,'_blank')}});
  document.querySelectorAll('.programDecision').forEach(function(btn){btn.onclick=async function(){const box=document.querySelector('.programFeedback[data-id="'+btn.dataset.id+'"]');const feedback=box?box.value.trim():'';if(btn.dataset.status==='needs_changes'&&!feedback){alert('Add a helpful note explaining how the program can be improved.');return;}const r=await sb.from('program_planning_forms').update({status:btn.dataset.status,council_feedback:feedback,reviewed_by:me.id,reviewed_at:new Date().toISOString()}).eq('id',btn.dataset.id);if(r.error){alert(r.error.message);return;}await loadAll();renderShell()}});
  document.querySelectorAll('.hideProgram').forEach(function(btn){btn.onclick=async function(){const p=state.programs.find(function(x){return x.id===btn.dataset.id});if(!p)return;const hidden=(p.hidden_by_profiles||[]).filter(function(id){return id!==me.id});hidden.push(me.id);const r=await sb.from('program_planning_forms').update({hidden_by_profiles:hidden}).eq('id',p.id);if(r.error){alert(r.error.message);return;}await loadAll();renderShell()}});
  document.querySelectorAll('.unhideProgram').forEach(function(btn){btn.onclick=async function(){const p=state.programs.find(function(x){return x.id===btn.dataset.id});if(!p)return;const hidden=(p.hidden_by_profiles||[]).filter(function(id){return id!==me.id});const r=await sb.from('program_planning_forms').update({hidden_by_profiles:hidden}).eq('id',p.id);if(r.error){alert(r.error.message);return;}await loadAll();renderShell()}});
  document.querySelectorAll('.deleteProgram').forEach(function(btn){btn.onclick=async function(){if(!confirm('Delete this program permanently? This cannot be undone.'))return;const path=btn.dataset.path;if(path){const sr=await sb.storage.from('program-planning-forms').remove([path]);if(sr.error){alert(sr.error.message);return;}}const r=await sb.from('program_planning_forms').delete().eq('id',btn.dataset.id);if(r.error){alert(r.error.message);return;}await loadAll();renderShell()}});
  document.querySelectorAll('.saveMeetingNote').forEach(function(btn){btn.onclick=saveMeetingNote});
  document.querySelectorAll('.openMeeting').forEach(function(btn){btn.onclick=function(){openMeetingModal(btn.dataset.meeting,btn.dataset.date)}});
}

async function deleteCounterpart(e){
  e.preventDefault();
  e.stopPropagation();
  const btn=e.currentTarget,id=btn.dataset.id,name=btn.dataset.name||'this counterpart';
  const cp=state.counterparts.find(function(x){return x.id===id});if(!cp)return;
  const hasAccount=!!cp.linked_profile_id;
  const msg='Delete '+name+' from your counterparts?'+(hasAccount?' Their login account will stay active; this only removes them from your People list.':'');
  if(!confirm(msg))return;
  const r=await sb.from('counterparts').delete().eq('id',id);
  if(r.error){alert('Could not delete counterpart: '+r.error.message);return;}
  await loadAll();
  renderShell();
}
async function deleteTask(e){
  e.preventDefault();
  e.stopPropagation();
  const btn=e.currentTarget,id=btn.dataset.id;
  const task=state.templates.find(function(t){return t.id===id});if(!task)return;
  if(!confirm('Delete "'+task.title+'" permanently?'))return;
  const r=await sb.from('check_templates').delete().eq('id',id);
  if(r.error){alert(r.error.message);return;}
  const workspaceId=btn.dataset.workspace||'';
  await loadAll();
  if(workspaceId&&document.getElementById('counterpartWorkspaceHost'))openCounterpartWorkspace(workspaceId);
  else renderShell();
}
async function assignCounterpartTask(profileId,name){
  const title=prompt('Task for '+name+':');
  if(!title||!title.trim())return false;
  const deadline=prompt('Deadline for '+name+' (YYYY-MM-DD), or leave blank for no deadline:')||'';
  if(deadline&&!/^\d{4}-\d{2}-\d{2}$/.test(deadline)){alert('Use YYYY-MM-DD for the deadline.');return false;}
  const r=await sb.from('check_templates').insert({
    council_id:me.council_id,
    owner_profile_id:profileId,
    assigned_by:me.id,
    title:title.trim(),
    group_name:'Assigned Tasks',
    cadence:'once',
    due_date:deadline||null,
    active:true
  });
  if(r.error){alert(r.error.message);return false;}
  await loadAll();
  alert('Task added to '+name+'\'s checklist'+(deadline?' with a deadline of '+niceDate(deadline):'')+'.');
  return true;
}
async function addPersonalTask(){
  const title=prompt('Task name:');
  if(!title||!title.trim())return;
  const r=await sb.from('check_templates').insert({
    council_id:me.council_id,
    owner_profile_id:me.id,
    title:title.trim(),
    group_name:'My Tasks',
    cadence:'once',
    active:true
  });
  if(r.error){alert(r.error.message);return;}
  await loadAll();renderShell();
}
async function createCounterpartAccount(id){
  const cp=state.counterparts.find(function(x){return x.id===id});if(!cp)return;
  const email=prompt('Email for '+cp.name+':');if(!email)return;
  const password=prompt('Temporary password for '+cp.name+' (they can change it later):');if(!password)return;
  const r=await sb.functions.invoke('create-managed-user',{body:{email:email,password:password,display_name:cp.name,role:'counterpart',council_id:cp.council_id,linked_counterpart_id:cp.id}});
  if(r.error){alert(r.error.message);return;}
  if(r.data&&r.data.user_id)await sb.from('meetings').update({attendee_profile_id:r.data.user_id}).eq('owner_profile_id',me.id).eq('counterpart_id',cp.id);
  await loadAll();renderShell();alert('Account created for '+cp.name+'.');
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
async function submitProgram(e){
  e.preventDefault();
  const input=document.getElementById('pFile'),file=input&&input.files&&input.files[0];
  if(!file){alert('Choose a PDF first.');return;}
  if(file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf')){alert('Program Planning Forms must be PDFs.');return;}
  if(file.size>10*1024*1024){alert('PDF must be 10 MB or smaller.');return;}
  const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
  const path=me.council_id+'/'+me.id+'/'+Date.now()+'-'+safe;
  const up=await sb.storage.from('program-planning-forms').upload(path,file,{contentType:'application/pdf'});
  if(up.error){alert(up.error.message);return;}
  const row={council_id:me.council_id,submitted_by:me.id,chapter_name:v('pChapter'),program_name:v('pName'),program_date:v('pDate')||null,file_path:path,file_name:file.name,ai_status:'unavailable'};
  const r=await sb.from('program_planning_forms').insert(row).select().single();
  if(r.error){alert(r.error.message);return;}
  await loadAll();renderShell();
}
async function addMeeting(e){e.preventDefault();const contact=v('mCounterpart');const cp=contact&&contact!=='__GJR_STAFF__'?state.counterparts.find(function(x){return x.id===contact}):null;const row={council_id:me.council_id,title:v('mTitle'),mode:v('mMode'),start_date:v('mDate'),start_time:v('mStart'),end_time:v('mEnd')||null,recurrence:v('mRepeat'),url:v('mUrl'),location:v('mLocation'),owner_profile_id:me.id,counterpart_id:cp?cp.id:null,attendee_profile_id:cp&&cp.linked_profile_id?cp.linked_profile_id:null,contact_type:contact==='__GJR_STAFF__'?'gjr_staff':cp?'counterpart':'none',contact_name:contact==='__GJR_STAFF__'?'GJR Staff':cp?cp.name:''};const r=await sb.from('meetings').insert(row);if(r.error){alert(r.error.message);return;}await loadAll();renderShell()}
function openMeetingModal(meetingId,date){
  const m=state.meetings.find(function(x){return x.id===meetingId});if(!m)return;
  const host=document.getElementById('meetingModalHost');if(!host)return;
  const n=occurrenceNote(meetingId,date),contact=meetingContactName(m),own=m.owner_profile_id===me.id;
  const recurrence=m.recurrence==='none'?'One time':m.recurrence==='weekly'?'Weekly':'Every other week';
  host.innerHTML='<div class="meeting-modal-backdrop" id="meetingModalBackdrop"><section class="meeting-modal"><div class="meeting-modal-head"><div><div class="eyebrow">MEETING DETAILS</div><h2>'+esc(m.title)+'</h2></div><button class="modal-close" id="meetingModalClose">×</button></div><div class="meeting-detail-grid">'+
    '<div class="meeting-detail"><span>Date</span><strong>'+niceDate(date)+'</strong></div>'+
    '<div class="meeting-detail"><span>Time</span><strong>'+meetingTimeText(m)+'</strong></div>'+
    '<div class="meeting-detail"><span>With</span><strong>'+esc(contact||'No specific contact')+'</strong></div>'+
    '<div class="meeting-detail"><span>Type</span><strong>'+esc(m.mode)+'</strong></div>'+
    '<div class="meeting-detail"><span>Repeats</span><strong>'+esc(recurrence)+'</strong></div>'+
    '<div class="meeting-detail"><span>Location</span><strong>'+esc(m.location||'—')+'</strong></div>'+
  '</div>'+
  (m.url?'<a class="meeting-join" target="_blank" rel="noopener" href="'+esc(m.url)+'">Join meeting ↗</a>':'')+
  '<div class="meeting-notes-panel"><div class="eyebrow">MEETING NOTES</div><h3>'+ (own?'Your notes':'Notes from the Council S\'gan') +'</h3>'+
  (own?'<textarea id="modalMeetingNote" rows="7" placeholder="Add notes from this meeting...">'+esc(n?n.notes:'')+'</textarea><button class="primary" id="modalSaveNote">Save notes</button>':
  '<div class="meeting-note-readonly">'+esc(n&&n.notes?n.notes:'No notes have been added yet.')+'</div>')+
  '</div></section></div>';
  document.getElementById('meetingModalClose').onclick=closeMeetingModal;
  document.getElementById('meetingModalBackdrop').onclick=function(e){if(e.target.id==='meetingModalBackdrop')closeMeetingModal()};
  const save=document.getElementById('modalSaveNote');if(save)save.onclick=async function(){
    const notes=document.getElementById('modalMeetingNote').value.trim();
    await saveMeetingNoteValue(meetingId,date,notes);
    openMeetingModal(meetingId,date);
  };
}
function closeMeetingModal(){const host=document.getElementById('meetingModalHost');if(host)host.innerHTML=''}
async function saveMeetingNoteValue(meetingId,date,notes){
  const existing=occurrenceNote(meetingId,date);
  let r;
  if(existing)r=await sb.from('meeting_occurrence_notes').update({notes:notes,updated_at:new Date().toISOString()}).eq('id',existing.id);
  else r=await sb.from('meeting_occurrence_notes').insert({meeting_id:meetingId,occurrence_date:date,owner_profile_id:me.id,notes:notes});
  if(r.error){alert(r.error.message);return false;}
  await loadAll();return true;
}
async function saveMeetingNote(e){
  const btn=e.currentTarget,meetingId=btn.dataset.meeting,date=btn.dataset.date;
  const field=document.querySelector('.meetingNoteField[data-meeting="'+meetingId+'"][data-date="'+date+'"]');
  const notes=field?field.value.trim():'';
  const ok=await saveMeetingNoteValue(meetingId,date,notes);
  if(ok)renderShell();
}
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
