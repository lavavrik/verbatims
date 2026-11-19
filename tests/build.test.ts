import { expect, test } from 'vitest';
import { buildDataset } from '../src/pipeline/build';
import { decisionsFixture, rawFixture } from './helpers';

test('build is deterministic and sorted by the new date', () => {
  const a = buildDataset(rawFixture(), decisionsFixture());
  const b = buildDataset(rawFixture(), decisionsFixture());
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  expect(a.reviews.map((r) => r.id)).toEqual(['r0001', 'r0003', 'r0002']);
});

test('published reviews carry redacted text, merged ratings and no reviewer fields', () => {
  const { reviews } = buildDataset(rawFixture(), decisionsFixture());
  const r1 = reviews.find((r) => r.id === 'r0001')!;
  expect(r1.text).toBe('Дякуємо, [name]! Чисто і тепло.');
  expect(Object.keys(r1).sort()).toEqual(['date', 'id', 'language', 'ratings', 'ratings_source', 'text']);
  const r2 = reviews.find((r) => r.id === 'r0002')!;
  expect(r2.ratings.location).toBe(4);
  expect(r2.ratings_source.location).toBe('owner');
  expect(r2.ratings_source.overall).toBe('generated');
  expect(JSON.stringify(reviews)).not.toMatch(/Olena|Petr|901|902/);
});

test('re-dated reviews carry new dates and the manifest keeps the originals', () => {
  const { reviews, manifest } = buildDataset(rawFixture(), decisionsFixture());
  expect(reviews.find((r) => r.id === 'r0002')!.date).toBe('2023-06-01');
  expect(manifest.redate!.moves).toEqual([{ id: 'r0002', from: '2023-02-14', to: '2023-06-01' }]);
  expect(manifest.idMap).toEqual({ r0001: '11', r0002: '12', r0003: '13' });
  expect(manifest.listing).toMatchObject({ id: 'L1' });
  expect(manifest.ratingChecks).toEqual({ checked: 1, accepted: 0 });
  expect(manifest.ratingsComparison.generatedAvg.overall).toBeCloseTo(4, 5);
});

test('build throws when a review has no ratings', () => {
  const d = decisionsFixture();
  delete d.ratings.results.r0003;
  expect(() => buildDataset(rawFixture(), d)).toThrow(/r0003/);
});
