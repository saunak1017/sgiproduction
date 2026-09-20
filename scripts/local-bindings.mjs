// Development/test adapters only. Production uses Cloudflare's actual D1 and R2.
import {DatabaseSync} from 'node:sqlite';
import {mkdir,writeFile,readFile,stat,rm,open} from 'node:fs/promises';
import {readFileSync,createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

class Statement {
  constructor(db,sql,params=[]) {this.db=db;this.sql=sql;this.params=params;}
  bind(...params) {return new Statement(this.db,this.sql,params);}
  execute() {
    const statement=this.db.prepare(this.sql);
    if(statement.columns().length) {
      const results=statement.all(...this.params).map(row=>({...row}));
      return {results,success:true,meta:{changes:Number(this.db.prepare('SELECT changes() AS n').get().n)}};
    }
    const result=statement.run(...this.params);
    return {results:[],success:true,meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};
  }
  async first(column){const row=this.db.prepare(this.sql).get(...this.params);return column?row?.[column]??null:row?{...row}:null;}
  async all(){return this.execute();}
  async run(){return this.execute();}
}
export class LocalD1 {
  constructor(path=':memory:') {this.db=new DatabaseSync(path);this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');}
  prepare(sql){return new Statement(this.db,sql);}
  async batch(statements){this.db.exec('BEGIN');try{const results=statements.map(s=>s.execute());this.db.exec('COMMIT');return results;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  async exec(sql){this.db.exec(sql);return {success:true};}
  close(){this.db.close();}
}
export function initializeDB(db){db.db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));}
const hash=s=>createHash('sha256').update(s).digest('hex');
export class LocalR2 {
  constructor(root){this.root=root;this.largestPart=0;}
  objectPath(key){return join(this.root,'objects',hash(key));}
  uploadPath(uploadId){return join(this.root,'multipart',uploadId);}
  async createMultipartUpload(key,options={}){
    const uploadId=randomUUID(),path=this.uploadPath(uploadId);await mkdir(path,{recursive:true});
    await writeFile(join(path,'metadata.json'),JSON.stringify({key,options}));return this.resumeMultipartUpload(key,uploadId);
  }
  resumeMultipartUpload(key,uploadId){
    const bucket=this,path=this.uploadPath(uploadId);
    return {key,uploadId,
      async uploadPart(partNumber,data){const buf=Buffer.from(data);bucket.largestPart=Math.max(bucket.largestPart,buf.length);await writeFile(join(path,String(partNumber)),buf);return {partNumber,etag:hash(buf)};},
      async complete(parts){
        const {options}=JSON.parse(await readFile(join(path,'metadata.json'),'utf8'));
        const target=bucket.objectPath(key);await mkdir(join(bucket.root,'objects'),{recursive:true});
        const handle=await open(target,'w');
        try{for(const p of parts){const buffer=await readFile(join(path,String(p.partNumber)));if(hash(buffer)!==p.etag)throw new Error('ETag mismatch');await handle.write(buffer);}}finally{await handle.close();}
        await writeFile(target+'.json',JSON.stringify(options));await rm(path,{recursive:true,force:true});return bucket.head(key);
      },
      async abort(){await rm(path,{recursive:true,force:true});}
    };
  }
  async head(key){try{return {key,size:(await stat(this.objectPath(key))).size};}catch(e){if(e.code==='ENOENT')return null;throw e;}}
  async get(key){const info=await this.head(key);if(!info)return null;return {...info,body:Readable.toWeb(createReadStream(this.objectPath(key)))};}
  async delete(key){await rm(this.objectPath(key),{force:true});await rm(this.objectPath(key)+'.json',{force:true});}
}
