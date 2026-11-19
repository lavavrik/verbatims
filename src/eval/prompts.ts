import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { PublishedReview } from '../pipeline/build';
import type { Topic } from './data';

export type ClassifyVersion = 'v1' | 'v2' | 'v3';
export const CLASSIFY_VERSIONS: ClassifyVersion[] = ['v1', 'v2', 'v3'];

export const loadPromptTemplate = (name: string, dir = '.') => readFile(join(dir, 'prompts', `${name}.md`), 'utf8');

/**
 * Per-version topic descriptions in prompts/topics-<version>.json ({ name: description }),
 * so a prompt version can redefine topics without changing the published dataset.
 */
export async function loadTopicOverrides(version: ClassifyVersion, dir = '.'): Promise<Record<string, string>> {
  try { return JSON.parse(await readFile(join(dir, 'prompts', `topics-${version}.json`), 'utf8')); } catch { return {}; }
}

export function applyTopicOverrides(topics: Topic[], overrides: Record<string, string>): Topic[] {
  const unknown = Object.keys(overrides).filter((n) => !topics.some((t) => t.name === n));
  if (unknown.length) throw new Error(`Topic overrides name topics that don't exist: ${unknown.join(', ')}`);
  return topics.map((t) => ({ ...t, description: overrides[t.name] ?? t.description }));
}

/** v1: topic names only. v2 and later: names with their one-line descriptions. */
export function renderClassifyPrompt(version: ClassifyVersion, topics: Topic[], template: string): string {
  const list = topics.map((t) => (version === 'v1' ? `- ${t.name}` : `- ${t.name}: ${t.description}`)).join('\n');
  return template.replace('{{topics}}', list);
}

export const TopicsSchema = (names: string[]) => z.object({ topics: z.array(z.enum(names as [string, ...string[]])) });

export const normaliseTopics = (topics: string[]) => [...new Set(topics)].sort();

/** The review as the classifier sees it: language and published (redacted) text, nothing else. */
export const classifyUserMessage = (r: PublishedReview) => `Language: ${r.language}\n\n${r.text}`;

export const promptHash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);
