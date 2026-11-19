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

_Filled in after the first full build (`npm run build` prints the table)._

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

## How this was built

Design first: the dataset's goals, anti-goals and every rule (sampling, the planted
trend, privacy) are written down in `docs/superpowers/specs/`, and the implementation
plan in `docs/superpowers/plans/`. The code was written with Claude Code, test-first,
against that plan; commits carry a `Co-Authored-By` trailer.

## Licence

Code: MIT. Data: CC BY 4.0, derived from Inside Airbnb. See [LICENSE-DATA.md](LICENSE-DATA.md).
