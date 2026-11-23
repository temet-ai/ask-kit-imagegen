// Runs one imagegen job, detached from whoever queued it: node runner.mjs <job.json>.
// Takes the studio's lock (queueing behind other jobs), sends the request to the studio's Codex
// thread as one turn (a new thread for a new studio), finds the image, copies it where asked and
// records it in the history.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { alive, codexHome, paths, readJson, writeJson } from "./imagegen.mjs";

import { inspectImage, parseReply, requestText, responseSchema, reviewResult } from "./lib/studio.mjs";
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
let lockDir = null;
const releaseLock = () => {
  if (!lockDir) return;
  const o = readJson(path.join(lockDir, "owner.json"));
  if (o?.pid === process.pid) fs.rmSync(lockDir, { recursive: true, force: true });
  lockDir = null;
};
const fail = (error) => { save({ status: "failed", error, finishedAt: now() }); releaseLock(); process.exit(1); };
function stopChild(signal = "SIGTERM") {
  try { if (child?.pid) process.kill(-child.pid, signal); } catch {}
}
process.on("SIGTERM", () => {
  cancelling = true;
  if (!child) fail("cancelled");
  stopChild();
  setTimeout(() => stopChild("SIGKILL"), 5000).unref();
});

async function takeLock() {
  const dir = paths.lock(job.studio);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const until = Date.now() + QUEUE_LIMIT_MS;
  for (;;) {
    try {
      fs.mkdirSync(dir);
      writeJson(path.join(dir, "owner.json"), { pid: process.pid, job: job.id, since: now() });
      lockDir = dir;
      return;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const o = readJson(path.join(dir, "owner.json"));
      // A lock with no owner file is being written right now, unless it is old.
      let age;
      try { age = Date.now() - fs.statSync(dir).mtimeMs; } catch (e) { if (e.code === "ENOENT") continue; throw e; }
      if ((o && !alive(o.pid)) || (!o && age > 10_000)) { fs.rmSync(dir, { recursive: true, force: true }); continue; }
      if (o?.job && job.waitingFor !== o.job) save({ waitingFor: o.job });
      if (Date.now() > until) fail(`waited ${QUEUE_LIMIT_MS / 60_000} minutes for studio ${job.studio}, busy with ${o?.job ?? "another job"}`);
      await sleep(2000);
    }
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
  await takeLock();
  inspectImage();
  for (const a of job.attach) inspectImage(a.file);
  const started = Date.now();
  save({ status: "running", startedAt: now(), waitingFor: null, runnerPid: process.pid });

  const studioFile = paths.studio(job.studio);
  let studio = readJson(studioFile) ?? { name: job.studio, createdAt: now(), thread: null, style: null, folder: job.dir };
  if (job.kind === "start" && job.request.style) studio.style = job.request.style;
  const isNew = !studio.thread;
  const images = job.attach.flatMap((a) => ["-i", a.file]);
  const common = ["--output-schema", responseSchema, "--json", "--skip-git-repo-check", "-c", 'sandbox_mode="workspace-write"', ...images, "-o", paths.last(job.id)];
  const args = isNew ? ["exec", "-C", job.dir, ...common, "-"] : ["exec", "resume", ...common, studio.thread, "-"];
  const guidance = requestText(job, studio);
  save({ guidanceRevision: guidance.revision });
  const r = await runCodex(args, guidance.text, job.dir);
  if (cancelling) fail("cancelled");

  const events = readEvents();
  const thread = studio.thread ?? events.find((e) => e.type === "thread.started")?.thread_id ?? null;
  if (isNew && thread) { studio = { ...studio, thread }; writeJson(studioFile, studio); }
  const usage = events.findLast?.((e) => e.type === "turn.completed")?.usage ?? null;
  let last = "";
  try { last = fs.readFileSync(paths.last(job.id), "utf8"); } catch {}
  if (!last) last = events.filter((e) => e.item?.type === "agent_message").at(-1)?.item?.text ?? "";
  const reply = parseReply(last);
  if (thread) { studio = { ...studio, thread, guidanceRevision: guidance.revision }; writeJson(studioFile, studio); }

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
  let copiedTo = null, deliveryError = null;
  if (job.out && path.resolve(job.out) !== file) {
    try { copiedTo = inspectImage(file, job.out).file; }
    catch (e) {
      deliveryError = `Image kept at ${file}; could not publish to ${job.out}: ${e.message}`;
      warnings.push(deliveryError);
    }
  }
  const review = reviewResult(reply, validation, job.request, warnings);
  const done = {
    status: "done", finishedAt: now(), thread, file, copiedTo, usage, validation, review, deliveryError,
    prompt: reply?.prompt ?? null, useCase: reply?.use_case ?? null, attempts: reply?.attempts ?? null,
    checked: reply?.checked ?? null, notes: reply?.notes ?? (reply ? null : "the studio did not send its JSON line; the image is the newest one it generated"),
  };
  save(done);
  fs.appendFileSync(paths.history(), JSON.stringify({
    id: job.id, studio: job.studio, kind: job.kind, at: done.finishedAt, file, copiedTo,
    request: job.request, prompt: done.prompt, useCase: done.useCase, notes: done.notes, thread,
    validation, review, checked: done.checked, attempts: done.attempts, guidanceRevision: guidance.revision,
    seconds: Math.round((Date.now() - started) / 1000),
  }) + "\n");
  releaseLock();

} catch (e) { fail(e.message); }
