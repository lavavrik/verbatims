import type { EvalData } from '../../src/eval/data';
import type { PublishedReview } from '../../src/pipeline/build';
import type { Ratings } from '../../src/types';

const stars = (v: number): Ratings => ({ overall: v, cleanliness: v, accuracy: v, checkin: v, communication: v, location: v, value: v });
const gen = (o: Partial<Ratings> = {}) => ({ ...stars(5), ...o });
const source = { overall: 'generated', cleanliness: 'generated', accuracy: 'generated', checkin: 'generated', communication: 'generated', location: 'generated', value: 'generated' } as const;

export const TOPICS = [
  { name: 'cleanliness', description: 'How clean the place itself was.' },
  { name: 'location', description: 'The neighbourhood and getting around.' },
  { name: 'noise', description: 'Sound from the street or neighbours.' },
];

/** n reviews r0001…, languages cycling eng ×3, fra, deu; dates monthly from 2024-01. */
export function evalFixture(n = 40): EvalData {
  const langs = ['eng', 'eng', 'eng', 'fra', 'deu'];
  const reviews: PublishedReview[] = Array.from({ length: n }, (_, i) => ({
    id: `r${String(i + 1).padStart(4, '0')}`,
    date: `2024-${String((i % 12) + 1).padStart(2, '0')}-10`,
    language: langs[i % langs.length],
    text: `Review ${i + 1} text`,
    ratings: gen(),
    ratings_source: { ...source },
  }));
  const labels: EvalData['labels'] = {};
  for (const r of reviews.slice(0, 30)) labels[r.id] = { topics: ['location'], viaTranslation: r.language === 'deu' };
  return {
    reviews,
    byId: new Map(reviews.map((r) => [r.id, r])),
    topics: TOPICS,
    labels,
    redate: { targetMonth: '2024-06', moves: [{ id: 'r0002' }, { id: 'r0003' }], groundTruth: ['r0002', 'r0003'] },
    confirmedComplaints: ['r0002', 'r0005', 'r0007', 'r0003', 'r0011', 'r0013', 'r0017', 'r0019', 'r0023', 'r0029', 'r0031', 'r0037', 'r0041'],
    datasetHash: 'hash',
  };
}
