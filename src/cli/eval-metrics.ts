// npm run eval:metrics -- results/<file>.json : recompute metrics from stored outputs (no API calls).
import { readFile } from 'node:fs/promises';
import { loadJudgeChecks, type AnswerOutput } from '../eval/answer';
import { answerMetrics } from '../eval/answerMetrics';
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
  // Never re-calls the judge: uses the verdicts stored in the file.
  file.metrics = answerMetrics(file.outputs as AnswerOutput[], file.judge?.verdicts ?? [], d, await loadJudgeChecks());
}
await writeResult(path, file);
console.log(`Recomputed metrics in ${path}.`);
