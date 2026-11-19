import { expect, test } from 'vitest';
import { looksLikeCleanlinessComplaint } from '../src/complaints';
import { rankCandidates } from '../src/pipeline/pickListing';
import type { SourceReview } from '../src/types';

const stubLang = (t: string) => (t.startsWith('[cs]') ? 'ces' : 'eng');

function listing(id: string, o: { n?: number; years?: number; csShare?: number; complaints?: number } = {}): SourceReview[] {
  const { n = 320, years = 4, csShare = 0.3, complaints = 40 } = o;
  const start = Date.UTC(2021, 0, 1);
  const stepMs = (years * 365 * 86400000) / (n - 1);
  return Array.from({ length: n }, (_, i) => ({
    listingId: id,
    sourceId: `${id}-${i}`,
    date: new Date(start + i * stepMs).toISOString().slice(0, 10),
    reviewerId: String(i),
    reviewerName: 'x',
    text: `${i < n * csShare ? '[cs] ' : ''}${i < complaints ? 'the bathroom was dirty' : 'great stay'}`,
  }));
}

test('rankCandidates keeps only listings that pass every filter', () => {
  const reviews = [
    ...listing('good'),
    ...listing('few', { n: 250 }),
    ...listing('young', { years: 2 }),
    ...listing('english', { csShare: 0.1 }),
    ...listing('tidy', { complaints: 20 }),
  ];
  const ranked = rankCandidates(reviews, stubLang);
  expect(ranked.map((c) => c.listingId)).toEqual(['good']);
  expect(ranked[0]).toMatchObject({ reviews: 320, complaintHits: 40 });
  expect(ranked[0].spanYears).toBeGreaterThanOrEqual(3);
  expect(ranked[0].nonEnglishShare).toBeCloseTo(0.3, 2);
});

test('rankCandidates sorts by review count, most first', () => {
  const ranked = rankCandidates([...listing('a', { n: 310 }), ...listing('b', { n: 400 })], stubLang);
  expect(ranked.map((c) => c.listingId)).toEqual(['b', 'a']);
});

test('cleanliness pre-filter matches complaints across languages', () => {
  expect(looksLikeCleanlinessComplaint('Koupelna byla špinavá')).toBe(true);
  expect(looksLikeCleanlinessComplaint('В ванной было грязно')).toBe(true);
  expect(looksLikeCleanlinessComplaint('У ванній було брудно')).toBe(true);
  expect(looksLikeCleanlinessComplaint('Überall Staub')).toBe(true);
  expect(looksLikeCleanlinessComplaint('dusty shelves')).toBe(true);
  expect(looksLikeCleanlinessComplaint('Great location')).toBe(false);
});
