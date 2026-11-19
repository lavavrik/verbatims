# verbatims: eval runner (step 2)

Date: 2026-11-19
Owner: Lavrentii Prokopovych
Size: project
Builds on: `2026-11-19-dataset-design.md` (step 1, done: `data/`, `labels/`, `decisions/`)

## Intent

Measure, with honest numbers, the LLM tasks Voice of Customer relied on, using the
dataset from step 1. The audience is hiring engineers (Anthropic product and growth
teams). The project should show that the owner knows how to tell whether an LLM feature
works and whether a change made it better.

Headline experiment: **topic prompt v1 (names only) vs v2 (names + descriptions)**,
on **Claude Haiku 5.5 and Claude Sonnet 5.5**. This mirrors the owner's real-world fix
(adding descriptions made topics consistent), now measured.

Step 3 (a report page) reads this step's result files. It's a separate design.

## Goals

1. **Topic classification:** each configuration (model × prompt version) classifies all
   421 reviews. It is scored against the owner's 100 hand labels.
2. **Consistency:** the 100 labelled reviews are classified 5 times per configuration,
   measuring how often the answer changes.
3. **Grounded answers:** fixed questions about the dataset, answered with review-ID
   citations, checked against the planted-trend answer key, with every citation
   checked for support.
4. **Comparison:** what changed between two runs, both as metrics and per review
   (which reviews improved or regressed).
5. **Committed, self-describing results**, so step 3 and any reader can trust where
   every number came from.

## Non-goals

- Gemini or other vendors (later; the model is a parameter, but no provider abstraction now).
- The report page (step 3).
- Prompt optimisation loops or automated prompt search.
- Batch API, fine-tuning, embeddings or retrieval: all 421 reviews (~60k tokens) fit in one request.

## Anti-goals (fail even if it technically works)

- **Tuning prompts on the numbers that are reported.** Any future prompt iteration
  looks only at a fixed **dev** half of the labels; headline numbers come from the
  **test** half. v1 and v2 are written up front, before any run.
- **Overclaiming:** every rate is shown with its n and a 95% interval (Wilson). No
  "accuracy" without saying against what.
- **Hidden judge:** LLM-judged numbers are labelled as such, and the judge is itself
  spot-checked by the owner.
- **Answer keys from an LLM.** Labels, complaints and the trend come from step 1, and
  nothing in this step writes to `labels/` except the owner's judge spot-check.
- **Leaking personal data:** the runner only ever reads published `data/`
  (redacted text), never `raw/`.

## Constraints

- Same repo, stack and conventions as step 1: TypeScript, Node 24, vitest test-first,
  `npm test` runs the typecheck, and commits use the repo-local git identity.
- Anthropic SDK structured outputs (`client.messages.parse` + `zodOutputFormat`). Models
  under test: `claude-haiku-5-5`, `claude-sonnet-5-5`. Judge: `claude-opus-5-5`.
- **Effort is pinned per run and recorded.** Default for runs under test is `low` on both
  models (short texts, classification). Thinking is left at each model's default, since it
  can't be disabled on these models. Sampling parameters can't be set; run-to-run
  variation is what the consistency measure captures.
- The owner's API key comes from `.env`. Budget: an **estimate**, not a hard limit, of about
  $5–6 for the first round. Thinking tokens make Sonnet's real cost uncertain, so **every
  run first makes 10 calls, projects the full run's cost from their actual token usage,
  prints it, and asks the owner to confirm** (a `--yes` flag skips the prompt). Nothing
  big is spent without the owner seeing the number first.
- Price table (per 1M tokens, input / output): Haiku 5.5 $0.10 / $0.50; Sonnet 5.5
  $2 / $10; Opus 5.5 $4 / $20. Kept in one config file, and every run records its
  token usage and estimated cost.

## Approaches considered

- **A. Extend the `verbatims` repo with `src/eval/` and npm commands** (*chosen*). It
  reuses the Claude wrapper, data, labels and test setup, and keeps one story from
  dataset to measurement.
- B. A separate repo reading the published dataset. Clean separation, but duplicated
  setup and two repos for one story.
- C. An off-the-shelf tool (e.g. promptfoo). It handles the matrix and judging, but the
  key measures (consistency, citation checks against the planted trend, per-language
  scores) need custom code anyway, and it shows less of the owner's own work. Mentioned
  in the write-up as an alternative.

Owner decisions: Claude only for now (no Gemini yet); models under test are Haiku 5.5
and Sonnet 5.5 to start.

## Decided

### Labels split (builder's call, recorded)

Of the 100 labelled reviews, **25 were added on purpose** (the 15 re-dated complaints plus
10 more confirmed complaints) and **75 were sampled** in proportion to language. Only the
sampled 75 represent the dataset, so:

- **Headline classification numbers use the 75 sampled reviews**, split once and
  deterministically into **dev (37) and test (38)**: stratified by language, seeded by review
  ID hash, committed as `eval/split.json`. Test is the headline and dev is shown alongside.
- The **25 added complaints are reported separately** ("complaint-heavy subset").
- **All 100** are also shown, clearly labelled as not a random sample.

Which review was sampled and which added is recomputed from `decisions/redate.json` and
`decisions/complaints.json` exactly as the labelling queue built it. v1/v2 were fixed before any run,
so both halves are clean for this first round.

### Prompts

Prompts are files in `prompts/`, versioned by filename. They are written from scratch:
they must not reproduce Quantum Metric's prompt (see the owner's case-study constraints).

- `classify-v1.md`: the topic **names** only (from `data/topics.json`).
- `classify-v2.md`: names **and** one-line descriptions.
- Both: multi-label; "no topic" allowed; the answer is constrained to the topic names
  (a zod enum); the input is one review's published text (with `[name]` placeholders),
  its language, and nothing else (no ratings, no date).
