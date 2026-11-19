# verbatims: dataset (step 1 of the eval tool)

Date: 2026-11-19
Owner: Lavrentii Prokopovych
Size: project

## Intent

`verbatims` is a public portfolio project for Lavrentii's application to Anthropic
product and growth engineering roles. It closes the gap that reviewers (Anthropic
engineers, via SuperMe) named: he has shipped LLM features (Quantum Metric's Voice of
Customer), but his quality checking was manual and none of his work is public.

The project recreates the Voice of Customer problems on public data and measures them
properly. It has three steps, each its own design:

1. **Dataset** (this document): a published, honestly documented review dataset with known answers.
2. Eval runner: topic classification (agreement and consistency) and grounded answers (citations, hallucination), run locally with the owner's API key. A later design.
3. Report page: static, showing scores over prompt versions and regressions. A later design.

Everything in step 1 is shaped by what steps 2 and 3 need. The **answer keys** must come
from a human or from a recorded, deliberate change. They must never come from an LLM,
because grading an LLM against LLM output just compares two models.

## Goals

- A dataset of 300–500 real Airbnb reviews of **one Prague listing**, multilingual,
  shaped like a survey export: per-review overall rating, sub-ratings, date and free text.
- Three answer keys:
  1. **Topic labels:** about 100 reviews hand-labelled by the owner.
  2. **A planted trend:** real cleanliness complaints re-dated into one month, recorded in a manifest.
  3. **Rating spot-check:** about 30 generated ratings reviewed by the owner (accept or correct).
- Full provenance: every change from the Inside Airbnb original is recorded and
  reproducible by script.
- A small local labelling page for the owner's hand-labelling.

## Non-goals

- The eval runner, the scoring and the report page (steps 2–3).
- Publishing the full Inside Airbnb reviews file. Only the sample is published, plus the
  script that rebuilds it.
- Hosting or deploying the labelling page. It runs locally only.
- Multiple listings or cities.

## Anti-goals (fail even if it technically works)

- **Passing generated data off as real**, or hiding any change. Every generated or
  altered field must be marked in the data and explained in the README.
- **Publishing personal data:** reviewer names, reviewer IDs, host names, or names
  mentioned inside review text.
- **An LLM-made answer key.** Topic labels and trend ground truth must come from the owner
  or from the re-dating manifest.
- **Licence violations:** missing CC BY 4.0 attribution to Inside Airbnb.

## Constraints

- **Source:** Inside Airbnb, Prague, scrape of 2026-09-20 (as listed on the download page
  on 2026-11-19; confirm the URL when downloading):
  `https://data.insideairbnb.com/czech-republic/prague/prague/2026-09-20/data/reviews.csv.gz`
  and the matching `listings.csv.gz` for listing metadata and average sub-scores.
- **Licence:** CC BY 4.0. Credit "Inside Airbnb" as the source, link the licence, state
  the changes made and the download date. Save a dated copy of the licence wording in the repo.
- **GDPR:** the owner is in the EU. Strip reviewer names and IDs, and redact names inside
  review text (hosts and guests often name each other).
