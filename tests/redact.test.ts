import { expect, test } from 'vitest';
import { applyRedactions, findOccurrences, mergeRedactions } from '../src/pipeline/redact';

test('finds whole-word names in Cyrillic and Czech', () => {
  expect(findOccurrences('Дякуємо Олені за все, Олена супер', 'Олена')).toEqual([{ start: 22, length: 5 }]);
  expect(findOccurrences('Petr a Petra byli skvělí', 'Petr')).toEqual([{ start: 0, length: 4 }]);
  expect(findOccurrences('thanks to ANNA and anna', 'Anna')).toEqual([{ start: 10, length: 4 }, { start: 19, length: 4 }]);
});

test('names with regex characters are matched literally', () => {
  expect(findOccurrences('Merci J.-P. et JxP', 'J.-P.')).toEqual([{ start: 6, length: 5 }]);
});

test('applyRedactions replaces spans and round-trips offsets', () => {
  const t = 'Děkujeme, Šárka! Šárka byla milá.';
  const spans = findOccurrences(t, 'Šárka').map((s) => ({ id: 'r0001', ...s }));
  expect(applyRedactions(t, spans)).toBe('Děkujeme, [name]! [name] byla milá.');
});

test('overlapping redactions throw', () => {
  expect(() => applyRedactions('Anna Maria', [{ id: 'r1', start: 0, length: 6 }, { id: 'r1', start: 5, length: 5 }])).toThrow(/overlap/i);
});

test('mergeRedactions drops duplicates and keeps the longer of nested spans', () => {
  const merged = mergeRedactions([
    { id: 'r1', start: 0, length: 4 },
    { id: 'r1', start: 0, length: 4 },
    { id: 'r1', start: 0, length: 10 },
    { id: 'r2', start: 3, length: 2 },
  ]);
  expect(merged).toEqual([{ id: 'r1', start: 0, length: 10 }, { id: 'r2', start: 3, length: 2 }]);
});
