// Finds person names in each sampled review and stores their positions in decisions/redactions.json.
// Names are printed to this terminal for checking and are never written to a file.
import { z } from 'zod';
import { readJsonOr, writeJson } from '../decisions';
import { callStructured, pool } from '../llm';
import { combineRedactions, findOccurrences, type Redaction, type Span } from '../pipeline/redact';
import { loadSampled } from '../workspace';

const SYSTEM = `You find people's names in guest reviews of an Airbnb listing.
Return every name of a person (first names, surnames, nicknames, diminutives) exactly as it is written in the text, including inflected forms such as "Олені" or "Petrovi".
Do not return place names, street names, business names, or words like "host" or "hostitel". Return an empty list if there are none.`;
const Names = z.object({ names: z.array(z.string()) });

const PROGRESS = 'cache/detect-names.json'; // id → spans (no names), so a rerun resumes
const { listing, items } = await loadSampled();
const done = await readJsonOr<Record<string, Span[]>>(PROGRESS, {});
const todo = items.filter((it) => !(it.id in done));
console.log(`${items.length - todo.length} already processed, ${todo.length} to go.`);

let n = 0;
await pool(todo, 4, async (it) => {
  const { names } = await callStructured(Names, SYSTEM, it.source.text);
  const all = [...new Set([...names, it.source.reviewerName, listing.hostName].filter(Boolean))];
  const spans = all.flatMap((name) => findOccurrences(it.source.text, name));
  const unmatched = names.filter((name) => findOccurrences(it.source.text, name).length === 0);
  done[it.id] = spans;
  if (names.length || unmatched.length) console.log(`${it.id}: ${names.join(', ')}${unmatched.length ? `   (not found in text: ${unmatched.join(', ')})` : ''}`);
  if (++n % 20 === 0) { await writeJson(PROGRESS, done); console.log(`… ${n}/${todo.length}`); }
});
await writeJson(PROGRESS, done);

const auto: Redaction[] = items.flatMap((it) => (done[it.id] ?? []).map((s) => ({ id: it.id, ...s })));
// Keep manual additions already in redactions.json, and keep removed spans removed.
const redactions = combineRedactions(
  auto,
  await readJsonOr<Redaction[]>('decisions/redactions.json', []),
  await readJsonOr<{ id: string; start: number }[]>('decisions/redactions-removed.json', []),
);
await writeJson('decisions/redactions.json', redactions);
console.log(`Wrote ${redactions.length} redactions across ${new Set(redactions.map((r) => r.id)).size} reviews. Fix misses with: npm run redact -- add <id> "<name>"`);
