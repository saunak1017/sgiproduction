// Isolated DOM/component tests. No browser, localhost connection, or external requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {JSDOM} from 'jsdom';
import * as domain from '../public/domain.js';
import {LocalD1,initializeDB} from '../scripts/local-bindings.mjs';
import {handleRequest} from '../server/api.js';

const script=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
async function until(fn,message='Expected UI did not appear') {
  for(let attempt=0;attempt<300;attempt++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw new Error(message);
}
async function fixture(t,{role='admin',route='/new'}={}){
  const DB=new LocalD1();initializeDB(DB);
  const env={DB,PORTAL_URL:'https://unit.example',BOOTSTRAP_USERS_JSON:JSON.stringify([
    {username:'admin1',display_name:'Saunak',role:'admin',password:'Test-password-123'},
    {username:'admin2',display_name:'Atit',role:'admin',password:'Test-password-123'},
    {username:'vendor1',display_name:'RFG One',role:'vendor',password:'Test-password-123'},
    {username:'vendor2',display_name:'RFG Two',role:'vendor',password:'Test-password-123'}
  ])};
  const login=await handleRequest(new Request('https://unit.example/api/login',{method:'POST',headers:{origin:'https://unit.example','content-type':'application/json'},body:JSON.stringify({username:role==='admin'?'admin1':'vendor1',password:'Test-password-123'})}),env);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const calls=[];
  const dom=new JSDOM(html,{url:`https://unit.example/#${route}`,runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;
  w.testDomain=domain;w.confirm=()=>true;
  if(!w.crypto.randomUUID)w.crypto.randomUUID=()=>crypto.randomUUID();
  w.fetch=async(url,options={})=>{
    calls.push({url,method:options.method||'GET',body:options.body});
    const headers={...options.headers,cookie};if(options.method&&options.method!=='GET')headers.origin='https://unit.example';
    return handleRequest(new Request(new URL(url,'https://unit.example'),{...options,headers}),env);
  };
  t.after(()=>{w.close();DB.close();});
  w.eval(script.replace(/^import[^\n]+\n/,`const {${Object.keys(domain).join(',')}}=window.testDomain;\n`));
  const $=s=>w.document.querySelector(s);
  const input=(el,value)=>{assert.ok(el);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
  const submit=form=>form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  return {dom,w,$,input,submit,DB,env,calls};
}

test('project typing preserves field nodes, focus and caret without per-keystroke requests',async t=>{
  const {w,$,input,DB,calls}=await fixture(t);await until(()=>$('#order-form'));
  const form=$('#order-form'),notes=$('textarea[name="notes"]'),name=$('input[name="name"]');
  input(name,'Emerald & diamond ring');notes.focus();
  const before=calls.length,start=performance.now(),text='Hand finish the gallery. '.repeat(100);
  for(const char of text){notes.value+=char;notes.dispatchEvent(new w.InputEvent('input',{bubbles:true,data:char,inputType:'insertText'}));}
  const elapsed=performance.now()-start;
  assert.equal($('#order-form'),form);assert.equal($('textarea[name="notes"]'),notes);assert.equal(w.document.activeElement,notes);assert.equal(notes.value,text);assert.equal(notes.selectionStart,text.length);assert.equal(calls.length,before);
  const row=$('.stone-row');input(row.querySelector('[data-key="weight"]'),'1.25');input(row.querySelector('[data-key="quantity"]'),'3');assert.equal(row.querySelector('output').textContent,'3.75 ct');
  const weight=row.querySelector('[data-key="weight"]');weight.focus();weight.setSelectionRange(1,1);input(row.querySelector('[data-key="basis"]'),'total');assert.equal(row.querySelector('output').textContent,'1.25 ct');assert.equal(w.document.activeElement,weight);
  $('#add-stone').click();assert.equal(w.document.querySelectorAll('.stone-row').length,2);assert.equal($('.stone-row'),row);
  const other=$('input[value="Other"]');other.checked=true;other.dispatchEvent(new w.Event('input',{bubbles:true}));assert.ok(!$('#other-stamping').classList.contains('hidden'));
  input($('#delivery-text'),'09/23/2026');assert.equal($('#delivery-picker').value,'2026-09-23');
  $('#delivery-picker').value='2026-10-01';$('#delivery-picker').dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal($('#delivery-text').value,'10/01/2026');
  t.diagnostic(`Processed ${text.length} local input events in ${elapsed.toFixed(1)} ms; zero requests and no field replacement. This measures handlers, not browser paint.`);
  assert.equal(DB.db.prepare('SELECT count(*) AS n FROM projects').get().n,0);
});

test('blank form creates an order; invalid typed date preserves edits; edit form saves correct values',async t=>{
  const {w,$,input,submit,DB}=await fixture(t);await until(()=>$('#order-form'));
  input($('#delivery-text'),'02/31/2026');submit($('#order-form'));assert.match($('.error').textContent,/MM\/DD\/YYYY/);assert.equal(DB.db.prepare('SELECT count(*) AS n FROM projects').get().n,0);
  input($('#delivery-text'),'');submit($('#order-form'));await until(()=>$('#change-stage'),'Blank project failed to create');
  assert.equal(DB.db.prepare('SELECT count(*) AS n FROM projects').get().n,1);assert.match($('h1').textContent,/Untitled/);
  const link=[...w.document.querySelectorAll('a')].find(a=>a.textContent.includes('Edit project'));link.click();await until(()=>$('#order-form'));
  input($('[name="name"]'),'Oval solitaire');input($('[name="metal"]'),'18K yellow gold');input($('[name="quantity"]'),'2 pairs');input($('[name="notes"]'),'Leave gallery open.');input($('[name="cad_modifications"]'),'Confirm prong clearance.');submit($('#order-form'));await until(()=>$('#change-stage'));
  assert.equal($('h1').textContent,'Oval solitaire');assert.match($('#main').textContent,/18K yellow gold/);assert.match($('#main').textContent,/2 pairs/);assert.match($('#main').textContent,/Confirm prong clearance/);assert.match($('.file-download')?.textContent||'Download',/Download/);
});

test('pickup prompt accepts optional cost; completed routing works; an unsent comment survives a stage change',async t=>{
  const {w,$,input,submit,DB}=await fixture(t);await until(()=>$('#order-form'));submit($('#order-form'));await until(()=>$('#change-stage'));
  input($('#comment'),'Please keep this unsent draft.');$('#change-stage').click();await until(()=>$('dialog'));
  const select=$('dialog [name="stage"]');select.value='6';select.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.ok(!$('#pickup-fields').classList.contains('hidden'));assert.equal($('#skip-pickup').hidden,false);
  input($('dialog [name="cost"]'),'150.25');$('dialog [name="cost_basis"]').value='piece';input($('dialog [name="invoice"]'),'INV-31');submit($('dialog form'));
  await until(()=>!$('dialog')&&$('#main').textContent.includes('$150.25'));assert.equal($('#comment').value,'Please keep this unsent draft.');
  $('#change-stage').click();await until(()=>$('dialog'));$('dialog [name="stage"]').value='7';submit($('dialog form'));
  await until(()=>!$('dialog')&&DB.db.prepare('SELECT stage FROM projects').get().stage===7);
  await until(()=>$('#main').textContent.includes('Back to completed projects'));
  assert.equal($('#comment').value,'Please keep this unsent draft.');
});

test('vendor dashboard omits creation and server-backed edit routes are denied',async t=>{
  const {w,$}=await fixture(t,{role:'vendor',route:'/active'});await until(()=>$('#project-results')&&!$('.loading'));
  assert.equal(w.document.querySelector('a[href="#/new"]'),null);
  w.location.hash='/new';await until(()=>$('#main').textContent.includes('Only admins can create projects.'));
});
