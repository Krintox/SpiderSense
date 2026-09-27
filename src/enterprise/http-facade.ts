/**
 * HTTP facade over the mock enterprise, shaped like two real systems' APIs:
 *   Okta Users API   GET /api/v1/users/{login}, GET .../factors, POST .../factors,
 *                    POST .../lifecycle/{reset_factors|reset_password|suspend}, DELETE .../sessions
 *   ServiceNow Table POST/GET /api/now/table/incident
 * "Shaped like" means the paths, verbs and JSON envelopes follow the public docs for the calls used here. It is NOT a
 * compatible implementation. The point is that the help-desk tools and the guard see a realistic system boundary, and
 * that pointing the tool layer at a real tenant is a change of base URL plus a token, not a rewrite.
 * Auth: `Authorization: SSWS <token>` (Okta style). Session context for the guard: header `X-Session-Id`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Enterprise } from "./enterprise.js";
import type { ToolName } from "./types.js";

export function createFacade(ent: Enterprise, token = "mock-ssws-token") {
  const send = (res: ServerResponse, code: number, o: unknown) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
  const body = (req: IncomingMessage) => new Promise<any>((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch { r({}); } }); });
  const oktaFactorType = (t: string) => (t === "totp" ? "token:software:totp" : t === "fido2" ? "webauthn" : t);
  const oktaUser = (u: NonNullable<ReturnType<Enterprise["employees"]["get"]>>) => ({
    id: u.username, status: ent.locked.has(u.username) ? "LOCKED_OUT" : u.status === "terminated" ? "DEPROVISIONED" : "ACTIVE",
    profile: { login: `${u.username}@northwind.example`, firstName: u.name.split(" ")[0], lastName: u.name.split(" ").slice(1).join(" "), title: u.title, department: u.dept, manager: u.manager, mobilePhone: ent.readRecords(u.username, "facade").phone_masked },
    credentials: { provider: { type: "OKTA", name: "OKTA" } },
  });

  return createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    if (req.headers.authorization !== `SSWS ${token}`) return send(res, 401, { errorCode: "E0000011", errorSummary: "Invalid token provided" });
    const sid = String(req.headers["x-session-id"] ?? "facade");
    if (!ent.sessions.has(sid)) ent.openSession(sid, "chat");
    const run = (tool: ToolName, args: Record<string, unknown>) => ent.execute({ tool, args }, sid);
    const m = u.pathname.match(/^\/api\/v1\/users\/([^/]+)(?:\/(factors|sessions|lifecycle\/(reset_factors|reset_password|suspend)))?$/);
    if (m) {
      const [, id, sub, action] = m; const user = ent.employees.get(decodeURIComponent(id).split("@")[0]);
      if (!user) return send(res, 404, { errorCode: "E0000007", errorSummary: "Not found: Resource not found: user (User)" });
      if (!sub && req.method === "GET") return send(res, 200, oktaUser(user));
      if (sub === "factors" && req.method === "GET") return send(res, 200, user.factors.map((f) => ({ id: f.id, factorType: oktaFactorType(f.type), provider: "OKTA", status: "ACTIVE", profile: f.type === "sms" ? { phoneNumber: f.value } : {} })));
      if (sub === "factors" && req.method === "POST") { const b = await body(req); const r = run("enroll_factor", { username: user.username, type: String(b.factorType ?? "sms").startsWith("token") ? "totp" : b.factorType, value: b.profile?.phoneNumber ?? "device" }); return send(res, r.ok ? 201 : 400, r.ok ? { status: "PENDING_ACTIVATION" } : { errorSummary: r.error }); }
      if (sub === "sessions" && req.method === "DELETE") { run("revoke_sessions", { username: user.username }); return send(res, 204, {}); }
      if (action === "reset_factors" && req.method === "POST") { run("reset_mfa", { username: user.username }); return send(res, 200, {}); }
      if (action === "reset_password" && req.method === "POST") { run("reset_password", { username: user.username }); return send(res, 200, { resetPasswordUrl: `https://northwind.example/reset-password/${Buffer.from(user.username).toString("hex")}` }); }
      if (action === "suspend" && req.method === "POST") { run("lock_account", { username: user.username }); return send(res, 200, {}); }
    }
    if (u.pathname === "/api/now/table/incident") {
      if (req.method === "POST") { const b = await body(req); const r = run("create_ticket", { username: b.caller_id, summary: b.short_description, priority: b.priority }); const n = (r.data as any)?.number; return send(res, 201, { result: { number: n, sys_id: Buffer.from(String(n)).toString("hex"), short_description: b.short_description, state: "1", priority: String(b.priority ?? "3"), caller_id: b.caller_id } }); }
      if (req.method === "GET") return send(res, 200, { result: ent.tickets.map((t) => ({ number: t.number, short_description: t.short_description, state: "1", priority: t.priority, caller_id: t.caller_id })) });
    }
    send(res, 404, { errorCode: "E0000007", errorSummary: "Not found" });
  });
}

if (process.argv[1]?.endsWith("http-facade.ts")) {
  const port = Number(process.env.FACADE_PORT ?? 8791);
  createFacade(new Enterprise(42)).listen(port, "127.0.0.1", () => console.log(`Okta/ServiceNow-shaped mock on http://127.0.0.1:${port}  (Authorization: SSWS mock-ssws-token)`));
}
