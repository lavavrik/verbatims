import { z } from 'zod';
import { callStructuredWith, LlmError, pool } from '../llm';
import type { PublishedReview } from '../pipeline/build';
import { RATING_KEYS } from '../types';
import type { AnswerOutput, Judge, JudgeJob, Verdict } from './answer';
import { costUsd } from './cost';
import type { EvalData } from './data';

export const JUDGE_MODEL = 'claude-opus-5-5';
export const JUDGE_EFFORT = 'medium' as const;
export const JUDGE_MAX_TOKENS = 1024;
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

/** Judges each (claim, valid cited review) pair once. Invalid ids are never sent to the judge. */
export function makeJudge(call: typeof callStructuredWith = callStructuredWith, model = JUDGE_MODEL, effort = JUDGE_EFFORT): Judge {
  const usage = { input: 0, output: 0 };
  const jobs = (outputs: AnswerOutput[], d: EvalData): JudgeJob[] => {
    const out: JudgeJob[] = [];
    outputs.forEach((o, outputIndex) => o.answer?.claims.forEach((c, claimIndex) => {
      for (const reviewId of new Set(c.reviewIds)) if (d.byId.has(reviewId)) out.push({ outputIndex, claimIndex, reviewId, claim: c.text });
    }));
    return out;
  };
  /** Upper bound: the input as sent, and the maximum output for every call. */
  const estimate = (js: JudgeJob[], d: EvalData) => costUsd(model, {
    input: js.reduce((a, j) => a + Math.ceil((JUDGE_PROMPT.length + judgeInput(j.claim, d.byId.get(j.reviewId)!).length) / 3), 0),
    output: JUDGE_MAX_TOKENS * js.length,
  });
  const run = async (js: JudgeJob[], d: EvalData): Promise<Verdict[]> => {
    const verdicts: Verdict[] = [];
    await pool(js, 4, async (j) => {
      const base = { outputIndex: j.outputIndex, claimIndex: j.claimIndex, reviewId: j.reviewId };
      try {
        const { value, usage: u } = await call({ model, effort, maxTokens: JUDGE_MAX_TOKENS }, JudgeSchema, JUDGE_PROMPT, judgeInput(j.claim, d.byId.get(j.reviewId)!));
        usage.input += u.input; usage.output += u.output;
        verdicts.push({ ...base, supported: value.supported, reason: value.reason });
      } catch (e) {
        if (e instanceof LlmError) { usage.input += e.usage.input; usage.output += e.usage.output; }
        verdicts.push({ ...base, supported: false, reason: '', error: (e as Error).message });
      }
    });
    return verdicts.sort((a, b) => a.outputIndex - b.outputIndex || a.claimIndex - b.claimIndex || a.reviewId.localeCompare(b.reviewId));
  };
  return { model, effort, prompt: JUDGE_PROMPT, usage, jobs, estimate, run };
}
