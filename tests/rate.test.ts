import { expect, test } from 'vitest';
import { mergeRatings, RatingsSchema } from '../src/pipeline/rate';
import type { Ratings } from '../src/types';

const r = (v: number): Ratings => ({ overall: v, cleanliness: v, accuracy: v, checkin: v, communication: v, location: v, value: v });

test('RatingsSchema accepts whole stars 1–5 only', () => {
  expect(RatingsSchema.safeParse(r(3)).success).toBe(true);
  for (const bad of [0, 6, 3.5]) expect(RatingsSchema.safeParse(r(bad)).success).toBe(false);
  expect(RatingsSchema.safeParse({ overall: 4 }).success).toBe(false);
});

test('mergeRatings overwrites only corrected fields and marks them as the owner\'s', () => {
  const merged = mergeRatings({ r0001: r(4), r0002: r(5) }, [{ id: 'r0001', original: r(4), corrected: { cleanliness: 2 } }]);
  expect(merged.r0001.ratings).toEqual({ ...r(4), cleanliness: 2 });
  expect(merged.r0001.source.cleanliness).toBe('owner');
  expect(merged.r0001.source.overall).toBe('generated');
  expect(Object.values(merged.r0002.source).every((s) => s === 'generated')).toBe(true);
});

test('mergeRatings rejects a correction for a review that has no generated ratings', () => {
  expect(() => mergeRatings({}, [{ id: 'r0009', original: r(4), corrected: { value: 1 } }])).toThrow(/r0009/);
});
