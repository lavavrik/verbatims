import { createHash } from 'node:crypto';
import type { Verdict } from './answer';
import type { JudgeCheck } from './answerMetrics';

export const CHECK_PER_CLASS = 10;
const key = (path: string, v: Verdict) => `${path}#${v.outputIndex}#${v.claimIndex}#${v.reviewId}`;
const order = (s: string) => createHash('sha256').update(s).digest('hex');

/** 10 supported and 10 unsupported verdicts not yet checked, in a fixed pseudo-random order. */
export function sampleForCheck(files: { path: string; verdicts: Verdict[] }[], checked: JudgeCheck[]) {
  const seen = new Set(checked.map((c) => `${c.resultFile}#${c.outputIndex}#${c.claimIndex}#${c.reviewId}`));
  const pool = files.flatMap((f) => f.verdicts.filter((v) => !v.error && !seen.has(key(f.path, v))).map((verdict) => ({ path: f.path, verdict })));
  pool.sort((a, b) => order(key(a.path, a.verdict)).localeCompare(order(key(b.path, b.verdict))));
  return [...pool.filter((x) => x.verdict.supported).slice(0, CHECK_PER_CLASS), ...pool.filter((x) => !x.verdict.supported).slice(0, CHECK_PER_CLASS)]
    .sort((a, b) => order(key(a.path, a.verdict)).localeCompare(order(key(b.path, b.verdict))));
}
