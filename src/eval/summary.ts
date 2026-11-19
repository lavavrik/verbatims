import type { AnswerOutput } from './answer';
import { answerMetrics, type JudgeCheck } from './answerMetrics';
import { computeClassifyMetrics } from './classify';
import type { ClassifyOutput, SplitFile } from './classifyMetrics';
import type { EvalData } from './data';
import type { ResultFile } from './results';
import { signTestP } from './signTest';
import type { Rate } from './stats';

type KN = { k: number; n: number };
type RateOut = { k: number; n: number; rate: number; low: number; high: number } | null;
const kn = (r: Rate | null | undefined): KN => ({ k: r?.k ?? 0, n: r?.n ?? 0 });
const rate = (r: Rate | null | undefined): RateOut => (r ? { k: r.k, n: r.n, rate: r.rate, low: r.low, high: r.high } : null);

export type Summary = ReturnType<typeof buildSummary>;
type Input = { data: EvalData; split: SplitFile; splitHash: string; results: { file: string; result: ResultFile }[]; judgeChecks: JudgeCheck[]; generatedAt: string; listingId?: string };

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const sorted = (xs?: string[]) => [...(xs ?? [])].sort();

/**
 * Everything the report page shows, recomputed from stored outputs. No API calls, no review
 * text and no labels: only numbers, model and prompt names, and the source file names.
 */
