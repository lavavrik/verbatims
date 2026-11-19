# verbatims Eval Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure topic classification (agreement, consistency) and grounded answers (planted-trend key, citation support) for Claude Haiku 5.5 and Sonnet 5.5, writing committed, self-describing result files.

**Architecture:** `src/eval/` holds pure modules (data, split, stats, metrics, context, judge scoring) plus thin runners that call Claude through the existing `src/llm.ts`. The runners are generalised to take a model and effort and to return token usage. Each run writes one `results/*.json` with outputs, and metrics are recomputable from those outputs alone. CLIs live in `src/cli/eval-*.ts`.

**Tech Stack:** Node 24, TypeScript ESM, vitest, zod, `@anthropic-ai/sdk` (`client.messages.parse` + `zodOutputFormat`), tsx.

**Spec:** `docs/superpowers/specs/2026-11-19-eval-runner-design.md`

## Global Constraints

- Models under test: `claude-haiku-5-5`, `claude-sonnet-5-5`. Judge: `claude-opus-5-5` at effort `medium`. Runs under test default to effort `low`. Never send `thinking`, `temperature`, `top_p` or `top_k`.
- Prices per 1M tokens (input / output): haiku-5-5 0.10 / 0.50; sonnet-5-5 2 / 10; opus-5-5 4 / 20.
- Read only `data/`, `decisions/redate.json`, `decisions/complaints.json` and `labels/`. **Never `raw/`.**
- Nothing in this step writes to `labels/` except `npm run eval:judge-check` (`labels/judge-checks.json`).
- Rates are shown with n and a 95% Wilson interval. F1 is shown without an interval.
- Headline classification = **test** half of the **75 sampled** labelled reviews; dev and all 100 are shown alongside; the 25 added complaints are reported separately.
- Q1 key: `cleanliness`, `2026-06`, with eligible months having ≥ 8 reviews and the metric "monthly average furthest below the category's overall average". The runner refuses to ask Q1 if the code-computed answer differs from the key.
- Concurrency ≤ 4. Before any run: 10 calls, cost projection, then a y/N confirm (skipped with `--yes`).
- Prompts are written from scratch and must not reproduce Quantum Metric's prompt.
- Commits use the repo-local git identity; end messages with the Co-Authored-By and Claude-Session trailers.

## Review Focus

1. The model returns a topic twice, in another case, or returns nothing: topic sets are deduplicated, the schema enum rejects unknown names, and an empty set is a valid answer (pinned in Task 4).
2. A refusal or API error mid-run: it's recorded as `{ error }` for that call, the run continues, and metrics exclude errored calls while counting them (pinned in Task 3 and Task 4).
3. Cited IDs that don't exist or are malformed (`"r12"`, `"12"`): they count as invalid citations, the judge isn't called for them, and a claim with only invalid citations counts as unsupported (pinned in Task 6).
4. An interrupted run resumed later: the progress cache is keyed by model + effort + prompt hash + dataset hash, so a resumed run never mixes outputs from another prompt or dataset (pinned in Task 4).
5. Zero denominators: a topic never predicted or never labelled, or a language with fewer than 5 labels. Precision, recall and F1 are `null` (shown as "n/a"), never NaN, and small languages fold into "other" (pinned in Task 3).

---

### Task 1: Generalise the Claude wrapper, add cost

**Files:** Modify `src/llm.ts`; create `src/eval/cost.ts`, `tests/eval/cost.test.ts`

**Interfaces:**
- Produces:
  - `callStructuredWith<T>(opts: { model: string; effort: 'low'|'medium'|'high'; maxTokens?: number }, schema: z.ZodType<T>, system: string, user: string): Promise<{ value: T; usage: { input: number; output: number } }>`. `usage.input` includes cache read/creation tokens. The existing `callStructured` becomes a wrapper using `MODEL`/`EFFORT`, so step-1 callers are unchanged.
  - `src/eval/cost.ts`: `PRICES: Record<string, { input: number; output: number }>` (per 1M); `costUsd(model, usage): number` (throws for an unknown model); `projectCost(model, sample: {input:number;output:number}[], totalCalls: number): number`.

