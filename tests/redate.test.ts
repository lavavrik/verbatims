import { expect, test } from 'vitest';
import { planRedate } from '../src/pipeline/redate';

/** One review every 6 days from 2022-01-01 to mid-2025; every 8th is a confirmed complaint, except none in 2024-03. */
function fixture() {
  const items: { id: string; date: string }[] = [];
  const start = Date.UTC(2022, 0, 1);
  for (let i = 0; i < 220; i++) items.push({ id: `r${String(i + 1).padStart(4, '0')}`, date: new Date(start + i * 6 * 86400000).toISOString().slice(0, 10) });
  const confirmed = items.filter((it, i) => i % 8 === 0 && !it.date.startsWith('2024-03')).map((it) => it.id);
  return { items, confirmed };
}

test('picks the quietest month (latest on ties) and moves complaints into it', () => {
  const { items, confirmed } = fixture();
  const plan = planRedate(items, confirmed);
  expect(plan.targetMonth).toMatch(/^\d{4}-\d{2}$/);
  const inTarget = (d: string) => d.startsWith(plan.targetMonth);
  expect(plan.moves.length).toBeGreaterThan(0);
  expect(plan.moves.every((m) => inTarget(m.to) && !inTarget(m.from))).toBe(true);
});

test('never dates a review after the scrape date or outside the sample span', () => {
  const { items, confirmed } = fixture();
  const plan = planRedate(items, confirmed, { want: 15, scrapeDate: '2025-06-01' });
  const first = items[0].date, last = items.at(-1)!.date;
  for (const m of plan.moves) {
    expect(m.to <= '2025-06-01').toBe(true);
    expect(m.to >= first && m.to <= last).toBe(true);
  }
});

test('caps the month at twice the busiest real month by moving fewer reviews', () => {
  const { items, confirmed } = fixture();
  // Busiest real month has 6 reviews, so the target may hold at most 12; it starts with 5–6.
  const plan = planRedate(items, confirmed, { want: 15, scrapeDate: '2026-09-20' });
  const monthTotal = items.filter((it) => !plan.moves.some((m) => m.id === it.id) && it.date.startsWith(plan.targetMonth)).length + plan.moves.length;
  expect(monthTotal).toBeLessThanOrEqual(12);
  expect(plan.moves.length).toBeLessThan(15);
});

test('throws when the spike cannot reach 3× the average monthly complaints', () => {
  // Every review is a complaint: about 5 a month on average, so the month needs 15, but the cap allows 12.
  const { items } = fixture();
  expect(() => planRedate(items, items.map((it) => it.id))).toThrow(/3×/);
});

test('ground truth includes complaints already in the target month', () => {
  const { items, confirmed } = fixture();
  const plan = planRedate(items, confirmed);
  const already = confirmed.filter((id) => items.find((it) => it.id === id)!.date.startsWith(plan.targetMonth));
  for (const id of [...already, ...plan.moves.map((m) => m.id)]) expect(plan.groundTruth).toContain(id);
});
