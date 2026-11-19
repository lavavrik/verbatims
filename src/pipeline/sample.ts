import { createHash } from 'node:crypto';
import { detectLanguage } from '../lang';
import type { SourceReview } from '../types';

export type SampledReview = SourceReview & { language: string };
export type SampleDecision = { listingId: string; items: { id: string; sourceId: string; language: string; textHash: string }[] };

/** Short sha256 of a review's normalised text; binds every decision to the exact text it was made on. */
export const textHash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

export const SAMPLE_RANGE = { min: 300, max: 500 };

export function isUsableReview(text: string): boolean {
  return text.length >= 20 && !text.includes('This is an automated posting');
}

const byDate = (a: SourceReview, b: SourceReview) => a.date.localeCompare(b.date) || a.sourceId.localeCompare(b.sourceId, 'en', { numeric: true });
const quarter = (date: string) => `${date.slice(0, 4)}Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;

/** Picks `want` items spread evenly through an already date-sorted list. */
export function spread<T>(items: T[], want: number): T[] {
  if (want >= items.length) return items;
  return Array.from({ length: want }, (_, i) => items[Math.floor(((i + 0.5) * items.length) / want)]);
}

/**
 * All usable reviews when there are 300–500 of them. With more, a sample of 500
 * stratified by (quarter × language): every stratum gets at least one review, the rest
 * is shared out in proportion (largest remainder), and each stratum is picked evenly by date.
 */
export function selectSample(reviews: SourceReview[], detectLang: (t: string) => string = detectLanguage, range = SAMPLE_RANGE): SampledReview[] {
  const usable = reviews.filter((r) => isUsableReview(r.text)).sort(byDate).map((r) => ({ ...r, language: detectLang(r.text) }));
  if (usable.length < range.min) throw new Error(`Only ${usable.length} usable reviews; need at least ${range.min}.`);
  if (usable.length <= range.max) return usable;

  const strata = new Map<string, SampledReview[]>();
  for (const r of usable) {
    const key = `${quarter(r.date)}|${r.language}`;
    strata.set(key, [...(strata.get(key) ?? []), r]);
  }
  if (strata.size > range.max) throw new Error(`Too many strata (${strata.size}) for a sample of ${range.max}.`);

  const groups = [...strata.values()];
  const alloc = groups.map(() => 1);
  const remaining = range.max - groups.length;
  const spare = groups.map((g) => g.length - 1);
  const totalSpare = spare.reduce((a, b) => a + b, 0);
  const shares = spare.map((s) => (s * remaining) / totalSpare);
  shares.forEach((s, i) => (alloc[i] += Math.floor(s)));
  let left = range.max - alloc.reduce((a, b) => a + b, 0);
  const order = shares.map((s, i) => [s - Math.floor(s), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left === 0) break;
    if (alloc[i] < groups[i].length) { alloc[i]++; left--; }
  }
  return groups.flatMap((g, i) => spread(g, alloc[i])).sort(byDate);
}

/** Stable published ids r0001… in original-date order. */
export function toSampleDecision(listingId: string, sample: SampledReview[]): SampleDecision {
  return {
    listingId,
    items: [...sample].sort(byDate).map((r, i) => ({ id: `r${String(i + 1).padStart(4, '0')}`, sourceId: r.sourceId, language: r.language, textHash: textHash(r.text) })),
  };
}
