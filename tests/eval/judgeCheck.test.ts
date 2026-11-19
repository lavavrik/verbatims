import { expect, test } from 'vitest';
import { sampleForCheck } from '../../src/eval/judgeCheck';

const verdicts = Array.from({ length: 40 }, (_, i) => ({ outputIndex: i, claimIndex: 0, reviewId: `r${i}`, supported: i % 3 !== 0, reason: '' }));
const files = [{ path: 'results/a.json', verdicts }];

test('samples 10 supported and 10 unsupported verdicts, deterministically', () => {
  const s = sampleForCheck(files, []);
  expect(s.filter((x) => x.verdict.supported)).toHaveLength(10);
  expect(s.filter((x) => !x.verdict.supported)).toHaveLength(10);
  expect(sampleForCheck(files, [])).toEqual(s);
});

test('skips verdicts already checked and verdicts the judge failed on', () => {
  const checked = [{ resultFile: 'results/a.json', outputIndex: 1, claimIndex: 0, reviewId: 'r1', judge: true, owner: true }];
  const withError = [{ path: 'results/a.json', verdicts: [...verdicts, { outputIndex: 99, claimIndex: 0, reviewId: 'r99', supported: false, reason: '', error: 'x' }] }];
  const s = sampleForCheck(withError, checked);
  expect(s.some((x) => x.verdict.outputIndex === 1)).toBe(false);
  expect(s.some((x) => x.verdict.outputIndex === 99)).toBe(false);
});
