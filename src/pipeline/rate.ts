import { z } from 'zod';
import { RATING_KEYS, type RatingKey, type Ratings } from '../types';

const star = z.number().int().min(1).max(5);
export const RatingsSchema = z.object({
  overall: star, cleanliness: star, accuracy: star, checkin: star, communication: star, location: star, value: star,
});

export const RATING_PROMPT_VERSION = 'v1';
export const RATING_SYSTEM_PROMPT = `You read one guest review of an Airbnb listing and give the star ratings this guest would most likely have given on Airbnb, from 1 to 5 whole stars.

Categories:
- overall: the stay as a whole
- cleanliness: how clean the place was
- accuracy: how well the place matched the listing description and photos
- checkin: how smooth arrival and key handover were
- communication: how responsive and helpful the host was
- location: the neighbourhood, transport and surroundings
- value: whether the stay was worth the price

Rate from the review text only. When a category is not mentioned, follow the review's overall tone. Reviews may be in any language. Ignore "[name]" placeholders; they replace people's names.`;

export type RatingsDecision = { model: string; effort: string; promptVersion: string; prompt: string; results: Record<string, Ratings> };
export type RatingCheck = { id: string; original: Ratings; corrected: Partial<Ratings> };
export type RatingSource = Record<RatingKey, 'generated' | 'owner'>;

/** Applies the owner's spot-check corrections on top of generated ratings, field by field. */
export function mergeRatings(generated: Record<string, Ratings>, checks: RatingCheck[]): Record<string, { ratings: Ratings; source: RatingSource }> {
  const out: Record<string, { ratings: Ratings; source: RatingSource }> = {};
  for (const [id, ratings] of Object.entries(generated)) {
    out[id] = { ratings: { ...ratings }, source: Object.fromEntries(RATING_KEYS.map((k) => [k, 'generated'])) as RatingSource };
  }
  for (const c of checks) {
    const target = out[c.id];
    if (!target) throw new Error(`Rating correction for ${c.id}, which has no generated ratings`);
    for (const [k, v] of Object.entries(c.corrected) as [RatingKey, number][]) {
      target.ratings[k] = v;
      target.source[k] = 'owner';
    }
  }
  return out;
}
