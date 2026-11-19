import { expect, test } from 'vitest';
import { costUsd, projectCost } from '../../src/eval/cost';

test('costUsd prices input and output per million tokens', () => {
  expect(costUsd('claude-sonnet-5-5', { input: 1_000_000, output: 100_000 })).toBeCloseTo(3, 10);
  expect(costUsd('claude-haiku-5-5', { input: 2_000_000, output: 1_000_000 })).toBeCloseTo(0.7, 10);
});

test('costUsd refuses an unknown model rather than guessing', () => {
  expect(() => costUsd('claude-mystery', { input: 1, output: 1 })).toThrow(/claude-mystery/);
});

test('projectCost scales the sample mean to the full run', () => {
  const sample = [{ input: 1000, output: 100 }, { input: 3000, output: 300 }];
  // mean 2000 in / 200 out per call × 1000 calls on Opus ($4 / $20)
  expect(projectCost('claude-opus-5-5', sample, 1000)).toBeCloseTo(2000 * 1000 * 4 / 1e6 + 200 * 1000 * 20 / 1e6, 10);
});
