// Manual fixes: npm run redact -- add r0042 "Pavel"   |   npm run redact -- remove r0042 17
import { readJsonOr, writeJson } from '../decisions';
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
} else {
  console.log('Usage: npm run redact -- add <id> "<name>" | remove <id> <start>');
}