- [ ] **Step 1: Failing tests:** `costUsd('claude-sonnet-5-5', { input: 1_000_000, output: 100_000 })` is `3`; an unknown model throws; `projectCost` scales the sample's mean usage to `totalCalls`.
- [ ] **Step 2: Run** `npx vitest run tests/eval/cost.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** **Step 4:** `npm test`, PASS. **Step 5: Commit** `feat(eval): model-parametric Claude calls and cost estimates`.

### Task 2: Eval data and the dev/test split

**Files:** Create `src/eval/data.ts`, `src/eval/split.ts`, `src/cli/eval-split.ts`, `tests/eval/split.test.ts`; script `eval:split`.

**Interfaces:**
- Produces:
  - `type EvalData = { reviews: PublishedReview[]; byId: Map<string, PublishedReview>; topics: { name: string; description: string }[]; labels: Record<string, { topics: string[]; viaTranslation: boolean }>; redate: { targetMonth: string; moves: { id: string }[]; groundTruth: string[] }; confirmedComplaints: string[]; datasetHash: string }`
  - `loadEvalData(dir = '.'): Promise<EvalData>`, with `datasetHash` = sha256 of `data/reviews.jsonl`.
  - `addedLabelIds(d: EvalData): string[]`: re-dated IDs plus the first 10 confirmed complaints not among them, in `decisions/complaints.json` order (the same rule as `labelApi` topicQueue `extra`). `sampledLabelIds(d)`: the labelled IDs minus the added ones.
  - `makeSplit(ids: string[], languageOf: (id) => string): { dev: string[]; test: string[] }`: group by language, sort each group by `sha256(id)`, alternate test/dev within each group (first goes to test). Deterministic.
  - `eval/split.json`: `{ datasetHash, sampled: { dev, test }, added }`. CLI `npm run eval:split` writes it.

- [ ] **Step 1: Failing tests:** `addedLabelIds` returns the re-dated IDs plus 10 more confirmed complaints for a fixture; `makeSplit` is deterministic, the two halves are disjoint and together cover the input, and each language's counts differ by ≤ 1 between halves.
- [ ] **Step 2:** Run, FAIL. **Step 3:** Implement. **Step 4:** `npm test`, PASS, then `npm run eval:split` prints `sampled 75 (dev 37, test 38), added 25`. **Step 5: Commit** `feat(eval): data loading and dev/test split`.

### Task 3: Statistics and classification metrics (pure)

**Files:** Create `src/eval/stats.ts`, `src/eval/classifyMetrics.ts`, `tests/eval/classifyMetrics.test.ts`

**Interfaces:**
- Produces:
  - `wilson(k: number, n: number): { rate: number; low: number; high: number } | null`: null when `n === 0`; z = 1.96.
  - `type ClassifyOutput = { id: string; rep: number; topics?: string[]; error?: string; usage: { input: number; output: number } }`
  - `prf(pred: Set<string>[], gold: Set<string>[], topic?: string): { precision: number|null; recall: number|null; f1: number|null; tp: number; fp: number; fn: number }`: micro over pairs, or one topic when given.
  - `classificationMetrics(outputs: ClassifyOutput[], d: EvalData, split: Split): { [subset in 'test'|'dev'|'sampled'|'added'|'all']: SubsetMetrics }`. `SubsetMetrics` = `{ n, errors, exactSet: wilson, micro: prf, perTopic: Record<topic, prf>, perLanguage: Record<lang|'other', prf & { n }>, withoutTranslated: { n, exactSet, micro } }`. It uses rep 1 only; languages with fewer than 5 labelled reviews in the subset fold into `other`.
  - `consistencyMetrics(outputs: ClassifyOutput[], ids: string[]): { n, stable: wilson, meanJaccard: number, flipRate: Record<topic, number>, unstable: string[] }` over all reps of each ID, excluding errored reps. An ID with fewer than 2 good reps is skipped and counted in `skipped`.
  - `topicCounts(outputs): Record<topic, number>` over rep 1, for all reviews.

- [ ] **Step 1: Failing tests:**

```ts
test('wilson(38, 38) is 1 with a lower bound below 1; wilson(0, 0) is null', ...);
test('prf handles zero denominators as null, not NaN', () => {
  expect(prf([new Set()], [new Set()]).precision).toBeNull();
});
test('exact-set agreement counts identical sets only, order-insensitive', ...);
test('errored outputs are excluded and counted', ...);
test('languages under 5 labels fold into other', ...);
test('consistency: identical reps → stable 100%, Jaccard 1; one flip → topic flipRate 1/n', ...);
```

- [ ] **Step 2:** Run, FAIL. **Step 3:** Implement. **Step 4:** `npm test`, PASS. **Step 5: Commit** `feat(eval): classification and consistency metrics`.

### Task 4: Classification runner, prompts, result files

**Files:** Create `prompts/classify-v1.md`, `prompts/classify-v2.md`, `src/eval/prompts.ts`, `src/eval/classify.ts`, `src/eval/results.ts`, `src/eval/confirm.ts`, `src/cli/eval-classify.ts`, `src/cli/eval-metrics.ts`, `tests/eval/classify.test.ts`; scripts `eval:classify`, `eval:metrics`.

**Interfaces:**
- Consumes: `callStructuredWith`, `costUsd`, `projectCost`, `loadEvalData`, the split, `classificationMetrics`, `consistencyMetrics`, `topicCounts`.
- Produces:
  - `renderClassifyPrompt(version: 'v1'|'v2', topics): string`: v1 lists names only, v2 lists names with descriptions. The prompt files use a `{{topics}}` placeholder.
  - `TopicsSchema(names: string[])` = `z.object({ topics: z.array(z.enum(names)) })`; `normaliseTopics(t: string[]): string[]` = deduplicated and sorted.
  - `classifyUserMessage(r: PublishedReview): string`: `Language: <iso>\n\n<text>`, with no ratings and no date.
  - `type ResultFile = { runId; kind: 'classify'|'answer'; createdAt; model; effort; promptVersion; prompt; promptHash; datasetHash; splitHash; reps; outputs; usage: { inputTokens; outputTokens; estCostUsd }; metrics }`
  - `resultPath(kind, model, promptVersion, date): string` = `results/<YYYY-MM-DD>-<kind>-<model>-<prompt>.json`. If the path exists, add a `-2`, `-3`… suffix.
  - `cacheKey({ model, effort, promptHash, datasetHash }): string` gives the progress file `cache/runs/<key>.json` (resumable).
  - `runClassify({ model, effort = 'low', version, reps = 5, yes = false }, deps = { call: callStructuredWith, confirm })`: rep 1 covers all 421 reviews; reps 2..reps cover the 100 labelled. The first 10 calls give a projection, then `confirm` runs. Errors are recorded per call. It writes the result file with `metrics = { classification, consistency, topicCounts }`.
  - `npm run eval:metrics -- <file>` recomputes `metrics` from `outputs` and rewrites the file.

- [ ] **Step 1: Failing tests** (inject a fake `call`, no API):

```ts
test('v1 prompt lists names only; v2 adds every description', ...);
test('duplicate and differently ordered topics normalise to one sorted set', ...);
test('schema rejects a topic outside the list', ...);
test('rep 1 covers all reviews, reps 2..5 only the labelled 100', ...);
test('an error on one call is recorded and the run completes', ...);
test('resuming with a different prompt hash does not reuse cached outputs', ...);
test('declining the projection writes no result file', ...);
```

- [ ] **Step 2:** Run, FAIL. **Step 3:** Implement and write both prompts. **Step 4:** `npm test`, PASS. **Step 5: Commit** `feat(eval): classification runner, prompts v1/v2, result files`.

### Task 5: Grounded-answer context, key check and runner

**Files:** Create `eval/questions.json`, `prompts/answer-v1.md`, `src/eval/context.ts`, `src/eval/answer.ts`, `src/cli/eval-answer.ts`, `tests/eval/context.test.ts`; script `eval:answer`.

**Interfaces:**
- Produces:
  - `monthlyTable(reviews): { month: string; n: number; avg: Ratings; eligible: boolean }[]`, with `eligible = n >= 8`.
  - `largestDrop(table, overall: Ratings): { category: RatingKey; month: string; gap: number }`, eligible months only.
  - `assertQ1Key(reviews, key = { category: 'cleanliness', month: '2026-06' })`: throws with the computed answer when it differs.
  - `renderContext(reviews, table): string`. One line per review: `id | date | language | overall cleanliness accuracy checkin communication location value | text`. The table follows, with months under 8 reviews marked `too few reviews`.
  - `AnswerSchema` = `z.object({ answer: z.string(), claims: z.array(z.object({ text: z.string(), reviewIds: z.array(z.string()).min(1) })).max(8) })`. `Q1Schema` extends it with `category: z.enum(RATING_KEYS)` and `month: z.string().regex(/^\d{4}-\d{2}$/)`.
  - `eval/questions.json`: `[{ id: 'Q1', text }, { id: 'Q2', text }, { id: 'Q3', text }]`, with the wording copied verbatim from the spec.
  - `runAnswer({ model, effort = 'low', reps = 3, yes })`: asks each question independently, `reps` times, using the same system prompt and context, with prompt caching (`cache_control` on the context block). The context goes in the system prompt so the cache is shared across questions. Runs the 10-call projection rule with `min(10, total)` calls. Writes a `kind: 'answer'` result file; `metrics` is filled by Task 6.

- [ ] **Step 1: Failing tests:** on the real `data/reviews.jsonl`, `largestDrop` gives cleanliness 2026-06 with a gap above 1; `assertQ1Key` throws for a fixture where another month wins; a month with 7 reviews is not eligible; `renderContext` contains no `raw/` fields (no reviewer or listing names; check keys only) and ends with the table.
- [ ] **Step 2:** Run, FAIL. **Step 3:** Implement. **Step 4:** `npm test`, PASS. **Step 5: Commit** `feat(eval): grounded-answer context, Q1 key check and runner`.

### Task 6: Judge, answer metrics and judge spot-check

**Files:** Create `src/eval/judge.ts`, `src/eval/answerMetrics.ts`, `src/cli/eval-judge-check.ts`, `tests/eval/answerMetrics.test.ts`; script `eval:judge-check`. Modify `src/eval/answer.ts` to run the judge after the answers.

**Interfaces:**
- Produces:
  - `JudgeSchema = z.object({ supported: z.boolean(), reason: z.string() })`; `JUDGE_PROMPT` follows the spec's rule (evidence for the claim; a single review needn't prove a count; it must fit the claim's time frame when one is named).
  - `judgeInput(claim: string, r: PublishedReview): string` contains the id, date, ratings and text.
  - `type Verdict = { outputIndex: number; claimIndex: number; reviewId: string; supported: boolean; reason: string }`, stored in the result file's `judge: { model, effort, prompt, verdicts }`.
  - `answerMetrics(outputs, verdicts, d: EvalData)` returns per question: `{ n, errors, q1Correct?: wilson, invalidCitations: number, citations: number, claims: number, unsupportedClaims: wilson /* hallucination rate */, q2?: { recall: wilson, precision: wilson, offMonthRelevant: number } }`. A claim is supported if at least one valid citation is judged supported.
  - `npm run eval:judge-check`: samples 20 verdicts from all answer result files (10 supported, 10 not, seeded), asks y/n in the terminal, and appends to `labels/judge-checks.json` `{ resultFile, outputIndex, claimIndex, reviewId, judge: boolean, owner: boolean }`. It then prints agreement per class.
  - `answerMetrics` also takes the judge checks (if any) and reports `judgeAgreement: { onSupported: wilson, onUnsupported: wilson }`.
  - `npm run eval:metrics -- <file>` (Task 4) is extended to recompute answer metrics for `kind: 'answer'` files from stored outputs and verdicts. It never re-calls the judge.

- [ ] **Step 1: Failing tests:**

```ts
test('invalid or malformed ids count as invalid and are never judged', ...);
test('a claim with only invalid citations is unsupported', ...);
test('Q1 is correct only when both category and month match', ...);
test('Q2 precision counts confirmed complaints from other months as wrong, and reports them as offMonthRelevant', ...);
test('Q2 recall is the share of ground-truth ids cited at least once', ...);
test('judge agreement is reported per class', ...);
```

- [ ] **Step 2:** Run, FAIL. **Step 3:** Implement. **Step 4:** `npm test`, PASS. **Step 5: Commit** `feat(eval): citation judge, answer metrics, judge spot-check`.

### Task 7: Compare runs, and README

**Files:** Create `src/eval/compare.ts`, `src/cli/eval-compare.ts`, `tests/eval/compare.test.ts`; script `eval:compare`. Modify `README.md` (a short "Evaluating" section with the commands and a pointer to `results/`).

**Interfaces:**
- Produces:
  - `compareRuns(a: ResultFile, b: ResultFile, d: EvalData): { metricDeltas: { name: string; a: number|null; b: number|null; nA: number; nB: number }[]; improved: string[]; regressed: string[] }`. Classification only: a review "improved" if its rep-1 set went from ≠ label to = label, and "regressed" the other way. It refuses to compare runs with different `datasetHash` or `kind`.
  - The CLI prints the deltas table, then each improved or regressed review with the label, A's set and B's set, and its text (first 200 characters).

- [ ] **Step 1: Failing tests:** improved and regressed are computed from rep 1 against the labels; differing dataset hashes throw; the deltas include `test exact-set` and `test micro F1`.
- [ ] **Step 2:** Run, FAIL. **Step 3:** Implement and update the README. **Step 4:** `npm test`, PASS. **Step 5: Commit** `feat(eval): compare runs; README evaluating section`.

---

## Running order for the owner (after Tasks 1–7)

`npm run eval:split` → for each model in haiku-5-5, sonnet-5-5 and each prompt in v1, v2: `npm run eval:classify -- --model claude-<m> --prompt <v>` → for each model: `npm run eval:answer -- --model claude-<m>` → `npm run eval:judge-check` → `npm run eval:compare -- results/<v1>.json results/<v2>.json`.
