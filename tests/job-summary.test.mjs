import test from 'node:test';
import assert from 'node:assert/strict';
import {jobSummary} from '../lib/job-summary.mjs';
import recent from '../scripts/recent.mjs';

test('long receipts keep defects under the host limit without changing the stored receipt',()=>{
  const job={id:'img-watch',status:'done',file:'/tmp/watch.png',prompt:'private '.repeat(3000),request:{prompt:'long '.repeat(2000)},
    checked:'x'.repeat(5000),notes:'n'.repeat(5000),review:{status:'needs_review',checks:[{criterion:'Subject',status:'pass',detail:'Vimes is present'},
      ...Array.from({length:20},(_,i)=>({criterion:`Badge ${i}`,status:'fail',detail:'Watch is misspelled. '.repeat(100)}))],warnings:Array(8).fill('Warning '.repeat(100))}};
  const before=structuredClone(job), result=jobSummary(job);
  assert.ok(JSON.stringify(result,null,2).length<=3600);
  assert.equal(result.file,job.file); assert.equal(result.review.status,'needs_review');
  assert.match(result.review.checks[0].detail,/Watch is misspelled/);
  assert.equal(result.review.counts.pass,1); assert.equal(result.review.counts.fail,20);
  assert.equal(result.review.checks.length+result.review.omittedChecks,20);
  assert.equal(result.review.warnings.length+result.review.omittedWarnings,8);
  assert.equal(result.prompt,undefined); assert.equal(result.request,undefined); assert.deepEqual(job,before);
});
test('recent id gives the review by default and full=true preserves the complete receipt',async()=>{
  const job={id:'img-vimes',at:'2026-01-01T00:00:00Z',prompt:'The Watch',review:{status:'pass',checks:[{criterion:'Subject',status:'pass',detail:'Vimes is present'}]}};
  const imagegen={history:()=>[job]};
  const summary=await recent({imagegen},{id:job.id});
  assert.equal(summary.status,'done');
  assert.equal(summary.review.status,'pass'); assert.equal(summary.review.counts.pass,1);
  assert.equal(summary.prompt,undefined);
  assert.strictEqual(await recent({imagegen},{id:job.id,full:'true'}),job);
});
test('queued jobs and failures retain actionable status without claiming a visual pass',()=>{
  const queued=jobSummary({id:'img-queued',status:'queued',waitingFor:'img-watch',secondsSoFar:8});
  assert.equal(queued.waitingFor,'img-watch'); assert.equal(queued.review,undefined);
  const failed=jobSummary({id:'img-failed',status:'failed',error:'Login required',file:'/tmp/recovered.png'});
  assert.equal(failed.error,'Login required'); assert.equal(failed.file,'/tmp/recovered.png');
  assert.equal(jobSummary({id:'img-old',status:'done'}).review.status,'unverified');
});
