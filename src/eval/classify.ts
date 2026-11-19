import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { callStructuredWith, LlmError, pool } from '../llm';
import { classificationMetrics, consistencyMetrics, topicCounts, type ClassifyOutput, type SplitFile } from './classifyMetrics';
import { costUsd, projectCost } from './cost';
import { loadEvalData, type EvalData } from './data';
import { classifyUserMessage, loadPromptTemplate, normaliseTopics, promptHash, renderClassifyPrompt, TopicsSchema, type ClassifyVersion } from './prompts';
import { cacheKey, readCache, resultPath, writeCache, writeResult, type ResultFile } from './results';

export type Effort = 'low' | 'medium' | 'high';
export type ClassifyOptions = {
  model: string; version: ClassifyVersion; effort?: Effort; reps?: number; yes?: boolean; dir?: string;
  data?: EvalData; split?: SplitFile; template?: string;
};
export type Deps = { call: typeof callStructuredWith; confirm: (question: string) => Promise<boolean>; log?: (line: string) => void };

export const PROJECTION_CALLS = 10;
export const CONCURRENCY = 4;

export function computeClassifyMetrics(outputs: ClassifyOutput[], d: EvalData, split: SplitFile) {
  return {
    classification: classificationMetrics(outputs, d, split),
    consistency: consistencyMetrics(outputs, Object.keys(d.labels)),
    topicCounts: topicCounts(outputs),
  };
}

/**
 * Classifies every review once (rep 1) and the labelled ones `reps - 1` more times. Spends
 * PROJECTION_CALLS calls first, shows the projected cost, and stops unless confirmed.
 * Returns the written result file, or null when the owner declined.
 */
export async function runClassify(opts: ClassifyOptions, deps: Deps): Promise<ResultFile<ClassifyOutput> | null> {
  const dir = opts.dir ?? '.', effort = opts.effort ?? 'low', reps = opts.reps ?? 5, log = deps.log ?? (() => {});
  const d = opts.data ?? (await loadEvalData(dir));
  const splitText = opts.split ? JSON.stringify(opts.split) : await readFile(join(dir, 'eval/split.json'), 'utf8');
  const split: SplitFile = JSON.parse(splitText);
  const prompt = renderClassifyPrompt(opts.version, d.topics, opts.template ?? (await loadPromptTemplate(`classify-${opts.version}`, dir)));
  const hash = promptHash(prompt);
  const schema = TopicsSchema(d.topics.map((t) => t.name));

  const labelled = Object.keys(d.labels).sort();
  const jobs = [
    ...d.reviews.map((r) => ({ id: r.id, rep: 1 })),
    ...Array.from({ length: reps - 1 }, (_, i) => labelled.map((id) => ({ id, rep: i + 2 }))).flat(),
  ];
  const key = cacheKey({ kind: 'classify', model: opts.model, effort, promptHash: hash, datasetHash: d.datasetHash });
  const done = await readCache<ClassifyOutput>(dir, key);
  // Only successes are reused; errors (outages, rate limits) are retried on resume.
  const todo = jobs.filter((j) => !done[`${j.id}#${j.rep}`]?.topics);

  const run = async (j: { id: string; rep: number }) => {
    try {
      const { value, usage } = await deps.call({ model: opts.model, effort }, schema, prompt, classifyUserMessage(d.byId.get(j.id)!));
      done[`${j.id}#${j.rep}`] = { id: j.id, rep: j.rep, topics: normaliseTopics(value.topics), usage };
    } catch (e) {
      done[`${j.id}#${j.rep}`] = { id: j.id, rep: j.rep, error: (e as Error).message, usage: e instanceof LlmError ? e.usage : { input: 0, output: 0 } };
    }
  };

  const first = todo.slice(0, PROJECTION_CALLS);
  await pool(first, CONCURRENCY, run);
  await writeCache(dir, key, done);
  if (todo.length > first.length) {
    const sample = first.filter((j) => done[`${j.id}#${j.rep}`].topics).map((j) => done[`${j.id}#${j.rep}`].usage);
    if (!sample.length) throw new Error(`All ${first.length} sample calls failed (first error: ${done[`${first[0].id}#${first[0].rep}`].error}); not continuing without a cost projection.`);
    const projected = projectCost(opts.model, sample, jobs.length);
    const question = `${opts.model} / prompt ${opts.version}: ${jobs.length} calls, projected ≈ $${projected.toFixed(2)}. Continue?`;
    log(question);
    if (!opts.yes && !(await deps.confirm(question))) { log('Stopped. Calls made so far are cached and reused next time.'); return null; }
    let n = 0;
    await pool(todo.slice(first.length), CONCURRENCY, async (j) => {
      await run(j);
      if (++n % 25 === 0) { await writeCache(dir, key, done); log(`… ${n + first.length}/${todo.length}`); }
    });
    await writeCache(dir, key, done);
  }

  const outputs = jobs.map((j) => done[`${j.id}#${j.rep}`]);
  const inputTokens = outputs.reduce((a, o) => a + o.usage.input, 0), outputTokens = outputs.reduce((a, o) => a + o.usage.output, 0);
  const date = new Date().toISOString().slice(0, 10);
  const file: ResultFile<ClassifyOutput> = {
    runId: `${date}-classify-${opts.model}-${opts.version}`,
    kind: 'classify', createdAt: new Date().toISOString(), model: opts.model, effort,
    promptVersion: opts.version, prompt, promptHash: hash, datasetHash: d.datasetHash,
    splitHash: createHash('sha256').update(splitText).digest('hex').slice(0, 16), reps, outputs,
    usage: { inputTokens, outputTokens, estCostUsd: costUsd(opts.model, { input: inputTokens, output: outputTokens }) },
    metrics: computeClassifyMetrics(outputs, d, split),
  };
  const path = resultPath('classify', opts.model, opts.version, date, dir);
  file.runId = path.split('/').pop()!.replace(/\.json$/, '');
  await writeResult(path, file);
  log(`Wrote ${path} (${outputs.filter((o) => o.error).length} errors, ≈ $${file.usage.estCostUsd.toFixed(2)}).`);
  return file;
}
