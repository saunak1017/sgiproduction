import {CHUNK_SIZE,MAX_FILE_SIZE,FILE_GROUPS} from '../public/domain.js';
import {all,assert,id,isoNow,textField} from './util.js';
const mimes={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',avif:'image/avif',heic:'image/heic',heif:'image/heif',tif:'image/tiff',tiff:'image/tiff',bmp:'image/bmp',pdf:'application/pdf',stl:'application/octet-stream','3dm':'application/octet-stream'};
export async function beginUpload(env,user,p,input) {
  assert(env.UPLOADS,503,'Add the UPLOADS R2 binding in Cloudflare.');
  const bucket=textField(input.bucket,20),name=textField(input.name,240).replace(/[\x00-\x1f\x7f/\\]/g,'_');
  assert(Object.hasOwn(FILE_GROUPS,bucket),400,'Choose an upload category.');
  const ext=name.split('.').pop().toLowerCase();
  assert(name && (bucket==='reference' ? Object.hasOwn(mimes,ext) && !['stl','3dm'].includes(ext) : ext===bucket),400,`Choose a valid ${FILE_GROUPS[bucket]} file.`);
  assert(Number.isInteger(input.size) && input.size>0 && input.size<=MAX_FILE_SIZE,400,'Files must be between 1 byte and 100 MB.');
  const count=await env.DB.prepare('SELECT count(*) AS n FROM files WHERE project_id=?').bind(p.id).first();
  assert(count.n<200,400,'This project has reached its 200-file limit.');
  const fileId=id(),key=`projects/${p.id}/${bucket}/${fileId}/${name}`;
  const upload=await env.UPLOADS.createMultipartUpload(key,{httpMetadata:{contentType:mimes[ext]}});
  try {
    await env.DB.prepare('INSERT INTO files(id,project_id,actor_id,bucket,name,object_key,size,mime,upload_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(fileId,p.id,user.id,bucket,name,key,input.size,mimes[ext],upload.uploadId,isoNow()).run();
  } catch(e) {await upload.abort().catch(()=>{});throw e;}
  return {id:fileId,chunk_size:CHUNK_SIZE};
}
export async function fileRow(env,fileId) {
  const f=await env.DB.prepare('SELECT * FROM files WHERE id=?').bind(fileId).first();
  assert(f,404,'File not found.'); return f;
}
export async function uploadPart(env,user,f,partNumber,request) {
  assert(f.actor_id===user.id,403,'This upload belongs to another user.');
  assert(!f.ready && f.upload_id,409,'This upload is already finished.');
  const count=Math.ceil(f.size/CHUNK_SIZE);
  assert(Number.isInteger(partNumber) && partNumber>=1 && partNumber<=count,400,'Invalid upload part.');
  const expected=partNumber===count ? f.size-(count-1)*CHUNK_SIZE : CHUNK_SIZE;
  const declared=Number(request.headers.get('content-length'));
  assert(declared===expected,400,'Upload chunk size does not match.');
  // Only one 8 MB chunk is buffered, never the entire 85 MB CAD file.
  const data=await request.arrayBuffer();
  assert(data.byteLength===expected,400,'Upload chunk is incomplete. Please retry.');
  const part=await env.UPLOADS.resumeMultipartUpload(f.object_key,f.upload_id).uploadPart(partNumber,data);
  await env.DB.prepare('INSERT INTO upload_parts(file_id,part_number,etag) VALUES (?,?,?) ON CONFLICT(file_id,part_number) DO UPDATE SET etag=excluded.etag').bind(f.id,partNumber,part.etag).run();
  return {part:partNumber};
}
export async function finishUpload(env,user,f) {
  assert(f.actor_id===user.id,403,'This upload belongs to another user.');
  if(f.ready) return {id:f.id};
  let object=await env.UPLOADS.head(f.object_key);
  if(!object) {
    const parts=await all(env.DB.prepare('SELECT part_number,etag FROM upload_parts WHERE file_id=? ORDER BY part_number').bind(f.id));
    assert(parts.length===Math.ceil(f.size/CHUNK_SIZE),400,'Some upload chunks are missing. Retry the upload.');
    object=await env.UPLOADS.resumeMultipartUpload(f.object_key,f.upload_id).complete(parts.map(p=>({partNumber:p.part_number,etag:p.etag})));
  }
  assert(object.size===f.size,409,'File size mismatch. Upload this file again.');
  await env.DB.batch([
    env.DB.prepare('UPDATE files SET ready=1,upload_id=NULL WHERE id=?').bind(f.id),
    env.DB.prepare('DELETE FROM upload_parts WHERE file_id=?').bind(f.id)
  ]);
  return {id:f.id};
}
export async function deleteFile(env,user,f) {
  assert(user.role==='admin' || f.actor_id===user.id,403,'Only the uploader or an admin can remove this file.');
  if(f.upload_id) await env.UPLOADS.resumeMultipartUpload(f.object_key,f.upload_id).abort().catch(()=>{});
  await env.UPLOADS.delete(f.object_key);
  await env.DB.batch([env.DB.prepare('DELETE FROM upload_parts WHERE file_id=?').bind(f.id),env.DB.prepare('DELETE FROM files WHERE id=?').bind(f.id)]);
}
export async function downloadFile(env,f,url) {
  assert(f.ready,404,'File is not ready.');
  const object=await env.UPLOADS.get(f.object_key);assert(object,404,'The stored file could not be found.');
  const inline=url.searchParams.get('inline')==='1' && ['image/jpeg','image/png','image/gif','image/webp','image/avif'].includes(f.mime);
  const ascii=f.name.replace(/[^a-zA-Z0-9._ -]/g,'_');
  const encoded=encodeURIComponent(f.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  return new Response(object.body,{headers:{'content-type':inline?f.mime:'application/octet-stream','content-length':String(f.size),'content-disposition':`${inline?'inline':'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`,'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}});
}
