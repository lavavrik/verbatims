import { mkdir, writeFile } from 'node:fs/promises';
import { detectLanguage } from '../lang';
import { rankCandidates } from '../pipeline/pickListing';
import { loadListings, loadReviews } from '../raw';

const chooseIdx = process.argv.indexOf('--choose');
const reviews = await loadReviews('raw/reviews.csv.gz');
const listings = await loadListings('raw/listings.csv.gz');

if (chooseIdx > -1) {
  const listingId = process.argv[chooseIdx + 1];
  if (!listingId || !reviews.some((r) => r.listingId === listingId)) throw new Error(`Unknown listing id: ${listingId}`);
  await mkdir('decisions', { recursive: true });
  await writeFile('decisions/listing.json', JSON.stringify({ listingId, chosenAt: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');
  console.log(`Chose listing ${listingId} (${listings.get(listingId)?.name ?? 'unknown name'}). Next: npm run sample`);
} else {
  const ranked = rankCandidates(reviews, detectLanguage).slice(0, 10);
  if (ranked.length === 0) console.log('No listing meets every rule. Loosen PICK_RULES in src/pipeline/pickListing.ts.');
  console.table(ranked.map((c) => ({
    listing: c.listingId,
    name: listings.get(c.listingId)?.name?.slice(0, 40),
    reviews: c.reviews,
    years: c.spanYears.toFixed(1),
    nonEnglish: `${Math.round(c.nonEnglishShare * 100)}%`,
    complaintHits: c.complaintHits,
  })));
  console.log('Choose one with: npm run pick-listing -- --choose <listing>');
}
