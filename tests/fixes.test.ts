import { expect, test } from 'vitest';
import { buildDataset } from '../src/pipeline/build';
import { combineRedactions, findOccurrences } from '../src/pipeline/redact';
import { textHash } from '../src/pipeline/sample';
import { checkRawHashes } from '../src/pipeline/download';
import { normaliseText } from '../src/raw';
import { allowEntry, forbiddenNameTokens, validate } from '../src/validate';
import { decisionsFixture, rawFixture } from './helpers';

// C1: rerunning detect-names must keep manual adds and keep removed spans removed.
test('combineRedactions keeps manual additions and honours removals', () => {
  const auto = [{ id: 'r1', start: 0, length: 4 }, { id: 'r1', start: 10, length: 3 }];
  const existing = [{ id: 'r1', start: 0, length: 4 }, { id: 'r2', start: 5, length: 5 }]; // r2 added by hand
  const removed = [{ id: 'r1', start: 10 }];
  expect(combineRedactions(auto, existing, removed)).toEqual([{ id: 'r1', start: 0, length: 4 }, { id: 'r2', start: 5, length: 5 }]);
});

// I1: decisions must be bound to the exact text they were made on.
test('build refuses when a review text no longer matches the hash in sample.json', () => {
  const raw = rawFixture();
  raw.reviews[0].text = raw.reviews[0].text.replace('Дякуємо', 'Дуже дякуємо');
  expect(() => buildDataset(raw, decisionsFixture())).toThrow(/r0001.*changed/);
});

test('build refuses a redaction that cuts through a word', () => {
  const d = decisionsFixture();
  d.redactions = [{ id: 'r0003', start: 1, length: 3 }];
  expect(() => buildDataset(rawFixture(), d)).toThrow(/r0003.*word/);
});

// I2: short, CJK, Indic and decomposed names must be caught.
test('normaliseText applies NFC, decodes every HTML entity and survives a bad code point', () => {
  expect(normaliseText('Zoë')).toBe('Zoë');
  expect(normaliseText('Caf&eacute; &hellip;')).toBe('Café …');
  expect(normaliseText('ok &#99999999; ok')).toBe('ok � ok');
});

test('forbiddenNameTokens keeps 2-letter, CJK and Indic names and drops filler words', () => {
  expect(forbiddenNameTokens(['Ян', 'Li', 'Jo & Li', '李伟', 'प्रिया', 'Petr And Jana', 'Prague Central Apartments'])).toEqual(
    ['Ян', 'Li', 'Jo', '李伟', 'प्रिया', 'Petr', 'Jana'],
  );
});

test('findOccurrences matches CJK names inside unspaced text and respects combining marks', () => {
  expect(findOccurrences('谢谢李伟的帮助', '李伟')).toEqual([{ start: 2, length: 2 }]);
  expect(findOccurrences(normaliseText('Petřa a Petr'), 'Petr')).toEqual([{ start: 8, length: 4 }]);
});

// I3: raw files must be the ones the decisions were made on.
test('checkRawHashes reports a raw file that differs from the recorded hash', () => {
  const info = { reviewsSha256: 'aaa', listingsSha256: 'bbb' };
  expect(checkRawHashes(info, { reviewsSha256: 'aaa', listingsSha256: 'bbb' })).toEqual([]);
  expect(checkRawHashes(info, { reviewsSha256: 'zzz', listingsSha256: 'bbb' })).toEqual([expect.stringMatching(/reviews/)]);
});

// I5: an allowed mention must survive an earlier redaction shifting positions.
test('allowed mentions are keyed by word, not position', () => {
  const { reviews, manifest } = buildDataset(rawFixture(), decisionsFixture());
  const r = reviews[1];
  r.text = 'We will come back. Will recommend!';
  const allowed = [allowEntry(r.id, 'will')];
  expect(validate(reviews, manifest, ['Will'], allowed)).toEqual([]);
  r.text = '[name] said we will come back.';
  expect(validate(reviews, manifest, ['Will'], allowed)).toEqual([]);
  expect(validate(reviews, manifest, ['Will', 'Tom'], allowed)).toEqual([]);
  r.text = 'Tom will come back.';
  expect(validate(reviews, manifest, ['Will', 'Tom'], allowed)).toEqual([expect.stringContaining(r.id)]);
});

test('textHash is stable and short', () => {
  expect(textHash('abc')).toBe(textHash('abc'));
  expect(textHash('abc')).toMatch(/^[0-9a-f]{16}$/);
});
