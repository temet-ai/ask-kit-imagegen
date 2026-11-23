import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const definitions=[
  {id:'infographic',source:'baoyu',skill:'baoyu-infographic',about:'Infographics and visual summaries; content analysis and layout/style selection',pattern:/\b(infographic|visual summary)\b/i},
  {id:'cover',source:'baoyu',skill:'baoyu-cover-image',about:'Article/book covers and social cards',pattern:/\b(cover image|book cover|article cover|social card)\b/i},
  {id:'article',source:'baoyu',skill:'baoyu-article-illustrator',about:'Article and editorial illustrations',pattern:/\b(article illustration|editorial illustration|illustrat\w* (?:an? |the )?article)\b/i},
  {id:'mobile',source:'leon',skill:'imagegen-frontend-mobile',about:'Mobile app screens and UI concepts',pattern:/\b(mobile (?:app|screen|ui)|app screen|ios screen|android screen)\b/i},
  {id:'web',source:'leon',skill:'imagegen-frontend-web',about:'Website and landing-page design concepts',pattern:/\b(website mockup|web(?:site)? (?:design|concept|comp)|landing page (?:mockup|design|concept))\b/i},
  {id:'brand',source:'leon',skill:'brandkit',about:'Brand boards, identity guidelines and logo concepts',pattern:/\b(brand (?:kit|board|guidelines)|brandkit|logo(?: concept| design)?)\b/i},
];
const lock=()=>JSON.parse(fs.readFileSync(path.join(ROOT,'vendor/sources.lock.json'),'utf8'));
export function workflows(){
  const sources=lock().sources;
  return [{id:'general',about:'Installed Codex imagegen skill'},...definitions.map(({id,source,skill,about})=>{
    const s=sources.find(s=>s.id===source);
    return {id,about,skill,repository:`https://github.com/${s.repo}`,commit:s.commit,license:s.license};
  })];
}
export function validateWorkflow(id){
  if(id!==undefined && !['auto','general',...definitions.map(x=>x.id)].includes(id)) throw new Error(`unknown workflow ${id}; use auto or ${workflows().map(w=>w.id).join(', ')}`);
}
export function selectWorkflow(request, profile){
  let id=request.workflow;
  if(id===undefined||id==='auto') id=profile?.style?.workflow;
  if(!id||id==='auto') id=definitions.find(d=>d.pattern.test(`${request.use||''}\n${request.prompt||request.change||''}`))?.id||'general';
  validateWorkflow(id);
  if(id==='general') return {id};
  const d=definitions.find(d=>d.id===id), source=lock().sources.find(s=>s.id===d.source);
  const base=path.join(ROOT,'vendor',d.source), prefix=`skills/${d.skill}/`;
  const hash=crypto.createHash('sha256');
  for(const [relative,expected] of Object.entries(source.files).filter(([f])=>f.startsWith(prefix)||f==='LICENSE').sort(([a],[b])=>a.localeCompare(b))){
    const bytes=fs.readFileSync(path.join(base,relative));
    const actual=crypto.createHash('sha256').update(bytes).digest('hex');
    if(actual!==expected) throw new Error(`upstream skill changed: ${relative}; verify vendor sources before generating`);
    hash.update(relative);hash.update(actual);
  }
  return {id,skill:d.skill,repository:`https://github.com/${source.repo}`,commit:source.commit,
    entry:path.join(base,prefix,'SKILL.md'),adapter:path.join(ROOT,'workflows/adapter.md'),digest:hash.digest('hex')};
}
