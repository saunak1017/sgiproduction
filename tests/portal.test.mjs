import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LocalD1,LocalR2,initializeDB} from '../scripts/local-bindings.mjs';
import {handleRequest} from '../server/api.js';
import {HASH_ITERATIONS} from '../server/auth.js';
import {STAGES,CHUNK_SIZE,stoneTotal,parseDateInput,nyClock,dueBucket,orderTotal} from '../public/domain.js';
import {TEMPLATES,stageRecipients,ADMINS,RFG,EVERYONE,enqueueDigest,deliverOutbox,emailText} from '../server/notifications.js';

const password='Local-test-password-123!';
async function fixture(t){
  const path=await mkdtemp(join(tmpdir(),'shivani-test-')),DB=new LocalD1();initializeDB(DB);
  const env={DB,UPLOADS:new LocalR2(path),PORTAL_URL:'https://production.example.com',BOOTSTRAP_USERS_JSON:JSON.stringify([
    {username:'saunak',display_name:'Saunak',role:'admin',password},{username:'atit',display_name:'Atit',role:'admin',password},
    {username:'rfg1',display_name:'RFG 1',role:'vendor',password},{username:'rfg2',display_name:'RFG 2',role:'vendor',password}
  ])};
  t.after(async()=>{DB.close();await rm(path,{recursive:true,force:true});});
  async function request(route,{method='GET',data,cookie,origin='https://production.example.com',body,headers={}}={}){
    if(cookie)headers.cookie=cookie;
    if(method!=='GET')headers.origin=origin;
    if(data!==undefined){headers['content-type']='application/json';body=JSON.stringify(data);}
    const response=await handleRequest(new Request('https://production.example.com/api'+route,{method,headers,...(body!==undefined?{body}:{} )}),env);
    const result=response.headers.get('content-type')?.includes('application/json')?await response.clone().json():null;
    return {response,result,status:response.status};
  }
  async function login(username){const r=await request('/login',{method:'POST',data:{username,password}});assert.equal(r.status,200,JSON.stringify(r.result));return r.response.headers.get('set-cookie').split(';')[0];}
  const admin=await login('saunak'),vendor=await login('rfg1'),vendor2=await login('rfg2');
  return {env,request,admin,vendor,vendor2,login};
}

test('weight bases, free-text quantity, calendar validation and New York DST',()=>{
  assert.equal(HASH_ITERATIONS,100000);
  assert.equal(stoneTotal({weight:'0.25',quantity:'4',basis:'per_stone'}),1);
  assert.equal(stoneTotal({weight:'0.25',quantity:'4',basis:'total'}),.25);
  assert.equal(stoneTotal({weight:'1.2',quantity:'',basis:'total'}),1.2);
  assert.equal(stoneTotal({weight:'1.2',quantity:'',basis:'per_stone'}),null);
  assert.equal(orderTotal({cost:'12.50',cost_basis:'piece',quantity:'3'}),37.5);
  assert.equal(orderTotal({cost:'12.50',cost_basis:'piece',quantity:'2 pairs'}),null);
  assert.equal(parseDateInput('2/29/2028'),'2028-02-29');assert.equal(parseDateInput('2/29/2027'),null);
  assert.equal(parseDateInput('2026-09-22'),'2026-09-22');assert.equal(parseDateInput(''),'');
  assert.equal(nyClock(new Date('2026-07-06T13:00:00Z')).hour,9);
  assert.equal(nyClock(new Date('2026-12-07T14:00:00Z')).hour,9);
  assert.equal(nyClock(new Date('2026-09-21T02:00:00Z')).date,'2026-09-20');
  assert.equal(dueBucket({stage:5,delivery_date:'2026-09-20'},'2026-09-21'),'overdue');
  assert.equal(dueBucket({stage:7,delivery_date:'2026-09-20'},'2026-09-21'),'');
  assert.equal(dueBucket({stage:1,delivery_date:'2026-09-23'},'2026-09-21'),'soon');
});

test('authentication, all-optional project, vendor permission checks and stale edits',async t=>{
  const {env,request,admin,vendor}=await fixture(t);
  assert.equal((await request('/projects')).status,401);
  assert.equal((await request('/projects',{method:'POST',cookie:admin,origin:'https://evil.example',data:{}})).status,403);
  assert.equal((await request('/projects',{method:'POST',cookie:vendor,data:{}})).status,403);
  const create=await request('/projects',{method:'POST',cookie:admin,data:{}});assert.equal(create.status,201);
  const p=create.result.project;assert.equal(p.name,'');assert.deepEqual(p.spec.stones,[]);
  assert.equal((await request(`/projects/${p.id}`,{method:'PATCH',cookie:vendor,data:{name:'Changed',version:p.version}})).status,403);
  const edited=await request(`/projects/${p.id}`,{method:'PATCH',cookie:admin,data:{version:p.version,name:'Emerald ring',quantity:'2 pairs',notes:'<script>unsafe()</script>',stamping:['Other'],stamping_other:'Custom logo',stones:[{shape:'Oval',weight:'1.25',quantity:'2',basis:'per_stone'}]}});
  assert.equal(edited.status,200);assert.equal(edited.result.project.name,'Emerald ring');
  assert.equal((await request(`/projects/${p.id}`,{method:'PATCH',cookie:admin,data:{name:'Stale',version:p.version}})).status,409);
  assert.equal((await request('/admin/notifications',{cookie:vendor})).status,403);
  assert.ok(env.DB.db.prepare('SELECT iterations FROM users').all().every(u=>u.iterations<=100000));
  assert.equal(env.DB.db.prepare('SELECT count(*) AS n FROM notification_outbox').get().n,3);
});

