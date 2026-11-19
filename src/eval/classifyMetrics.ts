import type { EvalData } from './data';
import { ratio, wilson, type Rate } from './stats';
import type { Split } from './split';

export type ClassifyOutput = { id: string; rep: number; topics?: string[]; error?: string; usage: { input: number; output: number } };
export type PRF = { precision: number | null; recall: number | null; f1: number | null; tp: number; fp: number; fn: number };
export type SplitFile = { sampled: Split; added: string[] };

/** Micro precision/recall/F1 over (review, topic) pairs, or for one topic. Zero denominators give null. */
export function prf(pred: Set<string>[], gold: Set<string>[], topic?: string): PRF {
  let tp = 0, fp = 0, fn = 0;
  pred.forEach((p, i) => {
    const g = gold[i];
    const topics = topic ? [topic] : [...new Set([...p, ...g])];
    for (const t of topics) {
      if (p.has(t) && g.has(t)) tp++;
      else if (p.has(t)) fp++;
      else if (g.has(t)) fn++;
    }
  });
  const precision = ratio(tp, tp + fp), recall = ratio(tp, tp + fn);
  const f1 = precision === null || recall === null ? null : precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, tp, fp, fn };
}

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
export const MIN_LANGUAGE_N = 5;

function scoreSubset(ids: string[], rep1: Map<string, ClassifyOutput>, d: EvalData, topicNames: string[]) {
  const scored = ids.filter((id) => rep1.get(id)?.topics);
  const errors = ids.filter((id) => rep1.get(id)?.error).length;
  const pred = (xs: string[]) => xs.map((id) => new Set(rep1.get(id)!.topics));
  const gold = (xs: string[]) => xs.map((id) => new Set(d.labels[id].topics));
  const exact = (xs: string[]) => wilson(xs.filter((id) => sameSet(pred([id])[0], gold([id])[0])).length, xs.length);

  const byLang = new Map<string, string[]>();
  for (const id of scored) byLang.set(d.byId.get(id)!.language, [...(byLang.get(d.byId.get(id)!.language) ?? []), id]);
  const perLanguage: Record<string, PRF & { n: number }> = {};
  const other: string[] = [];
  for (const [lang, xs] of byLang) {
    if (xs.length >= MIN_LANGUAGE_N) perLanguage[lang] = { n: xs.length, ...prf(pred(xs), gold(xs)) };
    else other.push(...xs);
  }
  if (other.length) perLanguage.other = { n: other.length, ...prf(pred(other), gold(other)) };

  const own = scored.filter((id) => !d.labels[id].viaTranslation);
  return {
    n: scored.length,
    errors,
    exactSet: exact(scored),
    micro: prf(pred(scored), gold(scored)),
    perTopic: Object.fromEntries(topicNames.map((t) => [t, prf(pred(scored), gold(scored), t)])),
    perLanguage,
    withoutTranslated: { n: own.length, exactSet: exact(own), micro: prf(pred(own), gold(own)) },
  };
}
export type SubsetMetrics = ReturnType<typeof scoreSubset>;

/** Rep-1 agreement with the owner's labels for each subset the report shows. */
export function classificationMetrics(outputs: ClassifyOutput[], d: EvalData, split: SplitFile): Record<'test' | 'dev' | 'sampled' | 'added' | 'all', SubsetMetrics> {
  const rep1 = new Map(outputs.filter((o) => o.rep === 1).map((o) => [o.id, o]));
  const names = d.topics.map((t) => t.name);
  const labelled = Object.keys(d.labels);
  const s = (ids: string[]) => scoreSubset(ids.filter((id) => id in d.labels), rep1, d, names);
  return {
    test: s(split.sampled.test),
    dev: s(split.sampled.dev),
    sampled: s([...split.sampled.test, ...split.sampled.dev]),
    added: s(split.added),
    all: s(labelled),
  };
}

const jaccard = (a: Set<string>, b: Set<string>) => {
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 1 : [...a].filter((x) => b.has(x)).length / union.size;
};

/** How often repeated classification of the same review gives the same answer. */
export function consistencyMetrics(outputs: ClassifyOutput[], ids: string[]) {
  const reps = new Map<string, Set<string>[]>();
  for (const o of outputs) if (o.topics && ids.includes(o.id)) reps.set(o.id, [...(reps.get(o.id) ?? []), new Set(o.topics)]);
  const considered = ids.filter((id) => (reps.get(id)?.length ?? 0) >= 2);
  const topics = new Set<string>();
  for (const sets of reps.values()) for (const s of sets) for (const t of s) topics.add(t);

  const unstable = considered.filter((id) => reps.get(id)!.some((s) => !sameSet(s, reps.get(id)![0])));
  const perId = considered.map((id) => {
    const sets = reps.get(id)!;
    const pairs: number[] = [];
    for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) pairs.push(jaccard(sets[i], sets[j]));
    return pairs.reduce((a, b) => a + b, 0) / pairs.length;
  });
  const flipRate: Record<string, number> = {};
  for (const t of topics) {
    const flips = considered.filter((id) => { const has = reps.get(id)!.map((s) => s.has(t)); return has.some(Boolean) && !has.every(Boolean); });
    flipRate[t] = considered.length ? flips.length / considered.length : 0;
  }
  return {
    n: considered.length,
    skipped: ids.length - considered.length,
    stable: wilson(considered.length - unstable.length, considered.length),
    meanJaccard: perId.length ? perId.reduce((a, b) => a + b, 0) / perId.length : null,
    flipRate,
    unstable,
  };
}

/** How often each topic was assigned across all reviews (rep 1). */
export function topicCounts(outputs: ClassifyOutput[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const o of outputs) if (o.rep === 1) for (const t of o.topics ?? []) counts[t] = (counts[t] ?? 0) + 1;
  return counts;
}
