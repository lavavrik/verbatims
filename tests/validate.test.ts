import { expect, test } from 'vitest';
import { buildDataset } from '../src/pipeline/build';
import { allowEntry, forbiddenNameTokens, validate } from '../src/validate';
import { decisionsFixture, rawFixture } from './helpers';

const built = () => buildDataset(rawFixture(), decisionsFixture());

test('a clean build has no problems', () => {
  const { reviews, manifest } = built();
  expect(validate(reviews, manifest, ['Olena', 'Олена', 'Tom', 'Eva', 'Petr'], [])).toEqual([]);
});

test('validate flags a leftover reviewer name even in Cyrillic, without printing the name', () => {
  const { reviews, manifest } = built();
  reviews[0].text = 'Дякуємо, Олена!';
  const problems = validate(reviews, manifest, ['Олена'], []);
  expect(problems).toContainEqual(expect.stringContaining('r0001'));
  expect(problems.join(' ')).not.toContain('Олена');
});

test('an allowed mention (owner confirmed it is not a name) is skipped', () => {
  const { reviews, manifest } = built();
  reviews[1].text = 'We will come back. Will recommend!';
  const problems = validate(reviews, manifest, ['Will'], [allowEntry(reviews[1].id, 'will')]);
  expect(problems).toEqual([]);
});

test('validate flags a date after the scrape date and a bad rating', () => {
  const { reviews, manifest } = built();
  reviews[0].date = '2026-10-01';
  reviews[1].ratings.value = 7;
  const problems = validate(reviews, manifest, [], []);
  expect(problems.some((p) => p.includes(reviews[0].id) && /scrape/.test(p))).toBe(true);
  expect(problems.some((p) => p.includes(reviews[1].id) && /value/.test(p))).toBe(true);
});

test('forbiddenNameTokens splits combined host names into words', () => {
  expect(forbiddenNameTokens(['Petr & Jana', 'Olena', 'J.'])).toEqual(['Petr', 'Jana', 'Olena']);
});
