import { expect, test } from 'vitest';
import type { AnswerOutput } from '../../src/eval/answer';
import { computeClassifyMetrics } from '../../src/eval/classify';
import type { ClassifyOutput } from '../../src/eval/classifyMetrics';
import type { ResultFile } from '../../src/eval/results';
import { signTestP } from '../../src/eval/signTest';
import { buildSummary } from '../../src/eval/summary';
import { evalFixture } from './fixtures';

const d = evalFixture(40); // labels r0001..r0030 are all ['location']
const split = { sampled: { test: ['r0001', 'r0004', 'r0006', 'r0008'], dev: ['r0009', 'r0010'] }, added: ['r0002', 'r0003'] };
const u = { input: 1000, output: 100 };

function classify(model: string, prompt: string, pred: (id: string, rep: number) => string[], over: Partial<ResultFile<ClassifyOutput>> = {}): ResultFile<ClassifyOutput> {
  const outputs: ClassifyOutput[] = [
    ...d.reviews.map((r) => ({ id: r.id, rep: 1, topics: pred(r.id, 1), usage: u })),
    ...Object.keys(d.labels).flatMap((id) => [2, 3].map((rep) => ({ id, rep, topics: pred(id, rep), usage: u }))),
  ];
  return { runId: 'x', kind: 'classify', createdAt: '2026-11-19T10:00:00Z', model, effort: 'low', promptVersion: prompt, prompt: '', promptHash: '', datasetHash: 'hash', splitHash: 'S', reps: 3, outputs, usage: { inputTokens: 0, outputTokens: 0, estCostUsd: 1 }, metrics: computeClassifyMetrics(outputs, d, split), ...over };
}
function answer(model: string): ResultFile<AnswerOutput> {
  const outputs: AnswerOutput[] = [{ questionId: 'Q1', rep: 1, answer: { answer: 'a', claims: [{ text: 'c', reviewIds: ['r0002'] }], category: 'cleanliness', month: '2024-06' }, usage: u }];
  return { runId: 'a', kind: 'answer', createdAt: '2026-11-19T11:00:00Z', model, effort: 'low', promptVersion: 'answer-v1', prompt: '', promptHash: '', datasetHash: 'hash', splitHash: '', reps: 1, outputs, usage: { inputTokens: 0, outputTokens: 0, estCostUsd: 0.5 }, metrics: {}, judge: { model: 'claude-opus-5-5', effort: 'medium', prompt: '', verdicts: [{ outputIndex: 0, claimIndex: 0, reviewId: 'r0002', supported: true, reason: '' }], estCostUsd: 0.25 } };
}
const ok = () => ['location'];
const build = (results: { file: string; result: ResultFile }[]) => buildSummary({ data: d, split, splitHash: 'S', results, judgeChecks: [], generatedAt: '2026-11-19T12:00:00Z' });

test('signTestP: 7 vs 0 → 0.015625; 5 vs 1 → 0.21875; 0 vs 0 → 1', () => {
  expect(signTestP(7, 0)).toBeCloseTo(0.015625, 10);
  expect(signTestP(5, 1)).toBeCloseTo(0.21875, 10);
  expect(signTestP(0, 0)).toBe(1);
  expect(signTestP(3, 3)).toBe(1);
});

test('latest file per (kind, model, prompt) is used and named; older ones still count in totalCostUsd', () => {
  const s = build([
    { file: 'old.json', result: classify('claude-haiku-5-5', 'v1', () => ['noise'], { createdAt: '2026-11-18T00:00:00Z' }) },
    { file: 'new.json', result: classify('claude-haiku-5-5', 'v1', ok) },
    { file: 'ans.json', result: answer('claude-haiku-5-5') },
  ]);
  expect(s.classify).toHaveLength(1);
  expect(s.classify[0]).toMatchObject({ file: 'new.json', model: 'claude-haiku-5-5', prompt: 'v1' });
  expect(s.totalCostUsd).toBeCloseTo(1 + 1 + 0.5 + 0.25, 10);
});

test('paired counts use test ids and rep 1 only, with exact-set matches', () => {
  // v1 wrong on r0001 (test) and r0009 (dev); v3 right everywhere; v3 rep 2 wrong on r0004 (ignored)
  const v1 = classify('claude-sonnet-5-5', 'v1', (id) => (id === 'r0001' || id === 'r0009' ? ['noise'] : ['location']));
  const v3 = classify('claude-sonnet-5-5', 'v3', (id, rep) => (id === 'r0004' && rep === 2 ? ['noise'] : ['location']));
  const p = build([{ file: 'a', result: v1 }, { file: 'b', result: v3 }]).paired;
  expect(p).toEqual([{ model: 'claude-sonnet-5-5', from: 'v1', to: 'v3', subset: 'test', better: 1, worse: 0, signTestP: 1 }]);
});

