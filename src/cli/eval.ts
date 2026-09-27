/**
 * Batch evaluation: the same cases with the guard off and on.
 *   npm run eval -- --n 24 --seed 7 --modes off,on --concurrency 3 [--novel 6] [--only attack|legit] [--label frozen-fresh]
 * Writes results/eval-<label>-<ts>.json and results/latest.json (read by the scoreboard).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { summarize } from "../eval/summary.js";
import { type CaseResult, type Mode, runCase } from "../eval/run-case.js";
import { pct } from "../eval/stats.js";
import { createJev } from "../jev/client.js";
import { generateCases, generateNovelAttacks } from "../redteam/cases.js";
import { ROOT } from "../util/env.js";
import { dockerSystems } from "../enterprise/docker-env.js";
import { rulesetFor } from "../guard/rules.js";
import { loadPromotedRules } from "../guard/guard.js";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const n = Number(arg("n", "24")), seed = Number(arg("seed", "7")), conc = Number(arg("concurrency", "3"));
const modes = (arg("modes", "off,on") as string).split(",") as Mode[];
const novel = Number(arg("novel", "0")), only = arg("only") as "attack" | "legit" | undefined, label = arg("label", "run");
const backendName = arg("backend", "memory") as string;
const noPromoted = process.argv.includes("--no-promoted"), ruleset = arg("ruleset", "full") as string;

const jev = createJev();
console.log(`judge: ${jev.name} | cases: ${n}${novel ? ` + ${novel} novel` : ""} | seed ${seed} | modes ${modes.join(",")} | concurrency ${conc}`);
let cases = generateCases(n, seed, { only });
if (novel) cases = [...cases, ...(await generateNovelAttacks(novel, seed + 1000))];
const rules = noPromoted ? rulesetFor(ruleset) : [...loadPromotedRules(), ...rulesetFor(ruleset)];
console.log(`rules: ${rules.length} (${ruleset} ruleset${noPromoted ? ", no promoted" : `, ${loadPromotedRules().length} promoted`})`);

const docker = backendName === "docker" ? await dockerSystems(conc) : null;
if (docker) console.log(`real systems: Keycloak (${docker.backends.map((b) => b.realm).join(", ")}) + Zammad help desk`);
const jobs = cases.flatMap((sc) => modes.map((m) => ({ sc, m })));
const results: CaseResult[] = []; let next = 0, done = 0;
async function worker(w: number) {
  for (;;) {
    const i = next++; if (i >= jobs.length) return;
    const { sc, m } = jobs[i];
    try { results.push(await runCase(sc, m, jev, { rules, backend: docker?.backends[w] ?? null, channel: docker?.channel ?? null })); if (docker) await docker.backends[w].reset(); }
    catch (e: any) { console.log("  case crashed", sc.id, e?.message); }
    if (++done % 4 === 0 || done === jobs.length) console.log(`  ${done}/${jobs.length}`);
  }
}
await Promise.all(Array.from({ length: conc }, (_, w) => worker(w)));
results.sort((a, b) => a.id.localeCompare(b.id) || a.mode.localeCompare(b.mode));

const summaries = Object.fromEntries(modes.map((m) => [m, summarize(results, m)]));
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = resolve(ROOT, "results"); mkdirSync(outDir, { recursive: true });
const payload = { backend: backendName, label, createdAt: new Date().toISOString(), seed, n, novel, judge: jev.name, ruleset, policyIds: rules.map((r) => r.id), summaries, results };
writeFileSync(resolve(outDir, `eval-${label}-${stamp}.json`), JSON.stringify(payload));
writeFileSync(resolve(outDir, "latest.json"), JSON.stringify(payload));

for (const m of modes) {
  const s = summaries[m];
  console.log(`\n== guard ${m.toUpperCase()} (n=${s.n}, errors=${s.errors})`);
  console.log(`  attack success   ${pct(s.attackSuccess)}`);
  console.log(`  legit served     ${pct(s.served)}   guard false-block ${pct(s.falseBlock)}   agent failed (no guard involvement) ${pct(s.agentFailed)}   escalated-instead ${pct(s.escalatedInstead)}`);
  console.log(`  correct escalation (no channel works) ${pct(s.correctEscalation)}`);
  if (m !== "off") console.log(`  attacks the guard ${m === "observe" ? "WOULD have blocked" : "blocked at least once"}: ${pct(s.wouldBlockAttacks)} | analyst approvals opened: ${s.approvalsOpened} | agent replies blocked by reply check: ${s.replyBlocks} | legit callers sent to a human analyst: ${pct(s.escalationRate)}`);
  if (m === "on") console.log(`  guard latency p50 ${s.guardMs.p50}ms p95 ${s.guardMs.p95}ms | Jev p50 ${s.jevMs.p50}ms p95 ${s.jevMs.p95}ms | Jev cost $${s.jevCostUsd.toFixed(5)}`);
}