- **Privacy level (owner's decision): names removed, not anonymised.** The Inside Airbnb
  listing ID **is** published, so the dataset can be rebuilt and checked against the
  source. Reviews can therefore be matched to the public originals. The README must say
  exactly that, e.g. "Names and reviewer IDs removed. The original reviews remain public
  on Airbnb and in Inside Airbnb's dataset." It must never say "anonymised". No
  paraphrasing: every word of review text stays as written, apart from `[name]` redactions.
- **Stack:** TypeScript on Node 24 (owner's stack, same as his homepage). Use the
  Anthropic API (Claude) for rating generation, with the key from `.env` (git-ignored).
- **Cost:** rating generation is a one-off over 300–500 short texts; keep it cheap (a
  small model is fine).
- **Languages:** keep reviews in their original language. Expected mix: English, Czech,
  German, Ukrainian, Russian, others. The owner can judge English, Czech/Slovak, Ukrainian
  and Russian.

## Approaches considered

- **A. TypeScript pipeline + small local labelling page** (*chosen*). One script per
  step, and a tiny web page for hand-labelling. It's the owner's stack, and the labelling
  page doubles as visible product work.
- B. Python notebooks + spreadsheet labelling. The data-science default, but not the
  owner's stack; reviewers said notebooks "read like research" for product roles, and
  spreadsheets handle long multilingual text poorly.
- (Dropped) Hosted labelling tool such as Label Studio: overkill for about 100 reviews.

On how the trend gets planted (decided before the approach):
- Injecting generated complaint reviews was rejected because it mixes generated text in.
- Labelling the real history by hand was rejected because the trends are weak and it costs hours.
- **Re-dating real complaints was chosen:** all text stays real, the only change is
  documented dates, and the answer is known exactly.

## Decided

### Pipeline (one script per step, each reading the previous step's output)

1. **download:** fetch `reviews.csv.gz` and `listings.csv.gz` into a git-ignored `raw/`.
   Record the URLs, scrape date and download date.
2. **pick-listing:** choose one listing by these criteria: the most reviews; reviews
   spanning at least 3 years; at least 20% not in English; at least 15 reviews that
   genuinely complain about cleanliness (found by keyword search in several languages,
   then confirmed by the owner on the labelling page). Print the candidates so the owner
   can confirm the pick.
3. **sample:** take 300–500 reviews from that listing (all of them if within range;
   otherwise a sample keeping the full date span and the language mix). Detect each
   review's language and store it. Keep Airbnb's "(Translated by …)" notes as they are,
   since they're part of the realism.
4. **strip-pii:** drop reviewer name and ID and give each review a new stable ID
   (`r0001`…). Redact person names inside the text as `[name]`, and record each
   redaction in the manifest by review ID (not the original text).
5. **re-date:** pick about 15 confirmed cleanliness complaints and move their dates into
   one target month (e.g. March of the most recent full year). Record the original and
   new date of each in the manifest. Other reviews are untouched.
   *Trend rules (builder's call, recorded):*
   - Choose the target month where real cleanliness complaints are rarest.
   - The ground truth is "**cleanliness complaints in month X**": every owner-confirmed
     complaint dated in that month, the re-dated ones plus any already there, listed by ID
     in the manifest.
   - The month must end up with at least 3× the listing's average monthly number of
     cleanliness complaints, and its total review count must stay plausible: no more than
     2× the listing's busiest real month. Re-date fewer reviews if needed to stay under it.
   - pick-listing rejects listings that can't meet this.
6. **rate:** for each review, Claude produces an overall rating (1–5) and sub-ratings
   (cleanliness, accuracy, check-in, communication, location, value: the same categories
   as Airbnb's sub-scores in `listings.csv`). Record the model ID and the full prompt in
   the manifest. Ratings are rated from the text only, so it doesn't matter whether this
   runs before or after re-dating.
   *Builder's call, recorded:* ratings are **not** calibrated to the listing's average
   sub-scores. Instead the README reports how the generated averages compare with Airbnb's
   real averages, as an honesty check.
7. **export:** write the published files (below) and validate them: no names, no
   reviewer IDs, every review has a rating, and every manifest entry points at a real review.

### What the ratings are for

They make the data behave like a survey export, so numbers move with the text. In
particular, the re-dated complaints should pull the **cleanliness average down in the
target month**. That gives step 2 a numeric question ("which sub-rating dropped, when,
and why?") whose answer is known from the manifest, and gives the step-3 report a chart.
Ratings themselves are never an answer key for grading.

*Owner corrections (builder's call, recorded):* a correction from the spot-check
**overwrites** that value in `reviews.jsonl`, and each review carries per-field provenance
instead of a blanket flag: `ratings_source: { overall: "generated" | "owner", ... }`.
`rating-checks.json` keeps the original generated value next to the correction, so the
README can report how often the model's rating was accepted.

### Reproducibility (builder's call, recorded)

**Replay, not rerun.** Every non-deterministic or manual decision is committed and the
build replays it: rating outputs, name redactions (stored as review ID + character offset
+ length, never the name), confirmed cleanliness complaints, and the re-dating map.
Rebuilding from the raw Inside Airbnb files plus these committed decisions gives a
byte-identical dataset with no API calls. Rerunning the LLM steps is a separate,
explicit command. If Inside Airbnb drops the 2026-09-20 scrape, the published dataset still
stands as is. The README says the raw file came from that scrape, and the owner keeps a
private copy of it (not committed, since it contains personal data).

### Labelling page (local only)

- Served by a small local dev server, reading and writing JSON files in the repo.
- One review at a time: original text (with language tag), date, generated ratings.
- **Topic labelling:** multi-select from a fixed topic list (below), with keyboard
  shortcuts. Saves to `labels/topics.json`.
- **Rating check:** accept, or correct each rating. Saves to `labels/rating-checks.json`.
- **Cleanliness confirmation** for step 2/5 candidates: yes or no.
- Shows progress (e.g. 37 / 100). Can be stopped and resumed.

*Which ~100 reviews get topic labels (builder's call, revised 2026-11-19 with the owner):*
about 100 in total, **including** the re-dated reviews and 10 other cleanliness complaints,
so the trend question has labelled support. The rest is a sample stratified by language in
proportion to the dataset; languages with at least 10 reviews get at least 5 labels, smaller
ones only their proportional share (a per-language score needs enough reviews to mean
anything). The original rule, "at least 5 per language present", gave 148 labels on the real
listing because of a long tail of 1–4-review languages. Language detection is restricted to
languages that plausibly appear in guest reviews, because unrestricted detection tagged short
English reviews as Scots, Quechua and similar. For languages the owner can't read (expected: German and others), the
page shows a machine translation as an aid, and those labels are saved with
`via_translation: true`. Agreement scores are then reported both with and without them.

### Topics (fixed list, each with a name and a one-line description)

The owner refines the list at the start of labelling. Starting proposal: cleanliness,
location, host communication, check-in, noise, comfort and beds, kitchen and amenities,
value for money, accuracy vs. listing, Wi-Fi and work. Descriptions matter: they were the
fix that made Voice of Customer's topics consistent, and the eval will test exactly that.

### Published files

```
data/reviews.jsonl        id, date, language, text, ratings{overall, cleanliness, ...}, ratings_generated: true
data/labels/topics.json   hand labels for ~100 reviews (owner)
data/labels/rating-checks.json
data/manifest.json        source URLs and dates, listing (Inside Airbnb listing ID and average sub-scores),
                          removed fields, redactions by review ID, re-dated reviews (original → new date),
                          rating model + prompt, pipeline version
data/topics.json          topic names + descriptions
LICENSE-DATA.md           CC BY 4.0 attribution to Inside Airbnb, licence link, list of changes, download date
README.md                 what the dataset is, what's real vs generated vs changed, how to rebuild it
```

The code licence (MIT or similar) is separate from the data licence.

## Left to the builder

- Library choices: CSV parsing, language detection, the local server for the labelling
  page (a minimal Vite or plain Node server is fine).
- The exact sampling method within the stated constraints.
- How names inside text are detected (an LLM pass is acceptable here because it isn't an
  answer key, but the owner must spot-check it; regex alone will miss names).
- The rating prompt wording.
- The labelling page's look. Keep it plain; it's a local tool.
