import {json,bodyJSON,assert,all,isoNow,sha256,safeUser,id} from './util.js';
import {sameOrigin,login,currentUser,sessionToken,sessionCookie,admin,passwordRecord,hashPassword} from './auth.js';
import {listProjects,getProject,createProject,updateProject,changeStage,updateCost,addComment,projectDetail} from './projects.js';
import {beginUpload,fileRow,uploadPart,finishUpload,deleteFile,downloadFile} from './files.js';

export async function handleRequest(request,env) {
  try {
    assert(env.DB,503,'Add the DB D1 binding in Cloudflare, then run schema.sql.');
    sameOrigin(request);
    const url=new URL(request.url),path=url.pathname.replace(/\/$/,''),method=request.method;
    if(path==='/api/login' && method==='POST') {
      const result=await login(request,env,await bodyJSON(request));
      return json({user:result.user},200,{'set-cookie':result.cookie});
    }
    const user=await currentUser(request,env);
    if(path==='/api/me' && method==='GET') return json({user:safeUser(user)});
    if(path==='/api/logout' && method==='POST') {
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(sessionToken(request))).run();
      return json({ok:true},200,{'set-cookie':sessionCookie('',0)});
    }
    const base=env.PORTAL_URL || url.origin;
    if(path==='/api/projects') {
      if(method==='GET') return json(await listProjects(env.DB,url));
      if(method==='POST') return json({project:await createProject(env.DB,user,await bodyJSON(request),base)},201);
    }
    const match=path.match(/^\/api\/projects\/([a-f0-9-]{36})(?:\/(stage|cost|comments|uploads))?$/);
    if(match) {
      const p=await getProject(env.DB,match[1]),action=match[2];
      if(!action && method==='GET') return json(await projectDetail(env.DB,p));
      if(!action && method==='PATCH') return json({project:await updateProject(env.DB,user,p,await bodyJSON(request))});
      if(action==='stage' && method==='POST') return json({project:await changeStage(env.DB,user,p,await bodyJSON(request),base)});
      if(action==='cost' && method==='PATCH') return json({project:await updateCost(env.DB,p,await bodyJSON(request))});
      if(action==='comments' && method==='POST') {await addComment(env.DB,user,p,await bodyJSON(request),base);return json({ok:true},201);}
      if(action==='uploads' && method==='POST') return json(await beginUpload(env,user,p,await bodyJSON(request)),201);
    }
    const fm=path.match(/^\/api\/files\/([a-f0-9-]{36})(?:\/(complete|parts\/\d+))?$/);
    if(fm) {
      const f=await fileRow(env,fm[1]);
      if(!fm[2] && method==='GET') return await downloadFile(env,f,url);
      if(!fm[2] && method==='DELETE') {await deleteFile(env,user,f);return json({ok:true});}
      if(fm[2]==='complete' && method==='POST') return json(await finishUpload(env,user,f));
      if(fm[2]?.startsWith('parts/') && method==='PUT') return json(await uploadPart(env,user,f,Number(fm[2].split('/')[1]),request));
    }
    if(path==='/api/account/password' && method==='POST') {
      const input=await bodyJSON(request);
      assert(typeof input.current_password==='string' && input.current_password.length<=256,400,'Enter your current password.');
      assert(await hashPassword(input.current_password,user.salt,user.iterations)===user.password_hash,400,'Current password is incorrect.');
      const p=await passwordRecord(input.password);
      await env.DB.batch([env.DB.prepare('UPDATE users SET password_hash=?,salt=?,iterations=? WHERE id=?').bind(p.hash,p.salt,p.iterations,user.id),env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id)]);
      return json({ok:true},200,{'set-cookie':sessionCookie('',0)});
    }
    if(path==='/api/admin/notifications' && method==='GET') {
      admin(user);
      const [notifications,counts,heartbeat]=await Promise.all([
        all(env.DB.prepare('SELECT id,kind,recipient,project_id,status,attempts,error,created_at,sent_at FROM notification_outbox ORDER BY created_at DESC LIMIT 100')),
        all(env.DB.prepare('SELECT status,count(*) AS n FROM notification_outbox GROUP BY status')),
        env.DB.prepare("SELECT value,updated_at FROM worker_state WHERE key='heartbeat'").first()
      ]); return json({notifications,counts,heartbeat});
    }
    const retry=path.match(/^\/api\/admin\/notifications\/([a-f0-9-]{36})\/retry$/);
    if(retry && method==='POST') {
      admin(user);
      const old=await env.DB.prepare("SELECT * FROM notification_outbox WHERE id=? AND status='failed'").bind(retry[1]).first();assert(old,409,'Only failed notifications can be retried.');
      const expired=old.first_attempt && Date.now()-new Date(old.first_attempt).getTime()>23*3600000;
      await env.DB.prepare("UPDATE notification_outbox SET id=?,status='pending',attempts=0,error=NULL,first_attempt=?,next_attempt=? WHERE id=? AND status='failed'").bind(expired?id():old.id,expired?null:old.first_attempt,isoNow(),old.id).run();
      return json({ok:true});
    }
    assert(false,404,'Page not found.');
  } catch(e) {
    const setup=String(e.message).includes('no such table');
    if(!e.status && !setup) console.error('Portal API error:',e.name,e.message);
    return json({error:setup?'Run schema.sql in the Cloudflare D1 console to initialize this portal.':e.status?e.message:'The request could not be completed. Please try again.'},setup?503:(e.status || 500));
  }
}
