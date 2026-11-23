import test from 'node:test';
import assert from 'node:assert/strict';
import recent from '../scripts/recent.mjs';

const row = (id, review) => ({id,studio:'watch',at:'2026-01-01T10:00:00Z',file:'/tmp/watch.png',exists:true,request:{prompt:'The Watch badge'},review});
test('recent surfaces unresolved content, warnings and missing reviews without full prompts', async () => {
  const rows=[row('img-letters',{status:'needs_review',checks:[{criterion:'Lettering',status:'fail',detail:'Watch is misspelled'}]}),
    row('img-alpha',{status:'needs_review',checks:[],warnings:['All pixels are opaque']}),row('img-old'),row('img-pass',{status:'pass',checks:[]})];
  const result=await recent({imagegen:{jobs:()=>[],history:()=>rows}});
  assert.match(result.images[0],/needs_review\(1\).*Lettering: Watch is misspelled/);
  assert.match(result.images[1],/All pixels are opaque/);
  assert.match(result.images[2],/unverified.*No verified visual review/);
  assert.doesNotMatch(result.images[3],/\|/);
});
test('recent does not lose active work behind a page of completed jobs', async () => {
  const all=[...Array.from({length:55},(_,i)=>({id:`img-watch-${i}`,status:'done'})),{id:'img-vimes',studio:'watch',status:'running',request:{prompt:'Watch at night'}}];
  const result=await recent({imagegen:{jobs:({limit})=>all.slice(0,limit),history:()=>[]}});
  assert.equal(result.running.length,1); assert.match(result.running[0],/img-vimes/);
});
