import { spawnSync } from 'node:child_process';
import { inspectImage, installedSkill } from '../lib/studio.mjs';

export const meta = {
  purpose: 'Check Codex login, image_generation, structured output support, installed imagegen skill and Pillow without generating an image.',
  params: {}, returns: '{ok, checks, note}; no quota spent',
  example: 'await scripts.run("doctor")',
};

export default function () {
  const checks = [];
  const run = (name, args, accept) => {
    const r = spawnSync('codex', args, { encoding: 'utf8', timeout: 15_000 });
    const text = `${r.stdout || ''}\n${r.stderr || ''}`.trim();
    // Login output can describe auth mode. Never return environment variables or credentials.
    checks.push({ name, ok: !r.error && r.status === 0 && accept(text), detail: r.error?.message || text.slice(0, 400) });
    return text;
  };
  run('codex', ['--version'], s => /codex/i.test(s));
  run('login', ['login', 'status'], s => /logged in using chatgpt/i.test(s));
  const features = spawnSync('codex', ['features', 'list'], { encoding: 'utf8', timeout: 15_000 });
  const imageFeature = (features.stdout || '').split('\n').find(s => /^image_generation\s/.test(s)) || '';
  checks.push({ name: 'image_generation', ok: features.status === 0 && /\btrue\s*$/.test(imageFeature), detail: imageFeature || 'image_generation was not found; update Codex or enable the feature' });
  for (const args of [['exec', '--help'], ['exec', 'resume', '--help']]) {
    const r = spawnSync('codex', args, { encoding: 'utf8', timeout: 15_000 });
    checks.push({ name: args.slice(0, -1).join(' ') + ' schema', ok: r.status === 0 && r.stdout.includes('--output-schema'), detail: 'Requires --output-schema for new and resumed studios' });
  }
  for (const [name, fn] of [['imagegen skill', installedSkill], ['Pillow', () => inspectImage()]]) {
    try { checks.push({ name, ok: true, detail: fn() }); }
    catch (e) { checks.push({ name, ok: false, detail: e.message }); }
  }
  return { ok: checks.every(c => c.ok), checks, note: 'Local readiness only; tool availability and remaining image quota are established by a real generation.' };
}
