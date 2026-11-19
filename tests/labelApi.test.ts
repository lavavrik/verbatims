import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';
import { createLabelStore, type LabelItem } from '../src/labelApi';
import type { Ratings } from '../src/types';

const r4: Ratings = { overall: 4, cleanliness: 4, accuracy: 4, checkin: 4, communication: 4, location: 4, value: 4 };
const LANGS = ['eng', 'eng', 'eng', 'eng', 'eng', 'eng', 'ces', 'deu', 'ukr', 'rus'];

function items(n = 300): LabelItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${String(i + 1).padStart(4, '0')}`,
    language: LANGS[i % LANGS.length],
    date: '2024-01-01',
    text: i % 9 === 0 ? 'The bathroom was dirty' : 'Lovely stay, great location',
    ratings: r4,
  }));
}

let dir: string;
const translations: string[] = [];
const make = (extra: Partial<Parameters<typeof createLabelStore>[0]> = {}) =>
  createLabelStore({ dir, items: items(), translate: async (t) => { translations.push(t); return `EN: ${t}`; }, ...extra });

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'verbatims-')); translations.length = 0; });

test('topics queue covers every language with at least 5 reviews', async () => {
  const store = await make();
  const ids = store.queue('topics');
  expect(ids.length).toBeGreaterThanOrEqual(95);
  expect(ids.length).toBeLessThanOrEqual(105);
  const byLang: Record<string, number> = {};
  for (const id of ids) { const l = items().find((it) => it.id === id)!.language; byLang[l] = (byLang[l] ?? 0) + 1; }
  for (const l of ['eng', 'ces', 'deu', 'ukr', 'rus']) expect(byLang[l]).toBeGreaterThanOrEqual(5);
});

test('nextItem skips labelled reviews and saveLabel round-trips to disk', async () => {
  const store = await make();
  const first = store.nextItem('topics');
  await store.saveLabel('topics', { id: first.item!.id, topics: ['cleanliness'], viaTranslation: false });
  const second = store.nextItem('topics');
  expect(second.item!.id).not.toBe(first.item!.id);
  expect(second.done).toBe(1);
  const saved = JSON.parse(await readFile(join(dir, 'labels/topics.json'), 'utf8'));
  expect(saved[first.item!.id]).toMatchObject({ topics: ['cleanliness'], viaTranslation: false });
  // A fresh store reads the same file back.
  expect((await make()).nextItem('topics').done).toBe(1);
});

test('complaints queue holds keyword hits and answers land in decisions/complaints.json', async () => {
  const store = await make();
  const ids = store.queue('complaints');
  expect(ids.length).toBe(Math.ceil(300 / 9));
  await store.saveLabel('complaints', { id: ids[0], confirmed: true });
  await store.saveLabel('complaints', { id: ids[1], confirmed: false });
  const saved = JSON.parse(await readFile(join(dir, 'decisions/complaints.json'), 'utf8'));
  expect(saved).toEqual({ confirmed: [ids[0]], rejected: [ids[1]] });
});

test('ratings queue has 30 reviews and stores the original next to the correction', async () => {
  const store = await make();
  const ids = store.queue('ratings');
  expect(ids).toHaveLength(30);
  await store.saveLabel('ratings', { id: ids[0], corrected: { cleanliness: 2 } });
  const saved = JSON.parse(await readFile(join(dir, 'labels/rating-checks.json'), 'utf8'));
  expect(saved).toEqual([{ id: ids[0], original: r4, corrected: { cleanliness: 2 } }]);
});

test('topics queue adds re-dated reviews and 10 more confirmed complaints', async () => {
  const store = await make({ redated: ['r0002', 'r0003'] });
  const complaints = store.queue('complaints');
  for (const id of complaints.slice(0, 12)) await store.saveLabel('complaints', { id, confirmed: true });
  const topics = store.queue('topics');
  expect(topics).toEqual(expect.arrayContaining(['r0002', 'r0003']));
  expect(complaints.slice(0, 12).filter((id) => topics.includes(id)).length).toBeGreaterThanOrEqual(10);
});

test('translation is refused for languages the owner reads and cached for others', async () => {
  const store = await make();
  const czech = items().find((it) => it.language === 'ces')!;
  const german = items().find((it) => it.language === 'deu')!;
  await expect(store.translate(czech.id)).rejects.toThrow(/reads/);
  expect(await store.translate(german.id)).toBe(`EN: ${german.text}`);
  expect(await (await make()).translate(german.id)).toBe(`EN: ${german.text}`);
  expect(translations).toHaveLength(1);
});

test('topics queue stays near 100 with a long tail of languages, extras included', async () => {
  // 300 English, 40 French, 12 German, then 20 languages with 2 reviews each.
  const tail = Array.from({ length: 20 }, (_, i) => `x${String.fromCharCode(97 + i)}x`);
  const langs = [...Array(300).fill('eng'), ...Array(40).fill('fra'), ...Array(12).fill('deu'), ...tail.flatMap((l) => [l, l])];
  const many: LabelItem[] = langs.map((language, i) => ({ id: `r${String(i + 1).padStart(4, '0')}`, language, date: '2024-01-01', text: i % 9 === 0 ? 'The bathroom was dirty' : 'Lovely stay', ratings: r4 }));
  const redated = many.slice(0, 15).map((it) => it.id);
  const store = await createLabelStore({ dir, items: many, translate: async (t) => t, redated });
  const ids = store.queue('topics');
  expect(ids.length).toBeGreaterThanOrEqual(95);
  expect(ids.length).toBeLessThanOrEqual(105);
  expect(ids).toEqual(expect.arrayContaining(redated));
  const count = (l: string) => ids.filter((id) => many.find((it) => it.id === id)!.language === l).length;
  expect(count('deu')).toBeGreaterThanOrEqual(5); // ≥10 reviews → at least 5
  for (const l of tail) expect(count(l)).toBeLessThanOrEqual(1); // tiny languages: proportional share only
});
