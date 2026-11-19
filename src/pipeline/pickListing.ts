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

export function summarise(listingId: string, reviews: SourceReview[], detectLang: (t: string) => string): ListingCandidate {
  const times = reviews.map((r) => Date.parse(r.date));
  const nonEnglish = reviews.filter((r) => detectLang(r.text) !== 'eng').length;
  return {
    listingId,
    reviews: reviews.length,
    spanYears: (Math.max(...times) - Math.min(...times)) / YEAR_MS,
    nonEnglishShare: nonEnglish / reviews.length,
    complaintHits: reviews.filter((r) => looksLikeCleanlinessComplaint(r.text)).length,
  };
}

/** Listings that meet every rule from the design, most reviews first. */
export function rankCandidates(reviews: SourceReview[], detectLang: (t: string) => string): ListingCandidate[] {
  const byListing = new Map<string, SourceReview[]>();
  for (const r of reviews) {
    const list = byListing.get(r.listingId) ?? [];
    list.push(r);
    byListing.set(r.listingId, list);
  }
  const out: ListingCandidate[] = [];
  for (const [id, rs] of byListing) {
    if (rs.length < PICK_RULES.minReviews) continue; // cheap check before language detection
    const c = summarise(id, rs, detectLang);
    if (c.spanYears >= PICK_RULES.minSpanYears && c.nonEnglishShare >= PICK_RULES.minNonEnglishShare && c.complaintHits >= PICK_RULES.minComplaintHits) out.push(c);
  }
  return out.sort((a, b) => b.reviews - a.reviews);
}
