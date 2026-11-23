// Runs one imagegen job, detached from whoever queued it: node runner.mjs <job.json>.
// Reserves studio capacity, resumes or forks a thread under per-thread locks, finds the image,
// copies it where asked and records it in the history and reference library.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { alive, codexHome, paths, readJson, writeJson } from "./imagegen.mjs";

import { conformImage, inspectImage, parseReply, requestText, responseSchema, reviewResult } from "./lib/studio.mjs";
import { createLibrary } from "./lib/library.mjs";
import { recordOutcome } from "./lib/outcomes.mjs";
const TURN_LIMIT_MS = 15 * 60_000;
const QUEUE_LIMIT_MS = 45 * 60_000;
const jobFile = process.argv[2];
let job = readJson(jobFile);
if (!job) process.exit(2);
const save = (patch) => { job = { ...readJson(jobFile), ...patch }; writeJson(jobFile, job); };
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let child = null;
let cancelling = false;
const locks = new Set();
const releaseLock = (dir) => {
  for (const held of dir ? [dir] : locks) {
    const o = readJson(path.join(held, "owner.json"));
    if (o?.pid === process.pid) fs.rmSync(held, { recursive: true, force: true });
    locks.delete(held);
  }
};
function journalResult(result) {
  if (!job.libraryRoot || !job.request.area || job.kind === "start") return {};
  try { return {libraryResult:createLibrary({root:job.libraryRoot,act:true}).recordJob({...job,...result})}; }
  catch (e) { return {libraryError:`The image job is preserved, but its library journal needs repair: ${e.message}`}; }
}
const journalOutcome = () => { const result = recordOutcome(job); if (result.error) save({ outcomeJournalError: result.error }); };
const fail = (error) => { const result={status:"failed",error,finishedAt:now()}; save({...result,...journalResult(result)}); journalOutcome(); releaseLock(); process.exit(1); };
function stopChild(signal = "SIGTERM") {
  try { if (child?.pid) process.kill(-child.pid, signal); } catch {}
}
process.on("SIGTERM", () => {
  cancelling = true;
  if (!child) fail("cancelled");
  stopChild();
  setTimeout(() => stopChild("SIGKILL"), 5000).unref();
});

const PARALLEL = 4; // jobs running at once in one studio; more queue

/** Take a lock directory. wait=false tries once. Returns true when taken. */
async function takeLock(dir, { wait = true, what = "the studio" } = {}) {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const until = Date.now() + QUEUE_LIMIT_MS;
  for (;;) {
    try {
      fs.mkdirSync(dir);
      writeJson(path.join(dir, "owner.json"), { pid: process.pid, job: job.id, since: now() });
      locks.add(dir);
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const o = readJson(path.join(dir, "owner.json"));
      // A lock with no owner file is being written right now, unless it is old.
      let age;
      try { age = Date.now() - fs.statSync(dir).mtimeMs; } catch (e) { if (e.code === "ENOENT") continue; throw e; }
      if ((o && !alive(o.pid)) || (!o && age > 10_000)) { fs.rmSync(dir, { recursive: true, force: true }); continue; }
      if (!wait) return false;
      if (o?.job && job.waitingFor !== o.job) save({ waitingFor: o.job });
      if (Date.now() > until) fail(`waited ${QUEUE_LIMIT_MS / 60_000} minutes for ${what}, busy with ${o?.job ?? "another job"}`);
      await sleep(2000);
    }
  }
}

/** Jobs of this studio running now (their runner alive), other than this one. */
function runningInStudio() {
  const dir = path.dirname(paths.job(job.id));
  const running = [];
  for (const f of fs.readdirSync(dir)) {
    if (!/^img-[^.]+\.json$/.test(f) || f === `${job.id}.json`) continue;
    const j = readJson(path.join(dir, f));
    if (j?.studio === job.studio && j.status === "running" && alive(j.runnerPid)) running.push(j.id);
  }
  return running;
}

