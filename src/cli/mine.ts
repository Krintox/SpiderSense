/** npm run mine -- [--all-results] [--ruleset v1|full] [--no-promoted] [--dry] */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { allResultFiles, loadRows, mine } from "../miner/mine.js";
import { loadPromotedRules } from "../guard/guard.js";
import { rulesetFor } from "../guard/rules.js";
import { publish } from "../guard/versions.js";
import { ROOT } from "../util/env.js";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const files = process.argv.includes("--all-results") ? allResultFiles() : [resolve(ROOT, "results", "latest.json")];
const baseline = [...(process.argv.includes("--no-promoted") ? [] : loadPromotedRules()), ...rulesetFor(arg("ruleset", "full"))];
const rows = loadRows(files);
console.log(`backtest set: ${rows.length} guard decisions from ${files.length} result file(s); baseline ${baseline.length} rules`);
const out = await mine(rows, baseline);
console.log(`missed attack decisions: ${out.misses.length}`);
for (const [k, n] of Object.entries(out.clusters)) console.log(`  cluster ${k}: ${n}`);
for (const p of out.proposals) {
  console.log(`\ncandidate ${p.rule.id}${p.errors.length ? `  INVALID: ${p.errors.join("; ")}` : ""}`);
  console.log(`  when ${p.rule.when.map((c) => `${c.f} ${c.op} ${JSON.stringify(c.v)}`).join(" AND ")}`);
  if (p.sham) console.log(`  sham control: ${p.sham.shamSuccesses}/${p.sham.shamTrials} random rules of similar coverage (${p.sham.coverage} decisions) did as well, p = ${p.sham.pValue.toFixed(3)}`);
  console.log(`  backtest: attacks allowed ${p.backtest.attackAllowedBefore} -> ${p.backtest.attackAllowedAfter} (flips ${p.backtest.flips}), new legit denials ${p.backtest.legitNewDenials} ${p.backtest.legitNewDenialCases.join(",")}  => ${p.accepted ? "ACCEPTED" : "rejected"}`);
}
if (out.promoted && !process.argv.includes("--dry")) {
  const cur = loadPromotedRules();
  const best = out.proposals.find((p) => p.rule.id === out.promoted!.id);
  const v = publish([out.promoted, ...cur], `mined: ${out.promoted.id}`, { backtest: best?.backtest, sham: best?.sham, clusters: out.clusters });
  console.log(`\nPROMOTED ${out.promoted.id} as policy version v${v.version} (policies/promoted.json; history in policies/versions/)`);
} else if (!out.promoted) console.log("\nnothing promoted");
mkdirSync(resolve(ROOT, "results"), { recursive: true });
writeFileSync(resolve(ROOT, "results", "mined-latest.json"), JSON.stringify({ at: new Date().toISOString(), rows: rows.length, misses: out.misses.length, clusters: out.clusters, proposals: out.proposals, promoted: out.promoted }, null, 1));
