import { createHash } from 'node:crypto';
import type { Manifest, PublishedReview } from './pipeline/build';
import { findOccurrences } from './pipeline/redact';
import { RATING_KEYS } from './types';

/** Words in host names that aren't names ("Petr And Jana", "Prague Central Apartments"). */
const NOT_NAMES = new Set(['and', 'und', 'et', 'y', 'a', 'i', 'и', 'та', 'і', 'the', 'team', 'family', 'prague', 'praha', 'prag', 'central', 'centre', 'center', 'city', 'old', 'town', 'apartment', 'apartments', 'apartmány', 'flat', 'flats', 'home', 'homes', 'rooms', 'residence', 'hotel', 'hostel', 'stay', 'stays', 'living', 'properties', 'group']);

/** Splits names like "Petr & Jana" into words; drops single letters and filler words. */
export function forbiddenNameTokens(names: string[]): string[] {
  return [...new Set(
    names.flatMap((n) => n.normalize('NFC').split(/[^\p{L}\p{M}'-]+/u)).filter((t) => [...t].length >= 2 && !NOT_NAMES.has(t.toLowerCase())),
  )];
}

/** A word the owner confirmed is not a name in one review (e.g. "will"). Stored as a hash, never as text. */
export type AllowedMention = { id: string; tokenHash: string };
const tokenHash = (word: string) => createHash('sha256').update(word.normalize('NFC').toLowerCase()).digest('hex').slice(0, 16);
export const allowEntry = (id: string, word: string): AllowedMention => ({ id, tokenHash: tokenHash(word) });

/**
 * Returns problems; an empty list means the dataset can be published.
 * Problem messages never contain the names themselves.
 */
export function validate(reviews: PublishedReview[], manifest: Manifest, forbiddenNames: string[], allowed: AllowedMention[]): string[] {
  const problems: string[] = [];
  const isAllowed = (id: string, word: string) => allowed.some((a) => a.id === id && a.tokenHash === tokenHash(word));
  const ids = new Set(reviews.map((r) => r.id));

  for (const r of reviews) {
    for (const name of forbiddenNames) {
      for (const hit of findOccurrences(r.text, name)) {
        if (!isAllowed(r.id, r.text.slice(hit.start, hit.start + hit.length))) problems.push(`${r.id}: a reviewer or host name remains at position ${hit.start} (redact it, or allow the word if it isn't a name)`);
      }
    }
    for (const k of RATING_KEYS) {
      const v = r.ratings[k];
      if (!Number.isInteger(v) || v < 1 || v > 5) problems.push(`${r.id}: rating ${k} is ${v}, expected a whole number 1–5`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) problems.push(`${r.id}: date ${r.date} is not YYYY-MM-DD`);
    else if (r.date > manifest.source.scrapeDate) problems.push(`${r.id}: date ${r.date} is after the scrape date ${manifest.source.scrapeDate}`);
    if (/<br/i.test(r.text)) problems.push(`${r.id}: text still contains HTML line breaks`);
  }

  for (const id of Object.keys(manifest.idMap)) if (!ids.has(id)) problems.push(`manifest idMap: ${id} is not in the dataset`);
  for (const red of manifest.redactions) if (!ids.has(red.id)) problems.push(`manifest redactions: ${red.id} is not in the dataset`);
  for (const m of manifest.redate?.moves ?? []) if (!ids.has(m.id)) problems.push(`manifest redate: ${m.id} is not in the dataset`);
  return problems;
}
