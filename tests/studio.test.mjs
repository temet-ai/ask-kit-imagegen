import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { conformImage, inspectImage, inspector, parseReply, reviewResult } from '../lib/studio.mjs';
import { inputSource } from '../lib/inputs.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagegen-tests-'));
const png = path.join(root, 'fixture.png');
const fixture = spawnSync('python3', ['-c', 'from PIL import Image; import sys; im=Image.new("RGBA",(32,24),(180,120,50,255)); im.putpixel((0,0),(0,0,0,0)); im.save(sys.argv[1])', png]);
assert.equal(fixture.status, 0);
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function environment(name, mode = 'ok') {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  const skill = path.join(dir, 'codex/skills/.system/imagegen');
  fs.mkdirSync(path.join(skill, 'references'), { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), 'Use built-in image_gen.');
  fs.writeFileSync(path.join(skill, 'references/prompting.md'), 'Preserve constraints.');
  const fake = path.join(dir, 'bin/codex');
  fs.writeFileSync(fake, `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
let input=''; for await(const c of process.stdin) input+=c;
fs.writeFileSync(path.join(process.env.TEST_DIR,'input.txt'),input);
fs.writeFileSync(path.join(process.env.TEST_DIR,'argv.json'),JSON.stringify(process.argv));
const job=JSON.parse(input.split('Job data:\\n\\n')[1]);
const mode=process.env.TEST_MODE;
console.log(JSON.stringify({type:'thread.started',thread_id:'test-thread'}));
if(mode==='hang') { fs.writeFileSync(path.join(process.env.TEST_DIR,'child.pid'),String(process.pid)); await new Promise(r=>setTimeout(r,60000)); }
if(job.kind==='start') {
  fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],JSON.stringify({ready:mode!=='startfail',read:['skill']}));
  process.exit(0);
}
const generated=path.join(process.env.CODEX_HOME,'generated_images/test-thread');
fs.mkdirSync(generated,{recursive:true});
if(mode!=='badpath' && mode!=='corrupt') fs.copyFileSync(process.env.FIXTURE,path.join(generated,'new.png'));
if(mode==='crashafterimage') process.exit(1);
if(mode==='missingreceipt') { console.log('lost receipt'); process.exit(0); }
if(mode==='corrupt') fs.writeFileSync(job.target,'not an image');
else if(mode!=='badpath') fs.copyFileSync(process.env.FIXTURE,job.target);
const reply={ready:true,read:['skill'],file:mode==='badpath'?process.env.FIXTURE:job.target,use_case:'product-mockup',prompt:job.request.prompt||job.request.change,attempts:1,checked:'The product is visible',notes:'',error:null,review:{status:'pass',checks:[{criterion:'subject',status:'pass',detail:'A product is visible'}]}};
fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],JSON.stringify(reply,null,2));
console.log(JSON.stringify({type:'turn.completed',usage:{}}));
`);
  fs.chmodSync(fake, 0o755);
  const env = { ...process.env, ASK_KIT_STATE: path.join(dir, 'ask-state'), XDG_STATE_HOME: path.join(dir, 'state'), CODEX_HOME: path.join(dir, 'codex'), PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, FIXTURE: png, TEST_MODE: mode, TEST_DIR: dir };
  return { dir, env };
}

function jobFiles(e, kind = 'make', request = { prompt: 'A product' }) {
  const jobs = path.join(e.env.XDG_STATE_HOME, 'ask-kit-imagegen/jobs');
  fs.mkdirSync(jobs, { recursive: true });
  const id = `img-${path.basename(e.dir)}`;
  const jobFile = path.join(jobs, `${id}.json`);
  const job = { id, studio: 'test', kind, request, attach: [], status: 'queued', queuedAt: new Date().toISOString(), dir: path.join(e.dir, 'images'), target: kind === 'start' ? null : path.join(e.dir, 'images/final.png'), out: path.join(e.dir, 'delivered.png'), callerCwd: e.dir };
  fs.writeFileSync(jobFile, JSON.stringify(job));
  return { job, jobFile };
}

async function run(e, kind, request) {
  const { jobFile } = jobFiles(e, kind, request);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['runner.mjs', jobFile], { env: e.env, stdio: 'pipe' });
    let err = '';
    child.stderr.on('data', d => err += d);
    child.on('error', reject);
    child.on('close', () => err ? reject(new Error(err)) : resolve());
  });
  return JSON.parse(fs.readFileSync(jobFile));
}

