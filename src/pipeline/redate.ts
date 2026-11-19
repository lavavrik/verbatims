export type Move = { id: string; from: string; to: string };
export type RedatePlan = { targetMonth: string; moves: Move[]; groundTruth: string[] };
export const REDATE_RULES = { want: 15, minRatio: 3, maxMonthFactor: 2 };

const monthOf = (d: string) => d.slice(0, 7);
const daysIn = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const lastDay = (month: string) => `${month}-${String(daysIn(month)).padStart(2, '0')}`;

function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = [Number(first.slice(0, 4)), Number(first.slice(5, 7))];
  while (`${y}-${String(m).padStart(2, '0')}` <= monthOf(last)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/**
 * Plants the cleanliness trend: moves real, owner-confirmed complaints into the quietest
 * full month, within the rules from the design (≥3× the average monthly complaints, month
 * total ≤ 2× the busiest real month, never after the scrape date).
 */
export function planRedate(items: { id: string; date: string }[], confirmed: string[], opts = { want: REDATE_RULES.want, scrapeDate: '2026-09-20' }): RedatePlan {
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const first = sorted[0].date, last = sorted.at(-1)!.date;
  const isComplaint = new Set(confirmed);
  const allMonths = monthsBetween(first, last);
  const total = new Map<string, number>(), complaints = new Map<string, number>();
  for (const it of sorted) {
    total.set(monthOf(it.date), (total.get(monthOf(it.date)) ?? 0) + 1);
    if (isComplaint.has(it.id)) complaints.set(monthOf(it.date), (complaints.get(monthOf(it.date)) ?? 0) + 1);
  }

  const candidates = allMonths.filter((m) => `${m}-01` >= first && lastDay(m) <= last && lastDay(m) <= opts.scrapeDate && (total.get(m) ?? 0) > 0);
  if (!candidates.length) throw new Error('No full month inside the sample span to plant the trend in.');
  const targetMonth = candidates.reduce((best, m) => ((complaints.get(m) ?? 0) <= (complaints.get(best) ?? 0) ? m : best));

  const avgMonthly = confirmed.length / allMonths.length;
  const busiest = Math.max(...total.values());
  const room = REDATE_RULES.maxMonthFactor * busiest - (total.get(targetMonth) ?? 0);
  const movable = sorted.filter((it) => isComplaint.has(it.id) && monthOf(it.date) !== targetMonth);
  const n = Math.max(0, Math.min(opts.want, movable.length, room));
  const already = complaints.get(targetMonth) ?? 0;
  if (already + n < REDATE_RULES.minRatio * avgMonthly) {
    throw new Error(`Can't reach 3× the average monthly complaints (${(REDATE_RULES.minRatio * avgMonthly).toFixed(1)}) in ${targetMonth}: only ${already + n} possible within the cap.`);
  }

  const days = daysIn(targetMonth);
  const moves = movable.slice(0, n).map((it, i) => ({ id: it.id, from: it.date, to: `${targetMonth}-${String(1 + ((i * 7) % days)).padStart(2, '0')}` }));
  const groundTruth = [
    ...sorted.filter((it) => isComplaint.has(it.id) && monthOf(it.date) === targetMonth).map((it) => it.id),
    ...moves.map((m) => m.id),
  ].sort();
  return { targetMonth, moves, groundTruth };
}
