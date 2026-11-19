import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PublishedReview } from '../pipeline/build';

export type Topic = { name: string; description: string };
export type TopicLabel = { topics: string[]; viaTranslation: boolean };

export type EvalData = {
  reviews: PublishedReview[];
  byId: Map<string, PublishedReview>;
  topics: Topic[];
  labels: Record<string, TopicLabel>;
  redate: { targetMonth: string; moves: { id: string }[]; groundTruth: string[] };
  confirmedComplaints: string[];
  datasetHash: string;
};

/** Everything the evals read. Published data only: never raw/. */
export async function loadEvalData(dir = '.'): Promise<EvalData> {
  const reviewsText = await readFile(join(dir, 'data/reviews.jsonl'), 'utf8');
  const reviews = reviewsText.trim().split('\n').map((l) => JSON.parse(l) as PublishedReview);
  const manifest = JSON.parse(await readFile(join(dir, 'data/manifest.json'), 'utf8'));
  if (!manifest.redate) throw new Error('data/manifest.json has no planted trend (redate); rebuild the dataset first');
  const complaints = JSON.parse(await readFile(join(dir, 'decisions/complaints.json'), 'utf8')) as { confirmed: string[] };
  return {
    reviews,
    byId: new Map(reviews.map((r) => [r.id, r])),
    topics: JSON.parse(await readFile(join(dir, 'data/topics.json'), 'utf8')),
    labels: JSON.parse(await readFile(join(dir, 'data/labels/topics.json'), 'utf8')),
    redate: manifest.redate,
    confirmedComplaints: complaints.confirmed,
    datasetHash: createHash('sha256').update(reviewsText).digest('hex'),
  };
}