test('every stage routes correctly, pickup cost optional, completed/backward moves and comment deduplication',async t=>{
  const {env,request,admin,vendor}=await fixture(t);
  let p=(await request('/projects',{method:'POST',cookie:admin,data:{name:'Test ring',quantity:'3'}})).result.project;
  for(let stage=1;stage<8;stage++){
    const before=env.DB.db.prepare('SELECT count(*) AS n FROM notification_outbox').get().n;
    const response=await request(`/projects/${p.id}/stage`,{method:'POST',cookie:vendor,data:{version:p.version,stage,...(stage===6?{pickup:{cost:'125.50',cost_basis:'piece',invoice:'RFG-128'}}:{})}});
    assert.equal(response.status,200,JSON.stringify(response.result));p=response.result.project;
    const rows=env.DB.db.prepare("SELECT recipient,payload FROM notification_outbox WHERE event_id=? ORDER BY recipient").all(p.last_event);
    assert.deepEqual(rows.map(r=>r.recipient).sort(),[...stageRecipients(stage)].sort());
    assert.equal(env.DB.db.prepare('SELECT count(*) AS n FROM notification_outbox').get().n,before+rows.length);
    assert.ok(rows.every(r=>JSON.parse(r.payload).template.id===TEMPLATES.stage));
    if(stage===6){assert.equal(p.cost,'125.50');assert.match(JSON.parse(rows[0].payload).template.variables.PICKUP_DETAILS,/per piece/);}
  }
  assert.equal((await request('/projects',{cookie:admin})).result.total,0);
  assert.equal((await request('/projects?completed=true',{cookie:admin})).result.total,1);
  const reopened=await request(`/projects/${p.id}/stage`,{method:'POST',cookie:vendor,data:{stage:6,version:p.version}});assert.equal(reopened.status,200);p=reopened.result.project;assert.equal(p.invoice,'RFG-128');
  assert.equal((await request('/projects',{cookie:admin})).result.total,1);
  const before=env.DB.db.prepare('SELECT count(*) AS n FROM notification_outbox').get().n;
  assert.equal((await request(`/projects/${p.id}/stage`,{method:'POST',cookie:vendor,data:{stage:5,version:1}})).status,409);
  assert.equal(env.DB.db.prepare('SELECT count(*) AS n FROM notification_outbox').get().n,before);
  for(const [cookie,recipients] of [[admin,RFG],[vendor,ADMINS]]){
    const id=crypto.randomUUID(),body='<img src=x onerror=alert(1)> Ready & checked';
    assert.equal((await request(`/projects/${p.id}/comments`,{method:'POST',cookie,data:{id,body}})).status,201);
    assert.equal((await request(`/projects/${p.id}/comments`,{method:'POST',cookie,data:{id,body}})).status,201);
    const rows=env.DB.db.prepare('SELECT recipient,payload FROM notification_outbox WHERE event_id=?').all(`comment-${id}`);
    assert.deepEqual(rows.map(r=>r.recipient).sort(),[...recipients].sort());
    assert.ok(!JSON.parse(rows[0].payload).template.variables.COMMENT_TEXT.includes('<img'));
  }
  assert.equal(env.DB.db.prepare('SELECT count(*) AS n FROM comments').get().n,2);
  const noCost=(await request('/projects',{method:'POST',cookie:admin,data:{}})).result.project;
  const skip=await request(`/projects/${noCost.id}/stage`,{method:'POST',cookie:vendor,data:{stage:6,version:1}});assert.equal(skip.status,200);assert.equal(skip.result.project.cost,'');
});

