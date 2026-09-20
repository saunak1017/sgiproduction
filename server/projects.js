import {STAMPS, validDate, decimal} from '../public/domain.js';
import {all, assert, id, isoNow, textField} from './util.js';
import {admin} from './auth.js';
import {enqueueStatements,eventPayload,stageRecipients,EVERYONE,ADMINS,RFG} from './notifications.js';

export function sanitizeSpec(input) {
  const spec={};
  for(const key of ['name','cad_file_name','category','ring_size','metal','setting','quantity','stamping_other']) spec[key]=textField(input[key]);
  spec.notes=textField(input.notes,20000);
  spec.delivery_date=textField(input.delivery_date,10);
  assert(!spec.delivery_date || validDate(spec.delivery_date),400,'Enter a valid delivery date.');
  const stamps=input.stamping || [];
  assert(Array.isArray(stamps) && stamps.length<=5 && stamps.every(v=>STAMPS.includes(v)),400,'Invalid stamping options.');
  spec.stamping=[...new Set(stamps)];
  if(!spec.stamping.includes('Other')) spec.stamping_other='';
  assert(!input.stones || Array.isArray(input.stones),400,'Invalid stone information.');
  assert((input.stones || []).length<=100,400,'Use up to 100 stone rows per project.');
  spec.stones=(input.stones || []).map(s=> {
    const row={shape:textField(s.shape,100),weight:textField(s.weight,30),quantity:textField(s.quantity,30),measurements:textField(s.measurements,200),basis:s.basis==='total'?'total':'per_stone'};
    assert(!row.weight || (decimal(row.weight)!==null && decimal(row.weight)<=100000),400,'Stone weight must be a nonnegative number.');
    assert(!row.quantity || (decimal(row.quantity)!==null && Number.isInteger(decimal(row.quantity)) && decimal(row.quantity)<=100000),400,'Stone quantity must be a whole number from 0 to 100,000.');
    return row;
  });
  return spec;
}
export function sanitizeCost(input) {
  const cost=textField(input.cost,30),invoice=textField(input.invoice,200),cost_basis=input.cost_basis || 'order';
  assert(cost==='' || (/^\d+(\.\d{1,2})?$/.test(cost) && Number(cost)<=1000000000),400,'Enter a valid cost with up to two decimal places.');
  assert(['order','piece'].includes(cost_basis),400,'Choose cost per piece or total order.');
  return {cost,cost_basis,invoice};
}
export const hydrate=row=>row ? {...row,spec:JSON.parse(row.spec_json || '{}'),spec_json:undefined} : null;
export async function getProject(db,projectId) {
  const p=hydrate(await db.prepare('SELECT * FROM projects WHERE id=?').bind(projectId).first());
  assert(p,404,'Project not found.'); return p;
}
const summaryColumns='number,id,name,metal,quantity,delivery_date,stage,cost,cost_basis,invoice,version,created_at,updated_at';
export async function listProjects(db,url) {
  const completed=url.searchParams.get('completed')==='true';
  const offset=Math.floor(Math.max(0,Math.min(99900,Number(url.searchParams.get('offset'))||0)));
  const search=(url.searchParams.get('search') || '').slice(0,200);
  const stage=Number(url.searchParams.get('stage'));
  const conditions=[completed?'stage=7':'stage<>7']; const params=[];
  if(search) {conditions.push("(name LIKE ? ESCAPE '\\' OR metal LIKE ? ESCAPE '\\' OR CAST(number AS TEXT)=?)"); const pattern=`%${search.replace(/[\\%_]/g,'\\$&')}%`;params.push(pattern,pattern,search.replace(/^SG-0*/i,''));}
  if(url.searchParams.has('stage') && Number.isInteger(stage) && stage>=0 && stage<=7) {conditions.push('stage=?');params.push(stage);}
  const today=url.searchParams.get('today');
  const due=url.searchParams.get('due');
  if(validDate(today || '') && ['soon','overdue'].includes(due)) {
    conditions.push(due==='overdue'?"delivery_date<>'' AND delivery_date<?":"delivery_date>=? AND delivery_date<=date(?, '+2 days')");
    params.push(today);if(due==='soon')params.push(today);
  }
  const where=conditions.join(' AND ');
  const [projects,count,stats]=await Promise.all([
    all(db.prepare(`SELECT ${summaryColumns} FROM projects WHERE ${where} ORDER BY CASE WHEN delivery_date='' THEN 1 ELSE 0 END,delivery_date,number DESC LIMIT 60 OFFSET ?`).bind(...params,offset)),
    db.prepare(`SELECT count(*) AS n FROM projects WHERE ${where}`).bind(...params).first(),
    db.prepare("SELECT count(*) AS total,coalesce(sum(stage<>7),0) AS active,coalesce(sum(stage=7),0) AS completed,coalesce(sum(stage=6),0) AS pickup FROM projects").first()
  ]);
  return {projects,total:count.n,stats,offset};
}
export async function createProject(db,user,input,base) {
  admin(user);
  const spec=sanitizeSpec(input),at=isoNow(),event=id(),projectId=id();
  const p={id:projectId,...spec,spec,stage:0,cost:'',cost_basis:'order',invoice:''};
  await db.batch([
    db.prepare('INSERT INTO projects(id,name,metal,quantity,delivery_date,spec_json,last_event,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(projectId,spec.name,spec.metal,spec.quantity,spec.delivery_date,JSON.stringify(spec),event,user.id,at,at),
    db.prepare('INSERT INTO stage_history(id,project_id,from_stage,to_stage,actor_id,created_at) VALUES (?,?,NULL,0,?,?)').bind(event,projectId,user.id,at),
    ...enqueueStatements(db,{event,recipients:EVERYONE,kind:'new',project:projectId,payload:eventPayload('new',p,user,base),at})
  ]);
  return getProject(db,projectId);
}
export async function updateProject(db,user,p,input) {
  admin(user); const spec=sanitizeSpec(input),event=id();
  const r=await db.prepare('UPDATE projects SET name=?,metal=?,quantity=?,delivery_date=?,spec_json=?,version=version+1,last_event=?,updated_at=? WHERE id=? AND version=?').bind(spec.name,spec.metal,spec.quantity,spec.delivery_date,JSON.stringify(spec),event,isoNow(),p.id,input.version).run();
  assert(r.meta.changes===1,409,'Someone updated this project. Reload it before saving; your entries are still in this form.');
  return getProject(db,p.id);
}
export async function changeStage(db,user,p,input,base) {
  assert(Number.isInteger(input.stage) && input.stage>=0 && input.stage<=7,400,'Choose a valid stage.');
  assert(input.version===p.version,409,'The project changed. Refresh it before changing its stage.');
  if(input.stage===p.stage) return p;
  const at=isoNow(),event=id();
  const cost=input.pickup ? sanitizeCost(input.pickup) : {cost:p.cost,cost_basis:p.cost_basis,invoice:p.invoice};
  const next={...p,...cost,stage:input.stage};
  const result=await db.batch([
    db.prepare('UPDATE projects SET stage=?,cost=?,cost_basis=?,invoice=?,version=version+1,last_event=?,updated_at=? WHERE id=? AND version=?').bind(next.stage,next.cost,next.cost_basis,next.invoice,event,at,p.id,input.version),
    db.prepare('INSERT INTO stage_history(id,project_id,from_stage,to_stage,actor_id,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND last_event=?)').bind(event,p.id,p.stage,next.stage,user.id,at,p.id,event),
    ...enqueueStatements(db,{event,recipients:stageRecipients(next.stage),kind:'stage',project:p.id,payload:eventPayload('stage',next,user,base,{previous:p.stage,at}),at,guard:true})
  ]);
  assert(result[0].meta.changes===1,409,'The project changed. Refresh it before changing its stage.');
  return getProject(db,p.id);
}
export async function updateCost(db,p,input) {
  const cost=sanitizeCost(input);
  const r=await db.prepare('UPDATE projects SET cost=?,cost_basis=?,invoice=?,version=version+1,updated_at=? WHERE id=? AND version=?').bind(cost.cost,cost.cost_basis,cost.invoice,isoNow(),p.id,input.version).run();
  assert(r.meta.changes===1,409,'The project changed. Refresh it before updating the cost.'); return getProject(db,p.id);
}
export async function addComment(db,user,p,input,base) {
  const comment=textField(input.body,10000); assert(comment,400,'Enter a comment.');
  // Client-generated UUID makes resubmission safe after a lost response.
  assert(typeof input.id==='string' && /^[a-f0-9-]{36}$/.test(input.id),400,'Invalid comment identifier.');
  const existing=await db.prepare('SELECT id,project_id,actor_id,body FROM comments WHERE id=?').bind(input.id).first();
  if(existing) {assert(existing.project_id===p.id && existing.actor_id===user.id && existing.body===comment,409,'Comment identifier already used.');return;}
  const at=isoNow(),event=`comment-${input.id}`;
  await db.batch([
    db.prepare('INSERT INTO comments(id,project_id,actor_id,body,created_at) VALUES (?,?,?,?,?)').bind(input.id,p.id,user.id,comment,at),
    ...enqueueStatements(db,{event,recipients:user.role==='vendor'?ADMINS:RFG,kind:'comment',project:p.id,payload:eventPayload('comment',p,user,base,{at,comment}),at})
  ]);
}
export async function projectDetail(db,p) {
  const [files,comments,history]=await Promise.all([
    all(db.prepare('SELECT f.id,f.bucket,f.name,f.size,f.mime,f.created_at,u.display_name AS author FROM files f JOIN users u ON u.id=f.actor_id WHERE project_id=? AND ready=1 ORDER BY f.created_at').bind(p.id)),
    all(db.prepare('SELECT c.*,u.display_name AS author,u.role FROM comments c JOIN users u ON u.id=c.actor_id WHERE project_id=? ORDER BY c.created_at DESC LIMIT 200').bind(p.id)),
    all(db.prepare('SELECT h.*,u.display_name AS author FROM stage_history h JOIN users u ON u.id=h.actor_id WHERE project_id=? ORDER BY h.created_at DESC LIMIT 200').bind(p.id))
  ]);
  return {project:p,files,comments:comments.reverse(),history};
}
