export type Usage = { input: number; output: number };

/** USD per 1M tokens (Anthropic first-party prices, cached 2026-11-03). */
export const PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
};

export function costUsd(model: string, usage: Usage): number {
  const p = PRICES[model];
  if (!p) throw new Error(`No price for ${model}; add it to PRICES in src/eval/cost.ts`);
  return (usage.input * p.input + usage.output * p.output) / 1e6;
}

/** Mean usage of the sample calls, scaled to `totalCalls`, in USD. */
export function projectCost(model: string, sample: Usage[], totalCalls: number): number {
  const mean = sample.reduce((a, u) => ({ input: a.input + u.input / sample.length, output: a.output + u.output / sample.length }), { input: 0, output: 0 });
  return costUsd(model, { input: mean.input * totalCalls, output: mean.output * totalCalls });
}
