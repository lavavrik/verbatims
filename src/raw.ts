import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { parse } from 'csv-parse/sync';
import { decodeHTML } from 'entities';
import type { Listing, RatingKey, SourceReview } from './types';

/**
 * Inside Airbnb comments are HTML-ish: <br> becomes a newline, every HTML entity is decoded
 * (invalid code points become U+FFFD instead of crashing), and the result is NFC so that
 * names and redaction offsets compare reliably. Changing this function shifts committed
 * offsets; the per-review text hash in decisions/sample.json catches that.
 */
export function normaliseText(raw: string): string {
  return decodeHTML(raw.replace(/<br\s*\/?>/gi, '\n'))
    .replace(/\r\n?/g, '\n')
    .normalize('NFC')
    .trim();
}

async function readCsv(path: string): Promise<Record<string, string>[]> {
  const buf = await readFile(path);
  const text = (path.endsWith('.gz') ? gunzipSync(buf) : buf).toString('utf8');
  return parse(text, { columns: true, skip_empty_lines: true, relax_quotes: true });
}

export async function loadReviews(path: string): Promise<SourceReview[]> {
  return (await readCsv(path)).map((r) => ({
    listingId: r.listing_id,
    sourceId: r.id,
    date: r.date,
    reviewerId: r.reviewer_id,
    reviewerName: r.reviewer_name,
    text: normaliseText(r.comments ?? ''),
  }));
}

const SCORE_COLUMNS: Record<RatingKey, string> = {
  overall: 'review_scores_rating',
  accuracy: 'review_scores_accuracy',
  cleanliness: 'review_scores_cleanliness',
  checkin: 'review_scores_checkin',
  communication: 'review_scores_communication',
  location: 'review_scores_location',
  value: 'review_scores_value',
};

export async function loadListings(path: string): Promise<Map<string, Listing>> {
  const out = new Map<string, Listing>();
  for (const r of await readCsv(path)) {
    const avgScores = Object.fromEntries(
      Object.entries(SCORE_COLUMNS).map(([k, col]) => [k, r[col] ? Number(r[col]) : null]),
    ) as Listing['avgScores'];
    out.set(r.id, { id: r.id, name: r.name, hostName: r.host_name, numberOfReviews: Number(r.number_of_reviews), avgScores });
  }
  return out;
}
