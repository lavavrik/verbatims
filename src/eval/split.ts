import { createHash } from 'node:crypto';
import type { EvalData } from './data';

export type Split = { dev: string[]; test: string[] };

/**
 * Labelled reviews that were added on purpose, not sampled: the re-dated complaints plus the
 * next 10 confirmed complaints, the same rule the labelling queue used.
 */
export function addedLabelIds(d: EvalData): string[] {
  const redated = d.redate.moves.map((m) => m.id);
  return [...redated, ...d.confirmedComplaints.filter((id) => !redated.includes(id)).slice(0, 10)];
}

/** Labelled reviews that represent the dataset (sampled in proportion to language). */
export function sampledLabelIds(d: EvalData): string[] {
  const added = new Set(addedLabelIds(d));
  return Object.keys(d.labels).filter((id) => !added.has(id)).sort();
}

const h = (id: string) => createHash('sha256').update(id).digest('hex');

/**
 * Per language: order by hash of id, then alternate test, dev, test… The alternation carries
 * over from one language to the next, so odd-sized languages take turns giving their extra
 * review to test and to dev. Deterministic and balanced overall and within each language.
 */
export function makeSplit(ids: string[], languageOf: (id: string) => string): Split {
  const groups = new Map<string, string[]>();
  for (const id of ids) groups.set(languageOf(id), [...(groups.get(languageOf(id)) ?? []), id]);
  const split: Split = { dev: [], test: [] };
  let turn = 0;
  for (const lang of [...groups.keys()].sort()) {
    for (const id of groups.get(lang)!.sort((a, b) => h(a).localeCompare(h(b)))) (turn++ % 2 === 0 ? split.test : split.dev).push(id);
  }
  split.dev.sort();
  split.test.sort();
  return split;
}