- `answer-v1.md`: the grounded-answer prompt (below).

### Classification run

`npm run eval:classify -- --model <id> --prompt <v1|v2> [--reps 5]`

- Classifies all 421 reviews once (rep 1), then the 100 labelled reviews again for reps 2..5.
- It resumes if interrupted (per-call progress in git-ignored `cache/`).
- It writes **one** result file when complete (below).

### Classification metrics

All are computed per configuration and shown for **test**, **dev** and **all 100**, with n and
95% intervals where they are rates:

- **Exact-set agreement:** share of reviews whose topic set equals the owner's.
- **Micro precision / recall / F1** over (review, topic) pairs.
- **Per-topic** precision / recall / F1.
- **Per-language** micro-F1 for languages with ≥ 5 labelled reviews, and "other" for the rest.
- With and **without** labels the owner made through the translation aid (`viaTranslation`).
- Topic counts across all 421 reviews (rep 1), for the report's distribution charts.

### Consistency metrics (100 labelled × 5 reps)

- **Stable rate:** share of reviews whose topic set is identical in all 5 reps.
- **Mean pairwise Jaccard** of topic sets across reps.
- **Flip rate per topic:** share of reviews where that topic is present in some reps and absent in others.
- The list of unstable reviews (for the step-3 report and for reading).

### Grounded answers

`npm run eval:answer -- --model <id> [--reps 3]`

- **Context:** all 421 published reviews, one per line
  (`id | date | language | overall/cleanliness/… ratings | text`), plus a **monthly averages
  table computed by code** (per rating category, with review counts). This is the product
  pattern the owner described from Voice of Customer: the system supplies the numbers,
  and the model explains them with evidence. Builder's call, recorded.
- **Questions** (fixed, in `eval/questions.json`):
  - **Q1** "Considering only months with at least 8 reviews, which rating category had a
    monthly average furthest below its overall average, and in which month?" The answer is
    structured as `{ category, month, explanation, claims[] }`.
    *Key:* `cleanliness`, `2026-06`. Checked on the real data: 1.14 stars below average,
    against 0.77 for the next (12 eligible months). Without the minimum, months with
    3–4 reviews beat the key by noise. The monthly table marks months under 8 reviews as
    "too few reviews". **Before asking Q1, the runner recomputes the answer from the table
    and refuses to run if it differs from the key**, so the key can't silently go stale.
  - **Q2** is asked **on its own, not chained to the model's Q1 answer**: "Cleanliness
    ratings dropped in June 2026. Why? Support each reason with reviews from that month."
    Q1 measures detection; Q2 measures explanation and grounding without carrying Q1's
    errors over. *Key:* the ground-truth review IDs from `decisions/redate.json`.
  - **Q3** "What do guests complain about most across the whole period?" No key; only
    citation checks apply.
- **Output schema (all questions):** `{ answer: string, claims: { text: string, reviewIds: string[] }[] }`,
  with `category` and `month` added for Q1. Max 8 claims; every claim must cite at least one review.
- **Checks:**
  - **Q1 correctness:** exact match on category and month.
  - **Citation validity:** cited IDs exist in the dataset.
  - **Support:** for each (claim, cited review) pair, the judge (Opus 5.5) answers
    `{ supported: boolean, reason }`. It sees the claim and the review's id, **date, ratings
    and text**. Rule given to the judge: the review supports the claim if it is evidence
    for what the claim says about guests' experience. A single review doesn't need to prove
    a count or a trend, but it must fit the claim's time frame when the claim names one.
  - **Hallucination rate:** share of claims with **no** supporting citation.
  - **Q2 recall:** share of ground-truth IDs cited at least once. **Q2 precision:** share of
    cited IDs that are in the ground truth. Citations of genuine cleanliness complaints from
    other months (confirmed in `decisions/complaints.json`) count against precision, since
    the question asks for June evidence. They are also reported as their own number
    ("relevant, wrong month"), so the report can tell "cited the wrong month" apart from
    "cited something irrelevant".
  - Each question is asked 3 times per model; results are reported per rep and averaged.

### Judge spot-check

`npm run eval:judge-check` shows the owner 20 random judge verdicts (claim + review text +
verdict), stratified half supported and half not. The owner answers y/n in the terminal;
answers go to `labels/judge-checks.json`. Judge agreement with the owner is reported
**per class** (on verdicts the judge called supported, and on those it called not supported),
pooled over all runs, next to every judged number. Because the check sample is half and
half, a single pooled percentage would misstate the judge's accuracy on the real mix.

### Result files (committed)

`results/<YYYY-MM-DD>-<kind>-<model>-<prompt>.json`, one per completed run:

```
{ runId, kind: 'classify'|'answer', createdAt, model, effort, promptVersion, prompt (full text),
  datasetHash (sha256 of data/reviews.jsonl), splitHash, reps,
  outputs: [{ id, rep, topics | answer, usage: {input, output}, error? }],
  usage: { inputTokens, outputTokens, estCostUsd },
  metrics: { … as above … } }
```

Metrics are **recomputable** from outputs by `npm run eval:metrics -- <file>` (so metric
code fixes don't require re-running models). Refusals and API errors are recorded as
`error` outputs and counted, never silently dropped.

### Comparison

`npm run eval:compare -- <runA> <runB>` prints metric deltas (with n), and the reviews whose
agreement got better or worse between the two runs, each with both outputs and the
owner's label.

## Left to the builder

- Exact prompt wording (within the rules above), and the formatting of the context lines.
- The interval implementation (Wilson for rates; F1 shown without an interval).
- Concurrency and retry settings (the SDK handles retries; keep concurrency ≤ 4).
- Terminal output formatting of `compare` and `judge-check`.
- Folder layout under `src/eval/`.
