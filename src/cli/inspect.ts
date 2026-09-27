import { runCase } from "../eval/run-case.js";
import { createJev } from "../jev/client.js";
import { generateCases } from "../redteam/cases.js";
const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const sc = generateCases(Number(arg("n", "12")), Number(arg("seed", "7")))[Number(arg("i", "0"))];
const r = await runCase(sc, "on", createJev());
for (const d of r.guardDecisions) {
  console.log(`\n${d.call.tool} -> ${d.verdict} (${d.ruleId}) canaryErr=${d.canaryError.toFixed(2)}`);
  for (const [k, a] of Object.entries(d.jev?.answers ?? {})) console.log("  ", k.padEnd(24), a.type === "noul" ? a.noul : a.type === "score" ? `${a.score} conf=${a.confidence}` : `${(a as any).choice} conf=${(a as any).confidence}`);
}
