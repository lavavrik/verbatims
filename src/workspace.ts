import { readJson } from './decisions';
import { textHash, type SampleDecision } from './pipeline/sample';
import { loadListings, loadReviews } from './raw';
import type { Listing, SourceReview } from './types';

export type SampledItem = { id: string; language: string; source: SourceReview };

/** The sampled reviews joined with their raw rows. In memory only: contains personal data. */
export async function loadSampled(): Promise<{ listing: Listing; items: SampledItem[] }> {
  const sample = await readJson<SampleDecision>('decisions/sample.json');
  const raw = new Map((await loadReviews('raw/reviews.csv.gz')).map((r) => [r.sourceId, r]));
  const listing = (await loadListings('raw/listings.csv.gz')).get(sample.listingId);
  if (!listing) throw new Error(`Listing ${sample.listingId} not in raw/listings.csv.gz`);
  const items = sample.items.map((it) => {
    const source = raw.get(it.sourceId);
    if (!source) throw new Error(`Review ${it.sourceId} (${it.id}) not in raw/reviews.csv.gz`);
    if (textHash(source.text) !== it.textHash) throw new Error(`${it.id}: review text changed since sampling (normalisation or raw file differs)`);
    return { id: it.id, language: it.language, source };
  });
  return { listing, items };
}
