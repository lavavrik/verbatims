import type { ClassifyOutput } from './classifyMetrics';
import type { EvalData } from './data';
import type { ResultFile } from './results';

export type Delta = { name: string; a: number | null; b: number | null; nA: number; nB: number };

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Metric deltas between two classification runs, and which labelled reviews got better or worse. */
export function compareRuns(a: ResultFile<ClassifyOutput>, b: ResultFile<ClassifyOutput>, d: EvalData) {
  if (a.kind !== 'classify' || b.kind !== 'classify') throw new Error(`Only classification runs can be compared (got kind ${a.kind} and ${b.kind})`);
  if (a.datasetHash !== b.datasetHash) throw new Error('The runs used different datasets; their numbers are not comparable');

  const metricDeltas: Delta[] = [];
  for (const subset of ['test', 'dev', 'sampled', 'added', 'all'] as const) {
    const ma = a.metrics.classification[subset], mb = b.metrics.classification[subset];
    metricDeltas.push({ name: `${subset} exact-set`, a: ma.exactSet?.rate ?? null, b: mb.exactSet?.rate ?? null, nA: ma.n, nB: mb.n });
    metricDeltas.push({ name: `${subset} micro F1`, a: ma.micro.f1, b: mb.micro.f1, nA: ma.n, nB: mb.n });
  }
  const ca = a.metrics.consistency, cb = b.metrics.consistency;
  metricDeltas.push({ name: 'consistency stable', a: ca.stable?.rate ?? null, b: cb.stable?.rate ?? null, nA: ca.n, nB: cb.n });
  metricDeltas.push({ name: 'consistency mean Jaccard', a: ca.meanJaccard, b: cb.meanJaccard, nA: ca.n, nB: cb.n });
  metricDeltas.push({ name: 'cost USD', a: a.usage.estCostUsd, b: b.usage.estCostUsd, nA: a.outputs.length, nB: b.outputs.length });

  const rep1 = (f: ResultFile<ClassifyOutput>) => new Map(f.outputs.filter((o) => o.rep === 1).map((o) => [o.id, o.topics]));
  const ra = rep1(a), rb = rep1(b);
  const improved: string[] = [], regressed: string[] = [];
  for (const id of Object.keys(d.labels).sort()) {
    const gold = d.labels[id].topics, ta = ra.get(id), tb = rb.get(id);
    if (!ta || !tb) continue;
    const okA = sameSet(ta, gold), okB = sameSet(tb, gold);
    if (!okA && okB) improved.push(id);
    if (okA && !okB) regressed.push(id);
  }
  return { metricDeltas, improved, regressed };
}
