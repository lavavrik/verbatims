/** Exact two-sided sign test (binomial, p = 0.5), ties excluded. 1 when there is nothing to compare. */
export function signTestP(better: number, worse: number): number {
  const n = better + worse;
  if (n === 0) return 1;
  const k = Math.min(better, worse);
  let tail = 0, c = 1; // C(n, 0)
  for (let i = 0; i <= k; i++) { tail += c; c = (c * (n - i)) / (i + 1); }
  return Math.min(1, (2 * tail) / 2 ** n);
}
