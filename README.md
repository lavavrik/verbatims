# verbatims

A small, honest dataset for evaluating LLM features on customer feedback: real,
multilingual guest reviews of **one Prague Airbnb listing**, shaped like a survey export
(per-review ratings + free text), with answer keys that come from a person or from a
recorded change, never from an LLM.

It's step 1 of a project that recreates a real product problem (classifying and
summarising customer feedback without hallucinating) on public data and measures it
properly. Steps 2 and 3, an eval runner and a report page, build on it.

## What's real, what's generated, what's changed

| | Source |
|---|---|
| Review text | **Real** (Inside Airbnb), original language, names replaced with `[name]` |
| Review dates | **Real**, except some cleanliness complaints **moved** into one month (listed in the manifest) |
| Ratings (overall + 6 categories) | **Generated** by an LLM from each review's text; owner corrections marked |
| Topic labels (~100 reviews) | **Hand-labelled** by the owner |
| Planted trend answer key | **Recorded change**: the re-dated complaints plus any already in that month |

Names and reviewer IDs removed. The original reviews remain public on Airbnb and in Inside
Airbnb's dataset. Full credit and the list of changes: [LICENSE-DATA.md](LICENSE-DATA.md).

### Generated vs. Airbnb's real average scores

Inside Airbnb publishes the listing's real average sub-scores. Comparing them with the
averages of the generated ratings is a sanity check on the generation:

| | Generated (421 reviews) | Airbnb (listing average) | Difference |
|---|---|---|---|
| overall | 4.43 | 4.24 | +0.19 |
| cleanliness | 4.39 | 4.08 | +0.31 |
| accuracy | 4.48 | 4.61 | −0.13 |
| checkin | 4.71 | 4.84 | −0.13 |
| communication | 4.69 | 4.75 | −0.06 |
| location | 4.72 | 4.59 | +0.13 |
| value | 4.52 | 4.50 | +0.02 |

Every category is within a third of a star. The generator is somewhat more generous than
real guests on cleanliness and overall, which fits the fact that it can only react to what
a review says, while unhappy guests often rate low without explaining why. Airbnb's
averages cover all of the listing's reviews, the generated ones only this sample. In the
owner's spot check of 30 reviews, 27 were accepted exactly as generated and 3 were
corrected (corrections are marked `"owner"` in `ratings_source`).

## Files

```
data/reviews.jsonl          one review per line: id, date, language, text, ratings, ratings_source
data/manifest.json          source, listing, id map, redactions, re-dated reviews, rating model + prompt
data/topics.json            topic names + one-line descriptions
data/labels/topics.json     hand labels (viaTranslation: true when labelled through a machine translation)
data/labels/rating-checks.json
```

## Rebuild it

The build replays committed decisions (`decisions/`, `labels/`); it makes no API calls
and gives the same files every time. `decisions/source.json` records the source URLs,
download date and file hashes; the build refuses raw files that don't match, and every
review's text hash is checked before its saved redaction offsets are applied.

```sh
npm install
npm run download    # Inside Airbnb Prague files into raw/ (git-ignored: they contain names)
npm run build       # → data/, validated: fails if any reviewer or host name remains
```

To make the decisions from scratch (needs an Anthropic API key in `.env`):
`pick-listing` → `sample` → `detect-names` (+ `redact` fixes) → `rate` → `label`
(complaints, rating check, topics) → `redate` → `label` (topic top-up) → `build`.

## Evaluating models on it

`src/eval/` measures what an LLM feature built on this data gets right. Design:
[`docs/superpowers/specs/2026-11-19-eval-runner-design.md`](docs/superpowers/specs/2026-11-19-eval-runner-design.md).

- **Topic classification:** prompt v1 (topic names) vs v2 (names + descriptions), scored
  against the hand labels. Headline numbers use the test half of the 75 language-stratified sampled
  labelled reviews (`eval/split.json`), with n and 95% intervals.
- **Consistency:** the labelled reviews classified 5 times. How often does the answer change?
- **Grounded answers:** questions about the planted cleanliness drop, answered with
  review-ID citations. Each citation is checked by a judge model, which is itself spot-checked by hand.

```sh
npm run eval:split                                              # once
npm run eval:classify -- --model claude-haiku-5-5 --prompt v2   # shows projected cost, asks first
npm run eval:answer -- --model claude-haiku-5-5
npm run eval:judge-check                                        # check 20 judge verdicts by hand
npm run eval:compare -- results/<A>.json results/<B>.json
```

Every run writes `results/<date>-<kind>-<model>-<prompt>.json` with the exact prompt, model,
settings, every output, token usage and cost; `npm run eval:metrics -- <file>` recomputes the
numbers from those outputs without calling a model.

## How this was built

Design first: the dataset's goals, anti-goals and every rule (sampling, the planted
trend, privacy) are written down in `docs/superpowers/specs/`, and the implementation
plan in `docs/superpowers/plans/`. The code was written with Claude Code, test-first,
against that plan; commits carry a `Co-Authored-By` trailer.

## Licence

Code: MIT. Data: CC BY 4.0, derived from Inside Airbnb. See [LICENSE-DATA.md](LICENSE-DATA.md).
