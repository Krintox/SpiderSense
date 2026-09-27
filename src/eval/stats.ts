/** Wilson score interval for a binomial proportion (95% by default). Right choice at small n and near 0 or 1. */
export interface Rate { p: number; lo: number; hi: number; n: number; k: number }
export function wilson(k: number, n: number, z = 1.96): Rate {
  if (n === 0) return { p: 0, lo: 0, hi: 1, n: 0, k: 0 };
  const p = k / n, z2 = z * z, d = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d;
  return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h), n, k };
}
export const pct = (r: Rate) => `${(r.p * 100).toFixed(1)}% [${(r.lo * 100).toFixed(1)}–${(r.hi * 100).toFixed(1)}] (${r.k}/${r.n})`;
export const quantile = (xs: number[], q: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
