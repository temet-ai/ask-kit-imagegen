import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectWorkflow } from './workflows.mjs';

export const kitDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const inspector = path.join(kitDir, 'lib/inspect_image.py');
export const responseSchema = path.join(kitDir, 'studio-response.schema.json');

export function inspectImage(file, destination) {
  const args = [inspector, ...(file ? [file] : ['--check']), ...(destination ? ['--publish', destination] : [])];
  const r = spawnSync('python3', args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
  let result;
  try { result = JSON.parse(r.stdout); } catch {}
  if (r.error || r.status !== 0 || !result || result.error) {
    throw new Error(`image check: ${result?.error || r.error?.message || r.stderr?.trim() || 'invalid inspector response'}. Requires python3 and Pillow.`);
  }
  return result;
}

/** Crop/resize the file in place to `spec` (WxH, W:H, square) when it is within 3% of it. */
export function conformImage(file, spec) {
  const r = spawnSync('python3', [inspector, file, '--conform', String(spec)], { encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024 });
  let result;
  try { result = JSON.parse(r.stdout); } catch {}
  if (r.error || r.status !== 0 || !result || result.error) throw new Error(`conform: ${result?.error || r.error?.message || r.stderr?.trim() || 'no response'}`);
  return result;
}

// A studio check about pixel size or aspect ratio. The runner measures and fixes those itself.
const SIZE_CHECK = /\b(aspect|dimensions?|canvas|resolution|pixel size|image size|\d+\s*:\s*\d+|\d+\s*[x\u00d7]\s*\d+)\b/i;

export function installedSkill() {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const candidates = [path.join(home, 'skills/.system/imagegen/SKILL.md'), path.join(home, 'skills/imagegen/SKILL.md')];
  const file = candidates.find(f => fs.existsSync(f));
  if (!file) throw new Error('Codex imagegen skill was not found. Update Codex or install its official imagegen skill, then run the doctor script.');
  return file;
}

// Pass caller instructions explicitly: the studio's cwd is its image folder, not the project.
export function callerInstructions(cwd) {
  const dirs = [];
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    dirs.unshift(dir);
    if (path.dirname(dir) === dir) break;
  }
  const codex = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return [...new Set([codex, ...dirs].flatMap(dir => {
    const override = path.join(dir, 'AGENTS.override.md');
    const normal = path.join(dir, 'AGENTS.md');
    return fs.existsSync(override) ? [override] : fs.existsSync(normal) ? [normal] : [];
  }))];
}

export function requestText(job, studio) {
  const skill = installedSkill();
  const localSkill = path.join(kitDir, 'skills/imagegen-studio/SKILL.md');
  const resources = [skill, path.join(path.dirname(skill), 'references/prompting.md'),
    localSkill, ...['asset-checks.md', 'review.md'].map(f => path.join(path.dirname(localSkill), 'references', f)),
    path.join(kitDir, 'studio-brief.md'), responseSchema];
  const revision = crypto.createHash('sha256');
  for (const f of resources) revision.update(fs.readFileSync(f));
  const workflow = job.workflow || selectWorkflow(job.request, job.libraryContext);
  if (workflow.entry) {
    const current = selectWorkflow({...job.request, workflow:workflow.id});
    if (current.digest !== workflow.digest) throw new Error('the selected upstream workflow changed after this job was queued; submit a new job to use the new version');
    revision.update(workflow.digest); revision.update(fs.readFileSync(workflow.adapter));
  }
  const digest = revision.digest('hex');
  const contract = {
    id: job.id, kind: job.kind, request: job.request, houseStyle: studio.style || null,
    maxAttempts: job.request.maxAttempts ?? 2, target: job.target,
    reviewPreview: job.target ? `${job.target}.review.png` : null,
    inputs: job.attach.map((a, i) => ({ index: i + 1, role: a.role, file: a.file, sourceJob: a.sourceJob, sourceReview: a.sourceReview })),
    callerInstructions: callerInstructions(job.callerCwd),
    areaLibrary: job.libraryContext || null, workflow,
  };
  return {
    revision: digest,
    text: [fs.readFileSync(path.join(kitDir, 'studio-brief.md'), 'utf8').trim(),
      `Studio skill: ${localSkill}`,
      `Installed imagegen skill: ${skill}`,
      `Prompting reference: ${resources[1]}`,
      ...(workflow.entry ? [`Art-direction adapter (read before upstream): ${workflow.adapter}`, `Selected upstream skill: ${workflow.entry} (commit ${workflow.commit}); read its applicable design references.`] : []),
      `Guidance revision: ${digest}${studio.guidanceRevision === digest ? '' : ' (new or changed: read the studio skill, its references, the installed skill and the prompting reference)'}`,
      `Image inspection helper: python3 ${JSON.stringify(inspector)} <image-path>`,
      `Response schema: ${responseSchema}`,
      job.kind === 'start' ? 'Read the guidance, return ready=true and read paths; no generation. Other fields may be empty/null, attempts=0, review.status=unverified.' : 'Generate this one image, inspect it, save to target and return the receipt.',
      'Job data:', JSON.stringify(contract, null, 2)].join('\n\n'),
  };
}

