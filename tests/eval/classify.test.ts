import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';
import { runClassify } from '../../src/eval/classify';
import { classifyUserMessage, normaliseTopics, renderClassifyPrompt, TopicsSchema } from '../../src/eval/prompts';
import { evalFixture, TOPICS } from './fixtures';

const TEMPLATE = 'Classify the review.\n\n{{topics}}';
let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'eval-')); });

function fakeCall(fail?: (msg: string) => boolean) {
  const calls: string[] = [];
  const call = async (_o: unknown, _s: unknown, _sys: string, user: string) => {
    calls.push(user);
    if (fail?.(user)) throw new Error('Model refused: cyber');
    return { value: { topics: ['noise', 'location', 'location'] } as never, usage: { input: 100, output: 10 } };
  };
  return { call: call as never, calls };
}
const d = evalFixture(40);
const split = { sampled: { test: ['r0001', 'r0004'], dev: ['r0006'] }, added: ['r0002', 'r0003'] };
const base = (over: object = {}) => ({ model: 'claude-haiku-5-5', version: 'v2' as const, reps: 3, yes: true, dir, data: d, split, template: TEMPLATE, ...over });

test('v1 prompt lists names only; v2 adds every description', () => {
  const v1 = renderClassifyPrompt('v1', TOPICS, TEMPLATE), v2 = renderClassifyPrompt('v2', TOPICS, TEMPLATE);
  for (const t of TOPICS) { expect(v1).toContain(t.name); expect(v2).toContain(t.description); expect(v1).not.toContain(t.description); }
  expect(v1).not.toContain('{{topics}}');
});

test('duplicate and differently ordered topics normalise to one sorted set', () => {
  expect(normaliseTopics(['noise', 'location', 'noise'])).toEqual(['location', 'noise']);
});

test('schema rejects a topic outside the list and accepts an empty set', () => {
  const s = TopicsSchema(TOPICS.map((t) => t.name));
  expect(s.safeParse({ topics: ['wifi'] }).success).toBe(false);
  expect(s.safeParse({ topics: [] }).success).toBe(true);
});

test('the user message carries language and text only', () => {
  const r = d.reviews[0];
  const m = classifyUserMessage(r);
  expect(m).toBe(`Language: ${r.language}\n\n${r.text}`);
  expect(m).not.toContain(r.date);
});

test('rep 1 covers all reviews, later reps only the labelled ones', async () => {
  const f = fakeCall();
  const file = (await runClassify(base(), { call: f.call, confirm: async () => true }))!;
  expect(f.calls).toHaveLength(40 + 2 * 30);
  expect(file.outputs.filter((o) => o.rep === 1)).toHaveLength(40);
  expect(file.outputs[0].topics).toEqual(['location', 'noise']);
  expect(file.metrics.consistency.n).toBe(30);
  expect(file.usage.estCostUsd).toBeGreaterThan(0);
});

test('an error on one call is recorded and the run completes', async () => {
  const f = fakeCall((m) => m.includes('Review 7 text'));
  const file = (await runClassify(base({ reps: 1 }), { call: f.call, confirm: async () => true }))!;
  expect(file.outputs.find((o) => o.id === 'r0007')).toMatchObject({ error: 'Model refused: cyber' });
  expect(file.outputs).toHaveLength(40);
});

test('resuming reuses cached calls, but never across a different prompt', async () => {
  const f1 = fakeCall();
  await runClassify(base({ reps: 1 }), { call: f1.call, confirm: async () => true });
  const f2 = fakeCall();
  await runClassify(base({ reps: 1 }), { call: f2.call, confirm: async () => true });
  expect(f2.calls).toHaveLength(0);
  const f3 = fakeCall();
  await runClassify(base({ reps: 1, template: TEMPLATE + '\nBe strict.' }), { call: f3.call, confirm: async () => true });
  expect(f3.calls).toHaveLength(40);
});

test('declining the projection writes no result file', async () => {
  const f = fakeCall();
  const file = await runClassify(base({ yes: false }), { call: f.call, confirm: async () => false });
  expect(file).toBeNull();
  expect(f.calls).toHaveLength(10);
  expect(await readdir(dir)).not.toContain('results');
});