export function buildSummary({ data: d, split, splitHash, results, judgeChecks, generatedAt, listingId }: Input) {
  for (const { file, result } of results) {
    if (result.datasetHash !== d.datasetHash) throw new Error(`${file}: made on a different dataset; refusing to report it`);
    if (result.kind === 'classify' && result.splitHash !== splitHash) throw new Error(`${file}: made on a different dev/test split; refusing to report it`);
  }
  const latest = new Map<string, { file: string; result: ResultFile }>();
  for (const r of results) {
    const key = `${r.result.kind}|${r.result.model}|${r.result.promptVersion}`;
    const cur = latest.get(key);
    if (!cur || r.result.createdAt > cur.result.createdAt) latest.set(key, r);
  }
  const picked = [...latest.values()].sort((a, b) => a.result.model.localeCompare(b.result.model) || a.result.promptVersion.localeCompare(b.result.promptVersion));
  const classifyRuns = picked.filter((r) => r.result.kind === 'classify') as { file: string; result: ResultFile<ClassifyOutput> }[];
  const answerRuns = picked.filter((r) => r.result.kind === 'answer') as { file: string; result: ResultFile<AnswerOutput> }[];
  const labelled = Object.keys(d.labels).sort();
  const ownerAvg = labelled.reduce((a, id) => a + d.labels[id].topics.length, 0) / labelled.length;
  // Failed calls have no topics and are left out, so they can never look like an exact match.
  const rep1 = (r: ResultFile<ClassifyOutput>) => new Map(r.outputs.filter((o) => o.rep === 1 && o.topics).map((o) => [o.id, sorted(o.topics)]));
  const exactOnTest = (a: Map<string, string[]>, b: Map<string, string[]>) => {
    let better = 0, worse = 0;
    for (const id of split.sampled.test) {
      if (!a.has(id) || !b.has(id) || !d.labels[id]) continue;
      const gold = sorted(d.labels[id].topics);
      const okA = sameSet(a.get(id)!, gold), okB = sameSet(b.get(id)!, gold);
      if (!okA && okB) better++;
      if (okA && !okB) worse++;
    }
    return { better, worse };
  };
  const stableIds = (r: ResultFile<ClassifyOutput>) => new Set(labelled.filter((id) => {
    const sets = r.outputs.filter((o) => o.id === id && o.topics).map((o) => sorted(o.topics));
    return sets.length >= 2 && sets.every((s) => sameSet(s, sets[0]));
  }));

  const classify = classifyRuns.map(({ file, result: r }) => {
    const m = computeClassifyMetrics(r.outputs, d, split);
    const first = rep1(r);
    const avg = labelled.reduce((a, id) => a + (first.get(id)?.length ?? 0), 0) / labelled.length;
    return {
      file, model: r.model, prompt: r.promptVersion, costUsd: r.usage.estCostUsd,
      test: { n: m.classification.test.n, exactSet: rate(m.classification.test.exactSet), microF1: m.classification.test.micro.f1 },
      dev: { n: m.classification.dev.n, exactSet: rate(m.classification.dev.exactSet), microF1: m.classification.dev.micro.f1 },
      consistency: { n: m.consistency.n, stable: rate(m.consistency.stable), meanJaccard: m.consistency.meanJaccard },
      avgTopicsPerReview: avg, ownerAvgTopicsPerReview: ownerAvg,
      perTopicPrecision: Object.fromEntries(Object.entries(m.classification.sampled.perTopic).map(([t, x]) => [t, x.precision])),
    };
  });

  const models = [...new Set(classifyRuns.map((r) => r.result.model))].sort();
  const run = (model: string, prompt: string) => classifyRuns.find((r) => r.result.model === model && r.result.promptVersion === prompt)?.result;
  const promptsOf = (model: string) => classifyRuns.filter((r) => r.result.model === model).map((r) => r.result.promptVersion).sort();

  const paired = models.flatMap((model) => {
    const ps = promptsOf(model);
    return ps.flatMap((from, i) => ps.slice(i + 1).map((to) => {
      const { better, worse } = exactOnTest(rep1(run(model, from)!), rep1(run(model, to)!));
      return { model, from, to, subset: 'test' as const, better, worse, signTestP: signTestP(better, worse) };
    }));
  });

  // Each pair of models at the highest prompt version both have, review by review on test.
  const pairedModels: { prompt: string; a: string; b: string; betterInB: number; worseInB: number; signTestP: number }[] = [];
  for (let i = 0; i < models.length; i++) for (let j = i + 1; j < models.length; j++) {
    const prompt = promptsOf(models[i]).filter((p) => promptsOf(models[j]).includes(p)).at(-1);
    if (!prompt) continue;
    const { better, worse } = exactOnTest(rep1(run(models[i], prompt)!), rep1(run(models[j], prompt)!));
    pairedModels.push({ prompt, a: models[i], b: models[j], betterInB: better, worseInB: worse, signTestP: signTestP(better, worse) });
  }

  const stabilityPairs: [{ model: string; prompt: string }, { model: string; prompt: string }][] = [];
  for (const model of models) {
    const ps = promptsOf(model), last = ps.at(-1)!;
    for (const p of ps.slice(0, -1)) stabilityPairs.push([{ model, prompt: p }, { model, prompt: last }]);
  }
  for (let i = 0; i < models.length; i++) for (let j = i + 1; j < models.length; j++) {
    const shared = promptsOf(models[i]).filter((p) => promptsOf(models[j]).includes(p)).at(-1);
    if (shared) stabilityPairs.push([{ model: models[i], prompt: shared }, { model: models[j], prompt: shared }]);
  }
  const pairedStability = stabilityPairs.map(([a, b]) => {
    const sa = stableIds(run(a.model, a.prompt)!), sb = stableIds(run(b.model, b.prompt)!);
    const onlyA = [...sa].filter((id) => !sb.has(id)).length, onlyB = [...sb].filter((id) => !sa.has(id)).length;
    return { a, b, stableOnlyInA: onlyA, stableOnlyInB: onlyB, signTestP: signTestP(onlyA, onlyB) };
  });

  const answers = answerRuns.map(({ file, result: r }) => {
    const m = answerMetrics(r.outputs, r.judge?.verdicts ?? [], d, judgeChecks);
    // Q2 asks for evidence from the planted month: count distinct valid cited reviews per answer, and those dated elsewhere.
    let cited = 0, offMonthCited = 0;
    for (const o of r.outputs.filter((x) => x.questionId === 'Q2' && x.answer)) {
      const ids = new Set(o.answer!.claims.flatMap((c) => c.reviewIds).filter((id) => d.byId.has(id)));
      cited += ids.size;
      offMonthCited += [...ids].filter((id) => !d.byId.get(id)!.date.startsWith(d.redate.targetMonth)).length;
    }
    return {
      file, model: r.model, costUsd: r.usage.estCostUsd, judgeCostUsd: r.judge?.estCostUsd ?? 0,
      q1Correct: kn(m.Q1.q1Correct),
      unsupportedClaims: { Q1: kn(m.Q1.unsupportedClaims), Q2: kn(m.Q2.unsupportedClaims), Q3: kn(m.Q3.unsupportedClaims) },
      invalidCitations: m.Q1.invalidCitations + m.Q2.invalidCitations + m.Q3.invalidCitations,
      q2: { meanRecall: m.Q2.q2?.meanRecall ?? null, meanPrecision: m.Q2.q2?.meanPrecision ?? null, offMonthRelevant: m.Q2.q2?.offMonthRelevant ?? 0, cited, offMonthCited },
    };
  });
  const agreement = answerMetrics([], [], d, judgeChecks).judgeAgreement;
  const languages: Record<string, number> = {};
  for (const r of d.reviews) languages[r.language] = (languages[r.language] ?? 0) + 1;

  return {
    schemaVersion: 1 as const, generatedAt, datasetHash: d.datasetHash, splitHash,
    dataset: {
      listingId: listingId ?? null, reviews: d.reviews.length, languages, labelled: labelled.length,
      split: { dev: split.sampled.dev.length, test: split.sampled.test.length, added: split.added.length },
      plantedTrend: { month: d.redate.targetMonth, category: 'cleanliness', reviews: d.redate.groundTruth.length },
    },
    classify, paired, pairedModels, pairedStability, answers,
    judgeAgreement: { onSupported: kn(agreement.onSupported), onUnsupported: kn(agreement.onUnsupported) },
    totalCostUsd: results.reduce((a, { result }) => a + result.usage.estCostUsd + (result.judge?.estCostUsd ?? 0), 0),
  };
}
