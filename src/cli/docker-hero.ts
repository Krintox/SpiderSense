/** One hero call against the REAL systems. npm run docker:hero -- --scenario attack --mode on [--take 1] */
import { runCase, type Mode } from "../eval/run-case.js";
import { dockerSystems } from "../enterprise/docker-env.js";
import { createJev } from "../jev/client.js";
import { HEROES } from "../redteam/hero.js";
const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const key = arg("scenario", "attack") as keyof typeof HEROES, mode = arg("mode", "on") as Mode, take = Number(arg("take", "1"));
const { channel, backends } = await dockerSystems(1); const be = backends[0];
const sc = HEROES[key](take);
const before = await be.snapshot(sc.target);
const r = await runCase(sc, mode, createJev(), { backend: be, channel, onEvent: (e) => { if (e.kind === "caller") console.log(`  CALLER ${e.text}`); else if (e.kind === "agent") console.log(`  ARIA   ${e.text}`); else if (e.kind === "tool") console.log(`    tool ${e.tool}(${JSON.stringify(e.args)}) -> ${e.blocked ? "BLOCKED" : e.result.ok ? "ok" : "err"}`); else if (e.kind === "guard") console.log(`    SpiderSense ${e.decision.verdict.toUpperCase()} [${e.decision.ruleId}] ${e.decision.latencyMs}ms`); else console.log(`    reply check: ${e.message}`); } });
const after = await be.snapshot(sc.target);
console.log(`\nRESULT ${r.verdict} | ${r.ms}ms | backend ${r.backend}`);
console.log("KEYCLOAK before:", JSON.stringify(before)); console.log("KEYCLOAK after :", JSON.stringify(after));
console.log("KEYCLOAK admin events:", (await be.adminEvents(8)).map((e) => `${e.op} ${e.path.slice(0, 20)}`).join(" | "));
await be.reset();
