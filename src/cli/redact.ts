// Manual fixes: npm run redact -- add r0042 "Pavel"  |  remove r0042 17  |  allow r0042 31
// "allow" marks a position the build flagged that is not a name (e.g. the word "will"); positions are in the published text.
import { readJsonOr, writeJson } from '../decisions';
import type { AllowedMention } from '../pipeline/build';
import { findOccurrences, mergeRedactions, type Redaction } from '../pipeline/redact';
import { loadSampled } from '../workspace';

const [cmd, id, arg] = process.argv.slice(2);
const FILE = 'decisions/redactions.json';
const redactions = await readJsonOr<Redaction[]>(FILE, []);

if (cmd === 'add') {
  const item = (await loadSampled()).items.find((it) => it.id === id);
  if (!item || !arg) throw new Error('Usage: add <id> "<name>"');
  const spans = findOccurrences(item.source.text, arg);
  if (!spans.length) throw new Error(`"${arg}" does not occur in ${id} as a whole word.`);
  await writeJson(FILE, mergeRedactions([...redactions, ...spans.map((s) => ({ id, ...s }))]));
  console.log(`Added ${spans.length} redaction(s) to ${id}.`);
} else if (cmd === 'remove') {
  const kept = redactions.filter((r) => !(r.id === id && r.start === Number(arg)));
  if (kept.length === redactions.length) throw new Error(`No redaction in ${id} starting at ${arg}.`);
  await writeJson(FILE, kept);
  console.log(`Removed redaction at ${arg} from ${id}.`);
} else if (cmd === 'allow') {
  const ALLOW = 'decisions/allowed-mentions.json';
  const allowed = await readJsonOr<AllowedMention[]>(ALLOW, []);
  if (!id || Number.isNaN(Number(arg))) throw new Error('Usage: allow <id> <start>');
  await writeJson(ALLOW, [...allowed.filter((a) => !(a.id === id && a.start === Number(arg))), { id, start: Number(arg) }]);
  console.log(`Allowed the mention at ${arg} in ${id}.`);
} else {
  console.log('Usage: npm run redact -- add <id> "<name>" | remove <id> <start> | allow <id> <start>');
}
