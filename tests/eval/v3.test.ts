import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { runClassify } from '../../src/eval/classify';
import { applyTopicOverrides, loadTopicOverrides, renderClassifyPrompt } from '../../src/eval/prompts';
import { evalFixture, TOPICS } from './fixtures';

test('topic overrides replace descriptions by name and keep everything else', () => {
  const out = applyTopicOverrides(TOPICS, { location: 'Only the neighbourhood.' });
  expect(out.find((t) => t.name === 'location')!.description).toBe('Only the neighbourhood.');
  expect(out.find((t) => t.name === 'noise')!.description).toBe(TOPICS.find((t) => t.name === 'noise')!.description);
  expect(out.map((t) => t.name)).toEqual(TOPICS.map((t) => t.name));
});

test('an override for a topic that does not exist is refused', () => {
  expect(() => applyTopicOverrides(TOPICS, { wifi: 'x' })).toThrow(/wifi/);
});

test('v3 renders descriptions like v2', () => {
  expect(renderClassifyPrompt('v3', TOPICS, '{{topics}}')).toContain(TOPICS[0].description);
});

test('a classify run uses prompts/topics-<version>.json when it exists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'v3-'));
  await mkdir(join(dir, 'prompts'), { recursive: true });
  await writeFile(join(dir, 'prompts/topics-v3.json'), JSON.stringify({ noise: 'Only sound that kept guests awake.' }));
  expect(await loadTopicOverrides('v2', dir)).toEqual({});
  const call = (async () => ({ value: { topics: [] }, usage: { input: 1, output: 1 } })) as never;
  const file = (await runClassify({ model: 'claude-haiku-5-5', version: 'v3', reps: 1, yes: true, dir, data: evalFixture(12), split: { sampled: { test: [], dev: [] }, added: [] }, template: '{{topics}}' }, { call, confirm: async () => true }))!;
  expect(file.prompt).toContain('Only sound that kept guests awake.');
  expect(file.promptVersion).toBe('v3');
});
