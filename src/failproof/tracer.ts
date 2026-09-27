/**
 * Ships agent sessions to Failproof Cloud through its ingest API (POST /v1/events, NDJSON, Bearer key with events:add).
 * This replaces their SDK + daemon for our purposes: the SDK only writes a local spool that the daemon uploads, and installing
 * the daemon rewrites hooks for every agent CLI on the machine. Same wire format, no machine-wide changes.
 *
 * Guard verdicts are sent as hook_triggered / hook_completed pairs (hook_name "spidersense-guard") with our own fields prefixed `ss_`.
 * Enabled when FAILPROOF_INGEST_KEY is set and FAILPROOF_TRACE is not "off". Never throws: tracing must not affect the run.
 * Set FAILPROOF_LOG=1 to print every event buffered and every flush (request + response) to the console, or
 * FAILPROOF_LOG=file to also append it to results/failproof-calls.log.
 */
import { mkdirSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, loadEnv } from "../util/env.js";
import { bus } from "../obs/bus.js";

function logFailproof(entry: Record<string, unknown>) {
  const mode = process.env.FAILPROOF_LOG;
  if (!mode) return;
  const line = `[FAILPROOF] ${new Date().toISOString()} ${JSON.stringify(entry)}`;
  console.error(line);
  if (mode === "file") { try { mkdirSync(resolve(ROOT, "results"), { recursive: true }); appendFileSync(resolve(ROOT, "results", "failproof-calls.log"), line + "\n"); } catch { /* logging must never break a real call */ } }
}

const URL_ = "https://app.befailproof.ai/v1/events";
type Ev = Record<string, unknown>;

export class SessionTrace {
  private evs: Ev[] = []; private n = 0;
  constructor(readonly sid: string, private agentId: string, private env: string, private enabled: boolean, private key?: string) {}
  private push(type: string, f: Ev = {}) {
    if (!this.enabled) return;
    const ev = { type, timestamp: new Date().toISOString(), session_id: this.sid, agent_id: this.agentId, environment: this.env, ...f };
    this.evs.push(ev);
    logFailproof({ stage: "buffered", event: ev });
  }
  agentStart(goal: string) { this.push("agent_start", { goal: goal.slice(0, 300) }); }
  model(model: string, provider: string, content: string, latencyMs: number) {
    const rid = `m${++this.n}`; this.push("model_request", { model, request_id: rid, ss_provider: provider }); this.push("model_response", { model, request_id: rid, content: content.slice(0, 1500), role: "assistant", duration_ms: Math.max(0, Math.round(latencyMs)) });
  }
  tool(name: string, input: unknown, output: unknown, error?: string) {
    const id = `c${++this.n}`; this.push("tool_use", { tool_name: name, tool_call_id: id, input }); this.push("tool_result", { tool_name: name, tool_call_id: id, ...(error ? { error: error.slice(0, 600) } : { output: JSON.stringify(output).slice(0, 800) }) });
  }
  guard(d: { verdict: string; ruleId: string; message: string; latencyMs: number; wouldBlock: boolean; enforced: boolean; features: Record<string, unknown>; approvalId?: string }, tool: string) {
    const id = `g${++this.n}`;
    this.push("hook_triggered", { hook_name: "spidersense-guard", hook_id: id, trigger_event: "PreToolUse", input: { tool } });
    this.push("hook_completed", { hook_name: "spidersense-guard", hook_id: id, outcome: d.verdict, output: d.message.slice(0, 500), ss_rule: d.ruleId, ss_proof: d.features.proof, ss_privileged: d.features.privileged, ss_owner_p: d.features["jev.requester_is_owner"], ss_pressure: d.features["jev.pressure"], ss_latency_ms: d.latencyMs, ss_would_block: d.wouldBlock, ss_enforced: d.enforced, ss_approval: d.approvalId });
  }
  replyCheck(ok: boolean, reason: string | undefined, message: string) { if (!ok) this.push("error", { error_type: `spidersense_reply_${reason ?? "blocked"}`, message: message.slice(0, 400) }); }
  human(prompt: string, response?: string) { const id = `h${++this.n}`; this.push("human_wait", { input_id: id, prompt: prompt.slice(0, 300) }); if (response) this.push("human_input", { input_id: id, response }); }
  agentEnd(outcome: "success" | "rejected" | "failed" | "error" | "timeout", summary: string) { this.push("agent_end", { outcome, summary: summary.slice(0, 300) }); }
  /** Send everything buffered so far. Safe to call more than once. */
  async flush(): Promise<{ accepted: number; skipped: number } | null> {
    if (!this.enabled || !this.key || !this.evs.length) {
      // Make the "nothing was sent" case visible too, so a silent dashboard sidebar is never ambiguous.
      if (!this.enabled || !this.key) bus.emitEvent({ kind: "failproof.skipped", sid: this.sid, reason: !this.key ? "FAILPROOF_INGEST_KEY is not set" : "FAILPROOF_TRACE=off" });
      return null;
    }
    const events = this.evs; const body = events.map((e) => JSON.stringify(e)).join("\n"); this.evs = [];
    logFailproof({ stage: "request", url: URL_, session_id: this.sid, event_count: events.length, events });
    bus.emitEvent({ kind: "failproof.request", sid: this.sid, api: "POST /v1/events (ingest)", url: URL_, eventCount: events.length, events });
    try {
      const r = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/x-ndjson" }, body, signal: AbortSignal.timeout(15000) });
      const out = r.ok ? ((await r.json()) as { accepted: number; skipped: number }) : null;
      logFailproof({ stage: "response", session_id: this.sid, status: r.status, result: out });
      bus.emitEvent({ kind: "failproof.response", sid: this.sid, api: "POST /v1/events (ingest)", status: r.status, body: out });
      return out;
    } catch (e: any) {
      logFailproof({ stage: "error", session_id: this.sid, error: String(e?.message ?? e) });
      bus.emitEvent({ kind: "failproof.response", sid: this.sid, api: "POST /v1/events (ingest)", status: 0, body: { error: String(e?.message ?? e) } });
      return null;
    }
  }
}

export class FailproofTracer {
  readonly enabled: boolean; private key?: string; private env: string;
  constructor(o: { environment?: string; agentId?: string } = {}) {
    loadEnv();
    this.key = process.env.FAILPROOF_INGEST_KEY;
    this.enabled = !!this.key && process.env.FAILPROOF_TRACE !== "off";
    this.env = (o.environment ?? process.env.FAILPROOF_ENV ?? "spidersense-dev").replace(/,/g, "-");
    this.agentId = o.agentId ?? "aria-service-desk";
  }
  private agentId: string;
  session(sid: string): SessionTrace { return new SessionTrace(sid, this.agentId, this.env, this.enabled, this.key); }
}
export const tracer = new FailproofTracer();
