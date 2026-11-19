// npm run eval:metrics -- results/<file>.json : recompute metrics from stored outputs (no API calls).
import { readFile } from 'node:fs/promises';
import { computeClassifyMetrics } from '../eval/classify';
import type { ClassifyOutput, SplitFile } from '../eval/classifyMetrics';
import { loadEvalData } from '../eval/data';
import { readResult, writeResult } from '../eval/results';

const path = process.argv[2];
if (!path) throw new Error('Usage: npm run eval:metrics -- results/<file>.json');
const file = await readResult(path);
const d = await loadEvalData();
if (file.datasetHash !== d.datasetHash) throw new Error(`${path} was run on a different dataset; its metrics can't be recomputed against this one.`);
if (file.kind === 'classify') {
  const split: SplitFile = JSON.parse(await readFile('eval/split.json', 'utf8'));
  file.metrics = computeClassifyMetrics(file.outputs as ClassifyOutput[], d, split);
} else {
  throw new Error(`Recomputing ${file.kind} metrics isn't supported yet.`);
}
await writeResult(path, file);
console.log(`Recomputed metrics in ${path}.`);
