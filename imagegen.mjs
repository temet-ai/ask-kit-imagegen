// Image making through a long-lived Codex thread (a "studio") that uses Codex's built-in image_gen
// tool and its imagegen skill. Every request is a job: a detached runner (runner.mjs) takes the
// studio's available slot, resumes or forks its Codex thread, waits for the image and
// copies it where the caller asked. A turn takes about a minute, longer than one REPL cell, so
// make() returns a job at once and wait() polls it in steps.
//
// Two checks. Making, editing, starting, resetting and cancelling need `act` (the caller asked for
// a change): they spend the Codex plan's image quota and write files. One turn at a time per
// thread: a job resumes its studio's thread when free and forks it when busy (up to 4 at once per
// studio), so two jobs never resume the same thread at once.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectImage } from "./lib/studio.mjs";
import { inputSource } from "./lib/inputs.mjs";
import { outcomeContext } from "./lib/outcomes.mjs";
import { createLibrary } from "./lib/library.mjs";
import { selectWorkflow, workflows } from "./lib/workflows.mjs";

const KIT_DIR = path.dirname(fileURLToPath(import.meta.url));
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const STUDIO_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
const WAIT_MAX_S = 55;

const home = (p) => String(p ?? "").replace(/^~(?=$|\/)/, os.homedir());
export const stateDir = () => path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local/state"), "ask-kit-imagegen");
export const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const p = {
  studio: (name) => path.join(stateDir(), "studios", `${name}.json`),
  job: (id) => path.join(stateDir(), "jobs", `${id}.json`),
  events: (id) => path.join(stateDir(), "jobs", `${id}.events.jsonl`),
  last: (id) => path.join(stateDir(), "jobs", `${id}.last.txt`),
  lock: (name) => path.join(stateDir(), "locks", name),
  history: () => path.join(stateDir(), "history.jsonl"),
};
export const paths = p;

export const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
export function writeJson(f, v) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, f);
}
export const alive = (pid) => { try { return !!pid && (process.kill(pid, 0), true); } catch (e) { return e.code === "EPERM"; } };

const notInThisAsk = (what) => () => {
  throw new Error(`not in this ask: ${what} spends the Codex image quota and writes files, and the caller did not ask for a change (act: true), so nothing was done. Answer what you can, and say that this needs \`ask\` with act: true. Do not look for another way to do it.`);
};
const checkStudio = (name = "default") => {
  if (!STUDIO_NAME.test(String(name))) throw new Error(`studio name "${name}": use lowercase letters, digits and dashes`);
  return String(name);
};
const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "image";

/** A file name that does not exist yet: hero.png, then hero-v2.png, hero-v3.png ... */
export function freeName(file) {
  if (!fs.existsSync(file)) return file;
  const ext = path.extname(file), base = file.slice(0, -ext.length || undefined);
  for (let n = 2; ; n++) if (!fs.existsSync(`${base}-v${n}${ext}`)) return `${base}-v${n}${ext}`;
}

function jobView(j) {
  if (!j) return null;
  const running = j.status === "running" || j.status === "queued";
  const stale = running && j.runnerPid && !alive(j.runnerPid);
  const status = stale ? "failed" : j.status;
  const out = { id: j.id, studio: j.studio, kind: j.kind, status, request: j.request, file: j.file ?? null, copiedTo: j.copiedTo ?? null };
  if (j.prompt) out.prompt = j.prompt;
  if (j.checked) out.checked = j.checked;
  if (j.notes) out.notes = j.notes;
  if (j.attempts) out.attempts = j.attempts;
  for (const key of ["review", "validation", "deliveryValidation", "deliveryError", "guidanceRevision", "workflow", "libraryResult", "libraryError", "referenceUse", "observations", "route", "thread", "baseThread", "outcomeJournalError"]) if (j[key]) out[key] = j[key];
  out.inputs = (j.attach || []).map(({ role, sourceJob, sourceReview }) => ({ role, sourceJob, sourceReview }));
  if (j.libraryContext) out.library = { area: j.libraryContext.name, revision: j.libraryContext.revision, referenceIds: j.libraryContext.references.map(r=>r.id) };
  if (status === "failed") out.error = stale ? "the runner stopped without finishing (killed, or the machine restarted)" : j.error;
  out.queuedAt = j.queuedAt;
  if (j.startedAt) out.startedAt = j.startedAt;
  if (j.finishedAt) out.finishedAt = j.finishedAt;
  const s = Math.round(((j.finishedAt ? Date.parse(j.finishedAt) : Date.now()) - Date.parse(j.startedAt ?? j.queuedAt)) / 1000);
  out[j.finishedAt ? "seconds" : "secondsSoFar"] = s;
  if (status === "queued") out.waitingFor = j.waitingFor ?? null;
  return out;
}

