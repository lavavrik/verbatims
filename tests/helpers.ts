import type { Decisions } from '../src/pipeline/build';
import { textHash } from '../src/pipeline/sample';
import type { Listing, Ratings, SourceInfo, SourceReview } from '../src/types';

export const stars = (v: number): Ratings => ({ overall: v, cleanliness: v, accuracy: v, checkin: v, communication: v, location: v, value: v });

export function rawFixture() {
  const reviews: SourceReview[] = [
    { listingId: 'L1', sourceId: '11', date: '2023-01-10', reviewerId: '901', reviewerName: 'Olena', text: 'Дякуємо, Олена! Чисто і тепло.' },
    { listingId: 'L1', sourceId: '12', date: '2023-02-14', reviewerId: '902', reviewerName: 'Tom', text: 'Dusty floor and a stained towel.' },
    { listingId: 'L1', sourceId: '13', date: '2023-05-02', reviewerId: '903', reviewerName: 'Eva', text: 'Petr was a great host, thanks!' },
  ];
  const listing: Listing = { id: 'L1', name: 'Loft', hostName: 'Petr', numberOfReviews: 3, avgScores: { ...stars(4.5) } };
  const source: SourceInfo = { reviewsUrl: 'https://x/reviews.csv.gz', listingsUrl: 'https://x/listings.csv.gz', scrapeDate: '2026-09-20', downloadedAt: '2026-11-19', reviewsSha256: 'r', listingsSha256: 'l' };
  return { reviews, listings: new Map([['L1', listing]]), source };
}

export function decisionsFixture(): Decisions {
  const text = (sourceId: string) => textHash(rawFixture().reviews.find((r) => r.sourceId === sourceId)!.text);
  return {
    sample: { listingId: 'L1', items: [
      { id: 'r0001', sourceId: '11', language: 'ukr', textHash: text('11') },
      { id: 'r0002', sourceId: '12', language: 'eng', textHash: text('12') },
      { id: 'r0003', sourceId: '13', language: 'eng', textHash: text('13') },
    ] },
    redactions: [{ id: 'r0001', start: 9, length: 5 }, { id: 'r0003', start: 0, length: 4 }],
    ratings: { model: 'claude-opus-5-5', effort: 'low', promptVersion: 'v1', prompt: 'p', results: { r0001: stars(5), r0002: stars(2), r0003: stars(5) } },
    ratingChecks: [{ id: 'r0002', original: stars(2), corrected: { location: 4 } }],
    redate: { targetMonth: '2023-06', moves: [{ id: 'r0002', from: '2023-02-14', to: '2023-06-01' }], groundTruth: ['r0002'], rules: { want: 15, minRatio: 3, maxMonthFactor: 2 } },
    allowedMentions: [],
  };
}
