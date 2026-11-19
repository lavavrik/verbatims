import { writeJson } from '../decisions';
import { loadEvalData } from '../eval/data';
import { addedLabelIds, makeSplit, sampledLabelIds } from '../eval/split';

const d = await loadEvalData();
const added = addedLabelIds(d);
const missing = added.filter((id) => !(id in d.labels));
if (missing.length) throw new Error(`Added reviews without topic labels: ${missing.join(', ')}. The label queue and this rule disagree.`);
const sampled = makeSplit(sampledLabelIds(d), (id) => d.byId.get(id)!.language);
await writeJson('eval/split.json', { datasetHash: d.datasetHash, sampled, added });
console.log(`sampled ${sampled.dev.length + sampled.test.length} (dev ${sampled.dev.length}, test ${sampled.test.length}), added ${added.length}`);
