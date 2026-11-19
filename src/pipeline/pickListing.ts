import { looksLikeCleanlinessComplaint } from '../complaints';
import type { SourceReview } from '../types';

export type ListingCandidate = {
  listingId: string;
  reviews: number;
  spanYears: number;
  nonEnglishShare: number;
  complaintHits: number;
};

export const PICK_RULES = { minReviews: 300, minSpanYears: 3, minNonEnglishShare: 0.2, minComplaintHits: 30 };

const YEAR_MS = 365.25 * 86400000;

const spanYears = (reviews: SourceReview[]) => {
  const times = reviews.map((r) => Date.parse(r.date));
  return (Math.max(...times) - Math.min(...times)) / YEAR_MS;
};
const complaintHits = (reviews: SourceReview[]) => reviews.filter((r) => looksLikeCleanlinessComplaint(r.text)).length;

export function summarise(listingId: string, reviews: SourceReview[], detectLang: (t: string) => string): ListingCandidate {
  return {
    listingId,
    reviews: reviews.length,
    spanYears: spanYears(reviews),
    nonEnglishShare: reviews.filter((r) => detectLang(r.text) !== 'eng').length / reviews.length,
    complaintHits: complaintHits(reviews),
  };
}

/**
 * Listings that meet every rule from the design, most reviews first. Cheap rules run first:
 * language detection (~0.6 ms per review) only runs on listings that pass the others.
 */
export function rankCandidates(reviews: SourceReview[], detectLang: (t: string) => string): ListingCandidate[] {
  const byListing = new Map<string, SourceReview[]>();
  for (const r of reviews) {
    const list = byListing.get(r.listingId) ?? [];
    list.push(r);
    byListing.set(r.listingId, list);
  }
  const out: ListingCandidate[] = [];
  for (const [id, rs] of byListing) {
    if (rs.length < PICK_RULES.minReviews) continue;
    if (spanYears(rs) < PICK_RULES.minSpanYears) continue;
    if (complaintHits(rs) < PICK_RULES.minComplaintHits) continue;
    const c = summarise(id, rs, detectLang);
    if (c.nonEnglishShare >= PICK_RULES.minNonEnglishShare) out.push(c);
  }
  return out.sort((a, b) => b.reviews - a.reviews);
}
