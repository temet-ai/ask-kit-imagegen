// Shot results are clipped by the host. Keep defects and delivery status ahead of long prompts;
// the complete receipt remains available through imagegen.job/history and recent full=true.
const cut = (text, n) => String(text).length > n ? `${String(text).slice(0, n - 1)}…` : String(text);
export function jobSummary(job) {
  const result = {};
  for (const key of ['id', 'studio', 'kind', 'status', 'file', 'copiedTo', 'seconds', 'secondsSoFar', 'waitingFor', 'attempts']) {
    if (job[key] !== undefined) result[key] = job[key];
  }
  if (job.at && !result.status) result.status = 'done';
  for (const key of ['error', 'deliveryError', 'libraryError', 'outcomeJournalError']) {
    if (job[key]) result[key] = cut(job[key], 300);
  }
  if (job.review || job.status === 'done' || job.at) {
    const checks = job.review?.checks || [], warnings = job.review?.warnings || [];
    const unresolved = checks.filter(c => c.status !== 'pass');
    result.review = {
      status: job.review?.status || 'unverified',
      counts: Object.fromEntries(['pass', 'fail', 'unverified'].map(s => [s, checks.filter(c => c.status === s).length])),
      checks: unresolved.slice(0, 8).map(c => ({criterion:cut(c.criterion, 100),status:c.status,detail:cut(c.detail, 220)})),
      warnings: warnings.slice(0, 4).map(w => cut(w, 220)),
      omittedChecks: Math.max(0, unresolved.length - 8), omittedWarnings: Math.max(0, warnings.length - 4),
    };
  }
  if (job.validation) result.validation = Object.fromEntries(['format', 'width', 'height', 'hasTransparency', 'fullyTransparent'].filter(k => job.validation[k] !== undefined).map(k => [k, job.validation[k]]));
  if (job.libraryResult) result.libraryResult = {...job.libraryResult};
  for (const key of ['checked', 'notes']) if (job[key]) result[key] = cut(job[key], 400);
  result.details = `imagegen.job(${JSON.stringify(job.id)}) or recent id=${job.id} full=true; select fields for long records`;
  const tooLong = () => JSON.stringify(result, null, 2).length > 3600;
  // Count every omitted finding, so a short response cannot make an incomplete review look clean.
  while (tooLong() && result.review?.checks.length > 1) { result.review.checks.pop(); result.review.omittedChecks++; }
  while (tooLong() && result.review?.warnings.length > 1) { result.review.warnings.pop(); result.review.omittedWarnings++; }
  for (const key of ['notes', 'checked', 'validation', 'libraryResult', 'copiedTo', 'file']) {
    if (!tooLong()) break;
    if (key in result) { delete result[key]; (result.omittedFields ||= []).push(key); }
  }
  return result;
}
