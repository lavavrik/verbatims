// npm run eval:judge-check : you check 20 of the judge's verdicts (y = the review supports the claim).
import { readdir, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { writeJson } from '../decisions';
import { loadJudgeChecks, type AnswerOutput } from '../eval/answer';
import { answerMetrics } from '../eval/answerMetrics';
import { loadEvalData } from '../eval/data';
import { sampleForCheck } from '../eval/judgeCheck';
import { readResult } from '../eval/results';

const d = await loadEvalData();
const paths = (await readdir('results').catch(() => [])).filter((f) => f.includes('-answer-')).map((f) => `results/${f}`);
if (!paths.length) throw new Error('No answer results yet. Run npm run eval:answer first.');
const files = await Promise.all(paths.map(async (path) => ({ path, file: await readResult<AnswerOutput>(path) })));
const checks = await loadJudgeChecks();
const sample = sampleForCheck(files.map((f) => ({ path: f.path, verdicts: f.file.judge?.verdicts ?? [] })), checks);
if (!sample.length) { console.log('Nothing left to check.'); process.exit(0); }

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(`Checking ${sample.length} verdicts. Answer y if the review supports the claim, n if not, s to skip.\n`);
for (const [i, { path, verdict }] of sample.entries()) {
  const out = files.find((f) => f.path === path)!.file.outputs[verdict.outputIndex];
  const claim = out.answer!.claims[verdict.claimIndex].text;
  const r = d.byId.get(verdict.reviewId)!;
  console.log(`— ${i + 1}/${sample.length}  (${out.questionId})\nClaim: ${claim}\nReview ${r.id} (${r.date}, ${r.language}): ${r.text}\n`);
  const a = (await rl.question('Supported? [y/n/s] ')).trim().toLowerCase();
  if (a !== 'y' && a !== 'n') continue;
  checks.push({ resultFile: path, outputIndex: verdict.outputIndex, claimIndex: verdict.claimIndex, reviewId: verdict.reviewId, judge: verdict.supported, owner: a === 'y' });
  await writeJson('labels/judge-checks.json', checks);
}
rl.close();
const agreement = answerMetrics([], [], d, checks).judgeAgreement;
const pct = (r: typeof agreement.onSupported) => (r ? `${Math.round(r.rate * 100)}% of ${r.n}` : 'n/a');
console.log(`\nYou agreed with the judge on ${pct(agreement.onSupported)} it called supported, and ${pct(agreement.onUnsupported)} it called unsupported.`);
console.log('Run npm run eval:metrics -- <answer result file> to update each file\'s judge agreement.');
