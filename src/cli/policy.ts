/** Policy version control. npm run policy -- list | show <n> | diff <a> <b> | rollback <n> | export */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { currentVersion, diff, listVersions, rollback } from "../guard/versions.js";
import { ROOT } from "../util/env.js";

const [cmd, a, b] = process.argv.slice(2);
const vs = listVersions();
if (cmd === "list" || !cmd) {
  console.log(`current: v${currentVersion() || 0}`);
  for (const v of vs) console.log(`  v${v.version}  ${v.createdAt}  parent=${v.parent ?? "-"}  rules=${v.rules.length}  ${v.note}`);
  if (!vs.length) console.log("  (no promoted versions yet)");
} else if (cmd === "show") {
  const v = vs.find((x) => x.version === Number(a)); if (!v) throw new Error("no such version");
  console.log(JSON.stringify(v, null, 2));
} else if (cmd === "diff") {
  const A = vs.find((x) => x.version === Number(a)), B = vs.find((x) => x.version === Number(b)); if (!A || !B) throw new Error("no such version");
  console.log(JSON.stringify(diff(A, B), null, 2));
} else if (cmd === "rollback") {
  const v = rollback(Number(a)); console.log(`rolled back: published v${v.version} (${v.note})`);
} else if (cmd === "export") {
  if (a === "json") {
    const { DEFAULT_RULES } = await import("../guard/rules.js");
    const { loadPromotedRules } = await import("../guard/guard.js");
    const all = [...loadPromotedRules(), ...DEFAULT_RULES];
    console.log(JSON.stringify(all, null, 2));
    process.exit(0);
  }
  // Failproof policy pack: the adapter that forwards consequential tool calls to the guard, plus the current rules as documentation.
  const dir = resolve(ROOT, "dist", "pack"); mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "README.md"), `# SpiderSense policy pack\n\nForwards help-desk account changes to the SpiderSense guard service (npm run guard-server) and maps its verdict to allow/instruct/deny. Fails closed.\n\nCurrent promoted version: v${currentVersion() || 0}\n\nInstall: failproofai policies --install --custom ./index.ts --scope project\nPublish: failproofai publish index.ts --min-cli-version 1.0.7-beta.0\n`);
  const src = resolve(ROOT, "src", "failproof", "spidersense-policies.ts");
  writeFileSync(resolve(dir, "index.ts"), (await import("node:fs")).readFileSync(src, "utf8"));
  writeFileSync(resolve(dir, "rules.snapshot.json"), JSON.stringify(vs.at(-1)?.rules ?? [], null, 2));
  console.log(`wrote ${dir}`);
} else { console.log("usage: policy list | show <n> | diff <a> <b> | rollback <n> | export"); }
