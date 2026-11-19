import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { PublishedReview } from '../pipeline/build';
import type { Topic } from './data';

export type ClassifyVersion = 'v1' | 'v2';

export const loadPromptTemplate = (name: string, dir = '.') => readFile(join(dir, 'prompts', `${name}.md`), 'utf8');

/** v1: topic names only. v2: names with their one-line descriptions. */
export function renderClassifyPrompt(version: ClassifyVersion, topics: Topic[], template: string): string {
  const list = topics.map((t) => (version === 'v1' ? `- ${t.name}` : `- ${t.name}: ${t.description}`)).join('\n');
  return template.replace('{{topics}}', list);
}

export const TopicsSchema = (names: string[]) => z.object({ topics: z.array(z.enum(names as [string, ...string[]])) });

export const normaliseTopics = (topics: string[]) => [...new Set(topics)].sort();

/** The review as the classifier sees it: language and published (redacted) text, nothing else. */
export const classifyUserMessage = (r: PublishedReview) => `Language: ${r.language}\n\n${r.text}`;

export const promptHash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);
