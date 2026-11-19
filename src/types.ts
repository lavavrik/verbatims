export type RatingKey = 'overall' | 'cleanliness' | 'accuracy' | 'checkin' | 'communication' | 'location' | 'value';
export const RATING_KEYS: RatingKey[] = ['overall', 'cleanliness', 'accuracy', 'checkin', 'communication', 'location', 'value'];
export type Ratings = Record<RatingKey, number>;

/** One review as it comes from Inside Airbnb, with text normalised. Contains personal data: never commit. */
export type SourceReview = {
  listingId: string;
  sourceId: string;
  date: string; // YYYY-MM-DD
  reviewerId: string;
  reviewerName: string;
  text: string;
};

export type Listing = {
  id: string;
  name: string;
  hostName: string;
  numberOfReviews: number;
  avgScores: Record<RatingKey, number | null>;
};

export type SourceInfo = { reviewsUrl: string; listingsUrl: string; scrapeDate: string; downloadedAt: string };
