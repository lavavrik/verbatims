import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';
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
const data = () => ({ ...evalFixture(1), reviews: real, byId: new Map(real.map((r) => [r.id, r])) });
const opts = (over: object = {}) => ({ model: 'claude-haiku-5-5', reps: 2, yes: true, dir, data: data(), questions: QUESTIONS, template: 'Answer from the data.', ...over });

test('asks each question independently reps times, Q1 with the category/month schema, context cached', async () => {
  const f = fakeCall();
  const file = (await runAnswer(opts(), { call: f.call, confirm: async () => true, judge: async () => [] }))!;
  expect(f.calls.map((c) => c.user)).toEqual(['q1?', 'q1?', 'q2?', 'q2?', 'q3?', 'q3?'].map((q) => expect.stringContaining(q)));
  expect(f.calls.filter((c) => c.schemaHasCategory)).toHaveLength(2);
  expect(f.calls.every((c) => c.cached)).toBe(true);
  expect(file.outputs).toHaveLength(6);
  expect(file.kind).toBe('answer');
});

test('declining the projection spends nothing', async () => {
  const f = fakeCall();
  expect(await runAnswer(opts({ yes: false }), { call: f.call, confirm: async () => false, judge: async () => [] })).toBeNull();
  expect(f.calls).toHaveLength(0);
});

test('refuses to run when the data no longer gives the Q1 key', async () => {
  const f = fakeCall();
  const d = evalFixture(30);
  await expect(runAnswer(opts({ data: d }), { call: f.call, confirm: async () => true, judge: async () => [] })).rejects.toThrow(/Q1 key/);
  expect(f.calls).toHaveLength(0);
});

test('an error is recorded per call and the run completes', async () => {
  const f = fakeCall((q) => q.includes('q2?'));
  const file = (await runAnswer(opts({ reps: 1 }), { call: f.call, confirm: async () => true, judge: async () => [] }))!;
  expect(file.outputs.find((o) => o.questionId === 'Q2')).toMatchObject({ error: 'boom' });
  expect(file.outputs.filter((o) => !o.error)).toHaveLength(2);
});
