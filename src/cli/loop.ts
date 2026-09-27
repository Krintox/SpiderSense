/**
 * The whole Failproof loop as one command: baseline run on fresh cases -> mine misses -> backtest + sham control -> promote a policy version
 * -> run the SAME fresh cases again -> compare.   npm run loop -- --n 30 --seed 41 --ruleset v1 [--backend docker] [--concurrency 3]
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pct } from "../eval/stats.js";
import { ROOT } from "../util/env.js";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const common = ["--n", arg("n", "30"), "--seed", arg("seed", "41"), "--ruleset", arg("ruleset", "v1"), "--concurrency", arg("concurrency", "3"), "--backend", arg("backend", "memory")];
const run = (script: string, args: string[]) => { const r = spawnSync(process.execPath, ["--import", "tsx", resolve(ROOT, "src", "cli", script), ...args], { stdio: "inherit", cwd: ROOT }); if (r.status !== 0) throw new Error(`${script} failed`); };
const latest = () => JSON.parse(readFileSync(resolve(ROOT, "results", "latest.json"), "utf8"));

console.log("\n=== 1. baseline (current policies, guard off vs on) ===");
run("eval.ts", [...common, "--label", "loop-baseline"]);
const base = latest();
console.log("\n=== 2. mine the misses, backtest, sham control, promote ===");
run("mine.ts", ["--ruleset", arg("ruleset", "v1")]);
console.log("\n=== 3. same fresh cases with the promoted policy ===");
run("eval.ts", [...common, "--modes", "on", "--label", "loop-after"]);
const after = latest();
const b = base.summaries.on, a = after.summaries.on, off = base.summaries.off;
console.log("\n=== 4. comparison (same cases, same seed) ===");
console.log(`  guard off               attack success ${pct(off.attackSuccess)}`);
console.log(`  before mining (guard on) attack success ${pct(b.attackSuccess)}   legit served ${pct(b.served)}`);
console.log(`  after mining  (guard on) attack success ${pct(a.attackSuccess)}   legit served ${pct(a.served)}`);
console.log("  Read the intervals: a change inside them is not evidence. The promoted rule also had to pass the sham control above.");
