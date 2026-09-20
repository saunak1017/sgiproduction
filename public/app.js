import {STAGES,STAMPS,FILE_GROUPS,MAX_FILE_SIZE,stoneTotal,carats,money,orderTotal,parseDateInput,displayDate,dueBucket,nyClock,projectName,projectRef} from './domain.js';

const app=document.querySelector('#app');
const state={user:null,project:null,route:'',dirty:false,busy:false,routeSequence:0};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={diamond:'<path d="m3 8 5-5h8l5 5-9 14L3 8Z M3 8h18M8 3l4 19 4-19"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',check:'<path d="m5 12 4 4L19 6"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',exit:'<path d="M9 4H4v16h5m5-13 5 5-5 5m-5-5h10"/>',plus:'<path d="M12 5v14M5 12h14"/>',arrow:'<path d="m9 5 7 7-7 7M4 12h12"/>',back:'<path d="m10 5-7 7 7 7m-7-7h17"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',box:'<path d="m3 7 9-4 9 4v11l-9 4-9-4V7Zm0 0 9 5 9-5M12 12v10M7 5l10 5"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M19 8a8 8 0 0 0-14-2m0 10a8 8 0 0 0 14 2"/>',edit:'<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z"/>',file:'<path d="M13 3H5v18h14V9l-6-6Zm0 0v6h6"/>',image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',chat:'<path d="M4 4h16v12H9l-5 5V4Z"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.file}</svg>`;
const brand=()=>`<a class="brand" href="#/active" aria-label="Shivani Gems home"><img class="brand-logo" src="/branding/shivani-logo.PNG" alt="Shivani Gems"></a>`;
const initials=name=>name.split(/\s+/).map(s=>s[0]).slice(0,2).join('').toUpperCase();
const time=v=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(v))+' ET';
const fileSize=n=>n<1024*1024?`${Math.ceil(n/1024)} KB`:`${(n/1024/1024).toFixed(1)} MB`;
const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
let toastTimer;
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4500);}
async function api(path,options={}){
  const headers={...options.headers};
  if(options.data!==undefined){headers['Content-Type']='application/json';options.body=JSON.stringify(options.data);delete options.data;}
  const response=await fetch(`/api${path}`,{credentials:'same-origin',...options,headers});
  const result=await response.json().catch(()=>({error:'Unexpected response. Please try again.'}));
  if(!response.ok){const e=new Error(result.error || `Request failed (${response.status})`);e.status=response.status;throw e;}
  return result;
}
function setError(root,message){$('.error',root).textContent=message;}
function shell(content,section='active'){
  const u=state.user;
  app.innerHTML=`<aside class="sidebar">${brand()}<p class="workspace-label">Workspace</p><nav class="nav" aria-label="Main navigation">
    <a href="#/active" class="${section==='active'?'active':''}">${icon('grid')}Active Projects</a>
    <a href="#/completed" class="${section==='completed'?'active':''}">${icon('check')}Completed</a>
    ${u.role==='admin'?`<a href="#/notifications" class="${section==='notifications'?'active':''}">${icon('mail')}Email Activity</a>`:''}
    <a href="#/account" class="${section==='account'?'active':''}">${icon('user')}My Account</a>
    </nav><div class="sidebar-bottom"><div class="partner-label">${icon('box')}<div>RFG Workshop<small>New York · Production partner</small></div></div><div class="user-menu"><div class="avatar">${esc(initials(u.display_name))}</div><div class="user-meta">${esc(u.display_name)}<small>${u.role==='admin'?'Shivani · Admin':'RFG · Workshop'}</small></div><button class="icon-btn" id="logout" aria-label="Sign out">${icon('exit')}</button></div></div></aside>
    <div class="layout"><header class="topbar"><div class="crumb">Shivani Gems ${icon('arrow')} <span>Production</span></div><div class="today"><span class="live-dot"></span>New York · ${displayDate(nyClock().date)}</div></header><main id="main" class="container" tabindex="-1">${content}</main></div>`;
  $('#logout').onclick=async()=>{
    if(!canLeave()) return;
    try{await api('/logout',{method:'POST'});state.user=null;state.dirty=false;renderLogin();}catch(e){toast(e.message);}
  };
}
function canLeave(){return !state.busy && (!state.dirty || confirm('You have unsaved changes. Leave this page?'));}
function go(route){if(!canLeave())return;state.dirty=false;location.hash=route;}
document.addEventListener('click',event=>{
  const a=event.target.closest('a[href^="#/"]');
  if(a && !event.ctrlKey && !event.metaKey && !event.shiftKey){event.preventDefault();go(a.getAttribute('href').slice(1));}
});
window.addEventListener('beforeunload',event=>{if(state.dirty||state.busy){event.preventDefault();event.returnValue='';}});
window.addEventListener('hashchange',()=>{
  if((state.dirty||state.busy)&&!canLeave()){history.replaceState(null,'',`#${state.route}`);return;}
  state.dirty=false;renderRoute();
});
async function boot(){
  try{state.user=(await api('/me')).user;await renderRoute();}
  catch(e){renderLogin(e.status===401?'':e.message);}
}
function renderLogin(error=''){
  state.dirty=false;state.busy=false;
  app.innerHTML=`<div class="login-page"><section class="login-brand-panel">${brand()}<div class="login-copy"><div class="eyebrow">Shivani × RFG Workshop</div><h1>Every detail.<br>Every step.<br>In one place.</h1><p>A shared workspace for the pieces we make together, from the first CAD to the final pickup.</p></div><svg class="login-art" viewBox="0 0 24 24" aria-hidden="true">${icons.diamond}</svg><footer>CRAFTED WITH CARE. CONNECTED BY DESIGN.</footer></section><main id="main" class="login-form-panel"><div class="login-form-wrap"><div class="eyebrow">Production portal</div><h2>Welcome back.</h2><p>Sign in to your production workspace.</p><form class="login-form" id="login-form"><label>Username<input name="username" autocomplete="username" required maxlength="60" autofocus></label><label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label><p class="error" role="alert">${esc(error)}</p><button class="btn primary">Sign in ${icon('arrow')}</button></form><p class="login-note">${icon('lock')} A private workspace for Shivani Gems and RFG.</p></div></main></div>`;
  $('#login-form').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget,button=$('button',form);button.disabled=true;setError(form,'');
    try{state.user=(await api('/login',{method:'POST',data:Object.fromEntries(new FormData(form))})).user;await renderRoute();}
    catch(e){setError(form,e.message);}finally{button.disabled=false;}
  };
}
async function renderRoute(){
  if(!state.user)return renderLogin();
  const route=location.hash.slice(1)||'/active';state.route=route;const sequence=++state.routeSequence;
  try{
    if(route==='/new') {if(state.user.role!=='admin')throw new Error('Only admins can create projects.');return renderOrderForm();}
    if(route==='/account')return renderAccount();
    if(route==='/notifications')return await renderNotifications(sequence);
    const projectMatch=route.match(/^\/project\/([a-f0-9-]{36})(\/edit)?$/);
    if(projectMatch){
      shell('<div class="loading" role="status">Opening project…</div>');
      const detail=await api(`/projects/${projectMatch[1]}`);if(sequence!==state.routeSequence)return;
      state.project=detail;
      if(projectMatch[2]){if(state.user.role!=='admin')throw new Error('Only admins can edit order specifications.');return renderOrderForm(detail.project);}
      return renderProject(detail);
    }
    return await renderDashboard(route==='/completed',sequence);
  }catch(e){
    if(sequence!==state.routeSequence)return;
    if(e.status===401){state.user=null;return renderLogin();}
    shell(`<div class="empty"><h2>Couldn’t open this page</h2><p>${esc(e.message)}</p><a class="btn" href="#/active">Back to projects</a></div>`);
  }
}
function stageBadge(stage){return `<span class="stage-badge tone-${stage}">${STAGES[stage]}</span>`;}
function miniTracker(p){return `<div class="mini-tracker tone-${p.stage}" aria-label="Stage ${p.stage+1} of 8: ${STAGES[p.stage]}">${STAGES.map((s,i)=>`<span title="${esc(s)}" class="${i===p.stage?'current':i<p.stage?'past':''}"></span>`).join('')}</div>`;}
function projectCard(p){
  const due=dueBucket(p),cost=p.cost!==''||p.invoice;
  return `<a class="project-card" href="#/project/${p.id}" aria-label="Open ${esc(projectName(p))}"><div class="card-top"><span class="project-ref">${projectRef(p)}</span>${icon('arrow').replace('<svg','<svg class="card-arrow"')}</div><h2>${esc(projectName(p))}</h2><div class="card-specs"><div><span>Metal</span><strong>${esc(p.metal||'Not specified')}</strong></div><div><span>Quantity</span><strong>${esc(p.quantity||'Not specified')}</strong></div></div><div class="card-date">${icon('calendar')}<span>${p.delivery_date?displayDate(p.delivery_date):'Delivery date not set'}</span>${due?`<span class="due-tag ${due}">${due==='overdue'?'Overdue':p.delivery_date===nyClock().date?'Due today':'Due soon'}</span>`:''}</div><div class="card-progress"><div class="progress-label">${stageBadge(p.stage)}<small>${p.stage+1} / 8</small></div>${miniTracker(p)}</div>${cost?`<div class="card-cost">${p.cost!==''?`<div><strong>${money(p.cost)}</strong> / ${p.cost_basis==='piece'?'piece':'order'}</div>`:''}${p.invoice?`<span>Invoice ${esc(p.invoice)}</span>`:''}</div>`:''}</a>`;
}
async function renderDashboard(completed,sequence){
  shell(`<section class="page-head dashboard-head"><div>${completed?'<div class="eyebrow">Production Workspace</div>':''}<h1>${completed?'Completed Projects':'Active Projects'}</h1>${completed?'<p>Finished pieces, received by Shivani.</p>':''}</div>${state.user.role==='admin'?`<a class="btn primary" href="#/new">${icon('plus')}New Project</a>`:''}</section><section class="stats" id="stats" aria-label="Project totals"><div class="stat"><p class="hint">Loading project totals…</p></div></section><div class="toolbar"><label class="search" aria-label="Search projects">${icon('search')}<input id="search" type="search" placeholder="Search projects, metal, or order number…" maxlength="200"></label><select id="stage-filter" aria-label="Filter by stage"><option value="">All stages</option>${STAGES.map((s,i)=>completed?i===7?`<option value="${i}">${s}</option>`:'':i<7?`<option value="${i}">${s}</option>`:'').join('')}</select>${completed?'':`<select id="due-filter" aria-label="Filter by delivery"><option value="">All delivery dates</option><option value="soon">Due within 2 days</option><option value="overdue">Overdue</option></select>`}<button class="icon-btn" id="refresh" aria-label="Refresh projects">${icon('refresh')}</button></div><p class="results-count" id="results-count" role="status"></p><div id="project-results"><div class="loading" role="status">Loading projects…</div></div>`,completed?'completed':'active');
  let offset=0,timer,requestNo=0;
  async function load(reset=false){
    if(reset)offset=0;const request=++requestNo;
    const params=new URLSearchParams({completed:String(completed),offset:String(offset),today:nyClock().date});
    for(const [id,key] of [['search','search'],['stage-filter','stage'],['due-filter','due']])if($(`#${id}`)?.value)params.set(key,$(`#${id}`).value);
    try{
      const result=await api(`/projects?${params}`);if(sequence!==state.routeSequence||request!==requestNo)return;
      $('#stats').innerHTML=[['box',result.stats.active,'Active projects'],['clock',result.stats.pickup,'Ready for pickup'],['check',result.stats.completed,'Completed projects']].map(([ico,n,label])=>`<div class="stat"><div class="stat-icon">${icon(ico)}</div><div><div class="stat-number">${n}</div><div class="stat-label">${label}</div></div></div>`).join('');
      $('#results-count').textContent=`${result.total} ${completed?'completed':'active'} project${result.total===1?'':'s'}${result.total>60?` · showing ${offset+1}–${offset+result.projects.length}`:''}`;
      $('#project-results').innerHTML=result.projects.length?`<div class="card-grid">${result.projects.map(projectCard).join('')}</div>${result.total>60?`<div class="pagination"><button class="btn small" id="previous-page" ${offset===0?'disabled':''}>Previous</button><span>Page ${Math.floor(offset/60)+1}</span><button class="btn small" id="next-page" ${offset+60>=result.total?'disabled':''}>Next</button></div>`:''}`:`<div class="empty">${icon(completed?'check':'diamond')}<h2>${completed?'Nothing completed yet':'Room for the next creation.'}</h2><p>${params.has('search')||params.has('stage')||params.has('due')?'No projects match these filters.':'Projects will appear here as your team adds and progresses them.'}</p>${!completed&&state.user.role==='admin'?'<a class="btn" href="#/new">Create a project</a>':''}</div>`;
      if($('#previous-page'))$('#previous-page').onclick=()=>{offset=Math.max(0,offset-60);load();};
      if($('#next-page'))$('#next-page').onclick=()=>{offset+=60;load();};
    }catch(e){if(sequence===state.routeSequence&&request===requestNo){$('#results-count').textContent=e.message;toast(e.message);}}
  }
  // Search is the only debounced network input. Project form fields never fetch.
  $('#search').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>load(true),240);};
  $('#stage-filter').onchange=()=>load(true);if($('#due-filter'))$('#due-filter').onchange=()=>load(true);
  $('#refresh').onclick=()=>load();await load();
}

