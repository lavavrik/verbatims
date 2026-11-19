import { expect, test } from 'vitest';
import { detectLanguage } from '../src/lang';
import { isUsableReview, relabelLanguages, selectSample, toSampleDecision } from '../src/pipeline/sample';
import type { SourceReview } from '../src/types';

const LANGS = ['eng', 'ces', 'deu', 'ukr', 'rus'];
const stubLang = (t: string) => t.slice(1, 4);

function reviews(n: number, years = 4): SourceReview[] {
  const start = Date.UTC(2021, 0, 1);
  const step = (years * 365 * 86400000) / (n - 1);
  // Shuffle the order so sorting is actually exercised.
  return Array.from({ length: n }, (_, i) => ({
    listingId: 'L', sourceId: String(1000 + i),
    date: new Date(start + i * step).toISOString().slice(0, 10),
    reviewerId: String(i), reviewerName: 'x',
    text: `[${LANGS[i % 7 === 0 ? 1 + (i % 4) : 0]}] a perfectly ordinary review number ${i}`,
  })).reverse();
}

test('drops automated postings and tiny comments', () => {
  expect(isUsableReview('The host canceled this reservation 5 days before arrival. This is an automated posting.')).toBe(false);
  expect(isUsableReview('Nice.')).toBe(false);
  expect(isUsableReview('A lovely flat close to the river.')).toBe(true);
});

test('keeps everything when within range and assigns ids by original date', () => {
  const sample = selectSample(reviews(320), stubLang);
  expect(sample).toHaveLength(320);
  const d = toSampleDecision('L', sample);
  expect(d.items[0].id).toBe('r0001');
  expect(d.items.at(-1)!.id).toBe('r0320');
  const dates = d.items.map((it) => sample.find((s) => s.sourceId === it.sourceId)!.date);
  expect([...dates].sort()).toEqual(dates);
});

test('stratified sample keeps the first and last quarter and every language', () => {
  const all = reviews(900);
  const sample = selectSample(all, stubLang);
  expect(sample).toHaveLength(500);
  const dates = sample.map((s) => s.date).sort();
  const allDates = all.map((s) => s.date).sort();
  expect(dates[0].slice(0, 7)).toBe(allDates[0].slice(0, 7));
  expect(dates.at(-1)!.slice(0, 4)).toBe(allDates.at(-1)!.slice(0, 4));
  expect(new Set(sample.map((s) => s.language))).toEqual(new Set(LANGS));
});

test('throws when fewer than 300 usable reviews', () => {
  expect(() => selectSample(reviews(299), stubLang)).toThrow(/299/);
});

test('detectLanguage recognises the expected languages', () => {
  expect(detectLanguage('Byt byl velmi čistý a hostitel byl moc milý, určitě se vrátíme.')).toBe('ces');
  expect(detectLanguage('Дуже гарна квартира, господиня привітна, все було чудово і чисто.')).toBe('ukr');
  expect(detectLanguage('Nice.')).toBe('und');
});

test('detectLanguage only answers with plausible guest languages', () => {
  expect(detectLanguage('The flat is near to the tram and good for two people.')).toBe('eng'); // franc alone says Scots
  expect(detectLanguage('El apartamento es pequeño pero muy limpio y bien ubicado.')).toBe('spa');
});

test('relabelLanguages updates languages without touching ids or text hashes', () => {
  const decision = { listingId: 'L', items: [
    { id: 'r0001', sourceId: '1', language: 'sco', textHash: 'aaa' },
    { id: 'r0002', sourceId: '2', language: 'eng', textHash: 'bbb' },
  ] };
  const texts = new Map([['1', 'The flat is near to the tram and good for two people.'], ['2', 'Lovely little place near the old town, all good.']]);
  const { decision: out, changed } = relabelLanguages(decision, texts, detectLanguage);
  expect(out.items.map((i) => [i.id, i.sourceId, i.textHash, i.language])).toEqual([['r0001', '1', 'aaa', 'eng'], ['r0002', '2', 'bbb', 'eng']]);
  expect(changed).toEqual({ 'sco→eng': 1 });
});