test('a detached runner journals the final size failure without a polling ask', async () => {
  const e = environment('journal-size');
  e.env.ASK_KIT_STATE = path.join(e.dir, 'ask-state');
  e.env.ASK_KIT_CALLER = 'vimes-session';
  const j = await run(e, 'make', { prompt: 'The Watch badge', size: '16:9' });
  assert.equal(j.status, 'done');
  const file = path.join(e.env.ASK_KIT_STATE, 'imagegen/outcomes.jsonl');
  const r = JSON.parse(fs.readFileSync(file, 'utf8').trim());
  assert.equal(r.jobId, j.id); assert.equal(r.session, 'vimes-session');
  assert.equal(r.ok, true); assert.equal(r.review.status, 'needs_review');
  assert.ok(r.review.warnings.some(w => /aspect ratio/.test(w)));
});

test('decodes image and measures actual alpha and size', () => {
  const result = inspectImage(png);
  assert.equal(result.width, 32); assert.equal(result.height, 24);
  assert.equal(result.hasTransparency, true); assert.equal(result.fullyTransparent, false);
  const bad = path.join(root, 'truncated.png');
  fs.writeFileSync(bad, fs.readFileSync(png).subarray(0, 40));
  assert.throws(() => inspectImage(bad));
});

test('publishes exclusive versions and encodes requested format', () => {
  const destination = path.join(root, 'output.png');
  const first = inspectImage(png, destination);
  const second = inspectImage(png, destination);
  assert.equal(first.file, destination); assert.match(second.file, /output-v2\.png$/);
  assert.equal(inspectImage(destination).sha256, inspectImage(png).sha256);
  const webp = inspectImage(png, path.join(root, 'output.webp'));
  assert.equal(webp.validation.format, 'WEBP'); assert.equal(webp.validation.hasTransparency, true);
  assert.throws(() => inspectImage(png, path.join(root, 'output.jpg')), /cannot preserve transparency/);
});