test('85 MB private multipart upload, chunk retries, ownership, type and download checks',async t=>{
  const {env,request,admin,vendor,vendor2}=await fixture(t);
  const p=(await request('/projects',{method:'POST',cookie:admin,data:{name:'Large CAD'}})).result.project;
  const size=85*1024*1024;
  const start=await request(`/projects/${p.id}/uploads`,{method:'POST',cookie:vendor,data:{bucket:'stl',name:'large ring.stl',size}});assert.equal(start.status,201);
  const file=start.result;
  assert.equal((await request(`/files/${file.id}`)).status,401);
  assert.equal((await request(`/files/${file.id}`,{cookie:admin})).status,404);
  const first=Buffer.alloc(CHUNK_SIZE,7);
  assert.equal((await request(`/files/${file.id}/parts/1`,{method:'PUT',cookie:vendor2,body:first,headers:{'content-length':String(first.length)}})).status,403);
  for(let offset=0,part=1;offset<size;offset+=CHUNK_SIZE,part++){
    const bytes=Buffer.alloc(Math.min(CHUNK_SIZE,size-offset),part);
    const response=await request(`/files/${file.id}/parts/${part}`,{method:'PUT',cookie:vendor,body:bytes,headers:{'content-length':String(bytes.length)}});assert.equal(response.status,200,JSON.stringify(response.result));
    if(part===1)assert.equal((await request(`/files/${file.id}/parts/${part}`,{method:'PUT',cookie:vendor,body:bytes,headers:{'content-length':String(bytes.length)}})).status,200);
  }
  assert.equal(env.UPLOADS.largestPart,CHUNK_SIZE);
  assert.equal((await request(`/files/${file.id}/complete`,{method:'POST',cookie:vendor})).status,200);
  assert.equal((await request(`/files/${file.id}/complete`,{method:'POST',cookie:vendor})).status,200);
  const download=await request(`/files/${file.id}`,{cookie:admin});assert.equal(download.status,200);assert.equal(download.response.headers.get('content-length'),String(size));
  const reader=download.response.body.getReader();let read=0;while(true){const part=await reader.read();if(part.done)break;read+=part.value.length;}assert.equal(read,size);
  assert.equal((await request(`/projects/${p.id}/uploads`,{method:'POST',cookie:vendor,data:{bucket:'reference',name:'unsafe.html',size:10}})).status,400);
  assert.equal((await request(`/files/${file.id}`,{method:'DELETE',cookie:vendor2})).status,403);
  assert.equal((await request(`/files/${file.id}`,{method:'DELETE',cookie:admin})).status,200);
});

test('weekday NY digest, upcoming/overdue grouping, no completed projects, no duplicates and Resend limits',async t=>{
  const {env,request,admin,vendor}=await fixture(t);
  const specs=[['Late','2026-09-18'],['Today','2026-09-21'],['Soon','2026-09-23'],['Later','2026-09-24'],['No date',''],['Completed','2026-09-19']];
  for(const [name,delivery_date] of specs){const p=(await request('/projects',{method:'POST',cookie:admin,data:{name,delivery_date}})).result.project;if(name==='Completed')await request(`/projects/${p.id}/stage`,{method:'POST',cookie:vendor,data:{stage:7,version:p.version}});}
  assert.equal(await enqueueDigest(env,new Date('2026-09-20T13:00:00Z')),0);
  assert.equal(await enqueueDigest(env,new Date('2026-09-21T12:00:00Z')),0);
  assert.equal(await enqueueDigest(env,new Date('2026-09-21T13:00:00Z')),3);
  assert.equal(await enqueueDigest(env,new Date('2026-09-21T13:05:00Z')),0);
  const rows=env.DB.db.prepare("SELECT recipient,payload FROM notification_outbox WHERE kind='digest'").all();assert.equal(rows.length,3);
  assert.deepEqual(rows.map(r=>r.recipient).sort(),[...EVERYONE].sort());
  const vars=JSON.parse(rows[0].payload).template.variables;
  assert.match(vars.DUE_SOON_PROJECTS,/Today/);assert.match(vars.DUE_SOON_PROJECTS,/Soon/);assert.doesNotMatch(vars.DUE_SOON_PROJECTS,/Later/);assert.match(vars.OVERDUE_PROJECTS,/Late/);assert.doesNotMatch(vars.OVERDUE_PROJECTS,/Completed/);
  assert.ok(emailText('&'.repeat(10000)).length<=2000);
});

test('durable mail queue, no real sends, retry/backoff and unchanged idempotency key',async t=>{
  const {env,request,admin}=await fixture(t);
  await request('/projects',{method:'POST',cookie:admin,data:{name:'Notification check'}});
  let calls=[];const now=new Date(Date.now()+1000);
  const success=async(url,opts)=>{calls.push({url,...opts});return Response.json({id:crypto.randomUUID()});};
  assert.equal((await deliverOutbox(env,{now,fetcher:success,pause:async()=>{}})).paused,true);assert.equal(calls.length,0);
  env.NOTIFICATIONS_ENABLED='true';env.RESEND_API_KEY='fake-test-key';
  const fail=async(url,opts)=>{calls.push({url,...opts});return Response.json({message:'Rate limited'},{status:429,headers:{'retry-after':'180'}});};
  await deliverOutbox(env,{now,fetcher:fail,pause:async()=>{}});assert.equal(calls.length,1);
  const key=calls[0].headers['Idempotency-Key'];
  await deliverOutbox(env,{now:new Date(+now+300000),fetcher:success,pause:async()=>{}});
  assert.ok(calls.slice(1).some(c=>c.headers['Idempotency-Key']===key));
  assert.equal(env.DB.db.prepare("SELECT count(*) AS n FROM notification_outbox WHERE status='sent'").get().n,3);
  for(const call of calls){const payload=JSON.parse(call.body);assert.equal(payload.template.id,TEMPLATES.new);assert.equal(payload.to.length,1);assert.equal(payload.from,'Shivani Production <saunak@shivanigems.com>');assert.ok(Object.values(payload.template.variables).every(v=>typeof v==='string'&&v.length<=2000));assert.ok(!payload.html);}
});
