import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordOutcome } from "../lib/outcomes.mjs";
import makeImage from "../scripts/make.mjs";
import waitImage from "../scripts/wait.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "imagegen-outcomes-"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const job = (id, patch = {}) => ({
  id, kind: "make", status: "done", queuedAt: "2026-11-01T12:00:00Z",
  finishedAt: "2026-11-01T12:01:00Z", outcomeJournal: { root, session: "vimes" },
  review: { status: "needs_review", warnings: ["Requested 16:9; received 32x24."], checks: [] },
  request: { prompt: "A private commission for the Watch" }, ...patch,
});
const rows = () => fs.readFileSync(path.join(root, "imagegen/outcomes.jsonl"), "utf8").trim().split("\n").map(JSON.parse);

test("completed outcomes retain quality failures without storing the prompt", () => {
  const j = job("img-watch");
  assert.equal(recordOutcome(j).written, true);
  assert.equal(recordOutcome(j).written, false);
  const [r] = rows();
  assert.equal(r.type, "outcome"); assert.equal(r.ok, true);
  assert.equal(r.review.status, "needs_review"); assert.equal(r.ms, 60_000);
  assert.equal(r.session, "vimes"); assert.equal(r.jobId, j.id);
  assert.equal(JSON.stringify(r).includes(j.request.prompt), false);
});

test("failed jobs and old unverified receipts remain visible", () => {
  recordOutcome(job("img-failed", { status: "failed", error: "Studio stopped", review: undefined }));
  recordOutcome(job("img-old", { review: undefined }));
  const [failed, old] = rows().slice(-2);
  assert.equal(failed.ok, false); assert.equal(failed.error, "Studio stopped");
  assert.equal(old.ok, true); assert.equal(old.review.status, "unverified");
});

test("pending jobs and studio setup do not masquerade as completed images", () => {
  assert.equal(recordOutcome(job("img-queued", { status: "queued" })).written, false);
  assert.equal(recordOutcome(job("img-start", { kind: "start" })).written, false);
});

test("outcome details are bounded and preserve the caller's benchmark label", () => {
  recordOutcome(job("img-bench", {
    outcomeJournal: { root, session: "kittest-watch" },
    review: { status: "needs_review", warnings: Array(20).fill("w".repeat(1000)), checks: [{ criterion: "Uniform", status: "fail", detail: "x".repeat(1000) }] },
  }));
  const r = rows().at(-1);
  assert.equal(r.session, "kittest-watch"); assert.equal(r.review.warnings.length, 8);
  assert.equal(r.review.warnings[0].length, 300); assert.equal(r.review.notes.length, 300);
});

test("journal failures return an error without throwing away a result", () => {
  const blocker = path.join(root, "blocked"); fs.writeFileSync(blocker, "a file");
  const result = recordOutcome(job("img-blocked", { outcomeJournal: { root: blocker } }));
  assert.equal(result.written, false); assert.match(result.error, /Could not record/);
});

test("make and wait scripts return the completed review without resubmitting", async () => {
  const completed = job("img-script"); let submitted = 0, waited = 0;
  const imagegen = {
    make() { submitted++; return { id: completed.id, status: "queued" }; },
    job() { return { id: completed.id, status: "running" }; },
    async wait() { waited++; return completed; },
  };
  assert.strictEqual(await makeImage({ imagegen }, { prompt: "The Watch", wait: 1 }), completed);
  assert.strictEqual(await waitImage({ imagegen }, { id: completed.id, seconds: 1 }), completed);
  assert.equal(submitted, 1); assert.equal(waited, 2);
});
