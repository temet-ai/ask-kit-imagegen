import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createLibrary} from '../lib/library.mjs';
import {workflows,selectWorkflow} from '../lib/workflows.mjs';
import {inspectImage} from '../lib/studio.mjs';
import makeScript from '../scripts/make.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'imagegen-library-'));
const image=path.join(root,'source.png');
assert.equal(spawnSync('python3',['-c','from PIL import Image; import sys; Image.new("RGB",(40,30),(100,80,50)).save(sys.argv[1])',image]).status,0);
const lib=(name,act=true)=>createLibrary({root:path.join(root,name),act});
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));

test('read-only library does not write or silently enable mutations',()=>{
  const l=lib('readonly',false); assert.deepEqual(l.areas(),[]);
  assert.throws(()=>l.createArea({name:'a'}),/needs act/);
  assert.throws(()=>l.ensureArea('a'),/needs act/);
  assert.equal(fs.existsSync(l.root),false);
});
test('imports preserve originals, roles, source and independent areas',()=>{
  const l=lib('copies'); l.createArea({name:'plants'});l.createArea({name:'ships'});
  const source=path.join(root,'temporary.png');fs.copyFileSync(image,source);
  const r=l.addReference({area:'plants',image:source,role:'palette',source:'https://example.org/plant',notes:'Warm ink only',tags:['botanical']});
  fs.unlinkSync(source);
  assert.ok(fs.existsSync(r.file));assert.equal(r.validation.sha256,inspectImage(image).sha256);
  assert.equal(l.reference('plants',r.id).source,'https://example.org/plant');
  assert.equal(l.references({area:'ships'}).length,0);
  assert.equal(l.references({area:'plants',search:'botanical'})[0].role,'palette');
  assert.throws(()=>l.reference('ships',r.id),/no reference/);
});
test('only approved references recur; explicit candidates never imply approval',()=>{
  const l=lib('feedback');l.createArea({name:'a'});
  const r=l.addReference({area:'a',image});
  assert.equal(l.select({area:'a'}).references.length,0);
  assert.equal(l.select({area:'a',referenceIds:[r.id]}).references.length,1);
  assert.equal(l.reference('a',r.id).status,'candidate');
  assert.throws(()=>l.feedback({area:'a',verdict:'approved'}),/exactly one/);
  l.feedback({area:'a',reference:r.id,verdict:'approved',role:'palette',note:'Only keep these colours'});
  const s=l.select({area:'a'});assert.equal(s.references[0].role,'palette');
  assert.equal(s.references[0].feedback[0].note,'Only keep these colours');
  l.feedback({area:'a',reference:r.id,verdict:'rejected',note:'Too cold'});
  assert.equal(l.select({area:'a'}).references.length,0);
  assert.equal(l.journal({area:'a'}).filter(e=>e.type==='feedback').length,2);
});
test('retrieval ranks by interest, bounds context and excludes unrelated identities',()=>{
  const l=lib('retrieval');l.createArea({name:'botany',title:'Botanical plates',description:'Fern specimens'});
  const add=(title,role='style')=>l.addReference({area:'botany',image,title,role,status:'approved'});
  const fern=add('Fern stipple study');add('Other palette');add('Sci-fi spaceship','identity');
  const s=l.select({area:'botany',query:'new plate'});
  assert.equal(s.references[0].id,fern.id);assert.equal(s.references.length,2);
  assert.equal(l.select({area:'botany',referenceIds:[]}).references.length,0);
  assert.equal(l.select({area:'botany',limit:1}).references.length,1);
  assert.throws(()=>l.select({area:'botany',limit:-1}),/selection limit/);
});
test('selection refuses missing or modified stored originals',()=>{
  const l=lib('integrity');l.createArea({name:'a'});
  const r=l.addReference({area:'a',image,status:'approved'});
  fs.writeFileSync(r.file,'bad');assert.throws(()=>l.select({area:'a'}));
  fs.unlinkSync(r.file);assert.throws(()=>l.select({area:'a'}),/missing/);
});
test('style revisions and feedback remain auditable with journal pagination',()=>{
  const l=lib('journal');l.createArea({name:'a'});
  l.setStyle({area:'a',keep:['ink'],avoid:['gradients'],workflow:'cover',note:'Use pen lines'});
  const first=l.area('a');l.setStyle({area:'a',keep:['ink','paper']});
  l.note({area:'a',text:'Try denser strokes next time'});
  assert.deepEqual(first.style.keep,['ink']);
  assert.deepEqual(l.area('a').style.avoid,['gradients']);
  const state=l.area('a');assert.notStrictEqual(state.style.keep,state.recentFeedback.find(e=>e.seq===2).data.changes.keep);
  const page=l.journal({area:'a',limit:2});assert.deepEqual(page.map(e=>e.seq),[3,2]);
  assert.equal(l.journal({area:'a',before:2})[0].data.note,'Use pen lines');
  assert.throws(()=>l.setStyle({area:'a',workflow:'missing'}),/unknown workflow/);
});
test('parallel journal writers retain every event once',async()=>{
  const l=lib('parallel');
  const module=new URL('../lib/library.mjs',import.meta.url).href;
  await Promise.all(Array.from({length:6},(_,i)=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',`import {createLibrary} from ${JSON.stringify(module)}; const l=createLibrary({root:${JSON.stringify(l.root)},act:true}); l.ensureArea('a'); l.note({area:'a',text:'note ${i}'});`],{stdio:'pipe'});
    let err='';child.stderr.on('data',d=>err+=d);child.on('error',reject);child.on('close',code=>code?reject(new Error(err)):resolve());
  })));
  assert.deepEqual(l.journal({area:'a'}).map(e=>e.seq),[6,5,4,3,2,1]);
});
test('generation journal stores provenance and candidates idempotently; failures have no image',()=>{
  const l=lib('results');const job={id:'img-first',kind:'make',status:'done',file:image,request:{area:'a',prompt:'Test'},libraryContext:{revision:7,references:[{id:'ref-prior'}]},workflow:{id:'cover',commit:'pinned'},referenceUse:[{reference:'ref-prior',traits:'warm palette'}],observations:['Possible denser lines']};
  const result=l.recordJob(job);l.recordJob(job);
  assert.equal(result.reference,'ref-img-first');assert.equal(l.area('a').references[0].status,'candidate');
  assert.equal(l.journal({area:'a'}).length,2);
  const event=l.journal({area:'a'})[0];assert.equal(event.data.usedRevision,7);
  assert.deepEqual(event.data.referenceUse,job.referenceUse);assert.equal(event.data.workflow.commit,'pinned');
  l.recordJob({...job,id:'img-fail',status:'failed',file:null,error:'quota'});
  assert.equal(l.area('a').references.length,1);assert.equal(l.journal({area:'a'})[0].type,'failure');
});
test('sheet includes guidance, feedback and escaping, preserving source bytes and prior exports',()=>{
  const l=lib('sheet');l.createArea({name:'a',title:'Botanical plates'});
  const r=l.addReference({area:'a',image,title:'<script>unsafe</script>',notes:'Palette only',status:'approved'});
  l.setStyle({area:'a',guidance:'Fine ink',keep:['paper'],avoid:['neon']});
  l.feedback({area:'a',reference:r.id,verdict:'approved',note:'Good colours'});
  const before=inspectImage(r.file).sha256;const sheet=l.sheet({area:'a'});
  assert.ok(fs.existsSync(sheet.sheets[0]));assert.equal(inspectImage(sheet.sheets[0]).width,1080);
  const html=fs.readFileSync(sheet.html,'utf8');assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('Good colours'));assert.ok(html.includes('data:image/png;base64,'));
  assert.equal(inspectImage(r.file).sha256,before);
  assert.throws(()=>l.sheet({area:'a',out:path.dirname(sheet.html)}),/EEXIST/);
});
test('all bundled workflow sources are intact, selected narrowly and overrideable',()=>{
  const catalog=workflows();assert.equal(catalog.length,7);
  for(const w of catalog.filter(w=>w.id!=='general')){const selected=selectWorkflow({workflow:w.id});assert.ok(fs.existsSync(selected.entry));assert.match(selected.digest,/^[a-f0-9]{64}$/);assert.equal(selected.commit,w.commit);}
  assert.equal(selectWorkflow({prompt:'an infographic about leaves'}).id,'infographic');
  assert.equal(selectWorkflow({prompt:'a plant'}).id,'general');
  assert.equal(selectWorkflow({prompt:'a plant'},{style:{workflow:'article'}}).id,'article');
  assert.equal(selectWorkflow({workflow:'general'},{style:{workflow:'article'}}).id,'general');
});
test('make script accepts JSON reference arrays including explicit empty selection',async()=>{
  let options;const imagegen={make:o=>(options=o,{id:'img-script',status:'done'})};
  await makeScript({imagegen},{prompt:'Test',referenceIds:'[]',wait:0});assert.deepEqual(options.referenceIds,[]);
  await makeScript({imagegen},{prompt:'Test',referenceIds:'["ref-one"]',wait:0});assert.deepEqual(options.referenceIds,['ref-one']);
});