const inputField=(name,label,value='',extra='')=>`<label>${label}<input name="${name}" value="${esc(value)}" maxlength="500" ${extra}></label>`;
let rowSequence=0;
function stoneRow(s={}){
  const n=++rowSequence;
  return `<div class="stone-row" data-stone="${n}"><label>Shape<input data-key="shape" value="${esc(s.shape||'')}" maxlength="100" placeholder="e.g. Round"></label><label>Weight (ct)<input data-key="weight" value="${esc(s.weight||'')}" inputmode="decimal" maxlength="30" placeholder="0.00"></label><label>Weight basis<select data-key="basis"><option value="per_stone" ${s.basis!=='total'?'selected':''}>Per stone</option><option value="total" ${s.basis==='total'?'selected':''}>Total weight</option></select></label><label>Quantity<input data-key="quantity" value="${esc(s.quantity||'')}" inputmode="numeric" maxlength="30" placeholder="e.g. 2"></label><label>Measurements<input data-key="measurements" value="${esc(s.measurements||'')}" maxlength="200" placeholder="e.g. 6 × 4 mm"></label><div><span class="field-label">Total weight</span><output>${carats(stoneTotal(s))}</output></div><button class="icon-btn remove-stone" type="button" aria-label="Remove stone row">${icon('close')}</button></div>`;
}
const getStone=row=>Object.fromEntries($$('[data-key]',row).map(el=>[el.dataset.key,el.value]));
function recalculateStones(root){
  let total=0,incomplete=false,has=false;
  for(const row of $$('.stone-row',root)){
    const s=getStone(row),value=stoneTotal(s);$('output',row).textContent=carats(value);
    if(Object.entries(s).some(([key,v])=>key!=='basis'&&v))has=true;
    if(value!==null)total+=value;else if(s.weight)incomplete=true;
  }
  $('#stone-total',root).textContent=`Combined weight: ${has?carats(total):'—'}${incomplete?' · enter stone quantities to finish':''}`;
}
function uploadsHTML(allow=true,files=[]){
  return `<div class="upload-grid">${Object.entries(FILE_GROUPS).map(([key,label])=>`<div class="upload-box" data-bucket="${key}"><h3>${icon(key==='reference'?'image':'file')}${label}</h3><p class="hint">${key==='reference'?'JPG, PNG, WEBP, HEIC, PDF & more':key.toUpperCase()+' design files'} · up to 100 MB each</p><div class="file-list" data-existing>${files.filter(f=>f.bucket===key).map(fileItem).join('')}</div>${allow?`<label class="upload-choose"><span class="hint">Add ${label.toLowerCase()}</span><input type="file" multiple data-files="${key}" accept="${key==='reference'?'.jpg,.jpeg,.png,.webp,.gif,.avif,.heic,.heif,.tif,.tiff,.bmp,.pdf':'.'+key}"></label><div class="file-list" data-pending></div>`:''}</div>`).join('')}</div>`;
}
function fileItem(f){const image=['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(f.mime);return `<div class="file-row">${image?`<a href="/api/files/${f.id}?inline=1" target="_blank" rel="noopener" aria-label="Preview ${esc(f.name)}"><img loading="lazy" src="/api/files/${f.id}?inline=1" alt="${esc(f.name)}"></a>`:icon('file')}<a class="file-download" href="/api/files/${f.id}" data-file-name="${esc(f.name)}">${esc(f.name)}<small>${fileSize(f.size)} · Download</small></a></div>`;}
function bindFileSelection(root){
  const selected=[];
  $$('[data-files]',root).forEach(input=>input.addEventListener('change',()=>{
    for(const file of input.files){
      if(file.size>MAX_FILE_SIZE||file.size===0){toast(`${file.name}: choose a file up to 100 MB.`);continue;}
      if(selected.some(s=>s.bucket===input.dataset.files&&s.file.name===file.name&&s.file.size===file.size&&s.file.lastModified===file.lastModified))continue;
      selected.push({key:crypto.randomUUID(),bucket:input.dataset.files,file});
    }
    state.dirty=selected.length>0||state.dirty;input.value='';renderPending();
  }));
  function renderPending(){
    $$('[data-bucket]',root).forEach(box=>{
      $('[data-pending]',box).innerHTML=selected.filter(s=>s.bucket===box.dataset.bucket).map(s=>`<div class="file-row">${icon('file')}<div class="file-info">${esc(s.file.name)}<small>${fileSize(s.file.size)} · waiting to upload</small></div><button class="icon-btn" type="button" data-remove-file="${s.key}" aria-label="Remove ${esc(s.file.name)}">${icon('close')}</button></div>`).join('');
    });
  }
  root.addEventListener('click',event=>{const b=event.target.closest('[data-remove-file]');if(!b)return;const index=selected.findIndex(f=>f.key===b.dataset.removeFile);if(index>=0)selected.splice(index,1);renderPending();});
  return selected;
}
async function retryUpload(fn){
  for(let attempt=0;attempt<3;attempt++){
    try{return await fn();}catch(e){if(attempt===2||e.status&&e.status<500&&e.status!==429)throw e;await new Promise(r=>setTimeout(r,700*(attempt+1)));}
  }
}
async function uploadFiles(projectId,selected,status){
  let uploaded=0;
  for(const entry of [...selected]){
    const progress=document.createElement('progress');progress.max=entry.file.size;progress.value=0;
    const caption=document.createElement('div');status.replaceChildren(caption,progress);
    caption.textContent=`Uploading ${entry.file.name} (${uploaded+1} of ${selected.length+uploaded})…`;
    if(!entry.upload)entry.upload=await api(`/projects/${projectId}/uploads`,{method:'POST',data:{bucket:entry.bucket,name:entry.file.name,size:entry.file.size}});
    const {id,chunk_size}=entry.upload;
    for(let start=0,part=1;start<entry.file.size;start+=chunk_size,part++){
      if(part<=(entry.completedParts||0)){progress.value=Math.min(start+chunk_size,entry.file.size);continue;}
      const chunk=entry.file.slice(start,Math.min(start+chunk_size,entry.file.size));
      await retryUpload(()=>api(`/files/${id}/parts/${part}`,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:chunk}));
      entry.completedParts=part;progress.value=Math.min(start+chunk_size,entry.file.size);
    }
    await retryUpload(()=>api(`/files/${id}/complete`,{method:'POST'}));
    selected.splice(selected.indexOf(entry),1);uploaded++;
  }
  status.textContent=uploaded?`${uploaded} file${uploaded===1?'':'s'} uploaded.`:'';
}
function renderOrderForm(project=null){
  const s=project?.spec||{},editing=!!project;
  shell(`<div class="form-width"><a class="back-link" href="#/${project?'project/'+project.id:'active'}">${icon('back')}Back to ${project?'project':'projects'}</a><section class="page-head"><div><div class="eyebrow">${project?projectRef(project):'Start something beautiful'}</div><h1>${editing?'Edit project':'New production project'}</h1><p>All order fields are optional. Add the details you have now.</p></div></section><form id="order-form" novalidate>
    <section class="panel form-panel"><div class="panel-head"><h2><span class="form-section-number">01</span>Project details</h2></div><div class="form-grid">${inputField('name','Project name',s.name,'placeholder="e.g. Emerald halo ring"')}${inputField('cad_file_name','CAD file name',s.cad_file_name,'placeholder="e.g. SG-1048-v2"')}${inputField('category','Category',s.category,'placeholder="e.g. Ring"')}${inputField('metal','Metal',s.metal,'placeholder="e.g. 18K yellow gold"')}${inputField('ring_size','Ring size',s.ring_size,'placeholder="e.g. 6.5"')}${inputField('quantity','Order quantity',s.quantity,'placeholder="e.g. 1 or 2 pairs"')}<label class="span-2">Setting information<input name="setting" value="${esc(s.setting||'')}" maxlength="500" placeholder="Setting style and production details"></label><label>Requested delivery date<span class="date-field"><input name="delivery_date" id="delivery-text" value="${esc(s.delivery_date?`${s.delivery_date.slice(5,7)}/${s.delivery_date.slice(8,10)}/${s.delivery_date.slice(0,4)}`:'')}" placeholder="MM/DD/YYYY" inputmode="numeric" maxlength="10"><span class="calendar-picker">${icon('calendar')}<input type="date" id="delivery-picker" value="${esc(s.delivery_date||'')}" aria-label="Choose requested delivery date" min="1900-01-01" max="2199-12-31" tabindex="0"></span></span></label></div></section>
    <section class="panel form-panel"><div class="panel-head"><div><h2><span class="form-section-number">02</span>Stone Information</h2><p>Choose whether each weight is per stone or for the full row.</p></div></div><div class="stone-rows" id="stone-rows">${(s.stones?.length?s.stones:[{}]).map(stoneRow).join('')}</div><div class="stone-summary"><button class="btn small" id="add-stone" type="button">${icon('plus')}Add stone</button><p id="stone-total" aria-live="polite"></p></div></section>
    <section class="panel form-panel"><div class="panel-head"><h2><span class="form-section-number">03</span>Finishing & Instructions</h2></div><div class="field-label">Stamping</div><div class="check-group">${STAMPS.map(v=>`<label><input type="checkbox" name="stamping" value="${v}" ${(s.stamping||[]).includes(v)?'checked':''}>${v}</label>`).join('')}</div><div id="other-stamping" class="${(s.stamping||[]).includes('Other')?'':'hidden'}"><br>${inputField('stamping_other','Other Stamping',s.stamping_other)}</div><br><label>Notes / Special Instructions<textarea name="notes" maxlength="20000" placeholder="Anything the workshop should know…">${esc(s.notes||'')}</textarea></label><br><label>CAD Modifications / CAD Checks<textarea name="cad_modifications" maxlength="20000" placeholder="List any CAD changes, checks, or approval notes RFG should review…">${esc(s.cad_modifications||'')}</textarea></label></section>
    <section class="panel form-panel"><div class="panel-head"><div><h2><span class="form-section-number">04</span>Project Files</h2><p>Multiple files per category. You can add more after creating the project.</p></div></div>${uploadsHTML(true,editing?state.project.files:[])}<div id="form-upload-status" class="upload-progress" role="status"></div></section>
    <div class="form-footer"><div><p id="save-note">${editing?'Changes save when you click Save changes.':'Your project will start at Project Created.'}</p><p class="error" role="alert"></p></div><div class="actions"><a class="btn" href="#/${project?'project/'+project.id:'active'}">Cancel</a><button class="btn primary" id="save-project" type="submit">${editing?'Save changes':'Create project'} ${icon('arrow')}</button></div></div></form></div>`);
  const form=$('#order-form');let saved=null;
  const selected=bindFileSelection(form);
  // Native, stable input elements: NO render calls, state synchronization, or requests on typing.
  form.addEventListener('input',event=>{
    state.dirty=true;
    if(event.target.closest('.stone-row'))recalculateStones(form);
    if(event.target.name==='stamping')$('#other-stamping').classList.toggle('hidden',!$('input[value="Other"]',form).checked);
    if(event.target.id==='delivery-text'){const parsed=parseDateInput(event.target.value);if(parsed!==null)$('#delivery-picker').value=parsed;}
  });
  $('#delivery-picker').onchange=event=>{const v=event.target.value;$('#delivery-text').value=v?`${v.slice(5,7)}/${v.slice(8,10)}/${v.slice(0,4)}`:'';state.dirty=true;};
  $('#add-stone').onclick=()=>{if($$('.stone-row',form).length>=100){toast('You can add up to 100 stone rows.');return;}$('#stone-rows').insertAdjacentHTML('beforeend',stoneRow());state.dirty=true;recalculateStones(form);};
  $('#stone-rows').onclick=event=>{const button=event.target.closest('.remove-stone');if(button){button.closest('.stone-row').remove();state.dirty=true;recalculateStones(form);}};
  recalculateStones(form);
  form.onsubmit=async event=>{
    event.preventDefault();if(state.busy)return;setError(form,'');
    const data=Object.fromEntries(new FormData(form));
    data.stamping=new FormData(form).getAll('stamping');data.stones=$$('.stone-row',form).map(getStone).filter(s=>Object.entries(s).some(([k,v])=>k!=='basis'&&v));
    data.delivery_date=parseDateInput(data.delivery_date||'');
    if(data.delivery_date===null){setError(form,'Use MM/DD/YYYY or YYYY-MM-DD for the delivery date.');$('#delivery-text').focus();return;}
    state.busy=true;const button=$('#save-project');button.disabled=true;button.textContent=saved?'Retrying files…':'Saving…';
    // Keep form controls stable while saved data/files are in flight.
    const controls=$$('input,textarea,select,button',form);controls.forEach(c=>c.disabled=true);
    try{
      if(!saved){const response=await api(project?`/projects/${project.id}`:'/projects',{method:project?'PATCH':'POST',data:{...data,...(project?{version:project.version}:{})}});saved=response.project;}
      $('#save-note').textContent='Project saved. Uploading selected files…';
      await uploadFiles(saved.id,selected,$('#form-upload-status'));
      state.dirty=false;state.busy=false;toast(editing?'Project updated.':'Project created.');location.hash=`/project/${saved.id}`;
    }catch(e){
      setError(form,saved?`Project saved. File upload stopped: ${e.message} Click Retry files to continue.`:e.message);
      button.textContent=saved?'Retry files':editing?'Save changes':'Create project';
      if(saved){$('#save-note').innerHTML=`The project is saved. <a href="#/project/${saved.id}">Open it without remaining files</a>.`;}
      // After a partial upload, freeze the already-saved specs but allow the retry button.
      controls.forEach(c=>c.disabled=!!saved);button.disabled=false;state.busy=false;
    }
  };
}

function spec(label,value){return `<div><span class="spec-label">${label}</span><div class="spec-value">${esc(value||'—')}</div></div>`;}
function renderProject(detail){
  const {project:p,files,comments,history}=detail,s=p.spec;
  state.project=detail;
  const visited=new Set(history.map(h=>h.to_stage));
  shell(`<a class="back-link" href="#/${p.stage===7?'completed':'active'}">${icon('back')}Back to ${p.stage===7?'completed':'active'} projects</a><section class="page-head project-head"><div><div class="eyebrow">${projectRef(p)}${s.category?' · '+esc(s.category):''}</div><h1>${esc(projectName(p))}</h1><div class="project-sub"><span>Created ${time(p.created_at)}</span>${stageBadge(p.stage)}</div></div><div class="actions"><button class="icon-btn" id="refresh-project" aria-label="Refresh project">${icon('refresh')}</button>${state.user.role==='admin'?`<a class="btn" href="#/project/${p.id}/edit">${icon('edit')}Edit project</a>`:''}<button class="btn primary" id="change-stage">Update stage ${icon('arrow')}</button></div></section>
    <section class="panel"><div class="panel-head"><h2>Production Progress</h2><span class="hint">Stage ${p.stage+1} of 8</span></div><ol class="tracker tone-${p.stage}">${STAGES.map((name,i)=>`<li class="${i===p.stage?'current':visited.has(i)?'visited':''}" ${i===p.stage?'aria-current="step"':''}><span class="step-number">${i+1}</span>${name}</li>`).join('')}</ol></section>
    <div class="project-columns"><div><section class="panel"><div class="panel-head"><h2>${icon('file')}Order Specifications</h2></div><div class="spec-grid">${spec('CAD file name',s.cad_file_name)}${spec('Category',s.category)}${spec('Ring size',s.ring_size)}${spec('Metal',p.metal)}${spec('Order quantity',p.quantity)}${spec('Requested delivery',displayDate(p.delivery_date))}</div><div class="full-spec">${spec('Setting information',s.setting)}</div><div class="full-spec"><span class="spec-label">Stamping</span><div class="chips">${(s.stamping||[]).length?s.stamping.map(v=>`<span class="chip">${v==='Other'?'Other'+(s.stamping_other?': '+esc(s.stamping_other):''):v}</span>`).join(''):'<span class="hint">Not specified</span>'}</div></div>${s.notes?`<div class="full-spec">${spec('Notes / Special Instructions',s.notes)}</div>`:''}</section>
    <section class="panel"><div class="panel-head"><h2>${icon('diamond')}Stone Information</h2><span class="hint">${s.stones?.length||0} row${s.stones?.length===1?'':'s'}</span></div>${s.stones?.length?`<div class="table-wrap"><table><thead><tr><th>Shape</th><th>Weight</th><th>Qty</th><th>Measurements</th><th>Total</th></tr></thead><tbody>${s.stones.map(stone=>`<tr><td>${esc(stone.shape||'—')}</td><td>${esc(stone.weight||'—')} ${stone.weight?'ct':''}<br><span class="hint">${stone.basis==='total'?'Total':'Per stone'}</span></td><td>${esc(stone.quantity||'—')}</td><td>${esc(stone.measurements||'—')}</td><td>${carats(stoneTotal(stone))}</td></tr>`).join('')}</tbody></table></div>`:'<p class="hint">No stones specified yet.</p>'}</section>
    <section class="panel"><div class="panel-head"><h2>${icon('box')}References</h2></div>${s.cad_modifications?`<div class="cad-checks"><strong>CAD Modifications / CAD Checks</strong><p>${esc(s.cad_modifications)}</p></div>`:''}${uploadsHTML(true,files)}<div class="upload-status" id="detail-upload-status" role="status"></div><div class="actions"><button class="btn small" id="upload-selected">${icon('plus')}Upload Selected Files</button></div><p class="error" id="file-error" role="alert"></p></section></div>
    <div><section class="panel"><div class="panel-head"><h2>Cost & invoice</h2><button class="btn small ghost" id="edit-cost">${p.cost!==''||p.invoice?'Edit':'Add details'}</button></div><div class="cost-summary">${p.cost!==''?money(p.cost):'—'}${p.cost!==''?`<small>${p.cost_basis==='piece'?'per piece':'total order'}</small>`:''}</div><div class="cost-details">${p.cost_basis==='piece'&&p.cost!==''?`<span>Order total: ${orderTotal(p)!==null?money(orderTotal(p)):'requires a numeric order quantity'}</span>`:''}<span>Invoice #: ${esc(p.invoice||'Not added')}</span></div></section>
    <section class="panel"><div class="panel-head"><h2>${icon('chat')}Project conversation</h2><span class="hint">${comments.length}${comments.length===200?'+':''}</span></div><div class="comments-list" id="comments-list">${comments.length?comments.map(commentHTML).join(''):'<p class="hint">Keep questions and updates together. Start a conversation below.</p>'}</div><form class="comment-form" id="comment-form"><label class="field-label" for="comment">Add a comment</label><textarea id="comment" name="comment" placeholder="Write an update for ${state.user.role==='admin'?'RFG':'Shivani'}…" maxlength="10000" required></textarea><div class="actions"><span class="hint">Notifies ${state.user.role==='admin'?'RFG Workshop':'Saunak & Atit'} by email</span><button class="btn small primary">Send ${icon('arrow')}</button></div><p class="error" role="alert"></p></form></section>
    <section class="panel"><div class="panel-head"><h2>Stage history</h2></div><ol class="history">${history.map(h=>`<li><strong>${STAGES[h.to_stage]}</strong><small>${esc(h.author)} · ${time(h.created_at)}</small></li>`).join('')}</ol></section></div></div>`,p.stage===7?'completed':'active');
  $('#refresh-project').onclick=()=>{if(canLeave()){state.dirty=false;renderRoute();}};
  $('#change-stage').onclick=()=>openStageDialog(p);
  $('#edit-cost').onclick=()=>openCostDialog(p);
  const selected=bindFileSelection($('#main'));let commentId=crypto.randomUUID();
  $('#main').addEventListener('click',event=>{const link=event.target.closest('.file-download');if(!link||!s.cad_modifications)return;event.preventDefault();const d=openDialog('CAD Modifications / CAD Checks',`<p>Please review these notes before downloading <strong>${esc(link.dataset.fileName)}</strong>.</p><div class="cad-download-note">${esc(s.cad_modifications)}</div><div class="dialog-actions"><a class="btn primary" href="${link.href}" download>Download File ${icon('download')}</a></div>`);$('a[download]',d).onclick=()=>d.close();});
  $('#upload-selected').onclick=async()=>{
    if(!selected.length){toast('Choose files in one of the three upload areas.');return;}
    const button=$('#upload-selected');button.disabled=true;state.busy=true;$('#file-error').textContent='';
    try{
      await uploadFiles(p.id,selected,$('#detail-upload-status'));
      const current=await api(`/projects/${p.id}`);
      // Refresh ONLY file lists, retaining an unsent comment and its caret.
      $$('[data-bucket]').forEach(box=>{$('[data-existing]',box).innerHTML=current.files.filter(f=>f.bucket===box.dataset.bucket).map(fileItem).join('');$('[data-pending]',box).replaceChildren();});
      state.dirty=!!$('#comment').value;toast('Files uploaded.');
    }catch(e){$('#file-error').textContent=`${e.message} Click Upload Selected Files to retry.`;}finally{button.disabled=false;state.busy=false;}
  };
  $('#comment').oninput=()=>{state.dirty=!!$('#comment').value||selected.length>0;};
  $('#comment-form').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget,button=$('button',form),textarea=$('textarea',form);
    const body=textarea.value.trim();if(!body)return;button.disabled=true;textarea.readOnly=true;setError(form,'');
    try{
      await api(`/projects/${p.id}/comments`,{method:'POST',data:{id:commentId,body}});commentId=crypto.randomUUID();textarea.value='';state.dirty=selected.length>0;
      const latest=await api(`/projects/${p.id}`);$('#comments-list').innerHTML=latest.comments.map(commentHTML).join('');$('#comments-list').scrollTop=$('#comments-list').scrollHeight;toast('Comment posted.');
    }catch(e){setError(form,e.message);}finally{button.disabled=false;textarea.readOnly=false;}
  };
  if(comments.length)$('#comments-list').scrollTop=$('#comments-list').scrollHeight;
}
function commentHTML(c){return `<article class="comment ${c.role}"><div class="avatar">${esc(initials(c.author))}</div><div class="comment-main"><div class="comment-meta"><strong>${esc(c.author)}</strong><time datetime="${c.created_at}">${time(c.created_at)}</time></div><p class="comment-body">${esc(c.body)}</p></div></article>`;}
function openDialog(title,body){
  const d=document.createElement('dialog');d.innerHTML=`<div class="dialog-head"><h2>${title}</h2><button class="icon-btn" data-close aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body">${body}</div>`;document.body.append(d);
  $('[data-close]',d).onclick=()=>{if(!state.busy)d.close();};d.addEventListener('cancel',e=>{if(state.busy)e.preventDefault();});d.addEventListener('close',()=>d.remove());if(typeof d.showModal==='function')d.showModal();else{d.setAttribute('open','');d.close=()=>{d.removeAttribute('open');d.dispatchEvent(new Event('close'));};}return d;
}
function costFields(p){return `<div class="cost-basis"><label>Cost (USD)<input name="cost" inputmode="decimal" placeholder="0.00" value="${esc(p.cost)}" maxlength="30"></label><label>Cost basis<select name="cost_basis"><option value="order" ${p.cost_basis==='order'?'selected':''}>Total order</option><option value="piece" ${p.cost_basis==='piece'?'selected':''}>Per piece</option></select></label></div><label>Invoice #<input name="invoice" placeholder="Optional invoice number" value="${esc(p.invoice)}" maxlength="200"></label>`;}
function openStageDialog(p){
  const d=openDialog('Update production stage',`<p>Choose the current stage. You can skip steps or move a project back when needed.</p><form><label>Stage<select name="stage">${STAGES.map((s,i)=>`<option value="${i}" ${p.stage===i?'selected':''}>${i+1}. ${s}</option>`).join('')}</select></label><div id="pickup-fields" class="hidden"><div class="notice">Ready for pickup? Add the cost and invoice if available. Both are optional.</div>${costFields(p)}</div><p class="error" role="alert"></p><div class="dialog-actions"><button class="btn" type="button" id="skip-pickup" hidden>Skip cost & update</button><button class="btn primary" type="submit">Update stage</button></div></form>`);
  const select=$('select[name="stage"]',d),pickup=$('#pickup-fields',d),skip=$('#skip-pickup',d);
  select.onchange=()=>{pickup.classList.toggle('hidden',Number(select.value)!==6);skip.hidden=Number(select.value)!==6;};
  select.onchange();
  async function save(includeCost){
    const form=$('form',d),data=Object.fromEntries(new FormData(form)),stage=Number(data.stage);
    if(stage===p.stage){d.close();return;}
    state.busy=true;$$('button',d).forEach(b=>b.disabled=true);setError(d,'');
    try{const result=await api(`/projects/${p.id}/stage`,{method:'POST',data:{stage,version:p.version,...(stage===6&&includeCost?{pickup:{cost:data.cost,cost_basis:data.cost_basis,invoice:data.invoice}}:{})}});d.close();state.busy=false;await refreshAfterProjectChange(result.project);toast(stage===7?'Project moved to Completed.':'Stage updated.');}
    catch(e){setError(d,e.message);$$('button',d).forEach(b=>b.disabled=false);state.busy=false;}
  }
  $('form',d).onsubmit=e=>{e.preventDefault();save(true);};skip.onclick=()=>save(false);
}
function openCostDialog(p){
  const d=openDialog('Cost & invoice',`<p>Add a cost per piece or for the whole order. Both the cost and invoice number are optional.</p><form>${costFields(p)}<p class="error" role="alert"></p><div class="dialog-actions"><button class="btn primary">Save details</button></div></form>`);
  $('form',d).onsubmit=async e=>{
    e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));state.busy=true;$$('button',d).forEach(b=>b.disabled=true);
    try{const result=await api(`/projects/${p.id}/cost`,{method:'PATCH',data:{...data,version:p.version}});d.close();state.busy=false;await refreshAfterProjectChange(result.project);toast('Cost details saved.');}
    catch(err){setError(d,err.message);$$('button',d).forEach(b=>b.disabled=false);state.busy=false;}
  };
}
async function refreshAfterProjectChange(p){
  // Preserve comment text if a stage/cost is updated mid-conversation.
  const comment=$('#comment')?.value||'';
  // Selected files cannot be reconstructed after a render. Defer the render if
  // there are unsaved selections; update the backing version for future actions.
  const pending=$$('[data-pending] .file-row').length;
  if(pending){state.project.project=p;toast('Saved. Upload the selected files, then refresh to see the new stage.');$('#change-stage').onclick=()=>openStageDialog(p);$('#edit-cost').onclick=()=>openCostDialog(p);return;}
  const detail=await api(`/projects/${p.id}`);renderProject(detail);$('#comment').value=comment;state.dirty=!!comment;
}
function renderAccount(){
  shell(`<section class="page-head"><div><div class="eyebrow">Your workspace</div><h1>My account</h1><p>${esc(state.user.display_name)} · ${esc(state.user.username)} · ${state.user.role==='admin'?'Admin':'RFG Workshop'}</p></div></section><section class="panel"><div class="panel-head"><div><h2>Change password</h2><p>After saving, sign in again with your new password.</p></div></div><form id="password-form" class="account-form"><label>Current password<input name="current_password" type="password" autocomplete="current-password" required maxlength="256"></label><label>New password<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="256" required></label><label>Confirm new password<input name="confirm" type="password" autocomplete="new-password" minlength="12" maxlength="256" required></label><p class="hint">At least 12 characters.</p><p class="error" role="alert"></p><button class="btn primary">Update password</button></form></section>`,'account');
  const form=$('#password-form');form.oninput=()=>state.dirty=true;
  form.onsubmit=async event=>{
    event.preventDefault();const data=Object.fromEntries(new FormData(form));if(data.password!==data.confirm){setError(form,'The new passwords do not match.');return;}
    const button=$('button',form);button.disabled=true;
    try{await api('/account/password',{method:'POST',data});state.dirty=false;state.user=null;renderLogin();toast('Password changed. Please sign in again.');}
    catch(e){setError(form,e.message);}finally{button.disabled=false;}
  };
}
async function renderNotifications(sequence){
  if(state.user.role!=='admin')throw new Error('Email Activity is available to admins.');
  shell('<div class="loading">Loading email activity…</div>','notifications');
  const result=await api('/admin/notifications');if(sequence!==state.routeSequence)return;
  const heartbeat=result.heartbeat,stale=heartbeat&&Date.now()-new Date(heartbeat.updated_at).getTime()>5*60000;
  const ready=heartbeat?.value==='enabled'&&!stale;
  const counts=Object.fromEntries(result.counts.map(c=>[c.status,c.n]));
  shell(`<section class="page-head"><div><div class="eyebrow">Notifications</div><h1>Email Activity</h1><p>Delivery status for production updates and reminders.</p></div><button class="btn" id="refresh-emails">${icon('refresh')}Refresh</button></section><div class="notice ${ready?'good':''}">${ready?'Email sending is enabled. Queued emails are checked every minute.':!heartbeat?'Email worker is not connected yet. Project updates are safely queued.':stale?'The email worker has not checked in recently. Check the Cloudflare Worker and its cron trigger.':'Email sending is paused. Add the Resend API key and enable notifications on the Worker.'}${heartbeat?`<br>Last worker check: ${time(heartbeat.updated_at)}`:''}</div><section class="stats">${[['mail',counts.pending||0,'Queued'],['check',counts.sent||0,'Sent'],['clock',counts.failed||0,'Need attention']].map(([i,n,label])=>`<div class="stat"><div class="stat-icon">${icon(i)}</div><div><div class="stat-number">${n}</div><div class="stat-label">${label}</div></div></div>`).join('')}</section><section class="panel"><div class="panel-head"><h2>Recent notifications</h2><span class="hint">Latest 100</span></div>${result.notifications.length?`<div class="table-wrap"><table class="log-table"><thead><tr><th>Event</th><th>Recipient</th><th>Status</th><th>Created</th></tr></thead><tbody>${result.notifications.map(n=>`<tr><td>${esc({new:'New project',stage:'Stage change',comment:'Comment',digest:'Delivery digest'}[n.kind]||n.kind)}${n.project_id?`<small><a href="#/project/${n.project_id}">View project →</a></small>`:''}</td><td>${esc(n.recipient)}</td><td><span class="log-status ${n.status}">${esc(n.status)}</span>${n.error?`<small>${esc(n.error)}</small>`:''}${n.status==='failed'?`<button class="btn small" data-retry="${n.id}">Retry</button>`:''}</td><td>${time(n.created_at)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="hint">Email events will appear here as you create projects, update stages, and comment.</p>'}</section>`,'notifications');
  $('#refresh-emails').onclick=()=>renderRoute();
  $$('[data-retry]').forEach(button=>button.onclick=async()=>{if(!confirm('Check Resend logs first if delivery was uncertain. Queue this notification again?'))return;button.disabled=true;try{await api(`/admin/notifications/${button.dataset.retry}/retry`,{method:'POST'});await renderRoute();toast('Email queued for retry.');}catch(e){toast(e.message);button.disabled=false;}});
}
boot();
