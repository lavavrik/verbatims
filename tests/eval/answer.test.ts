import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';
import type { Judge } from '../../src/eval/answer';
import { runAnswer, type Question } from '../../src/eval/answer';
import type { PublishedReview } from '../../src/pipeline/build';
import { evalFixture } from './fixtures';

const real: PublishedReview[] = readFileSync('data/reviews.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const QUESTIONS: Question[] = [{ id: 'Q1', text: 'q1?' }, { id: 'Q2', text: 'q2?' }, { id: 'Q3', text: 'q3?' }];
let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ans-')); });

function fakeCall(fail?: (q: string) => boolean) {
  const calls: { user: string; cached: boolean; schemaHasCategory: boolean }[] = [];
  const call = async (o: { cacheSystem?: boolean }, schema: { shape?: Record<string, unknown> }, _sys: string, user: string) => {
    calls.push({ user, cached: !!o.cacheSystem, schemaHasCategory: 'category' in (schema.shape ?? {}) });
    if (fail?.(user)) throw new Error('boom');
    return { value: { answer: 'a', claims: [{ text: 'c', reviewIds: ['r0001'] }], category: 'cleanliness', month: '2026-06' } as never, usage: { input: 60000, output: 500 } };
  };
  return { call: call as never, calls };
}
const noJudge = (verdicts: Judge extends { run: (...a: any[]) => Promise<infer V> } ? V : never = []): Judge => ({
  model: 'claude-opus-5-5', effort: 'medium', prompt: 'judge prompt', usage: { input: 10, output: 5 },
  jobs: (outputs) => outputs.flatMap((o, outputIndex) => (o.answer?.claims ?? []).flatMap((c, claimIndex) => c.reviewIds.map((reviewId) => ({ outputIndex, claimIndex, reviewId, claim: c.text })))),
  estimate: () => 0.01,
  // Like the real judge: one verdict per job (the given ones, otherwise 'not supported').
  run: async (jobs) => jobs.map((j) => verdicts.find((v) => v.outputIndex === j.outputIndex && v.claimIndex === j.claimIndex && v.reviewId === j.reviewId) ?? { outputIndex: j.outputIndex, claimIndex: j.claimIndex, reviewId: j.reviewId, supported: false, reason: '' }),
});
const data = () => ({ ...evalFixture(1), reviews: real, byId: new Map(real.map((r) => [r.id, r])), redate: { targetMonth: '2026-06', moves: [], groundTruth: [] } });
const opts = (over: object = {}) => ({ model: 'claude-haiku-5-5', reps: 2, yes: true, dir, data: data(), questions: QUESTIONS, template: 'Answer from the data.', ...over });

test('asks each question independently reps times, Q1 with the category/month schema, context cached', async () => {
  const f = fakeCall();
  const file = (await runAnswer(opts(), { call: f.call, confirm: async () => true, judge: noJudge() }))!;
  expect(f.calls.map((c) => c.user)).toEqual(['q1?', 'q1?', 'q2?', 'q2?', 'q3?', 'q3?'].map((q) => expect.stringContaining(q)));
  expect(f.calls.filter((c) => c.schemaHasCategory)).toHaveLength(2);
  expect(f.calls.every((c) => c.cached)).toBe(true);
  expect(file.outputs).toHaveLength(6);
  expect(file.kind).toBe('answer');
});

test('declining the projection spends nothing', async () => {
  const f = fakeCall();
  expect(await runAnswer(opts({ yes: false }), { call: f.call, confirm: async () => false, judge: noJudge() })).toBeNull();
  expect(f.calls).toHaveLength(0);
});

test('refuses to run when the data no longer gives the Q1 key', async () => {
  const f = fakeCall();
  const d = evalFixture(30);
  await expect(runAnswer(opts({ data: d }), { call: f.call, confirm: async () => true, judge: noJudge() })).rejects.toThrow(/Q1 key/);
  expect(f.calls).toHaveLength(0);
});

test('an error is recorded per call and the run completes', async () => {
  const f = fakeCall((q) => q.includes('q2?'));
  const file = (await runAnswer(opts({ reps: 1 }), { call: f.call, confirm: async () => true, judge: noJudge() }))!;
  expect(file.outputs.find((o) => o.questionId === 'Q2')).toMatchObject({ error: 'boom' });
  expect(file.outputs.filter((o) => !o.error)).toHaveLength(2);
});

test('stores judge verdicts with the judge setup, and fills answer metrics', async () => {
  const f = fakeCall();
  const judge = noJudge([{ outputIndex: 0, claimIndex: 0, reviewId: 'r0001', supported: true, reason: 'ok' }]);
  const file = (await runAnswer(opts({ reps: 1 }), { call: f.call, confirm: async () => true, judge }))!;
  expect(file.judge).toMatchObject({ model: 'claude-opus-5-5', effort: 'medium', prompt: 'judge prompt' });
  expect(file.judge!.verdicts).toHaveLength(3);
  expect(file.judge!.verdicts.filter((v) => v.supported)).toHaveLength(1);
  expect(file.metrics.Q1.q1Correct).toMatchObject({ k: 1, n: 1 });
  expect(file.metrics.Q3.unsupportedClaims).toMatchObject({ k: 1, n: 1 });
});
