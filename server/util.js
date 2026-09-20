export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const assert = (ok, status, message) => { if (!ok) throw new HttpError(status, message); };
export const isoNow = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
export const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}
});
export async function bodyJSON(request) {
  assert((request.headers.get('content-type') || '').startsWith('application/json'),415,'Use a JSON request.');
  assert(Number(request.headers.get('content-length') || 0) <= 128*1024,413,'Request is too large.');
  const reader = request.body?.getReader();
  let size = 0; const chunks = [];
  if (reader) {
    for (let partNumber=0;partNumber<8192;partNumber++) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > 128*1024) { await reader.cancel(); throw new HttpError(413,'Request is too large.'); }
      chunks.push(part.value);
      if(partNumber===8191) {await reader.cancel();throw new HttpError(413,'Too many request chunks.');}
    }
  }
  const bytes = new Uint8Array(size); let offset=0;
  for (const c of chunks) { bytes.set(c,offset); offset+=c.length; }
  let result;
  try { result = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400,'Invalid JSON.'); }
  assert(result && typeof result === 'object' && !Array.isArray(result),400,'Expected an object.');
  return result;
}
export function textField(value, max = 500) {
  assert(value === undefined || value === null || typeof value === 'string',400,'Invalid text field.');
  const v = (value || '').trim();
  assert(v.length <= max,400,`Text must be ${max} characters or fewer.`);
  return v;
}
export const all = async statement => (await statement.all()).results;
export const hex = bytes => Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
export async function sha256(value) { return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))); }
export const safeUser = u => ({id:u.id,username:u.username,display_name:u.display_name,role:u.role});