test('transparent-image inspection preview leaves the delivery source unchanged', () => {
  const before = inspectImage(png);
  const destination = path.join(root, 'review.png');
  const r = spawnSync('python3', [inspector, png, '--preview', destination], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
  const result = inspectImage(destination);
  assert.equal(result.hasTransparency, false); assert.equal(result.width, before.width * 2);
  assert.equal(inspectImage(png).sha256, before.sha256);
});

test('parses multiline and fenced receipts', () => {
  assert.deepEqual(parseReply('```json\n{\n"file":"/tmp/a.png"\n}\n```'), { file: '/tmp/a.png' });
  assert.equal(parseReply('not json'), null);
});

test('machine measurements override a claimed visual pass', () => {
  const reply = { checked: 'looked', review: { status: 'pass', checks: [{ criterion: 'subject', status: 'pass', detail: 'visible' }] } };
  const result = reviewResult(reply, inspectImage(png), { size: '1024x1024', transparent: false });
  assert.equal(result.status, 'needs_review'); assert.equal(result.warnings.length, 2);
  assert.equal(reviewResult(null, inspectImage(png), {}).status, 'unverified');
  assert.equal(reviewResult({ checked: 'looked', review: { status: 'pass', checks: [] } }, inspectImage(png), {}).status, 'unverified');
});

test('completes a valid new job with machine and visual evidence', async () => {
  const e = environment('success');
  const j = await run(e);
  assert.equal(j.status, 'done'); assert.equal(j.review.status, 'pass');
  assert.equal(j.validation.width, 32); assert.ok(fs.existsSync(j.copiedTo));
  assert.equal(j.deliveryValidation.sha256, inspectImage(j.copiedTo).sha256);
  const history = JSON.parse(fs.readFileSync(path.join(e.env.XDG_STATE_HOME, 'ask-kit-imagegen/history.jsonl'), 'utf8').trim());
  assert.equal(history.deliveryValidation.sha256, j.deliveryValidation.sha256);
  assert.equal(fs.existsSync(path.join(e.env.XDG_STATE_HOME, 'ask-kit-imagegen/locks/test')), false);
  assert.ok(JSON.parse(fs.readFileSync(path.join(e.dir, 'argv.json'))).includes('--output-schema'));
});

test('resumed studios receive current guidance, style and request references', async () => {
  const e = environment('resume');
  const studios = path.join(e.env.XDG_STATE_HOME, 'ask-kit-imagegen/studios');
  fs.mkdirSync(studios, { recursive: true });
  fs.writeFileSync(path.join(studios, 'test.json'), JSON.stringify({ name: 'test', thread: 'test-thread', style: 'cocoa brown', folder: path.join(e.dir, 'images'), guidanceRevision: 'old' }));
  const j = await run(e, 'edit', { change: 'Make it taller', context: 'Compact layout' });
  assert.equal(j.status, 'done');
  const input = fs.readFileSync(path.join(e.dir, 'input.txt'), 'utf8');
  assert.ok(input.includes('new or changed')); assert.ok(input.includes('cocoa brown')); assert.ok(input.includes('Compact layout'));
  assert.ok(JSON.parse(fs.readFileSync(path.join(e.dir, 'argv.json'))).includes('resume'));
});

for (const mode of ['badpath', 'corrupt']) {
  test(`rejects ${mode} instead of returning an arbitrary file`, async () => {
    const j = await run(environment(mode, mode));
    assert.equal(j.status, 'failed'); assert.match(j.error, /no valid image/);
  });
}
for (const mode of ['missingreceipt', 'crashafterimage']) {
  test(`recovers ${mode} output with an explicit review warning`, async () => {
    const j = await run(environment(mode, mode));
    assert.equal(j.status, 'done'); assert.equal(j.review.status, 'needs_review');
    assert.ok(j.review.warnings.some(w => w.includes('Recovered')));
  });
}

test('does not declare a studio ready without confirmation', async () => {
  const j = await run(environment('startfail', 'startfail'), 'start', {});
  assert.equal(j.status, 'failed'); assert.match(j.error, /readiness/);
});

test('delivery error retains the valid original and reports a next action', async () => {
  const e = environment('delivery');
  fs.mkdirSync(path.join(e.dir, 'delivered.png'));
  const { jobFile } = jobFiles(e);
  const raw = JSON.parse(fs.readFileSync(jobFile));
  raw.out = path.join(e.dir, 'output.jpg'); fs.writeFileSync(jobFile, JSON.stringify(raw));
  await new Promise(resolve => spawn(process.execPath, ['runner.mjs', jobFile], { env: e.env, stdio: 'ignore' }).on('close', resolve));
  const j = JSON.parse(fs.readFileSync(jobFile));
  assert.equal(j.status, 'done'); assert.equal(j.copiedTo, null);
  assert.ok(fs.existsSync(j.file)); assert.match(j.deliveryError, /PNG or WebP/);
  assert.equal(j.review.status, 'needs_review');
});

test('queue freezes role-labelled references before the source changes', async () => {
  const e = environment('snapshot');
  const source = path.join(e.dir, 'source.png'); fs.copyFileSync(png, source);
  const code = `import fs from 'node:fs'; import {make} from './imagegen.mjs';
    const api=make({settings:{IMAGES_DIR:process.env.TEST_DIR+'/images'},cwd:process.env.TEST_DIR,act:true});
    const j=api.edit({image:'source.png',change:'Change the lighting',refs:[{image:'source.png',role:'style reference'}],transparent:true});
    fs.writeFileSync(process.env.TEST_DIR+'/source.png','changed'); console.log(JSON.stringify(j));`;
  const queued = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: e.env, encoding: 'utf8' });
  assert.equal(queued.status, 0, queued.stderr);
  const j = JSON.parse(queued.stdout);
  const jobFile = path.join(e.env.XDG_STATE_HOME, 'ask-kit-imagegen/jobs', j.id + '.json');
  for (let i = 0; i < 100; i++) {
    const stored = JSON.parse(fs.readFileSync(jobFile));
    if (['done', 'failed'].includes(stored.status)) break;
    await new Promise(r => setTimeout(r, 50));
  }
  const stored = JSON.parse(fs.readFileSync(jobFile));
  assert.equal(stored.status, 'done');
  assert.equal(stored.attach[1].role, 'style reference');
  assert.equal(inspectImage(stored.attach[0].file).sha256, inspectImage(png).sha256);
});

