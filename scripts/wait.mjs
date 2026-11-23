import { jobSummary } from '../lib/job-summary.mjs';

export const meta = {
  purpose: "Is an image job done? Waits up to `seconds` for it, then returns it: the file path when done, the error when failed, how long it has run when not.",
  params: { id: "the job id (img-...)", seconds: "how long to wait, default 50" },
  returns: "compact job status, paths, elapsed time, validation and unresolved review checks with counts; full receipt through imagegen.job(id)",
  example: 'await scripts.run("wait", { id: "img-mwt675o6-6740" })',
};

export default async function ({ imagegen }, { id, seconds = 50 } = {}) {
  if (!id) return { error: "name the job: id=img-..." , recent: imagegen.jobs({ limit: 5 }) };
  let j = imagegen.job(id);
  const until = Date.now() + Math.max(0, Number(seconds) || 0) * 1000;
  while (["queued", "running"].includes(j.status) && Date.now() < until) j = await imagegen.wait(id, Math.min(55, Math.ceil((until - Date.now()) / 1000)));
  return jobSummary(j);
}
