import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';
import { AnswerSchema, Q1Schema, runAnswer, type AnswerOutput, type Question } from '../../src/eval/answer';
import { answerMetrics } from '../../src/eval/answerMetrics';
import { computeClassifyMetrics, runClassify } from '../../src/eval/classify';
import type { ClassifyOutput } from '../../src/eval/classifyMetrics';
import { compareRuns } from '../../src/eval/compare';
import { costUsd } from '../../src/eval/cost';
import { makeJudge } from '../../src/eval/judge';
import type { ResultFile } from '../../src/eval/results';
import { LlmError } from '../../src/llm';
import type { PublishedReview } from '../../src/pipeline/build';
import { evalFixture } from './fixtures';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'fix-')); });
const u = { input: 1, output: 1 };
const real: PublishedReview[] = readFileSync('data/reviews.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const realData = () => ({ ...evalFixture(1), reviews: real, byId: new Map(real.map((r) => [r.id, r])), redate: { targetMonth: '2026-06', moves: [], groundTruth: ['r0001'] } });
const QUESTIONS: Question[] = [{ id: 'Q1', text: 'q1?' }, { id: 'Q3', text: 'q3?' }];

const answerCall = () => {
  const calls: string[] = [];
  return { calls, call: (async (_o: unknown, _s: unknown, _sys: string, user: string) => {
    calls.push(user);
    return { value: { answer: 'a', claims: [{ text: 'c', reviewIds: ['r0001', 'r0002'] }], category: 'cleanliness', month: '2026-06' }, usage: { input: 50000, output: 300 } };
  }) as never };
};
const judgeCall = () => {
  const calls: string[] = [];
  return { calls, call: (async (_o: unknown, _s: unknown, _sys: string, user: string) => { calls.push(user); return { value: { supported: true, reason: 'ok' }, usage: { input: 700, output: 100 } }; }) as never };
};
const answerOpts = (over: object = {}) => ({ model: 'claude-haiku-5-5', reps: 1, yes: false, dir, data: realData(), questions: QUESTIONS, template: 'T', ...over });

// Critical 1: the judge never spends without a confirmed projection, and verdicts are cached.
test('the judge cost is projected and confirmed before judging, also on a resumed run', async () => {
  const a = answerCall(), j = judgeCall();
  const questions: string[] = [];
  const confirm = async (q: string) => { questions.push(q); return true; };
  await runAnswer(answerOpts(), { call: a.call, confirm, judge: makeJudge(j.call) });
  expect(questions.some((q) => /judge/i.test(q) && /\$\d/.test(q))).toBe(true);
  expect(j.calls).toHaveLength(4); // 2 outputs × 2 distinct citations

  // Resume: answers and verdicts are cached, so nothing is asked and nothing is paid again.
  const j2 = judgeCall(); questions.length = 0;
  await runAnswer(answerOpts(), { call: answerCall().call, confirm, judge: makeJudge(j2.call) });
  expect(j2.calls).toHaveLength(0);
});

test('declining the judge projection spends nothing on the judge and writes no result', async () => {
  const j = judgeCall();
  let n = 0;
  const confirm = async () => ++n === 1; // yes to answers, no to the judge
  expect(await runAnswer(answerOpts(), { call: answerCall().call, confirm, judge: makeJudge(j.call) })).toBeNull();
  expect(j.calls).toHaveLength(0);
});

// Important 2: errors are retried on resume.
test('errored classify calls are retried when the run is resumed', async () => {
  const d = evalFixture(12);
  let failing = true;
  const call = (async (_o: unknown, _s: unknown, _sys: string, user: string) => {
    if (failing && /Review (1|2|3) text/.test(user)) throw new Error('overloaded');
    return { value: { topics: ['location'] }, usage: u };
  }) as never;
  const o = { model: 'claude-haiku-5-5', version: 'v1' as const, reps: 1, yes: true, dir, data: d, split: { sampled: { test: [], dev: [] }, added: [] }, template: '{{topics}}' };
  const first = (await runClassify(o, { call, confirm: async () => true }))!;
  expect(first.outputs.filter((x) => x.error)).toHaveLength(3);
  failing = false;
  const second = (await runClassify(o, { call, confirm: async () => true }))!;
  expect(second.outputs.every((x) => x.topics)).toBe(true);
});

// Important 3: failed calls keep their token usage; schemas don't throw away paid answers.
test('a failed call records the tokens it used', async () => {
  const d = evalFixture(12);
  const call = (async (_o: unknown, _s: unknown, _sys: string, user: string) => {
    if (user.includes('Review 1 text')) throw new LlmError('No parsed output', { input: 900, output: 40 });
    return { value: { topics: ['location'] }, usage: { input: 100, output: 10 } };
  }) as never;
  const o = { model: 'claude-haiku-5-5', version: 'v1' as const, reps: 1, yes: true, dir, data: d, split: { sampled: { test: [], dev: [] }, added: [] }, template: '{{topics}}' };
  const file = (await runClassify(o, { call, confirm: async () => true }))!;
  expect(file.outputs[0]).toMatchObject({ error: 'No parsed output', usage: { input: 900, output: 40 } });
  expect(file.usage.estCostUsd).toBeCloseTo(costUsd('claude-haiku-5-5', { input: 900 + 100 * 11, output: 40 + 10 * 11 }), 10);
});

test('answer schemas accept 9 claims and a loosely formatted month, so paid answers are kept', () => {
  const claims = Array.from({ length: 9 }, () => ({ text: 'c', reviewIds: ['r0001'] }));
  expect(AnswerSchema.safeParse({ answer: 'a', claims }).success).toBe(true);
  expect(Q1Schema.safeParse({ answer: 'a', claims, category: 'cleanliness', month: '2026-6' }).success).toBe(true);
});

// Important 4 and 5: Q2 per rep, and invented ids count against precision.
test('Q2 is reported per rep and averaged, and invented ids count against precision', () => {
  const d = evalFixture(40); // ground truth r0002, r0003
  const out = (rep: number, ids: string[]): AnswerOutput => ({ questionId: 'Q2', rep, answer: { answer: 'a', claims: [{ text: 'c', reviewIds: ids }] }, usage: u });
  const q2 = answerMetrics([out(1, ['r0002', 'fake1']), out(2, ['r0002', 'r0003'])], [], d).Q2.q2!;
  expect(q2.perRep).toEqual([
    { rep: 1, recall: 0.5, precision: 0.5 },
    { rep: 2, recall: 1, precision: 1 },
  ]);
  expect(q2.meanRecall).toBeCloseTo(0.75, 10);
  expect(q2.meanPrecision).toBeCloseTo(0.75, 10);
  expect(q2.precision).toMatchObject({ k: 3, n: 4 }); // pooled: fake1 is in the denominator
});

// Minor 6, promoted: no projection, no spending.
test('a run refuses to continue when every sample call failed, even with --yes', async () => {
  const d = evalFixture(40);
  const calls: number[] = [];
  const call = (async () => { calls.push(1); throw new Error('401 invalid key'); }) as never;
  const o = { model: 'claude-haiku-5-5', version: 'v1' as const, reps: 1, yes: true, dir, data: d, split: { sampled: { test: [], dev: [] }, added: [] }, template: '{{topics}}' };
  await expect(runClassify(o, { call, confirm: async () => true })).rejects.toThrow(/sample calls failed/);
  expect(calls).toHaveLength(10);
});

// Minor 7, promoted: the answer projection is an upper bound on output.
test('the answer projection assumes the maximum output per call', async () => {
  const asked: string[] = [];
  await runAnswer(answerOpts(), { call: answerCall().call, confirm: async (q) => { asked.push(q); return false; }, judge: makeJudge(judgeCall().call) });
  const shown = Number(asked[0].match(/\$(\d+\.\d+)/)![1]);
  expect(shown).toBeGreaterThanOrEqual(Number(costUsd('claude-haiku-5-5', { input: 0, output: 8000 * 2 }).toFixed(2)));
});

// Minor 12, promoted: never compare runs made on different splits.
test('compare refuses runs made on different dev/test splits', () => {
  const d = evalFixture(40);
  const split = { sampled: { test: ['r0001'], dev: ['r0004'] }, added: [] };
  const outputs = d.reviews.map((r) => ({ id: r.id, rep: 1, topics: ['location'], usage: u }));
  const mk = (splitHash: string): ResultFile<ClassifyOutput> => ({ runId: 'x', kind: 'classify', createdAt: '', model: 'm', effort: 'low', promptVersion: 'v1', prompt: '', promptHash: '', datasetHash: 'h', splitHash, reps: 1, outputs, usage: { inputTokens: 0, outputTokens: 0, estCostUsd: 0 }, metrics: computeClassifyMetrics(outputs, d, split) });
  expect(() => compareRuns(mk('aaa'), mk('bbb'), d)).toThrow(/split/);
});
