import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { callStructuredWith, LlmError, pool } from '../llm';
import { RATING_KEYS } from '../types';
import { assertQ1Key, monthlyTable, renderContext } from './context';
import { answerMetrics, type JudgeCheck } from './answerMetrics';
import { costUsd } from './cost';
import { loadEvalData, type EvalData } from './data';
import { loadPromptTemplate, promptHash } from './prompts';
import { cacheKey, readCache, resultPath, writeCache, writeResult, type ResultFile } from './results';
import type { Deps as ClassifyDeps, Effort } from './classify';

// Limits the API can't enforce (claim count, month format) live in the prompt and in scoring,
// not in the schema: a schema failure would throw away an answer that was already paid for.
export const AnswerSchema = z.object({
  answer: z.string(),
  claims: z.array(z.object({ text: z.string(), reviewIds: z.array(z.string()).min(1) })),
});
export const Q1Schema = AnswerSchema.extend({
  category: z.enum(RATING_KEYS as [string, ...string[]]),
  month: z.string(),
});
export type Answer = z.infer<typeof Q1Schema> | z.infer<typeof AnswerSchema>;
export type Question = { id: 'Q1' | 'Q2' | 'Q3'; text: string };
export type AnswerOutput = { questionId: string; rep: number; answer?: Answer & { category?: string; month?: string }; error?: string; usage: { input: number; output: number } };
export type Verdict = { outputIndex: number; claimIndex: number; reviewId: string; supported: boolean; reason: string; error?: string };
export type JudgeJob = { outputIndex: number; claimIndex: number; reviewId: string; claim: string };
export type Judge = {
  model: string; effort: string; prompt: string; usage: { input: number; output: number };
  jobs: (outputs: AnswerOutput[], d: EvalData) => JudgeJob[];
  estimate: (jobs: JudgeJob[], d: EvalData) => number;
  run: (jobs: JudgeJob[], d: EvalData) => Promise<Verdict[]>;
};

export type AnswerOptions = { model: string; effort?: Effort; reps?: number; yes?: boolean; dir?: string; data?: EvalData; questions?: Question[]; template?: string };
export type AnswerDeps = ClassifyDeps & { judge: Judge };

export const ANSWER_MAX_TOKENS = 8000;

/**
 * Asks each question independently `reps` times with the whole dataset in a cached system
 * prompt. The cost is projected from the prompt size *before* any call, since every call
 * carries all reviews. Then the judge checks every citation.
 */