function historyRows() {
  try {
    return fs.readFileSync(p.history(), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

export function make({ settings = {}, cwd: hostCwd, act = false } = {}) {
  const cwd = path.resolve(home(settings.CALLER_DIR || hostCwd || process.cwd()));
  const imagesDir = path.resolve(home(settings.IMAGES_DIR || "~/Pictures/imagegen"));
  const studioDir = (name) => path.join(imagesDir, name);
  const library = createLibrary({ root: path.resolve(home(settings.LIBRARY_DIR || path.join(stateDir(), "library"))), cwd, act,
    resolveImage: (image, area) => resolveImage(image, "default", area) });

  /** An image the caller named: a path (relative to the caller's folder), a job id, or "last" (the studio's newest image). */
  function resolveImage(ref, studio, area = studio) {
    return resolveInput(ref, studio, area).file;
  }

  function resolveInput(ref, studio, area = studio) {
    const r = String(ref ?? "").trim();
    if (!r) throw new Error("no image named");
    if (/^ref-[a-z0-9-]+$/.test(r)) {
      const reference = library.reference(area, r);
      if (!reference.exists) throw new Error(`reference ${r} is missing`);
      return inputSource(reference.file, reference.job ? readJson(p.job(reference.job)) : null);
    }
    if (r === "last" || r === "latest") {
      const row = historyRows().reverse().find((h) => h.studio === studio && h.file);
      if (!row) throw new Error(`studio "${studio}" has made no image yet`);
      const file = row.copiedTo && fs.existsSync(row.copiedTo) ? row.copiedTo : row.file;
      if (!fs.existsSync(file)) throw new Error(`studio "${studio}" latest image (${row.id}) is missing; name an existing image path or job id`);
      return inputSource(file, row);
    }
    if (/^img-[a-z0-9-]+$/.test(r)) {
      const j = readJson(p.job(r));
      if (j?.status !== "done" || !j?.file) throw new Error(`job ${r} has no completed image (${j ? j.status : "no such job"})`);
      const file = j.copiedTo && fs.existsSync(j.copiedTo) ? j.copiedTo : j.file;
      if (!fs.existsSync(file)) throw new Error(`job ${r} image is missing; name an existing image path`);
      return inputSource(file, j);
    }
    const f = path.resolve(cwd, home(r));
    if (!fs.existsSync(f) || !fs.statSync(f).isFile()) throw new Error(`no image file at ${f}`);
    if (!IMAGE_EXT.test(f)) throw new Error(`${f} is not a png, jpeg, webp or gif`);
    const row = historyRows().reverse().find(h => h.file === f || h.copiedTo === f);
    return inputSource(f, row, { requireHash: true });
  }

  /** Where the caller wants the image: a file, or a folder (ends with / or exists as one). */
  function resolveOut(out, name) {
    if (!out) return null;
    let f = path.resolve(cwd, home(out));
    if (String(out).endsWith("/") || (fs.existsSync(f) && fs.statSync(f).isDirectory())) f = path.join(f, `${name}.png`);
    if (!IMAGE_EXT.test(f)) f += ".png";
    return f;
  }

  function queue(kind, studio, request, { attach = [], out = null, sourceThread = null } = {}) {
    studio = checkStudio(studio);
    if (request.maxAttempts !== undefined && ![1, 2].includes(request.maxAttempts)) throw new Error("maxAttempts must be 1 or 2");
    if (request.transparent !== undefined && typeof request.transparent !== "boolean") throw new Error("transparent must be true or false");
    // Validate before spending quota, and freeze inputs so queued jobs see the submitted image.
    inspectImage();
    for (const a of attach) inspectImage(a.file);
    let libraryContext = null;
    if (kind !== "start") {
      request.area = request.area || studio;
      library.ensureArea(request.area);
      libraryContext = library.select({area:request.area,query:[request.prompt,request.change,request.use,request.context].filter(Boolean).join(" "),referenceIds:request.referenceIds});
      attach.push(...libraryContext.references.map(r=>({...resolveInput(r.id,studio,request.area),role:`${r.role} reference from area ${request.area}`,referenceId:r.id})));
    }
    const workflow = selectWorkflow(request, libraryContext);
    const id = `img-${Date.now().toString(36)}-${crypto.randomBytes(2).toString("hex")}`;
    const name = `${id}-${slug(request.prompt ?? request.change ?? kind)}`;
    const dir = readJson(p.studio(studio))?.folder ?? studioDir(studio);
    fs.mkdirSync(dir, { recursive: true });
    attach = attach.map((a, i) => {
      const file = path.join(dir, ".inputs", id, `${i + 1}${path.extname(a.file).toLowerCase()}`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.copyFileSync(a.file, file, fs.constants.COPYFILE_EXCL);
      return { ...a, source: a.file, file };
    });
    if (libraryContext) libraryContext.references = libraryContext.references.map(r=>({...r,file:attach.find(a=>a.referenceId===r.id).file,attachment:attach.findIndex(a=>a.referenceId===r.id)+1}));
    const job = {
      id, studio, kind, request, attach, status: "queued", queuedAt: new Date().toISOString(),
      dir, target: kind === "start" ? null : path.join(dir, `${name}.png`), out: resolveOut(out, name),
      callerCwd: cwd, libraryRoot: library.root, libraryContext, workflow, sourceThread,
      outcomeJournal: outcomeContext(),
    };
    writeJson(p.job(id), job);
    const child = spawn(process.execPath, [path.join(KIT_DIR, "runner.mjs"), p.job(id)], { detached: true, stdio: "ignore", env: process.env });
    child.unref();
    job.runnerPid = child.pid;
    writeJson(p.job(id), { ...readJson(p.job(id)), runnerPid: child.pid });
    return jobView(job);
  }

  function references(refs, studio, area) {
    return [].concat(refs).filter(Boolean).map(ref => {
      if (typeof ref === "string") return { ...resolveInput(ref, studio, area), role: "reference" };
      if (!ref || typeof ref.image !== "string" || typeof ref.role !== "string" || !ref.role.trim()) {
        throw new Error('refs entries must be paths/job ids or {image, role}, such as {image: "brand.png", role: "style reference"}');
      }
      return { ...resolveInput(ref.image, studio, area), role: ref.role };
    });
  }

  const api = {
    imagesDir,
    act,
    library,
    workflows,

    studios() {
      let files = [];
      try { files = fs.readdirSync(path.join(stateDir(), "studios")).filter((f) => f.endsWith(".json")); } catch {}
      const rows = historyRows();
      return files.map((f) => {
        const s = readJson(path.join(stateDir(), "studios", f));
        if (!s) return null;
        const mine = rows.filter((h) => h.studio === s.name);
        const busy = api.jobs({ studio: s.name, limit: Infinity }).filter((j) => j.status === "running" || j.status === "queued").map((j) => j.id);
        return {
          name: s.name, thread: s.thread, createdAt: s.createdAt, style: s.style ?? null, folder: s.folder ?? studioDir(s.name),
          images: mine.length, lastImageAt: mine.at(-1)?.at ?? null,
          busyWith: busy.length ? busy : null,
          open: s.thread ? `codex resume ${s.thread}` : null,
        };
      }).filter(Boolean);
    },

    job(id) {
      const j = readJson(p.job(String(id)));
      if (!j) throw new Error(`no job ${id}`);
      return jobView(j);
    },

    async wait(id, seconds = 50) {
      const until = Date.now() + Math.min(Math.max(1, Number(seconds) || 50), WAIT_MAX_S) * 1000;
      for (;;) {
        const v = api.job(id);
        if (!["queued", "running"].includes(v.status) || Date.now() >= until) return v;
        await new Promise((r) => setTimeout(r, 2000));
      }
    },

    jobs({ studio, limit = 20 } = {}) {
      let files = [];
      try { files = fs.readdirSync(path.join(stateDir(), "jobs")).filter((f) => /^img-[^.]+\.json$/.test(f)); } catch {}
      return files.map((f) => jobView(readJson(path.join(stateDir(), "jobs", f)))).filter((j) => j && (!studio || j.studio === studio))
        .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt)).slice(0, limit);
    },

    history({ studio, search, limit = 20 } = {}) {
      const re = search ? new RegExp(String(search), "i") : null;
      return historyRows().filter((h) => (!studio || h.studio === studio) && (!re || re.test(`${h.request?.prompt ?? ""} ${h.request?.change ?? ""} ${h.prompt ?? ""}`)))
        .reverse().slice(0, limit)
        .map((h) => ({ ...h, exists: !!(h.file && fs.existsSync(h.file)) }));
    },

    make: act
      ? ({ prompt, out, refs = [], use, size, avoid, context, transparent, maxAttempts, area, referenceIds, workflow, studio = "default" } = {}) => {
          if (!String(prompt ?? "").trim()) throw new Error("make needs a prompt: what the image shows");
          const attach = references(refs, studio, area);
          return queue("make", studio, { prompt: String(prompt), use, size, avoid, context, transparent, maxAttempts, area, referenceIds, workflow }, { attach, out });
        }
      : notInThisAsk("making an image"),

    edit: act
      ? ({ image = "last", change, out, refs = [], use, size, avoid, context, transparent, maxAttempts, area, referenceIds, workflow, studio = "default" } = {}) => {
          if (!String(change ?? "").trim()) throw new Error("edit needs a change: what to change, and only that");
          const target = resolveInput(image, studio, area);
          const attach = [{ ...target, role: "edit target" }, ...references(refs, studio, area)];
          return queue("edit", studio, { change: String(change), image: String(image), use, size, avoid, context, transparent, maxAttempts, area, referenceIds, workflow }, { attach, out, sourceThread: target.thread });
        }
      : notInThisAsk("editing an image"),

    start: act
      ? ({ studio = "default", style } = {}) => {
          checkStudio(studio);
          const s = readJson(p.studio(studio));
          if (s?.thread) return { started: false, studio, thread: s.thread, open: `codex resume ${s.thread}`, note: "this studio already has a thread; reset it first for a new one" };
          return queue("start", studio, { style: style ? String(style) : null });
        }
      : notInThisAsk("starting a studio"),

    reset: act
      ? ({ studio = "default" } = {}) => {
          checkStudio(studio);
          const s = readJson(p.studio(studio));
          if (!s) return { reset: false, studio, note: "no such studio" };
          const busy = api.jobs({ studio, limit: Infinity }).filter((j) => j.status === "running" || j.status === "queued").map((j) => j.id);
          if (busy.length) throw new Error(`studio ${studio} is busy with ${busy.join(", ")}; wait for them or cancel them first`);
          writeJson(p.studio(studio), { ...s, thread: null, previousThreads: [...(s.previousThreads ?? []), s.thread].filter(Boolean) });
          return { reset: true, studio, oldThread: s.thread, note: "the next request starts a new thread with the same house style" };
        }
      : notInThisAsk("resetting a studio"),

    cancel: act
      ? (id) => {
          const j = readJson(p.job(String(id)));
          if (!j) throw new Error(`no job ${id}`);
          if (!["queued", "running"].includes(j.status)) return { cancelled: false, status: j.status };
          try { process.kill(-j.runnerPid, "SIGTERM"); } catch {}
          writeJson(p.job(j.id), { ...readJson(p.job(j.id)), status: "failed", error: "cancelled", finishedAt: new Date().toISOString() });
          return { cancelled: true, id: j.id };
        }
      : notInThisAsk("cancelling a job"),
  };
  return api;
}
