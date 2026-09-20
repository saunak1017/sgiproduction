import {assert, id, isoNow, sha256, hex, safeUser, textField} from './util.js';
// Cloudflare WebCrypto limit, and the user's explicit maximum. Never raise above 100,000.
export const HASH_ITERATIONS = 100000;
export async function hashPassword(password, salt, iterations = HASH_ITERATIONS) {
  assert(Number.isInteger(iterations) && iterations > 0 && iterations <= 100000,500,'Invalid password configuration.');
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations,hash:'SHA-256'},key,256));
}
export async function passwordRecord(password) {
  assert(typeof password === 'string' && password.length >= 12 && password.length <= 256,400,'Use a password between 12 and 256 characters.');
  const salt = hex(crypto.getRandomValues(new Uint8Array(24)));
  return {salt,hash:await hashPassword(password,salt),iterations:HASH_ITERATIONS};
}
function equal(a,b) {
  if(a.length!==b.length) return false;
  let difference=0; for(let i=0;i<a.length;i++) difference |= a.charCodeAt(i)^b.charCodeAt(i);
  return difference===0;
}
export async function bootstrap(env) {
  if ((await env.DB.prepare('SELECT count(*) AS n FROM users').first()).n) return;
  assert(env.BOOTSTRAP_USERS_JSON,503,'Add the BOOTSTRAP_USERS_JSON secret in Cloudflare to create your four logins.');
  let users; try {users=JSON.parse(env.BOOTSTRAP_USERS_JSON);} catch {assert(false,503,'BOOTSTRAP_USERS_JSON must be valid JSON.');}
  assert(Array.isArray(users) && users.length===4 && users.filter(u=>u.role==='admin').length===2 && users.filter(u=>u.role==='vendor').length===2,503,'Configure two admin and two vendor accounts.');
  const statements=[]; const seen=new Set();
  for (const u of users) {
    const username=textField(u.username,60).toLowerCase();
    assert(/^[a-z0-9_.-]{2,60}$/.test(username) && !seen.has(username),503,'Use four different usernames (letters, numbers, dots, underscores, or dashes).'); seen.add(username);
    const display=textField(u.display_name,100);
    assert(display,503,'Each login needs a display name.');
    const p=await passwordRecord(u.password);
    statements.push(env.DB.prepare('INSERT OR IGNORE INTO users (id,username,display_name,role,password_hash,salt,iterations,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(`user-${username}`,username,display,u.role,p.hash,p.salt,p.iterations,isoNow()));
  }
  await env.DB.batch(statements);
}
export function sameOrigin(request) {
  if (['GET','HEAD','OPTIONS'].includes(request.method)) return;
  assert(request.headers.get('origin') === new URL(request.url).origin,403,'Please submit this action from the portal.');
}
export async function login(request, env, input) {
  // Rate limiting happens BEFORE costly password derivation / first-time bootstrap.
  const username=textField(input.username,60).toLowerCase();
  const password=typeof input.password==='string' ? input.password : '';
  assert(password.length <= 256,400,'Password is too long.');
  const ip=request.headers.get('cf-connecting-ip') || 'local';
  const keys=await Promise.all([sha256(`ip:${ip}`),sha256(`user:${username}`)]);
  const now=isoNow(),reset=new Date(Date.now()+15*60*1000).toISOString();
  for(const key of keys) {
    const r=await env.DB.prepare(`INSERT INTO login_attempts (key,failures,reset_at) VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN reset_at<=? THEN 1 ELSE failures+1 END,
      reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING failures`).bind(key,reset,now,now).first();
    assert(r.failures<=20,429,'Too many sign-in attempts. Please wait 15 minutes.');
  }
  await bootstrap(env);
  const user=await env.DB.prepare('SELECT * FROM users WHERE username=? AND active=1').bind(username).first();
  const candidate=await hashPassword(password,user?.salt || 'missing-account-fixed-timing-salt',user?.iterations || HASH_ITERATIONS);
  assert(user && equal(candidate,user.password_hash),401,'Username or password is incorrect.');
  const token=hex(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await sha256(token),user.id,new Date(Date.now()+7*86400000).toISOString()),
    env.DB.prepare('DELETE FROM login_attempts WHERE key=?').bind(keys[1])
  ]);
  return {user:safeUser(user),cookie:sessionCookie(token,7*86400)};
}
export const sessionCookie=(value,age)=>`sg_production=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
export function sessionToken(request) {
  return (request.headers.get('cookie') || '').split(';').map(v=>v.trim()).find(v=>v.startsWith('sg_production='))?.slice(14) || '';
}
export async function currentUser(request,env) {
  const token=sessionToken(request);
  assert(/^[a-f0-9]{64}$/.test(token),401,'Please sign in.');
  const u=await env.DB.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1').bind(await sha256(token),isoNow()).first();
  assert(u,401,'Your session has expired. Please sign in again.');
  return u;
}
export const admin = user => assert(user.role==='admin',403,'Only Shivani admins can edit order specifications.');
