import { RATING_KEYS, type Listing, type RatingKey, type Ratings, type SourceInfo, type SourceReview } from '../types';
import { mergeRatings, type RatingCheck, type RatingSource, type RatingsDecision } from './rate';
import { applyRedactions, type Redaction } from './redact';
import type { RedatePlan } from './redate';
import type { SampleDecision } from './sample';

export const PIPELINE_VERSION = '1';

export type RedateDecision = RedatePlan & { rules: { want: number; minRatio: number; maxMonthFactor: number } };
/** Positions the owner confirmed are not names (e.g. "will"), so the validator skips them. */
export type AllowedMention = { id: string; start: number };

export type Decisions = {
  sample: SampleDecision;
  redactions: Redaction[];
  ratings: RatingsDecision;
  ratingChecks: RatingCheck[];
  redate: RedateDecision | null;
  allowedMentions: AllowedMention[];
};

export type PublishedReview = { id: string; date: string; language: string; text: string; ratings: Ratings; ratings_source: RatingSource };

export type Manifest = {
  pipelineVersion: string;
  source: SourceInfo;
  listing: { id: string; avgScores: Listing['avgScores'] };
  idMap: Record<string, string>;
  removedFields: string[];
  redactions: Redaction[];
  redate: RedateDecision | null;
  ratings: { model: string; effort: string; promptVersion: string; prompt: string };
  ratingChecks: { checked: number; accepted: number };
  ratingsComparison: { generatedAvg: Record<RatingKey, number>; airbnbAvg: Listing['avgScores'] };
};

type Raw = { reviews: SourceReview[]; listings: Map<string, Listing>; source: SourceInfo };

/** Pure replay: raw files + committed decisions → published dataset. No I/O, no API calls. */
export function buildDataset(raw: Raw, d: Decisions): { reviews: PublishedReview[]; manifest: Manifest } {
  const listing = raw.listings.get(d.sample.listingId);
  if (!listing) throw new Error(`Listing ${d.sample.listingId} missing from raw listings`);
  const rawById = new Map(raw.reviews.map((r) => [r.sourceId, r]));
  const merged = mergeRatings(d.ratings.results, d.ratingChecks);
  const moved = new Map((d.redate?.moves ?? []).map((m) => [m.id, m.to]));

  const reviews: PublishedReview[] = d.sample.items.map((it) => {
    const source = rawById.get(it.sourceId);
    if (!source) throw new Error(`Review ${it.sourceId} (${it.id}) missing from raw reviews`);
    const r = merged[it.id];
    if (!r) throw new Error(`No ratings for ${it.id}; run npm run rate`);
    return {
      id: it.id,
      date: moved.get(it.id) ?? source.date,
      language: it.language,
      text: applyRedactions(source.text, d.redactions.filter((x) => x.id === it.id)),
      ratings: r.ratings,
      ratings_source: r.source,
    };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const generatedAvg = Object.fromEntries(
    RATING_KEYS.map((k) => [k, reviews.reduce((s, r) => s + r.ratings[k], 0) / reviews.length]),
  ) as Record<RatingKey, number>;

  const manifest: Manifest = {
    pipelineVersion: PIPELINE_VERSION,
    source: raw.source,
    listing: { id: listing.id, avgScores: listing.avgScores },
    idMap: Object.fromEntries(d.sample.items.map((it) => [it.id, it.sourceId])),
    removedFields: ['reviewer_id', 'reviewer_name'],
    redactions: d.redactions,
    redate: d.redate,
    ratings: { model: d.ratings.model, effort: d.ratings.effort, promptVersion: d.ratings.promptVersion, prompt: d.ratings.prompt },
    ratingChecks: { checked: d.ratingChecks.length, accepted: d.ratingChecks.filter((c) => Object.keys(c.corrected).length === 0).length },
    ratingsComparison: { generatedAvg, airbnbAvg: listing.avgScores },
  };
  return { reviews, manifest };
}
