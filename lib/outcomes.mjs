// A detached image job can finish after the ask that submitted it. Record its final review
// separately from that ask, so the kit's improvement report sees the result without polling.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const short = (value) => String(value ?? "").slice(0, 300);

export function outcomeContext(session) {
  return {
    root: process.env.ASK_KIT_STATE || path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local/state"), "ask-kit"),
    session: session || process.env.ASK_KIT_CALLER || process.env.ASK_KIT_SESSION || process.env.CLAUDE_CODE_SESSION_ID || process.env.CODEX_THREAD_ID || null,
  };
}

export function recordOutcome(job) {
  if (!["done", "failed"].includes(job.status) || job.kind === "start") return { written: false };
  const context = job.outcomeJournal || outcomeContext();
  const file = path.join(context.root, "imagegen", "outcomes.jsonl");
  try {
    // Also permits importing completed jobs from before completion journaling existed.
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8").split("\n").some(line => {
      try { return JSON.parse(line).jobId === job.id; } catch { return false; }
    })) return { written: false };
    const review = job.review || {};
    const notes = (review.checks || []).filter(c => c.status !== "pass").map(c => `${c.criterion}: ${c.detail}`).join("; ");
    const elapsed = Date.parse(job.finishedAt) - Date.parse(job.startedAt || job.queuedAt);
    const row = {
      type: "outcome", ts: job.finishedAt || new Date().toISOString(),
      session: context.session || `job-${job.id}`, jobId: job.id, ok: job.status === "done",
      review: {
        status: ["pass", "needs_review", "unverified"].includes(review.status) ? review.status : "unverified",
        warnings: (Array.isArray(review.warnings) ? review.warnings : []).slice(0, 8).map(short),
        ...(notes ? { notes: short(notes) } : {}),
      },
      ...(job.error ? { error: short(job.error) } : {}),
      ...(Number.isFinite(elapsed) && elapsed >= 0 ? { ms: elapsed } : {}),
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(row) + "\n", { mode: 0o600 });
    return { written: true };
  } catch (e) {
    return { written: false, error: `Could not record the job outcome in ${file}: ${e.message}` };
  }
}
