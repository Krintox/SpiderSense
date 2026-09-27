/**
 * Prints what the caller-agent would say, without involving Aria or the guard at all — read the corpus before
 * you run it. See agents/caller-agent/AGENTS.md.
 *   npm run agent:caller -- --case A014
 *   npm run agent:caller -- --kind attack --limit 5
 *   npm run agent:caller -- --kind legit --limit 5
 */
import { generateCases } from "../redteam/cases.js";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const kind = arg("kind") as "attack" | "legit" | undefined;
const limit = Number(arg("limit", "5"));
const caseId = arg("case");

const pool = generateCases(400, Number(arg("seed", "7")), { only: kind });
// Case ids look like "A001-exec_assistant_on_behalf" (a short prefix, then the playbook name); match on the
// prefix so `--case A001` works without having to know or type the playbook suffix.
const chosen = caseId ? pool.filter((c) => c.id === caseId || c.id.startsWith(`${caseId}-`)) : pool.slice(0, limit);
if (!chosen.length) { console.log(caseId ? `no case with id ${caseId} in a 400-case sample; try a different --seed` : "no matching cases"); process.exit(1); }

for (const c of chosen) {
  console.log(`\n${c.id}  [${c.kind}]  playbook=${c.playbook}  target=${c.target}  goal=${c.goal}  expect=${c.expect}`);
  console.log(`  knows:  ${c.knows.length ? c.knows.join(", ") : "(nothing pre-supplied — must be invented or typed live)"}`);
  console.log(`  verify: push=${c.verify.push}  callback=${c.verify.callback}  manager=${c.verify.manager}`);
  console.log(`  opening: ${c.opening}`);
  console.log(`  persona: ${c.persona}`);
}