test('a missing latest image never silently selects an older image', () => {
  const e = environment('missinglatest');
  const state = path.join(e.env.XDG_STATE_HOME, 'ask-kit-imagegen');
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'history.jsonl'), [
    { id: 'img-old', studio: 'default', file: png },
    { id: 'img-new', studio: 'default', file: path.join(e.dir, 'deleted.png') },
  ].map(v => JSON.stringify(v)).join('\n') + '\n');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import {make} from './imagegen.mjs'; make({act:true}).edit({change:'Make it blue'});`], { env: e.env, encoding: 'utf8' });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /latest image \(img-new\) is missing/);
});

test('cancelling a running worker stops Codex and releases the studio lock', async () => {
  const e = environment('cancellation', 'hang');
  const { jobFile } = jobFiles(e);
  const child = spawn(process.execPath, ['runner.mjs', jobFile], { env: e.env, stdio: 'ignore' });
  const finished = new Promise(resolve => child.on('close', resolve));
  for (let i = 0; i < 100 && !fs.existsSync(path.join(e.dir, 'child.pid')); i++) await new Promise(r => setTimeout(r, 30));
  assert.ok(fs.existsSync(path.join(e.dir, 'child.pid')));
  const codexPid = Number(fs.readFileSync(path.join(e.dir, 'child.pid')));
  child.kill('SIGTERM');
  await finished;
  const j = JSON.parse(fs.readFileSync(jobFile));
  assert.equal(j.status, 'failed'); assert.equal(j.error, 'cancelled');
  assert.equal(fs.existsSync(path.join(e.env.XDG_STATE_HOME, 'ask-kit-imagegen/locks/test')), false);
  assert.throws(() => process.kill(codexPid, 0), /ESRCH/);
});

function sized(name, w, h) {
  const f = path.join(root, name);
  const r = spawnSync('python3', ['-c', 'from PIL import Image; import sys; Image.new("RGB",(int(sys.argv[2]),int(sys.argv[3])),(90,60,30)).save(sys.argv[1])', f, String(w), String(h)]);
  assert.equal(r.status, 0);
  return f;
}

test('conform crops a near-16:9 image to an exact 16:9 box', () => {
  const c = conformImage(sized('near169.png', 1672, 941), '16:9');
  assert.equal(c.conformed, true);
  assert.deepEqual([c.validation.width, c.validation.height], [1664, 936]);
});

test('conform crops then resizes to exact pixels', () => {
  const c = conformImage(sized('near-square.png', 1254, 1250), '1024x1024');
  assert.equal(c.conformed, true);
  assert.deepEqual([c.validation.width, c.validation.height], [1024, 1024]);
});

test('conform leaves a clearly wrong shape alone', () => {
  const f = sized('landscape.png', 1600, 900);
  const c = conformImage(f, 'square');
  assert.equal(c.conformed, false);
  assert.deepEqual([inspectImage(f).width, inspectImage(f).height], [1600, 900]);
});

test('once the size is exact, the studio size checks no longer hold the review back', () => {
  const reply = { checked: 'looked', review: { status: 'needs_review', checks: [
    { criterion: 'Subject', status: 'pass', detail: 'tug and jellyfish present' },
    { criterion: 'Exact 16:9 aspect ratio', status: 'fail', detail: '1672x941 is not exact' },
  ] } };
  const v = { width: 1664, height: 936, hasTransparency: false, fullyTransparent: false };
  const r = reviewResult(reply, v, { size: '16:9' }, []);
  assert.equal(r.status, 'pass');
  assert.equal(r.checks.length, 1);
});

test('content failures still need review after size checks are dropped', () => {
  const reply = { checked: 'looked', review: { status: 'needs_review', checks: [
    { criterion: 'Tendrils longer than ship', status: 'fail', detail: 'shorter than the ship' },
    { criterion: 'Aspect ratio', status: 'fail', detail: 'not exact' },
  ] } };
  const r = reviewResult(reply, { width: 1664, height: 936 }, { size: '16:9' }, []);
  assert.equal(r.status, 'needs_review');
  assert.deepEqual(r.checks.map(c => c.criterion), ['Tendrils longer than ship']);
});

test('a size that is still wrong keeps the studio size check and a warning', () => {
  const reply = { checked: 'looked', review: { status: 'needs_review', checks: [
    { criterion: 'Aspect ratio', status: 'fail', detail: 'portrait' },
  ] } };
  const r = reviewResult(reply, { width: 900, height: 1600 }, { size: '16:9' }, []);
  assert.equal(r.status, 'needs_review');
  assert.equal(r.checks.length, 1);
  assert.ok(r.warnings.some(w => /aspect ratio/.test(w)));
});

function busyStudio(e) {
  const state = path.join(e.env.XDG_STATE_HOME, 'ask-kit-imagegen');
  fs.mkdirSync(path.join(state, 'studios'), { recursive: true });
  fs.writeFileSync(path.join(state, 'studios/test.json'), JSON.stringify({ name: 'test', thread: 'test-thread', folder: path.join(e.dir, 'images') }));
  const lock = path.join(state, 'locks/thread-test-thread');
  fs.mkdirSync(lock, { recursive: true });
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, job: 'img-other' }));
  return { state, lock };
}

test('a busy studio forks its thread instead of queueing', async () => {
  const e = environment('fork');
  busyStudio(e);
  const j = await run(e, 'make', { prompt: 'A second frame' });
  assert.equal(j.status, 'done');
  assert.equal(j.route, 'fork');
  const argv = JSON.parse(fs.readFileSync(path.join(e.dir, 'argv.json')));
  assert.ok(argv.includes('fork') && argv.includes('test-thread'));
});

test('an edit on an older fork reloads guidance even when the main thread is current', async () => {
  const e = environment('fork-guidance');
  const first = await run(e);
  const state = path.join(e.env.XDG_STATE_HOME, 'ask-kit-imagegen');
  fs.writeFileSync(path.join(state, 'jobs/img-original.json'), JSON.stringify({ thread:'older-fork' }));
  fs.appendFileSync(path.join(state, 'history.jsonl'), JSON.stringify({ thread:'older-fork', guidanceRevision:'old' }) + '\n');
  const j = await run(e, 'edit', { image:'img-original', change:'Keep this design' });
  assert.equal(j.status, 'done');
  assert.equal(j.baseThread, 'older-fork');
  assert.equal(j.guidanceRevision, first.guidanceRevision);
  assert.ok(fs.readFileSync(path.join(e.dir, 'input.txt'), 'utf8').includes('new or changed'));
});

test('a studio at its parallel limit queues on the thread instead of forking', async () => {
  const e = environment('cap');
  const { state, lock } = busyStudio(e);
  fs.mkdirSync(path.join(state, 'jobs'), { recursive: true });
  for (let i = 0; i < 4; i++) fs.writeFileSync(path.join(state, `jobs/img-run${i}.json`), JSON.stringify({ id: `img-run${i}`, studio: 'test', status: 'running', runnerPid: process.pid }));
  setTimeout(() => {
    fs.rmSync(lock, { recursive: true, force: true });
    fs.rmSync(path.join(state, 'jobs/img-run0.json'));
  }, 1500);
  const j = await run(e, 'make', { prompt: 'A fifth frame' });
  assert.equal(j.status, 'done');
  assert.equal(j.route, 'resume');
  assert.ok(JSON.parse(fs.readFileSync(path.join(e.dir, 'argv.json'))).includes('resume'));
});

test('a free edit thread still waits when all studio slots are occupied', async () => {
  const e = environment('cap-free-thread');
  const { state, lock } = busyStudio(e);
  fs.rmSync(lock, { recursive: true });
  const { jobFile } = jobFiles(e);
  for (let i = 0; i < 4; i++) fs.writeFileSync(path.join(state, `jobs/img-run${i}.json`), JSON.stringify({ id: `img-run${i}`, studio: 'test', status: 'running', runnerPid: process.pid }));
  const child = spawn(process.execPath, ['runner.mjs', jobFile], { env: e.env, stdio: 'ignore' });
  const finished = new Promise(resolve => child.on('close', resolve));
  try {
    for (let i = 0; i < 100; i++) {
      const j = JSON.parse(fs.readFileSync(jobFile));
      if (j.waitingFor || j.status !== 'queued') break;
      await new Promise(r => setTimeout(r, 20));
    }
    assert.equal(JSON.parse(fs.readFileSync(jobFile)).status, 'queued');
    assert.equal(fs.existsSync(path.join(e.dir, 'argv.json')), false);
    fs.rmSync(path.join(state, 'jobs/img-run0.json'));
    await finished;
    assert.equal(JSON.parse(fs.readFileSync(jobFile)).status, 'done');
  } finally { child.kill('SIGTERM'); await finished; }
});

test('simultaneous submissions reserve at most four studio slots', async () => {
  const e = environment('burst', 'hang');
  const { state, lock } = busyStudio(e);
  fs.rmSync(lock, { recursive: true });
  const { job: template } = jobFiles(e);
  fs.rmSync(path.join(state, 'jobs', `${template.id}.json`));
  const children = [], files = [], finished = [];
  try {
    for (let i = 0; i < 8; i++) {
      const file = path.join(state, `jobs/img-burst-${i}.json`);
      fs.writeFileSync(file, JSON.stringify({ ...template, id: `img-burst-${i}`, target: path.join(e.dir, `images/${i}.png`) }));
      const child = spawn(process.execPath, ['runner.mjs', file], { env: e.env, stdio: 'ignore' });
      children.push(child); files.push(file); finished.push(new Promise(resolve => child.on('close', resolve)));
    }
    let jobs;
    for (let i = 0; i < 250; i++) {
      jobs = files.map(file => JSON.parse(fs.readFileSync(file)));
      assert.ok(jobs.filter(j => j.status === 'running').length <= 4);
      if (jobs.every(j => j.status === 'running' || j.waitingFor)) break;
      await new Promise(r => setTimeout(r, 20));
    }
    assert.equal(jobs.filter(j => j.status === 'running').length, 4);
    assert.equal(jobs.filter(j => j.status === 'queued').length, 4);
  } finally {
    for (const child of children) child.kill('SIGTERM');
    await Promise.all(finished);
  }
});

test('last freezes the source thread as well as the input image before queueing', async () => {
  const e = environment('last-thread');
  const { state, lock } = busyStudio(e);
  const jobs = path.join(state, 'jobs'); fs.mkdirSync(jobs, { recursive: true });
  for (let i = 0; i < 4; i++) fs.writeFileSync(path.join(jobs, `img-run${i}.json`), JSON.stringify({ id: `img-run${i}`, studio: 'test', status: 'running', runnerPid: process.pid }));
  fs.writeFileSync(path.join(state, 'history.jsonl'), JSON.stringify({ id: 'img-old', studio: 'test', file: png, thread: 'original-thread' }) + '\n');
  const queued = spawnSync(process.execPath, ['--input-type=module', '-e', `import {make} from './imagegen.mjs'; console.log(JSON.stringify(make({act:true}).edit({studio:'test',image:'last',change:'Keep the original design'})));`], { env: e.env, encoding: 'utf8' });
  assert.equal(queued.status, 0, queued.stderr);
  const id = JSON.parse(queued.stdout).id;
  const file = path.join(jobs, `${id}.json`);
  const submitted = JSON.parse(fs.readFileSync(file));
  assert.equal(submitted.sourceThread, 'original-thread');
  fs.appendFileSync(path.join(state, 'history.jsonl'), JSON.stringify({ id: 'img-new', studio: 'test', file: png, thread: 'unrelated-thread' }) + '\n');
  fs.rmSync(lock, { recursive: true });
  fs.rmSync(path.join(jobs, 'img-run0.json'));
  for (let i = 0; i < 200; i++) {
    if (['done', 'failed'].includes(JSON.parse(fs.readFileSync(file)).status)) break;
    await new Promise(r => setTimeout(r, 30));
  }
  const done = JSON.parse(fs.readFileSync(file));
  assert.equal(done.status, 'done');
  assert.equal(done.baseThread, 'original-thread');
  assert.equal(done.thread, 'original-thread');
  assert.ok(JSON.parse(fs.readFileSync(path.join(e.dir, 'argv.json'))).includes('original-thread'));
  const read = spawnSync(process.execPath, ['--input-type=module', '-e', `import {make} from './imagegen.mjs'; console.log(JSON.stringify(make().job(${JSON.stringify(id)})));`], { env: e.env, encoding: 'utf8' });
  assert.equal(read.status, 0, read.stderr);
  assert.equal(JSON.parse(read.stdout).baseThread, 'original-thread');
  assert.equal(JSON.parse(read.stdout).route, 'resume');
});

test('studio busy checks include active jobs older than the recent-job page', () => {
  const e = environment('older-busy');
  const { state } = busyStudio(e);
  const jobs = path.join(state, 'jobs'); fs.mkdirSync(jobs, { recursive: true });
  fs.writeFileSync(path.join(jobs, 'img-active.json'), JSON.stringify({ id:'img-active', studio:'test', status:'running', runnerPid:process.pid, queuedAt:'2026-01-01T00:00:00Z' }));
  for (let i = 0; i < 50; i++) fs.writeFileSync(path.join(jobs, `img-done-${i}.json`), JSON.stringify({ id:`img-done-${i}`, studio:'test', status:'done', queuedAt:'2026-01-02T00:00:00Z' }));
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import assert from 'node:assert/strict'; import {make} from './imagegen.mjs'; const api=make({act:true}); assert.deepEqual(api.studios()[0].busyWith,['img-active']); assert.throws(()=>api.reset({studio:'test'}),/busy with img-active/);`], { env:e.env, encoding:'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('source reviews follow image bytes, including a separately encoded delivery', () => {
  const exported = inspectImage(png, path.join(root, 'watch.webp'));
  const record = { id:'img-watch', file:png, copiedTo:exported.file, thread:'watch-thread', validation:inspectImage(png), deliveryValidation:exported.validation,
    review:{status:'needs_review',checks:[{criterion:'Badge',status:'pass',detail:'Visible'},{criterion:'Lettering',status:'fail',detail:'Watch is misspelled'}],warnings:[]} };
  assert.equal(inputSource(exported.file, record, {requireHash:true}).thread, 'watch-thread');
  assert.deepEqual(inputSource(png, record).sourceReview.checks.map(c=>c.criterion), ['Lettering']);
  assert.equal(inputSource(png, {...record,validation:{sha256:'old'}}).sourceJob, undefined);
  assert.equal(inputSource(png, {id:'img-old',thread:'old-thread'}, {requireHash:true}).thread, null);
  assert.equal(inputSource(png, {id:'img-old',thread:'old-thread'}).thread, 'old-thread');
});

