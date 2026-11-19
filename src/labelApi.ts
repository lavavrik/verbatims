import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { looksLikeCleanlinessComplaint } from './complaints';
import type { RatingCheck } from './pipeline/rate';
import { spread } from './pipeline/sample';
import type { Ratings } from './types';

export type LabelItem = { id: string; language: string; date: string; text: string; ratings?: Ratings };
export type Mode = 'topics' | 'ratings' | 'complaints';
export type TopicLabel = { topics: string[]; viaTranslation: boolean; labelledAt: string };
export type Complaints = { confirmed: string[]; rejected: string[] };

/** Languages the owner reads; everything else gets a machine translation as an aid. */
export const OWNER_READS = ['eng', 'ces', 'slk', 'ukr', 'rus'];
export const TOPIC_TARGET = 100;
export const RATING_CHECKS = 30;
export const MAJOR_LANGUAGE = 10;

async function readOr<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw e; }
}

/** Write to a temp file, then rename, so a crash never leaves half a JSON file. */
async function writeAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n');
  await rename(tmp, path);
}

export async function createLabelStore(opts: {
  dir: string;
  items: LabelItem[];
  translate: (text: string) => Promise<string>;
  redated?: string[];
}) {
  const paths = {
    topics: join(opts.dir, 'labels/topics.json'),
    ratings: join(opts.dir, 'labels/rating-checks.json'),
    complaints: join(opts.dir, 'decisions/complaints.json'),
    translations: join(opts.dir, 'cache/translations.json'),
  };
  const topics = await readOr<Record<string, TopicLabel>>(paths.topics, {});
  const checks = await readOr<RatingCheck[]>(paths.ratings, []);
  const complaints = await readOr<Complaints>(paths.complaints, { confirmed: [], rejected: [] });
  const translations = await readOr<Record<string, string>>(paths.translations, {});
  const items = [...opts.items].sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(items.map((it) => [it.id, it]));

  /**
   * About TOPIC_TARGET reviews in total, the extras included: every re-dated review, 10 more
   * confirmed complaints, and a language-stratified share for the rest. Languages with at
   * least MAJOR_LANGUAGE reviews get at least 5; smaller ones get their proportional share.
   */
  function topicQueue(): string[] {
    const redated = opts.redated ?? [];
    const extra = [...redated, ...complaints.confirmed.filter((id) => !redated.includes(id)).slice(0, 10)];
    const budget = Math.max(0, TOPIC_TARGET - extra.length);
    const pool = items.filter((it) => !extra.includes(it.id));
    const groups = [...pool.reduce((m, it) => m.set(it.language, [...(m.get(it.language) ?? []), it]), new Map<string, LabelItem[]>()).values()];
    const exact = groups.map((g) => (budget * g.length) / Math.max(1, pool.length));
    const quota = groups.map((g, i) => Math.min(g.length, g.length >= MAJOR_LANGUAGE ? Math.max(5, Math.floor(exact[i])) : Math.floor(exact[i])));
    // Hand out what rounding left over by largest remainder, so the total lands on the budget.
    let left = budget - quota.reduce((a, b) => a + b, 0);
    for (const i of exact.map((e, i) => i).sort((a, b) => (exact[b] % 1) - (exact[a] % 1) || a - b)) {
      if (left <= 0) break;
      if (quota[i] < groups[i].length) { quota[i]++; left--; }
    }
    const base = groups.flatMap((g, i) => spread(g, quota[i]).map((it) => it.id));
    return [...new Set([...extra, ...base])];
  }

  function queue(mode: Mode): string[] {
    if (mode === 'complaints') return items.filter((it) => looksLikeCleanlinessComplaint(it.text)).map((it) => it.id);
    if (mode === 'ratings') return spread(items.filter((it) => it.ratings), RATING_CHECKS).map((it) => it.id);
    return topicQueue();
  }

  const isDone: Record<Mode, (id: string) => boolean> = {
    topics: (id) => id in topics,
    ratings: (id) => checks.some((c) => c.id === id),
    complaints: (id) => complaints.confirmed.includes(id) || complaints.rejected.includes(id),
  };

  function nextItem(mode: Mode): { item: LabelItem | null; done: number; total: number } {
    const ids = queue(mode);
    const next = ids.find((id) => !isDone[mode](id));
    return { item: next ? byId.get(next)! : null, done: ids.filter(isDone[mode]).length, total: ids.length };
  }

  async function saveLabel(mode: Mode, body: { id: string } & Record<string, unknown>): Promise<void> {
    const item = byId.get(body.id);
    if (!item) throw new Error(`Unknown review ${body.id}`);
    if (mode === 'topics') {
      topics[body.id] = { topics: body.topics as string[], viaTranslation: Boolean(body.viaTranslation), labelledAt: new Date().toISOString() };
      await writeAtomic(paths.topics, topics);
    } else if (mode === 'ratings') {
      if (!item.ratings) throw new Error(`${body.id} has no generated ratings yet`);
      const rest = checks.filter((c) => c.id !== body.id);
      checks.splice(0, checks.length, ...rest, { id: body.id, original: item.ratings, corrected: (body.corrected ?? {}) as Partial<Ratings> });
      await writeAtomic(paths.ratings, checks);
    } else {
      complaints.confirmed = complaints.confirmed.filter((id) => id !== body.id);
      complaints.rejected = complaints.rejected.filter((id) => id !== body.id);
      (body.confirmed ? complaints.confirmed : complaints.rejected).push(body.id);
      await writeAtomic(paths.complaints, complaints);
    }
  }

  async function translate(id: string): Promise<string> {
    const item = byId.get(id);
    if (!item) throw new Error(`Unknown review ${id}`);
    if (OWNER_READS.includes(item.language)) throw new Error(`The owner reads ${item.language}; no translation needed`);
    if (!translations[id]) {
      translations[id] = await opts.translate(item.text);
      await writeAtomic(paths.translations, translations);
    }
    return translations[id];
  }

  return { queue, nextItem, saveLabel, translate };
}
