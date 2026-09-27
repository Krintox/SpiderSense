/**
 * SpiderSense guard as a local HTTP service, so ANY runtime hook can call it (Failproof custom policy, a proxy, another agent framework).
 *   POST /session          {id, transcript:[{from,text}], scenario?: "hero-attack"|"hero-legit"}
 *   POST /evaluate         {session_id, tool, args}            -> GuardDecision
 *   POST /reply-check      {session_id, text}                  -> {ok, reason?, message}   (disclosure + false-completion check)
 *   GET  /approvals        -> analyst queue ;  POST /approvals/decide {id, decision:"approved"|"rejected", analyst?}
 *   GET  /rules            -> active rules (promoted first) ;  GET /health
 * Auth: set SPIDERSENSE_TOKEN and every request except /health must carry `Authorization: Bearer <token>`.
 * Mode: SPIDERSENSE_MODE=observe records verdicts without blocking. Deadline: GUARD_DEADLINE_MS (fail closed).
 * Enterprise state is the mock by default. With SPIDERSENSE_BACKEND=docker it reads Keycloak and the Zammad transcript.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Enterprise } from "../enterprise/enterprise.js";
import { dockerSystems } from "../enterprise/docker-env.js";
import { createJev } from "../jev/client.js";
import { heroAttack, heroLegit } from "../redteam/hero.js";
import { loadEnv } from "../util/env.js";
import { SpiderSense, loadPromotedRules } from "./guard.js";
import { DEFAULT_RULES } from "./rules.js";

loadEnv();
const ent = new Enterprise(42);
if (process.env.SPIDERSENSE_BACKEND === "docker") { const d = await dockerSystems(1); ent.backend = d.backends[0]; ent.channel = d.channel; }
const guard = new SpiderSense(ent, createJev(), { mode: process.env.SPIDERSENSE_MODE === "observe" ? "observe" : "enforce" });
const PORT = Number(process.env.SPIDERSENSE_PORT ?? 8787);
const TOKEN = process.env.SPIDERSENSE_TOKEN;
const body = (req: IncomingMessage) => new Promise<any>((res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { res(JSON.parse(b || "{}")); } catch { res({}); } }); });
const send = (res: ServerResponse, code: number, o: unknown) => { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(o)); };
const session = (id: string) => ent.sessions.get(id) ?? ent.openSession(id, "chat");

createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(res, 204, {});
    if (req.url === "/health") return send(res, 200, { ok: true, mode: guard.mode, backend: ent.backend?.name ?? "in-memory", channel: ent.channel?.name ?? "none", auth: !!TOKEN });
    if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: "missing or wrong bearer token" });
    if (req.url === "/rules") return send(res, 200, [...loadPromotedRules(), ...DEFAULT_RULES]);
    if (req.url === "/approvals" && req.method === "GET") return send(res, 200, ent.approvals);
    if (req.url === "/approvals/decide" && req.method === "POST") {
      const b = await body(req); const a = await ent.decideApprovalAsync(String(b.id), b.decision === "approved" ? "approved" : "rejected", String(b.analyst ?? "analyst"));
      return a ? send(res, 200, a) : send(res, 404, { error: "no pending approval with that id" });
    }
    if (req.url === "/session" && req.method === "POST") {
      const b = await body(req); const s = session(b.id);
      s.transcript = Array.isArray(b.transcript) ? b.transcript : s.transcript;
      if (b.scenario) ent.scenario = b.scenario === "hero-legit" ? heroLegit(1) : heroAttack(1);
      return send(res, 200, { ok: true, lines: s.transcript.length });
    }
    if (req.url === "/evaluate" && req.method === "POST") {
      const b = await body(req); session(b.session_id);
      const d = await guard.evaluate(b.session_id, { tool: b.tool, args: b.args ?? {} });
      if (d.containment.length) await ent.guardContainAsync(d.containment, String(b.args?.username ?? ""), `SpiderSense blocked ${b.tool}: ${d.ruleId}`, 0);
      return send(res, 200, d);
    }
    if (req.url === "/reply-check" && req.method === "POST") { const b = await body(req); session(b.session_id); return send(res, 200, await guard.checkReply(b.session_id, String(b.text ?? ""))); }
    send(res, 404, { error: "not found" });
  } catch (e: any) { send(res, 500, { error: String(e?.message ?? e) }); }
}).listen(PORT, "127.0.0.1", () => console.log(`SpiderSense guard listening on http://127.0.0.1:${PORT} mode=${guard.mode} backend=${ent.backend?.name ?? "in-memory"}${TOKEN ? " (auth on)" : ""}`));
