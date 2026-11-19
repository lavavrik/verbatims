export type Rate = { k: number; n: number; rate: number; low: number; high: number };

/** Share k/n with a 95% Wilson score interval; null when n is 0. */
export function wilson(k: number, n: number): Rate | null {
  if (n === 0) return null;
  const z = 1.96, p = k / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { k, n, rate: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export const ratio = (a: number, b: number): number | null => (b === 0 ? null : a / b);
