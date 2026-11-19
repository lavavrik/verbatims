// Replays raw/ + decisions/ into data/ with no API calls, then validates. Exits 1 on any problem.
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { readJson, readJsonOr, writeJson } from '../decisions';
import { buildDataset, type RedateDecision } from '../pipeline/build';
import { checkRawHashes, sha256File } from '../pipeline/download';
import type { RatingCheck, RatingsDecision } from '../pipeline/rate';
import type { Redaction } from '../pipeline/redact';
import type { SampleDecision } from '../pipeline/sample';
import { loadListings, loadReviews } from '../raw';
import type { SourceInfo } from '../types';
import { forbiddenNameTokens, validate, type AllowedMention } from '../validate';

const source = await readJson<SourceInfo>('decisions/source.json');
const rawProblems = checkRawHashes(source, { reviewsSha256: await sha256File('raw/reviews.csv.gz'), listingsSha256: await sha256File('raw/listings.csv.gz') });
if (rawProblems.length) { console.error(rawProblems.join('\n')); process.exit(1); }
const raw = { reviews: await loadReviews('raw/reviews.csv.gz'), listings: await loadListings('raw/listings.csv.gz'), source };
const decisions = {
  sample: await readJson<SampleDecision>('decisions/sample.json'),
  redactions: await readJsonOr<Redaction[]>('decisions/redactions.json', []),
  ratings: await readJson<RatingsDecision>('decisions/ratings.json'),
  ratingChecks: await readJsonOr<RatingCheck[]>('labels/rating-checks.json', []),
  redate: await readJsonOr<RedateDecision | null>('decisions/redate.json', null),
  allowedMentions: await readJsonOr<AllowedMention[]>('decisions/allowed-mentions.json', []),
};
if (!decisions.redate) console.warn('No decisions/redate.json yet: building without the planted trend.');

const { reviews, manifest } = buildDataset(raw, decisions);

// Names stay in memory only: every sampled reviewer plus the host.
const sampledSources = new Set(decisions.sample.items.map((it) => it.sourceId));
const names = raw.reviews.filter((r) => sampledSources.has(r.sourceId)).map((r) => r.reviewerName);
names.push(raw.listings.get(decisions.sample.listingId)!.hostName);
const problems = validate(reviews, manifest, forbiddenNameTokens(names), decisions.allowedMentions);
if (problems.length) {
  console.error(`${problems.length} problem(s); nothing written:\n` + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}

await mkdir('data/labels', { recursive: true });
await writeFile('data/reviews.jsonl', reviews.map((r) => JSON.stringify(r)).join('\n') + '\n');
await writeJson('data/manifest.json', manifest);
await copyFile('topics.json', 'data/topics.json');
await writeJson('data/labels/topics.json', await readJsonOr('labels/topics.json', {}));
await writeJson('data/labels/rating-checks.json', decisions.ratingChecks);

console.log(`Wrote ${reviews.length} reviews to data/. Generated vs Airbnb average scores (for the README):`);
console.table(Object.fromEntries(Object.entries(manifest.ratingsComparison.generatedAvg).map(([k, v]) => [k, { generated: v.toFixed(2), airbnb: manifest.ratingsComparison.airbnbAvg[k as keyof typeof manifest.ratingsComparison.airbnbAvg]?.toFixed(2) ?? 'n/a' }])));
