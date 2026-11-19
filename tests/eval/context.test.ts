import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { assertQ1Key, largestDrop, monthlyTable, overallAverages, renderContext } from '../../src/eval/context';
import type { PublishedReview } from '../../src/pipeline/build';
import { evalFixture } from './fixtures';

const real: PublishedReview[] = readFileSync('data/reviews.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('on the real dataset the largest drop is cleanliness in June 2026, by more than a star', () => {
  const drop = largestDrop(monthlyTable(real), overallAverages(real));
  expect(drop).toMatchObject({ category: 'cleanliness', month: '2026-06' });
  expect(drop.gap).toBeGreaterThan(1);
  expect(() => assertQ1Key(real)).not.toThrow();
});

test('a month with 7 reviews is not eligible, one with 8 is', () => {
  const rs = evalFixture(0).reviews;
  const mk = (month: string, n: number) => Array.from({ length: n }, (_, i) => ({ ...evalFixture(1).reviews[0], id: `${month}-${i}`, date: `${month}-0${(i % 9) + 1}` }));
  const t = monthlyTable([...rs, ...mk('2024-01', 7), ...mk('2024-02', 8)]);
  expect(t.find((m) => m.month === '2024-01')!.eligible).toBe(false);
  expect(t.find((m) => m.month === '2024-02')!.eligible).toBe(true);
});

test('assertQ1Key throws, naming the computed answer, when another month wins', () => {
  const base = evalFixture(1).reviews[0];
  const rs = Array.from({ length: 24 }, (_, i) => ({
    ...base, id: `x${i}`, date: i < 8 ? '2025-03-05' : i < 16 ? '2025-04-05' : '2025-05-05',
    ratings: { ...base.ratings, value: i < 8 ? 1 : 5 },
  }));
  expect(() => assertQ1Key(rs)).toThrow(/value.*2025-03/);
});

test('renderContext has one line per review in a fixed format, then the monthly table', () => {
  const rs = evalFixture(3).reviews;
  const ctx = renderContext(rs, monthlyTable(rs));
  const r = rs[0];
  expect(ctx).toContain(`${r.id} | ${r.date} | ${r.language} | 5 5 5 5 5 5 5 | ${r.text}`);
  expect(ctx.indexOf('Monthly averages')).toBeGreaterThan(ctx.indexOf(rs[2].id));
  expect(ctx).toMatch(/too few reviews/);
});