for (const via of ['path', 'last', 'job', 'library', 'automatic']) {
  test(`${via} inputs carry source review into the worker and edits resume the source thread`, async () => {
    const e = environment(`watch-${via}`);
    const {state,lock} = busyStudio(e); fs.rmSync(lock, {recursive:true});
    const source = path.join(e.dir, 'watch.png'); fs.copyFileSync(png, source);
    const original = {id:'img-watch-master',studio:'test',status:'done',kind:'make',thread:'watch-master-thread',file:source,queuedAt:new Date().toISOString(),
      request:{prompt:'The Watch badge',area:'test'},validation:inspectImage(source),review:{status:'needs_review',checks:[{criterion:'Lettering',status:'fail',detail:'Watch is misspelled'}],warnings:[]}};
    fs.mkdirSync(path.join(state,'jobs'), {recursive:true});
    fs.writeFileSync(path.join(state,'jobs',`${original.id}.json`),JSON.stringify(original));
    fs.writeFileSync(path.join(state,'history.jsonl'),JSON.stringify(original)+'\n');
    const queued=spawnSync(process.execPath,['--input-type=module','-e',`
      import fs from 'node:fs'; import {make} from './imagegen.mjs';
      const api=make({settings:{IMAGES_DIR:process.env.TEST_DIR+'/images'},cwd:process.env.TEST_DIR,act:true});
      const via=${JSON.stringify(via)};
      const original=JSON.parse(fs.readFileSync(${JSON.stringify(path.join(state,'jobs',`${original.id}.json`))}));
      const result=api.library.recordJob(original);
      if(via==='automatic') api.library.feedback({area:'test',reference:result.reference,verdict:'approved',role:'palette',note:'Use only these colours'});
      const image=({path:'watch.png',last:'last',job:original.id,library:result.reference})[via];
      const j=via==='automatic'?api.make({studio:'test',prompt:'The Watch at night'}):api.edit({studio:'test',image,change:'Correct the lettering',refs:[{image:'watch.png',role:'identity'}]});
      original.review.checks[0].detail='Changed after submission';
      fs.writeFileSync(${JSON.stringify(path.join(state,'jobs',`${original.id}.json`))},JSON.stringify(original));
      console.log(JSON.stringify(j));
    `],{env:e.env,encoding:'utf8'});
    assert.equal(queued.status,0,queued.stderr);
    const j=JSON.parse(queued.stdout);
    assert.equal(j.inputs[0].sourceJob,original.id);
    const file=path.join(state,'jobs',`${j.id}.json`);
    for(let i=0;i<200;i++) {
      if(['done','failed'].includes(JSON.parse(fs.readFileSync(file)).status)) break;
      await new Promise(r=>setTimeout(r,30));
    }
    const done=JSON.parse(fs.readFileSync(file));
    assert.equal(done.status,'done',done.error);
    if(via!=='automatic') assert.equal(done.baseThread,original.thread);
    const contract=JSON.parse(fs.readFileSync(path.join(e.dir,'input.txt'),'utf8').split('Job data:\n\n')[1]);
    assert.equal(contract.inputs[0].sourceReview.checks[0].detail,'Watch is misspelled');
    assert.equal(contract.inputs[0].sourceReview.status,'needs_review');
    if(via!=='automatic') assert.equal(contract.inputs[1].sourceJob,original.id);
    else assert.match(contract.inputs[0].role,/palette/);
    assert.equal(done.review.status,'pass'); // Source warnings are context, not a verdict on the new image.
    assert.equal(done.deliveryValidation,null);
  });
}

