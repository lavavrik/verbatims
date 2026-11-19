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

  function topicQueue(): string[] {
    const byLang = new Map<string, LabelItem[]>();
    for (const it of items) byLang.set(it.language, [...(byLang.get(it.language) ?? []), it]);
    const base = [...byLang.values()].flatMap((group) => {
      const quota = Math.min(group.length, Math.max(5, Math.round((TOPIC_TARGET * group.length) / items.length)));
      return spread(group, quota).map((it) => it.id);
    });
    const extra = [...(opts.redated ?? []), ...complaints.confirmed.filter((id) => !(opts.redated ?? []).includes(id)).slice(0, 10)];
    return [...new Set([...base, ...extra])];
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
