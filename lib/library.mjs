// Area libraries retain originals, user decisions and the exact context used by each job.
// One immutable event file per change; a short per-area lock assigns sequence numbers.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectImage } from './studio.mjs';
import { validateWorkflow } from './workflows.mjs';

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ROLES = ['style', 'composition', 'palette', 'identity', 'subject', 'example'];
const STATES = ['candidate', 'approved', 'rejected', 'archived'];
const checkedName = value => {
  if (!NAME.test(String(value || ''))) throw new Error('area name: use lowercase letters, digits and dashes (up to 64 characters)');
  return String(value);
};
const strings = (value, field) => {
  if (!Array.isArray(value) || value.some(x => typeof x !== 'string' || !x.trim())) throw new Error(`${field} must be an array of nonempty strings`);
  return [...new Set(value)];
};
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const tokens = text => [...new Set(String(text || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])];
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function createLibrary({ root, act = false, cwd = process.cwd(), resolveImage = image => path.resolve(cwd, image) }) {
  root = path.resolve(root);
  const folder = area => path.join(root, checkedName(area));
  const requireAct = () => { if (!act) throw new Error('not in this ask: changing the reference library needs act: true; no image quota is spent'); };
  const metadata = area => {
    try { return read(path.join(folder(area), 'area.json')); }
    catch (e) { if (e.code === 'ENOENT') throw new Error(`no reference area "${area}"; create it first`); throw e; }
  };
  const events = area => {
    metadata(area);
    const dir = path.join(folder(area), 'journal');
    return fs.readdirSync(dir).filter(f => /^\d{12}-.*\.json$/.test(f)).sort().map(f => read(path.join(dir, f)));
  };
  const locked = (area, work) => {
    const lock = path.join(folder(area), '.write-lock');
    const deadline = Date.now() + 5000;
    for (;;) {
      try { fs.mkdirSync(lock); break; }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        try {
          const owner = read(path.join(lock, 'owner.json'));
          try { process.kill(owner.pid, 0); } catch (e) { if (e.code === 'ESRCH') { fs.rmSync(lock, { recursive: true, force: true }); continue; } }
        } catch (e) {
          if (e.code === 'ENOENT') {
            try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) { fs.rmSync(lock, { recursive: true, force: true }); continue; } } catch {}
          } else throw e;
        }
        if (Date.now() >= deadline) throw new Error(`reference area ${area} is being updated; retry the library operation`);
        sleep(25);
      }
    }
    try { fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({pid:process.pid})); return work(); }
    finally { fs.rmSync(lock, { recursive: true, force: true }); }
  };
  function append(area, type, data, actor = 'user', key) {
    metadata(area);
    return locked(area, () => {
      const log = events(area);
      if (key) { const prior = log.find(e => e.key === key); if (prior) return prior; }
      const seq = (log.at(-1)?.seq || 0) + 1;
      const event = { seq, id: crypto.randomUUID(), at: new Date().toISOString(), area, type, actor, ...(key ? {key} : {}), data };
      const filename = path.join(folder(area), 'journal', `${String(seq).padStart(12, '0')}-${event.id}.json`);
      const temp = `${filename}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(event, null, 2), {flag:'wx'}); fs.renameSync(temp, filename);
      return event;
    });
  }
  function snapshot(area) {
    const meta = metadata(area), log = events(area);
    const style = { guidance: '', keep: [], avoid: [], workflow: 'auto' };
    const refs = new Map();
    for (const e of log) {
      if (e.type === 'style') Object.assign(style, structuredClone(e.data.changes));
      if (e.type === 'reference') refs.set(e.data.id, { ...e.data, addedAt: e.at, status: e.data.status || 'candidate', feedback: [] });
      if (e.type === 'reference-update' && refs.has(e.data.reference)) Object.assign(refs.get(e.data.reference), structuredClone(e.data.changes));
      if (e.type === 'feedback' && refs.has(e.data.reference)) {
        const ref = refs.get(e.data.reference);
        Object.assign(ref, structuredClone(e.data.changes || {}));
        ref.status = e.data.verdict;
        ref.feedback.push({ at: e.at, note: e.data.note, verdict: e.data.verdict, actor: e.actor });
      }
    }
    const references = [...refs.values()].map(r => ({...r, exists:fs.existsSync(r.file)}));
    return { ...meta, revision: log.at(-1)?.seq || 0, style, references,
      counts: Object.fromEntries(STATES.map(s => [s,references.filter(r=>r.status===s).length])),
      recentFeedback: log.filter(e => ['feedback','note','style'].includes(e.type)).slice(-12),
    };
  }
  function storeImage(area, image) {
    const validation = inspectImage(image);
    const ext = {PNG:'.png',JPEG:'.jpg',WEBP:'.webp',GIF:'.gif'}[validation.format];
    const file = path.join(folder(area), 'images', `${validation.sha256}${ext}`);
    fs.mkdirSync(path.dirname(file), {recursive:true});
    try { fs.copyFileSync(image, file, fs.constants.COPYFILE_EXCL); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (inspectImage(file).sha256 !== validation.sha256) throw new Error(`reference storage integrity failure: ${file}`);
    return {file, validation};
  }
  const api = {
    root,
    areas() {
      if (!fs.existsSync(root)) return [];
      return fs.readdirSync(root).filter(n => NAME.test(n) && fs.existsSync(path.join(root,n,'area.json'))).sort().map(n => {
        const {name,title,description,revision,counts,style} = snapshot(n); return {name,title,description,revision,counts,workflow:style.workflow};
      });
    },
    area: snapshot,
    references({area, status, search, limit = 100} = {}) {
      if (status && !STATES.includes(status)) throw new Error('unknown reference status');
      const query = tokens(search);
      return snapshot(area).references.filter(r => (!status || r.status===status) && (!query.length || query.every(t=>`${r.title} ${r.notes} ${r.tags.join(' ')}`.toLowerCase().includes(t)))).slice(-Math.max(1,Math.min(1000,Number(limit)||100))).reverse();
    },
    reference(area, id) {
      const ref = snapshot(area).references.find(r => r.id===id);
      if (!ref) throw new Error(`no reference ${id} in area ${area}`);
      return ref;
    },
    journal({area, limit = 30, before} = {}) {
      return events(area).filter(e=>before===undefined||e.seq<Number(before)).slice(-Math.max(1,Math.min(1000,Number(limit)||30))).reverse();
    },
    createArea({name, title, description = ''} = {}) {
      requireAct(); name=checkedName(name);
      const dir=folder(name); fs.mkdirSync(path.join(dir,'journal'),{recursive:true});
      const meta={schema:1,name,title:String(title||name),description:String(description),createdAt:new Date().toISOString()};
      const temporary=path.join(dir,`.area-${crypto.randomUUID()}.tmp`);
      fs.writeFileSync(temporary,JSON.stringify(meta,null,2),{flag:'wx'});
      try { fs.linkSync(temporary,path.join(dir,'area.json')); }
      catch(e){ if(e.code==='EEXIST') throw new Error(`reference area ${name} already exists`); throw e; }
      finally { fs.unlinkSync(temporary); }
      return snapshot(name);
    },
    ensureArea(name) {
      requireAct();
      if (!fs.existsSync(path.join(folder(name),'area.json'))) {
        try { api.createArea({name}); } catch(e) { if (!fs.existsSync(path.join(folder(name),'area.json'))) throw e; }
      }
      return snapshot(name);
    },
    addReference({area,image,title,role='style',notes='',tags=[],source=null,status='candidate'} = {}) {
      requireAct(); metadata(area);
      if (!ROLES.includes(role)) throw new Error(`role must be ${ROLES.join(', ')}`);
      if (!STATES.includes(status)) throw new Error(`status must be ${STATES.join(', ')}`);
      const origin=resolveImage(image,area);
      const stored=storeImage(area,origin);
      const ref={id:`ref-${crypto.randomUUID()}`,title:String(title||path.basename(origin)),role,notes:String(notes),tags:strings(tags,'tags'),source:source===null?null:String(source),origin, status,...stored};
      append(area,'reference',ref);
      return api.reference(area,ref.id);
    },
    feedback({area,reference,job,verdict,note='',role,tags} = {}) {
      requireAct();
      if (!!reference === !!job) throw new Error('feedback needs exactly one reference id or job id');
      if (!STATES.includes(verdict)) throw new Error(`verdict must be ${STATES.join(', ')}`);
      const found=reference ? api.reference(area,reference) : snapshot(area).references.find(r=>r.job===job);
      if (!found) throw new Error(`no reference for job ${job} in area ${area}`);
      const changes={};
      if(role!==undefined){ if(!ROLES.includes(role)) throw new Error(`role must be ${ROLES.join(', ')}`); changes.role=role; }
      if(tags!==undefined) changes.tags=strings(tags,'tags');
      append(area,'feedback',{reference:found.id,job:found.job||null,verdict,note:String(note),changes});
      return api.reference(area,found.id);
    },
    setStyle({area,guidance,keep,avoid,workflow,note=''} = {}) {
      requireAct(); const changes={};
      if(guidance!==undefined) changes.guidance=String(guidance);
      if(keep!==undefined) changes.keep=strings(keep,'keep');
      if(avoid!==undefined) changes.avoid=strings(avoid,'avoid');
      if(workflow!==undefined) { validateWorkflow(workflow); changes.workflow=workflow; }
      if(!Object.keys(changes).length) throw new Error('setStyle needs guidance, keep, avoid or workflow');
      append(area,'style',{changes,note:String(note)}); return snapshot(area);
    },
    note({area,text}={}) {
      requireAct(); if(typeof text!=='string'||!text.trim()) throw new Error('note needs text');
      return append(area,'note',{text});
    },
    select({area,query='',referenceIds,limit=4}={}) {
      if (!Number.isInteger(limit) || limit < 0 || limit > 20) throw new Error('selection limit must be an integer from 0 to 20');
      const state=snapshot(area); const words=tokens(`${query} ${state.title} ${state.description}`);
      let selected;
      if(referenceIds!==undefined) selected=strings(referenceIds,'referenceIds').map(id=>api.reference(area,id));
      else selected=state.references.filter(r=>r.status==='approved').map((r,index)=>{
        const text=`${r.title} ${r.tags.join(' ')} ${r.notes}`.toLowerCase();
        const score=words.reduce((n,w)=>n+(text.includes(w)?1:0),0);
        return {r,index,score};
      }).filter(({r,score})=>!['identity','subject'].includes(r.role)||score>0)
        .sort((a,b)=>b.score-a.score||b.index-a.index).slice(0,limit).map(x=>x.r);
      for(const r of selected){
        if(!r.exists) throw new Error(`reference ${r.id} is missing; restore it or archive it before generating`);
        if(inspectImage(r.file).sha256!==r.validation.sha256) throw new Error(`reference ${r.id} has changed on disk; re-import it before generating`);
      }
      return {name:state.name,title:state.title,description:state.description,revision:state.revision,style:state.style,
        selection:referenceIds===undefined?'approved references ranked by request terms, newest on ties':'explicit reference ids for this request',
        references:selected.map(({id,title,role,notes,tags,source,status,file,validation,feedback})=>({id,title,role,notes,tags,source,status,file,sha256:validation.sha256,feedback})),
        recentFeedback:state.recentFeedback,
      };
    },
    recordJob(job) {
      requireAct(); const area=job.request.area;
      if(!area) return null;
      api.ensureArea(area);
      let reference=null;
      if(job.status==='done' && job.file && job.kind!=='start') {
        const prior=snapshot(area).references.find(r=>r.job===job.id);
        if(prior) reference=prior;
        else {
          const stored=storeImage(area,job.file);
          const ref={id:`ref-${job.id}`,job:job.id,title:job.request.prompt||job.request.change,role:'example',notes:job.notes||'',tags:[],source:null,status:'candidate',...stored};
          append(area,'reference',ref,'studio',`reference:${job.id}`); reference=api.reference(area,ref.id);
        }
      }
      append(area,job.status==='done'?'generation':'failure',{
        job:job.id,kind:job.kind,request:job.request,reference:reference?.id||null,
        usedRevision:job.libraryContext?.revision||0,usedReferences:job.libraryContext?.references.map(r=>r.id)||[],
        workflow:job.workflow||null,prompt:job.prompt||null,review:job.review||null,notes:job.notes||null,error:job.error||null,
        referenceUse:job.referenceUse||[],observations:job.observations||[],
      },'studio',`result:${job.id}`);
      return {area,reference:reference?.id||null,revision:snapshot(area).revision};
    },
    sheet({area,out,status='approved'}={}) {
      requireAct();
      if(!['all',...STATES].includes(status)) throw new Error('unknown sheet status');
      const state=snapshot(area);
      const refs=state.references.filter(r=>status==='all'||r.status===status);
      const dir=out?path.resolve(cwd,out):path.join(folder(area),'sheets',`${state.revision}-${crypto.randomBytes(3).toString('hex')}`);
      fs.mkdirSync(dir,{recursive:true});
      const data={...state,references:refs};
      const manifest=path.join(dir,'style.json');
      fs.writeFileSync(manifest,JSON.stringify(data,null,2),{flag:'wx'});
      const helper=path.join(path.dirname(fileURLToPath(import.meta.url)),'reference_sheet.py');
      const result=spawnSync('python3',[helper,manifest],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
      if(result.error||result.status!==0) throw new Error(`reference sheet: ${result.error?.message||result.stderr||result.stdout}; manifest kept at ${manifest}`);
      return {...JSON.parse(result.stdout),area,revision:state.revision,manifest};
    },
  };
  return api;
}
