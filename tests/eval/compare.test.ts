import { expect, test } from 'vitest';
import { computeClassifyMetrics } from '../../src/eval/classify';
import type { ClassifyOutput } from '../../src/eval/classifyMetrics';
import { compareRuns } from '../../src/eval/compare';
import type { ResultFile } from '../../src/eval/results';
import { evalFixture } from './fixtures';

const d = evalFixture(40); // every label is ['location']
const split = { sampled: { test: ['r0001', 'r0004', 'r0006', 'r0008'], dev: ['r0009', 'r0010'] }, added: ['r0002', 'r0003'] };
function run(pred: (id: string) => string[], over: Partial<ResultFile<ClassifyOutput>> = {}): ResultFile<ClassifyOutput> {
  const outputs = d.reviews.map((r) => ({ id: r.id, rep: 1, topics: pred(r.id), usage: { input: 1, output: 1 } }));
  return { runId: 'x', kind: 'classify', createdAt: '', model: 'm', effort: 'low', promptVersion: 'v1', prompt: '', promptHash: '', datasetHash: 'hash', splitHash: '', reps: 1, outputs, usage: { inputTokens: 0, outputTokens: 0, estCostUsd: 0 }, metrics: computeClassifyMetrics(outputs, d, split), ...over };
}

test('improved and regressed come from rep 1 against the labels', () => {
  const a = run((id) => (id === 'r0001' ? ['noise'] : ['location']));
  const b = run((id) => (id === 'r0004' ? ['noise'] : ['location']));
  const c = compareRuns(a, b, d);
  expect(c.improved).toEqual(['r0001']);
  expect(c.regressed).toEqual(['r0004']);
});

test('deltas include test exact-set and test micro F1 with their n', () => {
  const c = compareRuns(run(() => ['noise']), run(() => ['location']), d);
  const exact = c.metricDeltas.find((m) => m.name === 'test exact-set')!;
  expect(exact).toMatchObject({ a: 0, b: 1, nA: 4, nB: 4 });
  expect(c.metricDeltas.some((m) => m.name === 'test micro F1')).toBe(true);
});

test('runs on different datasets or of different kinds are refused', () => {
  expect(() => compareRuns(run(() => []), run(() => [], { datasetHash: 'other' }), d)).toThrow(/dataset/);
  expect(() => compareRuns(run(() => []), run(() => [], { kind: 'answer' }), d)).toThrow(/kind/);
});