export async function runAnswer(opts: AnswerOptions, deps: AnswerDeps): Promise<ResultFile<AnswerOutput> | null> {
  const dir = opts.dir ?? '.', effort = opts.effort ?? 'low', reps = opts.reps ?? 3, log = deps.log ?? (() => {});
  const d = opts.data ?? (await loadEvalData(dir));
  assertQ1Key(d.reviews);
  const questions: Question[] = opts.questions ?? JSON.parse(await readFile(join(dir, 'eval/questions.json'), 'utf8'));
  const system = `${opts.template ?? (await loadPromptTemplate('answer-v1', dir))}\n\n${renderContext(d.reviews, monthlyTable(d.reviews))}`;
  const hash = promptHash(system + JSON.stringify(questions));

  const jobs = questions.flatMap((q) => Array.from({ length: reps }, (_, i) => ({ q, rep: i + 1 })));
  const key = cacheKey({ kind: 'answer', model: opts.model, effort, promptHash: hash, datasetHash: d.datasetHash });
  const done = await readCache<AnswerOutput>(dir, key);
  const todo = jobs.filter((j) => !done[`${j.q.id}#${j.rep}`]?.answer);

  if (todo.length) {
    const estInput = Math.ceil(system.length / 3.5) * todo.length;
    const projected = costUsd(opts.model, { input: estInput, output: ANSWER_MAX_TOKENS * todo.length });
    const question = `${opts.model} answers: ${todo.length} calls with the whole dataset each, at most ≈ $${projected.toFixed(2)} (before caching discounts; the judge is confirmed separately). Continue?`;
    log(question);
    if (!opts.yes && !(await deps.confirm(question))) { log('Stopped before any call.'); return null; }
  }

  // Questions run one after another so the first call writes the context cache the rest read.
  await pool(todo, 1, async (j) => {
    const schema = j.q.id === 'Q1' ? Q1Schema : AnswerSchema;
    try {
      const { value, usage } = await deps.call({ model: opts.model, effort, maxTokens: ANSWER_MAX_TOKENS, cacheSystem: true }, schema, system, `${j.q.id}. ${j.q.text}`);
      done[`${j.q.id}#${j.rep}`] = { questionId: j.q.id, rep: j.rep, answer: value as Answer, usage };
    } catch (e) {
      done[`${j.q.id}#${j.rep}`] = { questionId: j.q.id, rep: j.rep, error: (e as Error).message, usage: e instanceof LlmError ? e.usage : { input: 0, output: 0 } };
    }
    await writeCache(dir, key, done);
    log(`… ${j.q.id} rep ${j.rep}`);
  });

  const outputs = jobs.map((j) => done[`${j.q.id}#${j.rep}`]);

  // The judge spends too (Opus): its own projection and confirmation, and cached verdicts.
  const judgeKey = `${key}-judge-${deps.judge.model}-${promptHash(deps.judge.prompt)}`;
  const judged = await readCache<Verdict>(dir, judgeKey);
  const vKey = (v: { outputIndex: number; claimIndex: number; reviewId: string }) => `${v.outputIndex}#${v.claimIndex}#${v.reviewId}`;
  const judgeJobs = deps.judge.jobs(outputs, d);
  const pending = judgeJobs.filter((j) => !judged[vKey(j)]);
  const fresh = new Map<string, Verdict>();
  if (pending.length) {
    const q = `Judge (${deps.judge.model}): ${pending.length} citation checks, at most ≈ $${deps.judge.estimate(pending, d).toFixed(2)}. Continue?`;
    log(q);
    if (!opts.yes && !(await deps.confirm(q))) { log('Stopped before judging. Answers are cached; run again to judge.'); return null; }
    for (const v of await deps.judge.run(pending, d)) { fresh.set(vKey(v), v); if (!v.error) judged[vKey(v)] = v; }
    await writeCache(dir, judgeKey, judged);
  }
  const verdicts = judgeJobs.map((j) => judged[vKey(j)] ?? fresh.get(vKey(j)) ?? { outputIndex: j.outputIndex, claimIndex: j.claimIndex, reviewId: j.reviewId, supported: false, reason: '', error: 'not judged' });
  const inputTokens = outputs.reduce((a, o) => a + o.usage.input, 0), outputTokens = outputs.reduce((a, o) => a + o.usage.output, 0);
  const date = new Date().toISOString().slice(0, 10);
  const path = resultPath('answer', opts.model, 'answer-v1', date, dir);
  const file: ResultFile<AnswerOutput> = {
    runId: path.split('/').pop()!.replace(/\.json$/, ''),
    kind: 'answer', createdAt: new Date().toISOString(), model: opts.model, effort, promptVersion: 'answer-v1',
    prompt: system, promptHash: hash, datasetHash: d.datasetHash, splitHash: '', reps, outputs,
    usage: { inputTokens, outputTokens, estCostUsd: costUsd(opts.model, { input: inputTokens, output: outputTokens }) },
    metrics: answerMetrics(outputs, verdicts, d, await loadJudgeChecks(dir)),
    judge: { model: deps.judge.model, effort: deps.judge.effort, prompt: deps.judge.prompt, verdicts, usage: deps.judge.usage, estCostUsd: costUsd(deps.judge.model, deps.judge.usage) },
  };
  await writeResult(path, file);
  log(`Wrote ${path}.`);
  return file;
}

/** The owner's judge spot-check answers, pooled over all runs. */
export async function loadJudgeChecks(dir = '.'): Promise<JudgeCheck[]> {
  try { return JSON.parse(await readFile(join(dir, 'labels/judge-checks.json'), 'utf8')); } catch { return []; }
}