test('a model with only v1 and v3 gets just the v1→v3 pair; a missing model is skipped', () => {
  const s = build([{ file: 'a', result: classify('claude-haiku-5-5', 'v1', ok) }, { file: 'b', result: classify('claude-haiku-5-5', 'v3', ok) }]);
  expect(s.paired.map((x) => `${x.model} ${x.from}→${x.to}`)).toEqual(['claude-haiku-5-5 v1→v3']);
  expect(s.pairedStability.every((x) => x.a.model === 'claude-haiku-5-5' && x.b.model === 'claude-haiku-5-5')).toBe(true);
});

test('pairedStability counts reviews stable in one config only', () => {
  const v1 = classify('claude-haiku-5-5', 'v1', (id, rep) => (['r0001', 'r0002'].includes(id) && rep === 3 ? ['noise'] : ['location']));
  const v3 = classify('claude-haiku-5-5', 'v3', (id, rep) => (id === 'r0005' && rep === 2 ? ['noise'] : ['location']));
  const ps = build([{ file: 'a', result: v1 }, { file: 'b', result: v3 }]).pairedStability;
  expect(ps).toEqual([{ a: { model: 'claude-haiku-5-5', prompt: 'v1' }, b: { model: 'claude-haiku-5-5', prompt: 'v3' }, stableOnlyInA: 1, stableOnlyInB: 2, signTestP: 1 }]);
});

test('classify files with another splitHash or any file with another datasetHash are refused', () => {
  expect(() => build([{ file: 'x.json', result: classify('claude-haiku-5-5', 'v1', ok, { splitHash: 'OTHER' }) }])).toThrow(/x\.json.*split/);
  expect(() => build([{ file: 'y.json', result: { ...answer('claude-haiku-5-5'), datasetHash: 'OTHER' } }])).toThrow(/y\.json.*dataset/);
});

test('answer files are accepted with an empty splitHash and summarised', () => {
  const s = build([{ file: 'ans.json', result: answer('claude-sonnet-5-5') }]);
  expect(s.answers[0]).toMatchObject({ file: 'ans.json', model: 'claude-sonnet-5-5', costUsd: 0.5, judgeCostUsd: 0.25, q1Correct: { k: 1, n: 1 }, invalidCitations: 0 });
});

test('the summary contains no review text and no labels', () => {
  const s = JSON.stringify(build([{ file: 'a', result: classify('claude-haiku-5-5', 'v1', ok) }, { file: 'ans.json', result: answer('claude-haiku-5-5') }]));
  expect(s).not.toMatch(/Review \d+ text/);
  expect(s).not.toMatch(/"r0\d{3}"/);
});

test('Q2 counts cited reviews from outside the planted month', () => {
  const a = answer('claude-haiku-5-5');
  // fixture planted month is 2024-06; r0006 is dated 2024-06-10, r0007 2024-07-10
  a.outputs = [{ questionId: 'Q2', rep: 1, answer: { answer: 'a', claims: [{ text: 'c', reviewIds: ['r0006', 'r0007', 'r0007'] }] }, usage: u }];
  const s = build([{ file: 'ans.json', result: a }]);
  expect(s.answers[0].q2.offMonthCited).toBe(1);
  expect(s.answers[0].q2.cited).toBe(2);
});

test('models are compared with each other on test, at the highest prompt both have', () => {
  const h = classify('claude-haiku-5-5', 'v3', (id) => (id === 'r0001' ? ['noise'] : ['location']));
  const so = classify('claude-sonnet-5-5', 'v3', ok);
  const pm = build([{ file: 'a', result: h }, { file: 'b', result: so }]).pairedModels;
  expect(pm).toEqual([{ prompt: 'v3', a: 'claude-haiku-5-5', b: 'claude-sonnet-5-5', betterInB: 1, worseInB: 0, signTestP: 1 }]);
});

test('a failed rep-1 call never counts as an exact match, even for a review labelled with no topics', () => {
  const data = { ...d, labels: { ...d.labels, r0001: { topics: [], viaTranslation: false } } };
  const v1 = classify('claude-haiku-5-5', 'v1', (id) => (id === 'r0001' ? ['noise'] : ['location']));
  const v3 = classify('claude-haiku-5-5', 'v3', ok);
  v3.outputs = v3.outputs.map((o) => (o.id === 'r0001' && o.rep === 1 ? { ...o, topics: undefined, error: 'boom' } : o));
  const s = buildSummary({ data, split, splitHash: 'S', results: [{ file: 'a', result: v1 }, { file: 'b', result: v3 }], judgeChecks: [], generatedAt: '' });
  expect(s.paired[0]).toMatchObject({ better: 0, worse: 0 });
});
