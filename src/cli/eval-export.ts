// npm run eval:export [-- --out report/summary.json] : the numbers behind the report page (no API calls).
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { writeJson } from '../decisions';
import { loadJudgeChecks } from '../eval/answer';
import { arg } from '../eval/args';
import { loadEvalData } from '../eval/data';
import { readResult } from '../eval/results';
import { buildSummary } from '../eval/summary';

const out = arg('out', 'report/summary.json')!;
const splitText = await readFile('eval/split.json', 'utf8');
const files = (await readdir('results')).filter((f) => f.endsWith('.json')).sort();
const summary = buildSummary({
  data: await loadEvalData(),
  split: JSON.parse(splitText),
  splitHash: createHash('sha256').update(splitText).digest('hex').slice(0, 16),
  results: await Promise.all(files.map(async (f) => ({ file: `results/${f}`, result: await readResult(`results/${f}`) }))),
  judgeChecks: await loadJudgeChecks(),
  generatedAt: new Date().toISOString(),
  listingId: JSON.parse(await readFile('data/manifest.json', 'utf8')).listing.id,
});
await writeJson(out, summary);
const short = (m: string) => m.replace(/^claude-|-\d+-\d+$/g, '');
console.log(`Wrote ${out}: ${summary.classify.length} classify runs, ${summary.answers.length} answer runs, total ≈ $${summary.totalCostUsd.toFixed(2)}.`);
for (const p of summary.paired) console.log(`  ${short(p.model)} ${p.from}→${p.to} test: ${p.better} better / ${p.worse} worse (p=${p.signTestP.toFixed(3)})`);
for (const s of summary.pairedStability) console.log(`  stability ${short(s.a.model)} ${s.a.prompt} vs ${short(s.b.model)} ${s.b.prompt}: ${s.stableOnlyInA} only in first / ${s.stableOnlyInB} only in second (p=${s.signTestP.toFixed(3)})`);