test('an overwritten output path cannot inherit the former image thread or review', async () => {
  const e=environment('watch-overwritten');
  const {state,lock}=busyStudio(e); fs.rmSync(lock,{recursive:true});
  const source=path.join(e.dir,'watch.png'); fs.copyFileSync(png,source);
  fs.writeFileSync(path.join(state,'history.jsonl'),JSON.stringify({id:'img-watch',file:source,thread:'wrong-thread',validation:{sha256:'old-bytes'},review:{status:'needs_review'}})+'\n');
  const queued=spawnSync(process.execPath,['--input-type=module','-e',`import {make} from './imagegen.mjs'; console.log(JSON.stringify(make({cwd:process.env.TEST_DIR,act:true}).edit({studio:'test',image:'watch.png',change:'Change the lighting'})));`],{env:e.env,encoding:'utf8'});
  assert.equal(queued.status,0,queued.stderr);
  const j=JSON.parse(queued.stdout), file=path.join(state,'jobs',j.id+'.json');
  assert.equal(j.inputs[0].sourceJob,undefined);
  for(let i=0;i<200;i++) {if(['done','failed'].includes(JSON.parse(fs.readFileSync(file)).status))break;await new Promise(r=>setTimeout(r,30));}
  const done=JSON.parse(fs.readFileSync(file));
  assert.equal(done.status,'done'); assert.equal(done.baseThread,'test-thread');
});

