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
| Smoke from someone else on the floor, even if strong inside the flat | No: the source is named and outside the flat's upkeep |
| Several things in one review | Judge each: one qualifying complaint makes it a complaint |

A **cleanliness complaint** (`decisions/complaints.json`) is a review that says the place
was not clean enough by this rule. Praise ("very clean") is not a complaint.

**Severity: any negative mention counts, however mild.** If the guest raises it as a
downside ("a slight smell from the bathroom", "the only negative was…", "towels didn't
smell nice"), it is a complaint, even when they add "nothing major" or praise the rest.
A review that says a problem was *absent* ("we didn't notice the damp smell others
mentioned") is not a complaint.

## Accuracy vs listing

Only when the guest explicitly compares the place with the listing, its photos or its
description ("as described", "smaller than in the photos", "the washing machine in the
listing was missing"). Describing the place itself ("small", "compact", "basic") is not
this topic.

## Kitchen and amenities

Specific equipment the place had or lacked: kitchen items, washing machine, **towels**,
toiletries, coffee, TV. General phrases like "has everything you need" don't count.

*Added 2026-11-19 after reviewing prompt v2's disagreements (dev and added reviews only).
Applying the towels rule changed one label: r0118 (an added review, outside the dev/test
split) gained "kitchen and amenities" for "lacked bath towels".*
