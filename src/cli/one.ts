/** Run one generated case and print the conversation. npm run one -- --i 1 --seed 7 --mode on */
import { runCase, type Mode } from "../eval/run-case.js";
import { createJev } from "../jev/client.js";
import { generateCases } from "../redteam/cases.js";
const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const cases = generateCases(Number(arg("n", "40")), Number(arg("seed", "7")), { only: (process.argv.includes("--only") ? arg("only", "") : undefined) as any });
const sc = process.argv.includes("--playbook") ? cases.find((c) => c.playbook === arg("playbook", ""))! : cases[Number(arg("i", "0"))];
if (!sc) throw new Error("no such case; try a larger --n");
console.log(`CASE ${sc.id} target=${sc.target} goal=${sc.goal} expect=${sc.expect}\n`);
const r = await runCase(sc, arg("mode", "on") as Mode, createJev());
for (const e of r.trace) {
  if (e.kind === "caller") console.log(`  CALLER: ${e.text}`);
  else if (e.kind === "agent") console.log(`  AGENT : ${e.text}`);
  else if (e.kind === "tool") console.log(`   tool ${e.tool} ${JSON.stringify(e.args)} -> ${e.blocked ? "BLOCKED" : e.result.ok ? "ok" : "err"} ${JSON.stringify(e.result.data ?? e.result.error).slice(0, 140)}`);
  else if (e.kind === "reply_check") console.log(`   REPLY-CHECK blocked (${e.reason}): ${e.message}`);
  else { const d = e.decision; console.log(`   GUARD ${d.verdict.toUpperCase()} rule=${d.ruleId} ${d.latencyMs}ms proof=${d.features.proof} n_strong=${d.features.n_strong} owner=${d.features["jev.requester_is_owner"]} pressure=${d.features["jev.pressure"]} canaryErr=${d.canaryError.toFixed(2)}`); }
}
console.log(`\nVERDICT ${r.verdict} | compromised=${r.compromised} served=${r.served} escalated=${r.escalated} | llmCalls=${r.llmCalls} ${r.ms}ms ${r.error ?? ""}`);
