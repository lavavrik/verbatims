import { z } from 'zod';
import { callStructuredWith, pool } from '../llm';
import type { PublishedReview } from '../pipeline/build';
import { RATING_KEYS } from '../types';
import type { AnswerOutput, Verdict } from './answer';
import type { EvalData } from './data';

export const JUDGE_MODEL = 'claude-opus-5-5';
export const JUDGE_EFFORT = 'medium' as const;
export const JudgeSchema = z.object({ supported: z.boolean(), reason: z.string() });

export const JUDGE_PROMPT = `You check one citation in an analysis of guest reviews.
You get a claim and one review the claim cites. Decide whether this review is evidence for what the claim says about guests' experience.
- A single review doesn't need to prove a count, an average or a trend on its own; it must be consistent with the claim and show the kind of experience the claim describes.
- If the claim names a time frame (a month, a period), the review's date must fall within it.
- Reviews may be in any language; "[name]" replaces a person's name.
Reply with supported true or false and a one-sentence reason.`;

/** What the judge sees: the claim and one review's id, date, ratings and text. */
export function judgeInput(claim: string, r: PublishedReview): string {
  return `Claim: ${claim}\n\nReview ${r.id}, dated ${r.date}, language ${r.language}\nRatings: ${RATING_KEYS.map((k) => `${k} ${r.ratings[k]}`).join(', ')}\nText: ${r.text}`;
}

/** Judges every (claim, valid cited review) pair once. Invalid ids are never sent to the judge. */
export function makeJudge(call: typeof callStructuredWith = callStructuredWith, model = JUDGE_MODEL, effort = JUDGE_EFFORT) {
  const usage = { input: 0, output: 0 };
  const judge = async (outputs: AnswerOutput[], d: EvalData): Promise<Verdict[]> => {
    const jobs: { outputIndex: number; claimIndex: number; reviewId: string; claim: string }[] = [];
    outputs.forEach((o, outputIndex) => o.answer?.claims.forEach((c, claimIndex) => {
      for (const reviewId of new Set(c.reviewIds)) if (d.byId.has(reviewId)) jobs.push({ outputIndex, claimIndex, reviewId, claim: c.text });
    }));
    const verdicts: Verdict[] = [];
    await pool(jobs, 4, async (j) => {
      try {
        const { value, usage: u } = await call({ model, effort }, JudgeSchema, JUDGE_PROMPT, judgeInput(j.claim, d.byId.get(j.reviewId)!));
        usage.input += u.input; usage.output += u.output;
        verdicts.push({ outputIndex: j.outputIndex, claimIndex: j.claimIndex, reviewId: j.reviewId, supported: value.supported, reason: value.reason });
      } catch (e) {
        verdicts.push({ outputIndex: j.outputIndex, claimIndex: j.claimIndex, reviewId: j.reviewId, supported: false, reason: '', error: (e as Error).message } as Verdict);
      }
    });
    return verdicts.sort((a, b) => a.outputIndex - b.outputIndex || a.claimIndex - b.claimIndex || a.reviewId.localeCompare(b.reviewId));
  };
  return Object.assign(judge, { model, effort, prompt: JUDGE_PROMPT, usage });
}
