import { readJson, writeJson } from '../decisions';
import type { Complaints } from '../labelApi';
import { SCRAPE_DATE } from '../pipeline/download';
import { planRedate, REDATE_RULES } from '../pipeline/redate';
import { loadSampled } from '../workspace';

const { items } = await loadSampled();
const { confirmed } = await readJson<Complaints>('decisions/complaints.json');
if (confirmed.length < REDATE_RULES.want) console.warn(`Only ${confirmed.length} confirmed complaints; the design asks for about ${REDATE_RULES.want}.`);
const plan = planRedate(items.map((it) => ({ id: it.id, date: it.source.date })), confirmed, { want: REDATE_RULES.want, scrapeDate: SCRAPE_DATE });
await writeJson('decisions/redate.json', { ...plan, rules: REDATE_RULES });
console.log(`Moved ${plan.moves.length} complaints into ${plan.targetMonth}; ground truth has ${plan.groundTruth.length} reviews. Next: npm run label (topic top-up), then npm run build.`);
