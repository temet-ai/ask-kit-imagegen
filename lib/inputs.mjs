import crypto from 'node:crypto';
import fs from 'node:fs';

// Attach a previous review only to the bytes it describes. A reused output pathname may now
// contain an unrelated image. Old explicit job/last references can still recover their thread.
export function inputSource(file, record, { requireHash = false } = {}) {
  const input = { file, thread: null };
  if (!record) return input;
  const expected = (file === record.copiedTo ? record.deliveryValidation : null)?.sha256 || record.validation?.sha256;
  if (!expected && requireHash) return input;
  if (expected && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== expected) return input;
  input.thread = record.thread || null;
  input.sourceJob = record.id;
  if (expected && record.review) {
    input.sourceReview = {
      status: record.review.status,
      checks: (record.review.checks || []).filter(c => c.status !== 'pass'),
      warnings: record.review.warnings || [],
    };
  }
  return input;
}
