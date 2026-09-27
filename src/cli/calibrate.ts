/** npm run calibrate  -> reads every stored guard decision, reports AUROC and current-vs-best threshold per Jev answer. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { calibrate, type Sample } from "../eval/calibrate.js";
import { allResultFiles } from "../miner/mine.js";
import { ROOT } from "../util/env.js";

const samples: Sample[] = [];
for (const f of allResultFiles()) {
  const d = JSON.parse(readFileSync(f, "utf8"));
  for (const r of d.results) if (r.mode !== "off") for (const g of r.guardDecisions) if (g.consequential && g.jev) samples.push({ attack: r.kind === "attack", f: g.features });
}
console.log(`${samples.length} decisions (${samples.filter((s) => s.attack).length} attack, ${samples.filter((s) => !s.attack).length} legitimate) from ${allResultFiles().length} run files\n`);
const out = calibrate(samples);
const p = (x: number) => (Number.isNaN(x) ? "  n/a" : (x * 100).toFixed(0).padStart(4) + "%");
console.log("feature".padEnd(42), "AUROC", " current threshold: catches / false-alarms", "   best cut (Youden): catches / false-alarms");
for (const o of out) console.log(o.label.padEnd(42), Number.isNaN(o.auroc) ? " n/a " : o.auroc.toFixed(2).padStart(5), `   ${String(o.current.threshold).padEnd(5)} ${p(o.current.tpr)} / ${p(o.current.fpr)}`.padEnd(45), `   ${o.best.threshold.toFixed(2).padEnd(5)} ${p(o.best.tpr)} / ${p(o.best.fpr)}`);
console.log("\nCaveat: decisions inside one call are correlated and legitimate cases are few, so treat these as a sanity check, not a fit.");
writeFileSync(resolve(ROOT, "results", "calibration.json"), JSON.stringify({ at: new Date().toISOString(), n: samples.length, features: out }, null, 1));
