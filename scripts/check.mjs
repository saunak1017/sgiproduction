import {readdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=resolve(new URL('..',import.meta.url).pathname);
async function visit(dir){for(const item of await readdir(dir,{withFileTypes:true})){if(['node_modules','.local','.wrangler'].includes(item.name))continue;const path=resolve(dir,item.name);if(item.isDirectory())await visit(path);else if(/\.(js|mjs)$/.test(path))execFileSync(process.execPath,['--check',path],{stdio:'pipe'});}}
await visit(root);
for(const f of ['public/index.html','public/styles.css','schema.sql','functions/api/[[path]].js','worker/index.js'])await readFile(resolve(root,f));
console.log('Source syntax and required Cloudflare files verified.');
