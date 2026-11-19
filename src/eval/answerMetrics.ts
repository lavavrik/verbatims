import type { AnswerOutput, Verdict } from './answer';
import type { EvalData } from './data';
import { wilson, type Rate } from './stats';

const meanOf = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

export type JudgeCheck = { resultFile: string; outputIndex: number; claimIndex: number; reviewId: string; judge: boolean; owner: boolean };

export type QuestionMetrics = {
  n: number; errors: number; citations: number; invalidCitations: number; claims: number;
  unsupportedClaims: Rate | null; unjudgedClaims: number;
  q1Correct?: Rate | null;
  /** recall/precision pool all reps (labelled "pooled" in reports); perRep and the means treat each rep as one result. */
  q2?: { recall: Rate | null; precision: Rate | null; offMonthRelevant: number; perRep: { rep: number; recall: number | null; precision: number | null }[]; meanRecall: number | null; meanPrecision: number | null };
};

/**
 * Scores grounded answers from stored outputs and judge verdicts (no API calls).
 * A claim is supported when at least one valid citation was judged supported; a claim whose
 * valid citations all failed to be judged is "unjudged" and left out of the rate.
 */
export function answerMetrics(outputs: AnswerOutput[], verdicts: (Verdict & { error?: string })[], d: EvalData, checks: JudgeCheck[] = []) {
  const truth = new Set(d.redate.groundTruth), complaints = new Set(d.confirmedComplaints);
  const result = {} as Record<'Q1' | 'Q2' | 'Q3', QuestionMetrics>;
  for (const q of ['Q1', 'Q2', 'Q3'] as const) {
    const mine = outputs.map((o, i) => ({ o, i })).filter(({ o }) => o.questionId === q);
    const good = mine.filter(({ o }) => o.answer);
    let citations = 0, invalid = 0, claims = 0, unsupported = 0, unjudged = 0;
    let q2Hits = 0, q2Truth = 0, q2Cited = 0, q2InTruth = 0, offMonth = 0, q1 = 0;
    const perRep: { rep: number; recall: number | null; precision: number | null }[] = [];
    for (const { o, i } of good) {
      const a = o.answer!;
      a.claims.forEach((c, ci) => {
        claims++;
        citations += c.reviewIds.length;
        invalid += c.reviewIds.filter((id) => !d.byId.has(id)).length;
        const vs = verdicts.filter((v) => v.outputIndex === i && v.claimIndex === ci);
        if (vs.some((v) => v.supported && !v.error)) return;
        if (vs.length && vs.every((v) => v.error)) unjudged++;
        else unsupported++;
      });
      if (q === 'Q1' && a.category === 'cleanliness' && a.month === d.redate.targetMonth) q1++;
      if (q === 'Q2') {
        // Every distinct cited id counts in the precision denominator, invented ones included.
        const cited = new Set(a.claims.flatMap((c) => c.reviewIds));
        const hits = [...truth].filter((id) => cited.has(id)).length, inTruth = [...cited].filter((id) => truth.has(id)).length;
        q2Hits += hits; q2Truth += truth.size; q2Cited += cited.size; q2InTruth += inTruth;
        offMonth += [...cited].filter((id) => d.byId.has(id) && !truth.has(id) && complaints.has(id)).length;
        perRep.push({ rep: o.rep, recall: truth.size ? hits / truth.size : null, precision: cited.size ? inTruth / cited.size : null });
      }
    }
    result[q] = {
      n: good.length, errors: mine.length - good.length, citations, invalidCitations: invalid, claims,
      unsupportedClaims: wilson(unsupported, claims - unjudged), unjudgedClaims: unjudged,
      ...(q === 'Q1' ? { q1Correct: wilson(q1, good.length) } : {}),
      ...(q === 'Q2' ? { q2: {
        recall: wilson(q2Hits, q2Truth), precision: wilson(q2InTruth, q2Cited), offMonthRelevant: offMonth, perRep,
        meanRecall: meanOf(perRep.map((r) => r.recall)), meanPrecision: meanOf(perRep.map((r) => r.precision)),
      } } : {}),
    };
  }
  const onS = checks.filter((c) => c.judge), onU = checks.filter((c) => !c.judge);
  return {
    ...result,
    judgeAgreement: { onSupported: wilson(onS.filter((c) => c.owner).length, onS.length), onUnsupported: wilson(onU.filter((c) => !c.owner).length, onU.length) },
  };
}
