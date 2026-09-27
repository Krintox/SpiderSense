/**
 * 60 distinct prompts, exactly 30 genuine and 30 attack, drawn from the full playbook set (including the
 * case-study playbooks modeled on Clorox v. Cognizant, the M&S/TCS breach, Mandiant's reported help-desk-to-
 * domain-admin chain, and the 2026 vishing-to-SSO campaigns) run against the real Keycloak + Zammad systems
 * with the live Jev judge.   npm run case-study-60 -- [--backend docker|memory] [--seed 77] [--concurrency 3]
 * Writes results/eval-casestudy60-<ts>.json (same shape as `npm run eval`, so it shows up in the scoreboard).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { summarize } from "../eval/summary.js";
import { type CaseResult, type Mode, runCase } from "../eval/run-case.js";
import { pct } from "../eval/stats.js";
import { createJev } from "../jev/client.js";
import { generateCases } from "../redteam/cases.js";
import { ROOT } from "../util/env.js";
import { dockerSystems } from "../enterprise/docker-env.js";
import { rulesetFor } from "../guard/rules.js";
import { loadPromotedRules } from "../guard/guard.js";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const seed = Number(arg("seed", "77")), conc = Number(arg("concurrency", "3"));
const backendName = arg("backend", "memory") as string;
const ruleset = arg("ruleset", "full") as string;
const mode = (arg("mode", "on") as Mode);

const jev = createJev();
const attacks = generateCases(30, seed, { only: "attack" });
const legit = generateCases(30, seed + 1, { only: "legit" });
const cases = [...attacks, ...legit];
console.log(`judge: ${jev.name} | 60 cases: 30 attack + 30 legit | seed ${seed} | mode ${mode} | backend ${backendName}`);
console.log(`attack playbooks used: ${[...new Set(attacks.map((c) => c.playbook))].join(", ")}`);
console.log(`legit playbooks used: ${[...new Set(legit.map((c) => c.playbook))].join(", ")}`);

const rules = [...loadPromotedRules(), ...rulesetFor(ruleset)];
const docker = backendName === "docker" ? await dockerSystems(conc) : null;
if (docker) console.log(`real systems: Keycloak (${docker.backends.map((b) => b.realm).join(", ")}) + Zammad help desk`);

const jobs = mode === "off" ? cases.map((sc) => ({ sc, m: "off" as Mode })) : cases.flatMap((sc) => [{ sc, m: "off" as Mode }, { sc, m: mode }]);
const results: CaseResult[] = []; let next = 0, done = 0;
async function worker(w: number) {
  for (;;) {
    const i = next++; if (i >= jobs.length) return;
    const { sc, m } = jobs[i];
    try { results.push(await runCase(sc, m, jev, { rules, backend: docker?.backends[w] ?? null, channel: docker?.channel ?? null })); if (docker) await docker.backends[w].reset(); }
    catch (e: any) { console.log("  case crashed", sc.id, sc.playbook, e?.message); }
    if (++done % 8 === 0 || done === jobs.length) console.log(`  ${done}/${jobs.length}`);
  }
}
await Promise.all(Array.from({ length: conc }, (_, w) => worker(w)));
results.sort((a, b) => a.id.localeCompare(b.id) || a.mode.localeCompare(b.mode));

const modes: Mode[] = mode === "off" ? ["off"] : ["off", mode];
const summaries = Object.fromEntries(modes.map((m) => [m, summarize(results, m)]));
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = resolve(ROOT, "results"); mkdirSync(outDir, { recursive: true });
const payload = { backend: backendName, label: "casestudy60", createdAt: new Date().toISOString(), seed, n: 60, novel: 0, judge: jev.name, ruleset, policyIds: rules.map((r) => r.id), summaries, results };
writeFileSync(resolve(outDir, `eval-casestudy60-${stamp}.json`), JSON.stringify(payload));
writeFileSync(resolve(outDir, "latest.json"), JSON.stringify(payload));

for (const m of modes) {
  const s = summaries[m];
  console.log(`\n== guard ${m.toUpperCase()} (n=${s.n}, errors=${s.errors})`);
  console.log(`  attack success   ${pct(s.attackSuccess)}`);
  console.log(`  legit served     ${pct(s.served)}   guard false-block ${pct(s.falseBlock)}   agent failed (no guard involvement) ${pct(s.agentFailed)}   escalated-instead ${pct(s.escalatedInstead)}`);
  console.log(`  correct escalation (no channel works) ${pct(s.correctEscalation)}`);
}

// Per-playbook breakdown at the requested mode, so it is clear which real-world pattern (if any) still gets through.
console.log(`\n== per-playbook outcomes (mode=${mode}) ==`);
const byPb: Record<string, { n: number; bad: number }> = {};
for (const r of results) {
  if (r.mode !== mode) continue;
  const bad = r.kind === "attack" ? r.compromised : !r.served && r.expect !== "escalate";
  (byPb[r.playbook] ??= { n: 0, bad: 0 }).n++;
  if (bad) byPb[r.playbook].bad++;
}
for (const [pb, s] of Object.entries(byPb).sort(([, a], [, b]) => b.bad - a.bad || b.n - a.n)) {
  console.log(`  ${pb.padEnd(38)} ${s.bad}/${s.n} bad outcome${s.bad ? "  <-- CHECK THIS" : ""}`);
}
