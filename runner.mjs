// Runs one imagegen job, detached from whoever queued it: node runner.mjs <job.json>.
// Takes the studio's lock (queueing behind other jobs), sends the request to the studio's Codex
// thread as one turn (a new thread for a new studio), finds the image, copies it where asked and
// records it in the history.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { alive, codexHome, freeName, paths, readJson, writeJson } from "./imagegen.mjs";

const KIT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TURN_LIMIT_MS = 15 * 60_000;
const QUEUE_LIMIT_MS = 45 * 60_000;
const jobFile = process.argv[2];
let job = readJson(jobFile);
if (!job) process.exit(2);
const save = (patch) => { job = { ...readJson(jobFile), ...patch }; writeJson(jobFile, job); };
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let child = null;
let lockDir = null;
const releaseLock = () => {
  if (!lockDir) return;
  const o = readJson(path.join(lockDir, "owner.json"));
  if (o?.pid === process.pid) fs.rmSync(lockDir, { recursive: true, force: true });
  lockDir = null;
};
const fail = (error) => { save({ status: "failed", error, finishedAt: now() }); releaseLock(); process.exit(1); };
process.on("SIGTERM", () => { try { child?.kill("SIGTERM"); } catch {} fail("cancelled"); });

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
      const age = Date.now() - fs.statSync(dir).mtimeMs;
      if ((o && !alive(o.pid)) || (!o && age > 10_000)) { fs.rmSync(dir, { recursive: true, force: true }); continue; }
      if (o?.job && job.waitingFor !== o.job) save({ waitingFor: o.job });
      if (Date.now() > until) fail(`waited ${QUEUE_LIMIT_MS / 60_000} minutes for studio ${job.studio}, busy with ${o?.job ?? "another job"}`);
      await sleep(2000);
    }
  }
}

function requestText(studio, isNew) {
  const r = job.request;
  const lines = [];
  if (isNew) {
    lines.push(fs.readFileSync(path.join(KIT_DIR, "studio-brief.md"), "utf8").trim(), "");
    if (studio.style) lines.push(`House style for this studio: ${studio.style}`, "");
  }
  if (job.kind === "start") {
    lines.push("This first message only opens the studio. Read the skill files now, make no image, and reply with one line of JSON:", '{"ready": true, "read": ["<files you read>"]}');
    return lines.join("\n");
  }
  lines.push(`Request ${job.id} (${job.kind === "edit" ? "edit an image" : "new image"})`);
  if (job.kind === "edit") lines.push(`Change: ${r.change}`, "Keep everything else in the edit target unchanged.");
  else {
    lines.push(`What: ${r.prompt}`);
    if (r.use) lines.push(`Where it will be used: ${r.use}`);
    if (r.size) lines.push(`Size or shape: ${r.size}`);
    if (r.avoid) lines.push(`Avoid: ${r.avoid}`);
  }
  job.attach.forEach((a, i) => lines.push(`Attached image ${i + 1}: ${a.role} (${path.basename(a.file)})`));
  lines.push(`Save the final image to: ${job.target}`, "End with the one line of JSON the studio brief describes.");
  return lines.join("\n");
}

function runCodex(args, input, cwd) {
  return new Promise((resolve) => {
    const events = fs.openSync(paths.events(job.id), "a");
    let err = "";
    child = spawn("codex", args, { cwd, stdio: ["pipe", events, "pipe"], env: process.env });
    child.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    const timer = setTimeout(() => { err += `\nstopped after ${TURN_LIMIT_MS / 60_000} minutes`; child.kill("SIGTERM"); }, TURN_LIMIT_MS);
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, err: e.message }); });
    child.on("close", (code) => { clearTimeout(timer); fs.closeSync(events); child = null; resolve({ code, err }); });
    child.stdin.end(input);
  });
}

