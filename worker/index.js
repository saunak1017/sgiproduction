import {enqueueDigest,deliverOutbox} from '../server/notifications.js';
export default {
  async scheduled(event,env,ctx) {
    ctx.waitUntil((async()=>{
      const now=new Date(event.scheduledTime);
      // Pausing notifications pauses both digest creation and sending. Event emails
      // stay safely queued by the portal until sending is enabled.
      if(env.NOTIFICATIONS_ENABLED==='true') await enqueueDigest(env,now);
      await deliverOutbox(env,{now});
      if(now.getUTCMinutes()===0) {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now.toISOString()),
          env.DB.prepare('DELETE FROM login_attempts WHERE reset_at<?').bind(now.toISOString())
        ]);
        const stale=(await env.DB.prepare('SELECT * FROM files WHERE ready=0 AND created_at<? LIMIT 20').bind(new Date(+now-86400000).toISOString()).all()).results;
        for(const f of stale) {
          if(!env.UPLOADS) break;
          if(f.upload_id) await env.UPLOADS.resumeMultipartUpload(f.object_key,f.upload_id).abort().catch(()=>{});
          await env.UPLOADS.delete(f.object_key);
          await env.DB.batch([env.DB.prepare('DELETE FROM upload_parts WHERE file_id=?').bind(f.id),env.DB.prepare('DELETE FROM files WHERE id=? AND ready=0').bind(f.id)]);
        }
      }
    })());
  },
  fetch() {return new Response('Shivani Production notification worker. No public actions.',{status:404});}
};