export function parseReply(text) {
  const clean = String(text || '').trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  try { const v = JSON.parse(clean); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch {}
  for (const line of clean.split('\n').reverse()) {
    try { const v = JSON.parse(line); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch {}
  }
  return null;
}

export function reviewResult(reply, validation, request, warnings = []) {
  const validCheck = c => c && typeof c.criterion === 'string' && c.criterion.trim() &&
    ['pass', 'fail', 'unverified'].includes(c.status) && typeof c.detail === 'string' && c.detail.trim();
  const size = String(request.size || '').trim();
  const exact = size.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  const ratio = size === 'square' ? [1, 1] : size.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/)?.slice(1).map(Number);
  const sizeOk = exact ? validation.width === Number(exact[1]) && validation.height === Number(exact[2])
    : ratio ? Math.abs(validation.width / validation.height - ratio[0] / ratio[1]) <= 0.002 : false;
  // The runner owns size: once its own measurement passes, the studio's size checks are moot.
  const given = Array.isArray(reply?.review?.checks) ? reply.review.checks : null;
  const rawChecks = given && sizeOk ? given.filter(c => !SIZE_CHECK.test(String(c?.criterion ?? ''))) : given;
  const dropped = given && rawChecks ? given.length - rawChecks.length : 0;
  const checks = Array.isArray(rawChecks) ? rawChecks.filter(validCheck) : [];
  const supplied = reply?.review;
  let status = supplied && ['pass', 'needs_review', 'unverified'].includes(supplied.status) &&
    checks.length && checks.length === rawChecks.length && typeof reply.checked === 'string' && reply.checked.trim() ? supplied.status : 'unverified';
  // A studio verdict of needs_review that rested only on a size check it no longer owns.
  if (dropped && status === 'needs_review' && checks.every(c => c.status === 'pass')) status = 'pass';
  if (checks.some(c => c.status !== 'pass')) status = 'needs_review';
  if (validation.fullyTransparent) warnings.push('The image is fully transparent.');
  if (exact && (validation.width !== Number(exact[1]) || validation.height !== Number(exact[2]))) {
    warnings.push(`Requested ${exact[1]}x${exact[2]}; received ${validation.width}x${validation.height}.`);
  } else if (ratio && Math.abs(validation.width / validation.height - ratio[0] / ratio[1]) > 0.002) {
    warnings.push(`Requested aspect ratio ${size}; received ${validation.width}x${validation.height}.`);
  }
  if (request.transparent === true && !validation.hasTransparency) warnings.push('Transparent output was requested, but all pixels are opaque.');
  if (request.transparent === false && validation.hasTransparency) warnings.push('Opaque output was requested, but the image contains transparent pixels.');
  if (warnings.length) status = 'needs_review';
  return { status, checks, warnings };
}
