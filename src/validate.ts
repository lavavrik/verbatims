import type { AllowedMention, Manifest, PublishedReview } from './pipeline/build';
import { findOccurrences } from './pipeline/redact';
import { RATING_KEYS } from './types';

/** Splits names like "Petr & Jana" into words; drops initials and fragments under 3 letters. */
export function forbiddenNameTokens(names: string[]): string[] {
  return [...new Set(names.flatMap((n) => n.split(/[^\p{L}'-]+/u)).filter((t) => [...t].length >= 3))];
}

/**
 * Returns problems; an empty list means the dataset can be published.
 * Problem messages never contain the names themselves.
 */
export function validate(reviews: PublishedReview[], manifest: Manifest, forbiddenNames: string[], allowed: AllowedMention[]): string[] {
  const problems: string[] = [];
  const isAllowed = (id: string, start: number) => allowed.some((a) => a.id === id && a.start === start);
  const ids = new Set(reviews.map((r) => r.id));

  for (const r of reviews) {
    for (const name of forbiddenNames) {
      for (const hit of findOccurrences(r.text, name)) {
        if (!isAllowed(r.id, hit.start)) problems.push(`${r.id}: a reviewer or host name remains at position ${hit.start} (redact it, or allow it if it isn't a name)`);
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