test('queued area references reach the worker with a pinned workflow and journalled output', async () => {
  const e = environment('library-context');
  const code = `import fs from 'node:fs'; import {make} from './imagegen.mjs';
    const api=make({settings:{IMAGES_DIR:process.env.TEST_DIR+'/images'},cwd:process.env.TEST_DIR,act:true});
    api.library.createArea({name:'botanical'});
    const ref=api.library.addReference({area:'botanical',image:process.env.FIXTURE,role:'palette',notes:'Warm paper only',status:'approved'});
    api.library.setStyle({area:'botanical',keep:['fine ink'],workflow:'cover'});
    const j=api.make({prompt:'A fern cover',area:'botanical',studio:'plants',maxAttempts:1});
    api.library.feedback({area:'botanical',reference:ref.id,verdict:'rejected',note:'Future jobs should avoid this'});
    const done=await api.wait(j.id,15);
    const beforeReset=api.library.area('botanical'); api.reset({studio:'plants'});
    console.log(JSON.stringify({done,ref,beforeReset,afterReset:api.library.area('botanical'),journal:api.library.journal({area:'botanical'})}));`;
  const result = await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',code],{env:e.env,stdio:'pipe'});
    let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
    child.on('error',reject);child.on('close',code=>code?reject(new Error(err)):resolve(JSON.parse(out)));
  });
  assert.equal(result.done.status,'done');assert.equal(result.done.libraryError,undefined);
  assert.equal(result.done.library.revision,2);assert.equal(result.done.workflow.id,'cover');
  assert.ok(result.done.workflow.commit);assert.ok(result.done.libraryResult.reference);
  const contract=JSON.parse(fs.readFileSync(path.join(e.dir,'input.txt'),'utf8').split('Job data:\n\n')[1]);
  assert.equal(contract.areaLibrary.references[0].id,result.ref.id);
  assert.equal(contract.areaLibrary.references[0].status,'approved');
  assert.equal(contract.areaLibrary.references[0].role,'palette');
  assert.deepEqual(contract.areaLibrary.style.keep,['fine ink']);
  assert.equal(contract.workflow.id,'cover');
  assert.ok(fs.existsSync(contract.areaLibrary.references[0].file));
  const argv=JSON.parse(fs.readFileSync(path.join(e.dir,'argv.json')));
  assert.ok(argv.includes(contract.areaLibrary.references[0].file));
  assert.deepEqual(result.afterReset,result.beforeReset);
  const output=result.afterReset.references.find(r=>r.job===result.done.id);assert.equal(output.status,'candidate');
  const event=result.journal.find(e=>e.type==='generation');
  assert.equal(event.data.usedRevision,2);assert.deepEqual(event.data.usedReferences,[result.ref.id]);
});
