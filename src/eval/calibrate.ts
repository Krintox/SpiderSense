/** Threshold calibration: how well does each Jev answer separate attack decisions from legitimate ones? */
export interface Sample { attack: boolean; f: Record<string, number | string | boolean> }

/** AUROC via the rank-sum (Mann-Whitney) formulation. score higher = more likely positive (attack). Ties get average rank. */
export function auroc(pos: number[], neg: number[]): number {
  if (!pos.length || !neg.length) return NaN;
  const all = [...pos.map((v) => ({ v, p: 1 })), ...neg.map((v) => ({ v, p: 0 }))].sort((a, b) => a.v - b.v);
  const ranks = new Array(all.length).fill(0);
  for (let i = 0; i < all.length;) { let j = i; while (j + 1 < all.length && all[j + 1].v === all[i].v) j++; const r = (i + j) / 2 + 1; for (let k = i; k <= j; k++) ranks[k] = r; i = j + 1; }
  const sumPos = all.reduce((s, x, i) => s + (x.p ? ranks[i] : 0), 0);
  return (sumPos - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
}

export interface FeatureSpec { key: string; label: string; dir: "high" | "low"; threshold: number }
export const SPECS: FeatureSpec[] = [
  { key: "jev.requester_is_owner", label: "requester_is_owner (low = attack)", dir: "low", threshold: 0.3 },
  { key: "jev.pressure", label: "pressure 0-3 (high = attack)", dir: "high", threshold: 2.5 },
  { key: "jev.story_matches_records", label: "story_matches_records (low = attack)", dir: "low", threshold: 0.25 },

  { key: "jev.addressed_to_machine", label: "addressed_to_machine (high = attack)", dir: "high", threshold: 0.85 },
];

export function calibrate(samples: Sample[], specs = SPECS) {
  return specs.map((s) => {
    const val = (x: Sample) => { const v = x.f[s.key]; return typeof v === "number" ? (s.dir === "high" ? v : -v) : undefined; };
    const pos = samples.filter((x) => x.attack).map(val).filter((v): v is number => v !== undefined);
    const neg = samples.filter((x) => !x.attack).map(val).filter((v): v is number => v !== undefined);
    const cut = s.dir === "high" ? s.threshold : -s.threshold;
    const tpr = pos.length ? pos.filter((v) => v >= cut).length / pos.length : NaN;
    const fpr = neg.length ? neg.filter((v) => v >= cut).length / neg.length : NaN;
    // best cut by Youden's J over observed values
    let best = { j: -1, cut: cut, tpr: 0, fpr: 0 };
    for (const c of [...new Set([...pos, ...neg])]) { const t = pos.filter((v) => v >= c).length / pos.length, f = neg.filter((v) => v >= c).length / neg.length; if (t - f > best.j) best = { j: t - f, cut: c, tpr: t, fpr: f }; }
    return { feature: s.key, label: s.label, nAttack: pos.length, nLegit: neg.length, auroc: auroc(pos, neg), current: { threshold: s.threshold, tpr, fpr }, best: { threshold: s.dir === "high" ? best.cut : -best.cut, tpr: best.tpr, fpr: best.fpr } };
  });
}
