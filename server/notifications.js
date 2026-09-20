import {STAGES, projectName, displayDate, dueBucket, nyClock, money} from '../public/domain.js';
import {all, id, isoNow} from './util.js';

export const ADMINS = ['saunak@shivanigems.com','atit@shivanigems.com'];
export const RFG = ['rfgworkshopny@gmail.com'];
export const EVERYONE = [...ADMINS,...RFG];
export const TEMPLATES = {
  new:'4f4db824-1700-4714-84f9-8e7687275b33',
  stage:'f8b858e4-e522-4f48-a30c-fe43e759148a',
  comment:'71a5bf03-fbb2-4469-9cb0-a0de1ce2171f',
  digest:'529de6db-4731-4c91-9770-aef21fd4ef14'
};
export const stageRecipients = stage => stage===0 || stage===7 ? EVERYONE : stage===2 ? RFG : ADMINS;
const escapeText=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Resend caps EACH template string variable at 2,000 characters. Clip before escaping,
// then at complete character boundaries so long comments never break delivery.
export function emailText(value, fallback='Not provided') {
  const source=String(value || fallback); let result='';
  for(const char of source.slice(0,2000)) {
    const next=escapeText(char);
    if(result.length+next.length>1900) return `${result}… (full details in portal)`;
    result+=next;
  }
  return result+(source.length>2000?'… (full details in portal)':'');
}
const timestamp=v=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'}).format(new Date(v))+' ET';
const delivery=p=>p.delivery_date ? displayDate(p.delivery_date) : 'Not provided';
export const projectURL=(base,p)=>`${base.replace(/\/$/,'')}/#/project/${p.id}`;
export function eventPayload(kind,p,user,base,extra={}) {
  const common={PROJECT_NAME:emailText(projectName(p)),DELIVERY_DATE:delivery(p),PROJECT_URL:projectURL(base,p)};
  let variables, label;
  if(kind==='new') {
    label='New project'; variables={...common,CREATED_BY:emailText(user.display_name),CAD_FILE_NAME:emailText(p.spec.cad_file_name),METAL:emailText(p.metal),QUANTITY:emailText(p.quantity)};
  } else if(kind==='stage') {
    label=STAGES[p.stage];
    const pickup=p.stage===6 ? [p.cost!==''?`Cost: ${money(p.cost)} ${p.cost_basis==='piece'?'per piece':'total order'}`:'',p.invoice?`Invoice #: ${p.invoice}`:''].filter(Boolean).join(' · ') : '';
    variables={...common,PREVIOUS_STAGE:STAGES[extra.previous],NEW_STAGE:STAGES[p.stage],UPDATED_BY:emailText(user.display_name),UPDATED_AT:timestamp(extra.at),PICKUP_DETAILS:emailText(pickup,'' )};
  } else {
    label='New comment'; variables={...common,COMMENT_AUTHOR:emailText(user.display_name),COMMENT_DATE:timestamp(extra.at),CURRENT_STAGE:STAGES[p.stage],COMMENT_TEXT:emailText(extra.comment)};
  }
  return {from:'Shivani Production <saunak@shivanigems.com>',reply_to:'saunak@shivanigems.com',subject:`Shivani Production | ${label} | ${projectName(p).replace(/[\r\n]/g,' ').slice(0,120)}`,template:{id:TEMPLATES[kind],variables}};
}
// These statements run IN THE SAME D1 transaction as the event. Conditional inserts
// ensure stale concurrent updates cannot create phantom notifications.
export function enqueueStatements(db,{event,recipients,kind,project=null,payload,at=isoNow(),guard=false}) {
  return [...new Set(recipients)].map(recipient=> {
    const values=[id(),event,recipient,kind,project,JSON.stringify({...payload,to:[recipient]}),at,at];
    return guard ? db.prepare(`INSERT OR IGNORE INTO notification_outbox
      (id,event_id,recipient,kind,project_id,payload,next_attempt,created_at)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND last_event=?)`).bind(...values,project,event)
      : db.prepare(`INSERT OR IGNORE INTO notification_outbox (id,event_id,recipient,kind,project_id,payload,next_attempt,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(...values);
  });
}
function digestList(projects,base) {
  if(!projects.length) return 'None';
  const lines=[]; let length=0;
  for(const p of projects) {
    const line=emailText(`${projectName(p).slice(0,100)} | ${displayDate(p.delivery_date)} | ${STAGES[p.stage]} | ${projectURL(base,p)}`);
    if(length+line.length>1650) break;
    lines.push(line); length+=line.length+2;
  }
  if(lines.length<projects.length) lines.push(`${projects.length-lines.length} more — view all in the portal: ${base}`);
  return lines.join('\n\n');
}
export async function enqueueDigest(env,now=new Date()) {
  const clock=nyClock(now);
  if(clock.hour!==9 || ['Sat','Sun'].includes(clock.weekday)) return 0;
  if(!/^https:\/\//.test(env.PORTAL_URL || '')) return 0;
  const event=`digest-${clock.date}`;
  if(await env.DB.prepare('SELECT id FROM notification_outbox WHERE event_id=? LIMIT 1').bind(event).first()) return 0;
  // One digest per recipient/day, safe under overlapping cron deliveries.
  const projects=await all(env.DB.prepare("SELECT id,name,delivery_date,stage FROM projects WHERE stage<>7 AND delivery_date<>'' AND delivery_date<=date(?, '+2 days') ORDER BY delivery_date,number").bind(clock.date));
  if(!projects.length) return 0;
  const payload={from:'Shivani Production <saunak@shivanigems.com>',reply_to:'saunak@shivanigems.com',subject:`Shivani Production | Delivery reminders | ${displayDate(clock.date)}`,template:{id:TEMPLATES.digest,variables:{DIGEST_DATE:displayDate(clock.date),DUE_SOON_PROJECTS:digestList(projects.filter(p=>dueBucket(p,clock.date)==='soon'),env.PORTAL_URL),OVERDUE_PROJECTS:digestList(projects.filter(p=>dueBucket(p,clock.date)==='overdue'),env.PORTAL_URL),PORTAL_URL:env.PORTAL_URL}}};
  await env.DB.batch(enqueueStatements(env.DB,{event,recipients:EVERYONE,kind:'digest',payload,at:now.toISOString()}));
  return 3;
}
export async function deliverOutbox(env,{now=new Date(),fetcher=fetch,pause=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  const at=now.toISOString();
  const enabled=env.NOTIFICATIONS_ENABLED==='true' && !!env.RESEND_API_KEY;
  await env.DB.prepare(`INSERT INTO worker_state(key,value,updated_at) VALUES ('heartbeat',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(enabled?'enabled':'paused',at).run();
  if(!enabled) return {sent:0,paused:true};
  const lock=id(),expiry=new Date(+now+90000).toISOString();
  const acquired=await env.DB.prepare(`INSERT INTO worker_state(key,value,updated_at) VALUES ('sender-lock',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE worker_state.updated_at<=? RETURNING key`).bind(lock,expiry,at).first();
  if(!acquired) return {sent:0,locked:true};
  let sent=0;
  try {
    // Recover interrupted sends with the original idempotency key; never auto-retry
    // uncertain deliveries beyond Resend's 24-hour idempotency window.
    await env.DB.prepare("UPDATE notification_outbox SET status='pending' WHERE status='sending' AND last_attempt<?").bind(new Date(+now-120000).toISOString()).run();
    const rows=await all(env.DB.prepare("SELECT * FROM notification_outbox WHERE status='pending' AND next_attempt<=? ORDER BY created_at,id LIMIT 8").bind(at));
    for(const row of rows) {
      if(row.first_attempt && +now-new Date(row.first_attempt).getTime()>23*3600000) {
        await env.DB.prepare("UPDATE notification_outbox SET status='failed',error='Retry window expired. Check Resend logs before retrying to avoid duplicate delivery.' WHERE id=?").bind(row.id).run(); continue;
      }
      // Stay below the free plan's daily recipient cap; account-wide usage still
      // matters if other applications share the same Resend account.
      const today=at.slice(0,10);
      const used=await env.DB.prepare("SELECT count(*) AS n FROM notification_outbox WHERE sent_at>=? OR (status='sending' AND last_attempt>=?)").bind(today,today).first();
      if(used.n>=90) break;
      await env.DB.prepare("UPDATE notification_outbox SET status='sending',attempts=attempts+1,first_attempt=coalesce(first_attempt,?),last_attempt=? WHERE id=?").bind(at,at,row.id).run();
      try {
        const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`production-${row.id}`},body:row.payload,signal:AbortSignal.timeout(6000)});
        const result=await response.json().catch(()=>({}));
        if(response.ok && result.id) {
          await env.DB.prepare("UPDATE notification_outbox SET status='sent',sent_at=?,provider_id=?,error=NULL WHERE id=?").bind(at,String(result.id),row.id).run(); sent++;
        } else {
          const transient=response.status===429 || response.status>=500;
          const attempts=row.attempts+1;
          const delay=Math.min(3600,Math.max(Number(response.headers.get('retry-after'))||0,60*2**Math.min(attempts,6)));
          await env.DB.prepare('UPDATE notification_outbox SET status=?,error=?,next_attempt=? WHERE id=?').bind(transient && attempts<12?'pending':'failed',`Resend ${response.status}: ${String(result.message || result.name || 'Request failed').slice(0,400)}`,new Date(+now+delay*1000).toISOString(),row.id).run();
          if(response.status===429) break;
        }
      } catch {
        await env.DB.prepare('UPDATE notification_outbox SET status=?,error=?,next_attempt=? WHERE id=?').bind(row.attempts+1<12?'pending':'failed','Delivery response unavailable; retry uses the same idempotency key.',new Date(+now+300000).toISOString(),row.id).run();
      }
      await pause(600); // At most two Resend requests per second.
    }
  } finally {
    await env.DB.prepare("DELETE FROM worker_state WHERE key='sender-lock' AND value=?").bind(lock).run();
  }
  return {sent};
}
