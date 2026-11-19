# Labelling guidelines

Rules for the hand labels in `labels/` and `decisions/complaints.json`. They exist so the
answer key is consistent; when a new edge case comes up, decide once and add it here.

## General

- Label from the review text only. Don't guess what a classifier would say.
- A review can have several topics, or none.
- A topic counts when the review says something about it, good or bad
  ("spotless" and "dirty" are both cleanliness).
- Labels made through the machine translation aid are marked `viaTranslation`.

## Cleanliness

Rule of thumb: **would better cleaning or upkeep of the place itself have fixed it?**

| Case | Cleanliness? |
|---|---|
| Bad smell from the bathroom (drains, mould, toilet) | Yes |
| The flat smelled of smoke, no source named (stale smoke in fabrics) | Yes |
| Cigarette smell or smoke from neighbours, the stairwell or the street | No: building or neighbour issue, not cleaning |

A **cleanliness complaint** (`decisions/complaints.json`) is a review that says the place
was not clean enough by this rule. Praise ("very clean") is not a complaint.
