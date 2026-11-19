// Re-detects languages in decisions/sample.json with the restricted detector. Ids and hashes don't change.
import { readJson, writeJson } from '../decisions';
import { relabelLanguages, type SampleDecision } from '../pipeline/sample';
import { loadReviews } from '../raw';

const sample = await readJson<SampleDecision>('decisions/sample.json');
const wanted = new Set(sample.items.map((it) => it.sourceId));
const texts = new Map((await loadReviews('raw/reviews.csv.gz')).filter((r) => wanted.has(r.sourceId)).map((r) => [r.sourceId, r.text]));
const { decision, changed } = relabelLanguages(sample, texts);
await writeJson('decisions/sample.json', decision);
console.log('Changed:', Object.keys(changed).length ? changed : 'nothing');
const counts: Record<string, number> = {};
for (const it of decision.items) counts[it.language] = (counts[it.language] ?? 0) + 1;
console.log('Languages now:', counts);
