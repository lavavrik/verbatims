import { readJson, writeJson } from '../decisions';
import { selectSample, toSampleDecision } from '../pipeline/sample';
import { loadReviews } from '../raw';

const { listingId } = await readJson<{ listingId: string }>('decisions/listing.json');
const reviews = (await loadReviews('raw/reviews.csv.gz')).filter((r) => r.listingId === listingId);
const decision = toSampleDecision(listingId, selectSample(reviews));
await writeJson('decisions/sample.json', decision);
const langs: Record<string, number> = {};
for (const it of decision.items) langs[it.language] = (langs[it.language] ?? 0) + 1;
console.log(`Sampled ${decision.items.length} of ${reviews.length} reviews.`);
console.table(langs);