/** The thread an edit continues: the one that made the image it names, when known. */
function threadOf(image) {
  if (!image) return null;
  if (/^img-[a-z0-9-]+$/.test(image)) return readJson(paths.job(image))?.thread ?? null;
  if (image === "last" || image === "latest") {
    try {
      const rows = fs.readFileSync(paths.history(), "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } });
      // Compatibility with jobs queued before sourceThread was recorded: match the frozen input.
      const source = job.attach[0]?.source;
      return rows.filter((h) => h?.studio === job.studio && h.thread && source && (h.file === source || h.copiedTo === source)).at(-1)?.thread ?? null;
    } catch { return null; }
  }
  return null;
}

function guidanceInThread(thread, studio) {
  if (thread === studio.thread) return studio.guidanceRevision;
  try {
    const rows = fs.readFileSync(paths.history(), "utf8").split("\n").map((line) => { try { return JSON.parse(line); } catch { return null; } });
    return rows.filter((row) => row?.thread === thread).at(-1)?.guidanceRevision;
  } catch { return undefined; }
}

/**
 * Pick the thread to run on. A new studio makes its first thread once (under the studio lock).
 * Otherwise the job continues its base thread (the studio's, or for an edit the thread that made
 * the image) when that thread is free, and forks it when busy, so several jobs run at once and
 * each still has the studio's style, references and guidance in context.
 */
async function chooseThread(studio) {
  const admission = paths.lock(job.studio);
  const until = Date.now() + QUEUE_LIMIT_MS;
  for (;;) {
    // Reserve capacity while holding the studio lock, before another runner can count jobs.
    await takeLock(admission, { what: `studio ${job.studio}` });
    const fresh = readJson(paths.studio(job.studio));
    if (fresh) Object.assign(studio, fresh);
    const running = runningInStudio();
    if (running.length < PARALLEL) {
      if (!studio.thread) {
        save({ status: "running" });
        return { mode: "new" }; // Keep admission locked until the first thread is saved.
      }
      const base = (job.kind === "edit" && (job.sourceThread ?? threadOf(job.request.image))) || studio.thread;
      const resume = await takeLock(paths.lock(`thread-${base}`), { wait: false });
      save({ status: "running" });
      releaseLock(admission);
      return { mode: resume ? "resume" : "fork", base };
    }
    save({ waitingFor: running[0] });
    releaseLock(admission);
    if (Date.now() > until) fail(`waited ${QUEUE_LIMIT_MS / 60_000} minutes for capacity in studio ${job.studio}`);
    await sleep(2000);
  }
}

function runCodex(args, input, cwd) {
  return new Promise((resolve) => {
    const events = fs.openSync(paths.events(job.id), "a");
    let err = "";
    child = spawn("codex", args, { cwd, detached: true, stdio: ["pipe", events, "pipe"], env: process.env });
    child.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    child.stdin.on("error", (e) => { err += `\n${e.message}`; });
    let forceTimer;
    const timer = setTimeout(() => {
      err += `\nstopped after ${TURN_LIMIT_MS / 60_000} minutes`;
      stopChild();
      forceTimer = setTimeout(() => stopChild("SIGKILL"), 5000);
    }, TURN_LIMIT_MS);
    child.on("error", (e) => { err += `\n${e.message}`; });
    child.on("close", (code) => {
      clearTimeout(timer); clearTimeout(forceTimer); fs.closeSync(events); child = null;
      resolve({ code: code ?? -1, err });
    });
    child.stdin.end(input);
  });
}

function readEvents() {
  try { return fs.readFileSync(paths.events(job.id), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}

/** Newest image Codex saved for this thread since the turn started. */
function newestGenerated(thread, sinceMs) {
  const dir = path.join(codexHome(), "generated_images", thread);
  try {
    return fs.readdirSync(dir).map((f) => path.join(dir, f)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && fs.statSync(f).isFile() && fs.statSync(f).mtimeMs >= sinceMs)
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null;
  } catch { return null; }
}

try {
  inspectImage();
  for (const a of job.attach) inspectImage(a.file);
  save({ runnerPid: process.pid });

  const studioFile = paths.studio(job.studio);
  let studio = readJson(studioFile) ?? { name: job.studio, createdAt: now(), thread: null, style: null, folder: job.dir };
  if (job.kind === "start" && job.request.style) studio.style = job.request.style;
  const route = await chooseThread(studio);
  const started = Date.now();
  save({ status: "running", startedAt: now(), waitingFor: null, route: route.mode, baseThread: route.base ?? null });
  const isNew = route.mode === "new";
  const images = job.attach.flatMap((a) => ["-i", a.file]);
  const common = ["--output-schema", responseSchema, "--json", "--skip-git-repo-check", "-c", 'sandbox_mode="workspace-write"', ...images, "-o", paths.last(job.id)];
  const args = isNew ? ["exec", "-C", job.dir, ...common, "-"]
    : route.mode === "fork" ? ["exec", "fork", ...common, route.base, "-"]
    : ["exec", "resume", ...common, route.base, "-"];
  const guidance = requestText(job, { ...studio, guidanceRevision: guidanceInThread(route.base, studio) });
  save({ guidanceRevision: guidance.revision });
  const r = await runCodex(args, guidance.text, job.dir);
  if (cancelling) fail("cancelled");

  const events = readEvents();
  const started_ = events.find((e) => e.type === "thread.started")?.thread_id ?? null;
  const thread = route.mode === "resume" ? route.base : started_;
  save({ thread });
  if (isNew && thread) { studio = { ...readJson(studioFile) ?? studio, thread }; writeJson(studioFile, studio); }
  const usage = events.findLast?.((e) => e.type === "turn.completed")?.usage ?? null;
  let last = "";
  try { last = fs.readFileSync(paths.last(job.id), "utf8"); } catch {}
  if (!last) last = events.filter((e) => e.item?.type === "agent_message").at(-1)?.item?.text ?? "";
  const reply = parseReply(last);
  // The studio's main thread stays its own; a fork's thread is kept on the job and in the history.
  if (thread && thread === (readJson(studioFile)?.thread ?? studio.thread)) { studio = { ...readJson(studioFile) ?? studio, guidanceRevision: guidance.revision }; writeJson(studioFile, studio); }

  if (job.kind === "start") {
    if (r.code !== 0 || !thread || reply?.ready !== true || !Array.isArray(reply.read) || !reply.read.length) fail(`studio did not confirm readiness: ${reply?.error || last.trim().slice(0, 300) || r.err}`);
    save({ status: "done", finishedAt: now(), thread, usage, notes: reply?.ready ? `studio ready; read ${(reply.read ?? []).join(", ")}` : last.trim().slice(0, 500) });
    releaseLock();
    process.exit(0);
  }

  // Only accept this job's fresh target, or a fresh generated file from this exact thread.
  // An arbitrary path in a model response is not evidence of successful generation.
  const warnings = [];
  if (reply?.error) warnings.push(`The studio reported an error: ${reply.error}`);
  let file = null, validation = null;
  const candidate = typeof reply?.file === "string" && path.resolve(job.dir, reply.file);
  const freshTarget = candidate === job.target && fs.existsSync(candidate) &&
    fs.lstatSync(candidate).isFile() && fs.statSync(candidate).mtimeMs >= started;
  if (freshTarget) {
    try {
      validation = inspectImage(candidate); file = candidate;
      if (validation.format !== "PNG") {
        const published = inspectImage(candidate, job.target);
        file = published.file; validation = published.validation;
      }
    }
    catch (e) { file = null; validation = null; warnings.push(`The selected file failed validation: ${e.message}`); }
  }
  if (!file && thread) {
    const generated = newestGenerated(thread, started);
    if (generated) {
      try {
        const published = inspectImage(generated, job.target);
        file = published.file; validation = published.validation;
        warnings.push("Recovered a generated image without a confirmed selection; inspect it before use.");
      } catch (e) { warnings.push(e.message); }
    }
  }
  if (!file) fail(`no valid image came back (codex exit ${r.code}). ${warnings.join(" ")} Codex said: ${last.trim().slice(0, 400) || r.err.trim().slice(-600) || "(nothing)"}`);
  if (r.code !== 0) warnings.push(`Codex exited ${r.code}; the saved image was recovered, but the turn did not finish normally.`);
  if (!reply?.prompt || !Number.isInteger(reply?.attempts) || reply.attempts < 1 || reply.attempts > (job.request.maxAttempts ?? 2)) warnings.push("The generation receipt is incomplete or exceeds the attempt limit.");
  // Fix the shape: image_gen picks its own pixel size (1672x941 for 16:9), and an edit can come
  // back a pixel off its input. Within 3% the runner crops and resizes; further off stays a miss.
  const editTarget = job.kind === "edit" ? job.attach.find((a) => a.role === "edit target") : null;
  let shape = String(job.request.size ?? "").trim();
  if (!shape && editTarget) {
    try { const t = inspectImage(editTarget.file); shape = `${t.width}x${t.height}`; } catch {}
  }
  if (shape) {
    try {
      const c = conformImage(file, shape);
      validation = { ...c.validation, conformed: { conformed: c.conformed, ...(c.conformed ? { original: c.original, cropped: c.cropped, resizedTo: c.resizedTo, upscaled: c.upscaled } : { reason: c.reason }) } };
    } catch (e) { warnings.push(`Could not fix the image's shape: ${e.message}`); }
  }
  let copiedTo = null, deliveryError = null;
  if (job.out && path.resolve(job.out) !== file) {
    try { copiedTo = inspectImage(file, job.out).file; }
    catch (e) {
      deliveryError = `Image kept at ${file}; could not publish to ${job.out}: ${e.message}`;
      warnings.push(deliveryError);
    }
  }
  const review = reviewResult(reply, validation, { ...job.request, size: shape || job.request.size }, warnings);
  const done = {
    status: "done", finishedAt: now(), thread, file, copiedTo, usage, validation, review, deliveryError,
    prompt: reply?.prompt ?? null, useCase: reply?.use_case ?? null, attempts: reply?.attempts ?? null,
    checked: reply?.checked ?? null, notes: reply?.notes ?? (reply ? null : "the studio did not send its JSON line; the image is the newest one it generated"),
    referenceUse:Array.isArray(reply?.reference_use)?reply.reference_use:[], observations:Array.isArray(reply?.style_observations)?reply.style_observations:[],
  };
  save({...done,...journalResult(done)});
  fs.appendFileSync(paths.history(), JSON.stringify({
    id: job.id, studio: job.studio, kind: job.kind, at: done.finishedAt, file, copiedTo,
    request: job.request, prompt: done.prompt, useCase: done.useCase, notes: done.notes, thread,
    validation, review, checked: done.checked, attempts: done.attempts, guidanceRevision: guidance.revision,
    area:job.request.area, libraryResult:job.libraryResult, workflow:job.workflow,
    seconds: Math.round((Date.now() - started) / 1000),
  }) + "\n");
  journalOutcome();
  releaseLock();

} catch (e) { fail(e.message); }
