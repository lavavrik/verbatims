import type { PublishedReview } from '../pipeline/build';
import { RATING_KEYS, type RatingKey, type Ratings } from '../types';

export const MIN_MONTH_REVIEWS = 8;
export const Q1_KEY = { category: 'cleanliness' as RatingKey, month: '2026-06' };

export type MonthRow = { month: string; n: number; avg: Ratings; eligible: boolean };

const mean = (rs: PublishedReview[]) =>
  Object.fromEntries(RATING_KEYS.map((k) => [k, rs.reduce((s, r) => s + r.ratings[k], 0) / rs.length])) as Ratings;

export const overallAverages = (reviews: PublishedReview[]) => mean(reviews);

/** Per-month averages, computed by code (the system supplies the numbers, the model explains them). */
export function monthlyTable(reviews: PublishedReview[]): MonthRow[] {
  const by = new Map<string, PublishedReview[]>();
  for (const r of reviews) by.set(r.date.slice(0, 7), [...(by.get(r.date.slice(0, 7)) ?? []), r]);
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, rs]) => ({ month, n: rs.length, avg: mean(rs), eligible: rs.length >= MIN_MONTH_REVIEWS }));
}

/** Among eligible months: the category and month whose average is furthest below that category's overall average. */
export function largestDrop(table: MonthRow[], overall: Ratings): { category: RatingKey; month: string; gap: number } {
  let best = { category: RATING_KEYS[0], month: '', gap: -Infinity };
  for (const row of table.filter((m) => m.eligible)) {
    for (const k of RATING_KEYS) {
      const gap = overall[k] - row.avg[k];
      if (gap > best.gap) best = { category: k, month: row.month, gap };
    }
  }
  if (!best.month) throw new Error(`No month has at least ${MIN_MONTH_REVIEWS} reviews`);
  return best;
}

/** Refuses to ask Q1 when the data no longer gives the answer the key says. */
export function assertQ1Key(reviews: PublishedReview[], key = Q1_KEY): void {
  let got: ReturnType<typeof largestDrop>;
  try { got = largestDrop(monthlyTable(reviews), overallAverages(reviews)); } catch (e) { throw new Error(`Q1 key can't be checked: ${(e as Error).message}`); }
  if (got.category !== key.category || got.month !== key.month) {
    throw new Error(`Q1 key is ${key.category} ${key.month}, but the data gives ${got.category} ${got.month} (${got.gap.toFixed(2)} below average). Fix the key before running.`);
  }
}

const fmt = (x: number) => x.toFixed(2);

/** All reviews, one per line, then the monthly table. Published fields only. */
export function renderContext(reviews: PublishedReview[], table: MonthRow[]): string {
  const lines = reviews.map((r) => `${r.id} | ${r.date} | ${r.language} | ${RATING_KEYS.map((k) => r.ratings[k]).join(' ')} | ${r.text.replace(/\s*\n\s*/g, ' ')}`);
  const overall = overallAverages(reviews);
  const rows = table.map((m) => `${m.month} | ${m.n} | ${m.eligible ? RATING_KEYS.map((k) => fmt(m.avg[k])).join(' ') : 'too few reviews'}`);
  return [
    `Reviews (${reviews.length}). Columns: id | date | language | ratings ${RATING_KEYS.join(' ')} (1–5) | text`,
    ...lines,
    '',
    `Monthly averages (months with fewer than ${MIN_MONTH_REVIEWS} reviews are marked "too few reviews"). Columns: month | reviews | ${RATING_KEYS.join(' ')}`,
    `all | ${reviews.length} | ${RATING_KEYS.map((k) => fmt(overall[k])).join(' ')}`,
    ...rows,
  ].join('\n');
}
