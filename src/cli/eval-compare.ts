// npm run eval:compare -- results/<A>.json results/<B>.json
import type { ClassifyOutput } from '../eval/classifyMetrics';
import { compareRuns } from '../eval/compare';
import { loadEvalData } from '../eval/data';
import { readResult } from '../eval/results';

const [pa, pb] = process.argv.slice(2);
if (!pa || !pb) throw new Error('Usage: npm run eval:compare -- results/<A>.json results/<B>.json');
const [a, b] = [await readResult<ClassifyOutput>(pa), await readResult<ClassifyOutput>(pb)];
const d = await loadEvalData();
const c = compareRuns(a, b, d);
const f = (x: number | null, name: string) => (x === null ? 'n/a' : name === 'cost USD' ? `$${x.toFixed(2)}` : `${(x * 100).toFixed(1)}%`);
console.log(`A: ${a.runId} (${a.model}, ${a.promptVersion})\nB: ${b.runId} (${b.model}, ${b.promptVersion})\n`);
console.table(Object.fromEntries(c.metricDeltas.map((m) => [m.name, {
  A: f(m.a, m.name), B: f(m.b, m.name), change: m.a === null || m.b === null ? 'n/a' : m.name === 'cost USD' ? `$${(m.b - m.a).toFixed(2)}` : `${((m.b - m.a) * 100).toFixed(1)} pts`, n: m.nA === m.nB ? m.nA : `${m.nA} / ${m.nB}`,
}])));
const rep1 = (f: typeof a, id: string) => f.outputs.find((o) => o.id === id && o.rep === 1)?.topics?.join(', ') || '(none)';
for (const [title, ids] of [['Got better in B', c.improved], ['Got worse in B', c.regressed]] as const) {
  console.log(`\n${title} (${ids.length}):`);
  for (const id of ids) {
    const r = d.byId.get(id)!;
    console.log(`  ${id} [${r.language}] label: ${d.labels[id].topics.join(', ') || '(none)'} | A: ${rep1(a, id)} | B: ${rep1(b, id)}\n    ${r.text.slice(0, 200).replace(/\s+/g, ' ')}${r.text.length > 200 ? '…' : ''}`);
  }
}
