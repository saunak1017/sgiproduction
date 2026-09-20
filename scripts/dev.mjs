// Local-only development server. This file is never a Cloudflare entry point.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {randomBytes} from 'node:crypto';
import {LocalD1,LocalR2,initializeDB} from './local-bindings.mjs';
import {handleRequest} from '../server/api.js';
const root=fileURLToPath(new URL('..',import.meta.url));
await mkdir(resolve(root,'.local'),{recursive:true});
const DB=new LocalD1(resolve(root,'.local/dev.sqlite'));initializeDB(DB);
const devPassword=process.env.DEV_PASSWORD || randomBytes(12).toString('base64url');
const env={DB,UPLOADS:new LocalR2(resolve(root,'.local/r2')),PORTAL_URL:'http://localhost:8788',
  BOOTSTRAP_USERS_JSON:JSON.stringify([
    {username:'saunak',display_name:'Saunak Shah',role:'admin',password:devPassword},
    {username:'atit',display_name:'Atit',role:'admin',password:devPassword},
    {username:'rfg1',display_name:'RFG · Alex',role:'vendor',password:devPassword},
    {username:'rfg2',display_name:'RFG · Workshop',role:'vendor',password:devPassword}
  ])};
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost:8788');
    if(url.pathname.startsWith('/api/')){
      const request=new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})});
      const result=await handleRequest(request,env);res.writeHead(result.status,Object.fromEntries(result.headers));
      if(result.body)await pipeline(Readable.fromWeb(result.body),res);else res.end();
    }else{
      const pathname=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname),target=resolve(root,'public','.'+pathname);
      if(!target.startsWith(resolve(root,'public')+'/')){res.writeHead(403);res.end();return;}
      const bytes=await readFile(target);
      res.writeHead(200,{'Content-Type':mime[extname(target)]||'application/octet-stream','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"});res.end(bytes);
    }
  }catch(e){if(e.code==='ENOENT'){res.writeHead(404);res.end('Not found');}else{console.error(e);res.writeHead(500);res.end('Local server error');}}
});
server.listen(8788,'127.0.0.1',()=>{
  console.log('Local portal: http://localhost:8788');
  if(!DB.db.prepare('SELECT count(*) AS n FROM users').get().n) console.log(`LOCAL-ONLY accounts: saunak, atit, rfg1, rfg2. Temporary development password: ${devPassword}`);
  else console.log('Using existing local accounts. Remove .local/dev.sqlite to reset development data.');
  console.log('Email delivery is disabled in this local server.');
});
