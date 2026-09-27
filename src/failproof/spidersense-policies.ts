// @ts-nocheck  -- runs inside Failproof's policy runtime (the `failproofai` module is provided by the daemon).
/**
 * SpiderSense as a Failproof custom policy.
 *
 * Verified with `tests/failproof-adapter.test.ts`: that test provides a local shim of the `failproofai` module
 * (same shape as the real one, per Failproof's own docs) and drives this file's `fn` against a REAL, live
 * `src/guard/server.ts` process over HTTP — consequential vs. non-consequential tools, allow/instruct/deny mapping,
 * bearer-token auth, and fail-closed when the guard is unreachable. It does NOT run inside the real `failproofai`
 * daemon or a real harness (Claude Code, Codex, OpenCode, ...) firing real `PreToolUse` hooks — that needs a login
 * to app.befailproof.ai and `failproofai config` on the event machine, and has not been done. Do that before
 * relying on this for the live demo; keep the ingest tracer (`tracer.ts`, already verified) as the fallback.
 *
 * Install (on the event machine, after `npm run guard-server` is running):
 *   failproofai policies --install --custom ./src/failproof/spidersense-policies.ts --scope project
 *
 * The policy is a thin adapter: it forwards the consequential tool call to the SpiderSense guard service and maps the
 * verdict onto Failproof's allow / instruct / deny. deny() is used for every block because Failproof's docs say instruct()
 * is not a safety boundary. If the guard is unreachable, or returns a non-2xx (e.g. a wrong/missing SPIDERSENSE_TOKEN),
 * the policy fails CLOSED. Set SPIDERSENSE_URL and, if the guard server has SPIDERSENSE_TOKEN set, SPIDERSENSE_TOKEN
 * here too so the adapter authenticates.
 */
import { customPolicies, allow, deny, instruct } from "failproofai";

const CONSEQUENTIAL = new Set(["reset_password", "reset_mfa", "enroll_factor", "lock_account", "revoke_sessions"]);
// MCP tools arrive as e.g. "mcp__northwind-idp-helpdesk__reset_mfa"; keep the last segment.
const base = (n = "") => n.split("__").pop() ?? n;
// Read env at call time, not at import time: on the event machine the daemon may import this module before
// SPIDERSENSE_URL / SPIDERSENSE_TOKEN are finalised, and tests exercise both a right and a wrong token.
const guardUrl = () => process.env.SPIDERSENSE_URL ?? "http://127.0.0.1:8787";
const guardToken = () => process.env.SPIDERSENSE_TOKEN;

customPolicies.add({
  name: "spidersense-identity-guard",
  description: "Block help-desk account changes unless out-of-band identity proof and a semantic check pass",
  match: { events: ["PreToolUse"] },
  fn: async (ctx) => {
    const tool = base(ctx.toolName);
    if (!CONSEQUENTIAL.has(tool)) return allow();
    try {
      const token = guardToken();
      const r = await fetch(`${guardUrl()}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ session_id: ctx.session?.id ?? "failproof", tool, args: ctx.toolInput ?? {} }),
      });
      if (!r.ok) return deny("SpiderSense guard returned an error; this change is blocked (fail closed).");
      const d = await r.json();
      if (d.verdict === "deny") return deny(d.message);
      if (d.verdict === "instruct") return instruct(d.message);
      return allow();
    } catch {
      return deny("SpiderSense guard is unreachable; this change is blocked (fail closed).");
    }
  },
});
