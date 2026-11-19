// Generates ratings for every sampled review missing from decisions/ratings.json (resumable).
import { readJsonOr, writeJson } from '../decisions';
import { callStructured, EFFORT, MODEL, pool } from '../llm';
import { RATING_PROMPT_VERSION, RATING_SYSTEM_PROMPT, RatingsSchema, type RatingsDecision } from '../pipeline/rate';
import { applyRedactions, type Redaction } from '../pipeline/redact';
import { loadSampled } from '../workspace';

const FILE = 'decisions/ratings.json';
const { items } = await loadSampled();
const redactions = await readJsonOr<Redaction[]>('decisions/redactions.json', []);
const decision = await readJsonOr<RatingsDecision>(FILE, { model: MODEL, effort: EFFORT, promptVersion: RATING_PROMPT_VERSION, prompt: RATING_SYSTEM_PROMPT, results: {} });
if (decision.promptVersion !== RATING_PROMPT_VERSION || decision.model !== MODEL) {
  throw new Error(`${FILE} was made with ${decision.model} / prompt ${decision.promptVersion}. Move it aside to regenerate with ${MODEL} / ${RATING_PROMPT_VERSION}.`);
}

const todo = items.filter((it) => !decision.results[it.id]);
console.log(`${items.length - todo.length} already rated, ${todo.length} to go.`);
let n = 0;
await pool(todo, 4, async (it) => {
  const text = applyRedactions(it.source.text, redactions.filter((r) => r.id === it.id));
  decision.results[it.id] = await callStructured(RatingsSchema, RATING_SYSTEM_PROMPT, text);
  if (++n % 25 === 0) { await writeJson(FILE, decision); console.log(`… ${n}/${todo.length}`); }
});
await writeJson(FILE, decision);
console.log(`Done: ${Object.keys(decision.results).length} reviews rated.`);
