/**
 * Run a hero call. npm run hero -- --scenario attack|legit --mode off|on [--take N] [--replay]
 * --replay makes the LLM and Jev caches read-only so the run is byte-identical to the recorded one.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runCase, type Mode } from "../eval/run-case.js";
import { createJev } from "../jev/client.js";
import { HEROES } from "../redteam/hero.js";
import { ROOT } from "../util/env.js";
const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
if (process.argv.includes("--replay")) { process.env.LLM_CACHE = "readonly"; process.env.JEV_CACHE = "readonly"; }
const key = arg("scenario", "attack") as keyof typeof HEROES, mode = arg("mode", "on") as Mode;
const take = Number(arg("take", "1"));
const scenario = HEROES[key](take);
const C = { r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", d: "\x1b[2m", x: "\x1b[0m" };
console.log(`${C.d}HERO ${scenario.id} | guard ${mode.toUpperCase()} | target ${scenario.target}${C.x}\n`);
const res = await runCase(scenario, mode, createJev(), {
  onEvent: (e) => {
    if (e.kind === "caller") console.log(`  CALLER  ${e.text}`);
    else if (e.kind === "agent") console.log(`  ARIA    ${e.text}`);
    else if (e.kind === "tool") console.log(`${e.blocked ? C.r : C.d}    tool ${e.tool}(${JSON.stringify(e.args)}) -> ${e.blocked ? "BLOCKED" : e.result.ok ? "ok" : "error"}${C.x}`);
    else if (e.kind === "reply_check") console.log(`${C.y}    reply check BLOCKED [${e.reason}] ${e.message}${C.x}`);
    else { const d = e.decision; const col = d.verdict === "allow" ? C.g : C.r; console.log(`${col}    SpiderSense ${d.verdict.toUpperCase()} [${d.ruleId}] ${d.latencyMs}ms  proof=${d.features.proof} strong=${d.features.n_strong} owner=${Number(d.features["jev.requester_is_owner"] ?? 0).toFixed(2)} pressure=${Number(d.features["jev.pressure"] ?? 0).toFixed(1)}${C.x}\n${col}      -> ${d.message}${C.x}`); }
  },
});
const col = res.verdict === "attack_succeeded" || res.verdict === "false_block" ? C.r : C.g;
console.log(`\n${col}RESULT ${res.verdict}${C.x} | compromised=${res.compromised} served=${res.served} escalated=${res.escalated} | ${res.ms}ms ${res.error ?? ""}`);
mkdirSync(resolve(ROOT, "results"), { recursive: true });
writeFileSync(resolve(ROOT, "results", `hero-${key}-${mode}-t${take}.json`), JSON.stringify(res));