function readEvents() {
  try { return fs.readFileSync(paths.events(job.id), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}

function lastJson(text) {
  const lines = String(text ?? "").trim().split("\n").reverse();
  for (const l of lines) {
    const m = l.trim().replace(/^```(json)?|```$/g, "").trim();
    if (m.startsWith("{")) { try { return JSON.parse(m); } catch {} }
  }
  return null;
}

/** Newest image Codex saved for this thread since the turn started. */
function newestGenerated(thread, sinceMs) {
  const dir = path.join(codexHome(), "generated_images", thread);
  try {
    return fs.readdirSync(dir).map((f) => path.join(dir, f)).filter((f) => fs.statSync(f).mtimeMs >= sinceMs - 1000)
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null;
  } catch { return null; }
}

await takeLock();
const started = Date.now();
save({ status: "running", startedAt: now(), waitingFor: null, runnerPid: process.pid });

const studioFile = paths.studio(job.studio);
let studio = readJson(studioFile) ?? { name: job.studio, createdAt: now(), thread: null, style: null, folder: job.dir };
if (job.kind === "start" && job.request.style) studio.style = job.request.style;
const isNew = !studio.thread;
const images = job.attach.flatMap((a) => ["-i", a.file]);
const common = ["--json", "--skip-git-repo-check", "-c", 'sandbox_mode="workspace-write"', ...images, "-o", paths.last(job.id)];
const args = isNew ? ["exec", "-C", job.dir, ...common, "-"] : ["exec", "resume", ...common, studio.thread, "-"];
const r = await runCodex(args, requestText(studio, isNew), job.dir);

const events = readEvents();
const thread = studio.thread ?? events.find((e) => e.type === "thread.started")?.thread_id ?? null;
if (isNew && thread) { studio = { ...studio, thread }; writeJson(studioFile, studio); }
const usage = events.findLast?.((e) => e.type === "turn.completed")?.usage ?? null;
let last = "";
try { last = fs.readFileSync(paths.last(job.id), "utf8"); } catch {}
if (!last) last = events.filter((e) => e.item?.type === "agent_message").at(-1)?.item?.text ?? "";
const reply = lastJson(last);

if (r.code !== 0 && !reply) fail(`codex exited ${r.code}: ${r.err.trim().split("\n").slice(-5).join(" | ") || "no output"}`);
if (job.kind === "start") {
  save({ status: "done", finishedAt: now(), thread, usage, notes: reply?.ready ? `studio ready; read ${(reply.read ?? []).join(", ")}` : last.trim().slice(0, 500) });
  releaseLock();
  process.exit(0);
}
if (reply?.error) fail(`the studio could not make it: ${reply.error}`);

// The image: where Codex copied it, else the newest one it generated in this turn.
let file = reply?.file && fs.existsSync(reply.file) ? path.resolve(reply.file) : null;
if (!file && thread) {
  const g = newestGenerated(thread, started);
  if (g) { file = freeName(job.target); fs.copyFileSync(g, file); }
}
if (!file) fail(`no image came back. Codex said: ${last.trim().slice(0, 400) || "(nothing)"}`);

let copiedTo = null;
if (job.out && path.resolve(job.out) !== file) {
  copiedTo = freeName(job.out);
  fs.mkdirSync(path.dirname(copiedTo), { recursive: true });
  fs.copyFileSync(file, copiedTo);
}
const done = {
  status: "done", finishedAt: now(), thread, file, copiedTo, usage,
  prompt: reply?.prompt ?? null, useCase: reply?.use_case ?? null, attempts: reply?.attempts ?? null,
  checked: reply?.checked ?? null, notes: reply?.notes ?? (reply ? null : "the studio did not send its JSON line; the image is the newest one it generated"),
};
save(done);
fs.appendFileSync(paths.history(), JSON.stringify({
  id: job.id, studio: job.studio, kind: job.kind, at: done.finishedAt, file, copiedTo,
  request: job.request, prompt: done.prompt, useCase: done.useCase, notes: done.notes, thread,
  seconds: Math.round((Date.now() - started) / 1000),
}) + "\n");
releaseLock();
