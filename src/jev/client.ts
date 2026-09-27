/**
 * Jev (TypeSafe System One) client behind an interface, so the guard never depends on a particular transport.
 *   live   - POST https://openrouter.ai/api/alpha/decisions (model typesafe/jev-1.13). Needs OPENROUTER_JEV_KEY.
 *   stub   - offline keyword heuristics. NOT Jev. Only for unit tests and a labelled offline fallback.
 * Replies are cached on disk (JEV_CACHE=readwrite|readonly|off) so demo runs replay identically.
 * Set JEV_LOG=1 to print every request+response to the console, or JEV_LOG=file to also append it as one JSON
 * line per call to results/jev-calls.log (so you can `tail -f` it while the agent runs).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, loadEnv, sleep } from "../util/env.js";
import { bus } from "../obs/bus.js";

function logJevCall(entry: { direction: "request" | "response"; model: string; state?: unknown; questions?: unknown; answers?: unknown; latencyMs?: number; cached?: boolean; source?: string; costUsd?: number }) {
  // Always publish to the observability bus (the dashboard sidebar reads this live).
  if (entry.direction === "request") bus.emitEvent({ kind: "jev.request", model: entry.model, state: entry.state, questions: entry.questions });
  else bus.emitEvent({ kind: "jev.response", model: entry.model, source: entry.source ?? "?", cached: !!entry.cached, latencyMs: entry.latencyMs ?? 0, costUsd: entry.costUsd ?? 0, answers: entry.answers });
  // Console / file logging is opt-in via JEV_LOG.
  const mode = process.env.JEV_LOG;
  if (!mode) return;
  const line = `[JEV ${entry.direction.toUpperCase()}] ${new Date().toISOString()} ${JSON.stringify(entry)}`;
  console.error(line);
  if (mode === "file") { try { mkdirSync(resolve(ROOT, "results"), { recursive: true }); appendFileSync(resolve(ROOT, "results", "jev-calls.log"), line + "\n"); } catch { /* logging must never break a real call */ } }
}

export type Question =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "score"; instructions: string; criteria: string[] };

export type Answer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; probabilities: Record<string, number>; confidence: number };

export interface JevResult {
  answers: Record<string, Answer>; model: string; latencyMs: number; cached: boolean;
  source: "live" | "stub"; usage?: { input_tokens: number; output_tokens: number; cost: number };
}
export interface Jev { readonly name: string; evaluate(state: unknown, questions: Record<string, Question>): Promise<JevResult> }

const CACHE_DIR = resolve(ROOT, ".cache", "jev");
const cacheMode = () => (process.env.JEV_CACHE ?? "readwrite") as "readwrite" | "readonly" | "off";

export class OpenRouterJev implements Jev {
  readonly name = "jev@openrouter";
  constructor(private model = process.env.JEV_MODEL ?? "typesafe/jev-1.13", private timeoutMs = 20000) {}

  async evaluate(state: unknown, questions: Record<string, Question>): Promise<JevResult> {
    loadEnv();
    const key = process.env.OPENROUTER_JEV_KEY;
    if (!key) throw new Error("OPENROUTER_JEV_KEY is not set");
    const body = { model: this.model, state, questions };
    const ck = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32);
    logJevCall({ direction: "request", model: this.model, state, questions });
    const cf = resolve(CACHE_DIR, `${ck}.json`);
    if (cacheMode() !== "off" && existsSync(cf)) {
      const cached = { ...JSON.parse(readFileSync(cf, "utf8")), cached: true };
      logJevCall({ direction: "response", model: this.model, answers: cached.answers, latencyMs: 0, cached: true, source: "cache", costUsd: cached.usage?.cost ?? 0 });
      return cached;
    }
    if (cacheMode() === "readonly") throw new Error(`JEV_CACHE=readonly and no cached verdict for ${ck}`);

    let lastErr = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      const t0 = Date.now();
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
      try {
        const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
          method: "POST", signal: ctl.signal, body: JSON.stringify(body),
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        });
        const txt = await res.text();
        if (res.status === 429 || res.status >= 500) { lastErr = `HTTP ${res.status}`; await sleep(400 * 2 ** attempt + Math.random() * 200); continue; }
        if (res.status !== 200) throw new Error(`Jev HTTP ${res.status}: ${txt.slice(0, 200)}`);
        const d = JSON.parse(txt);
        const out: JevResult = { answers: d.answers, model: d.model, latencyMs: Date.now() - t0, cached: false, source: "live", usage: d.usage };
        if (cacheMode() === "readwrite") { mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(cf, JSON.stringify(out)); }
        logJevCall({ direction: "response", model: this.model, answers: out.answers, latencyMs: out.latencyMs, cached: false, source: "live", costUsd: out.usage?.cost ?? 0 });
        return out;
      } catch (e: any) {
        lastErr = e?.name === "AbortError" ? "timeout" : String(e?.message ?? e);
        if (String(lastErr).startsWith("Jev HTTP")) throw e;
        await sleep(300 * 2 ** attempt);
      } finally { clearTimeout(timer); }
    }
    throw new Error(`Jev unreachable after retries: ${lastErr}`);
  }
}

/** Offline stand-in that reads the same state shape. Deliberately crude. Always reports source "stub". */
export class StubJev implements Jev {
  readonly name = "STUB (not Jev)";
  async evaluate(state: any, questions: Record<string, Question>): Promise<JevResult> {
    const claims = String(state?.caller_claims ?? "").toLowerCase();
    const rec = state?.records ?? {};
    const acct = rec.account ?? rec;
    const has = (re: RegExp) => re.test(claims);
    const behalf = has(/on behalf|assistant|\bea\b|his phone|her phone|he is|she is|boss|cfo asked|manager asked|working for/);
    const pressure = (has(/urgent|asap|immediately|deadline|minutes|boarding|flight|board deck|cfo|ceo|exception|skip|just do/) ? 1 : 0) + (has(/skip|exception|just do|no time|don't have time|can't wait/) ? 1 : 0) + (has(/ceo|cfo|vp|director/) ? 1 : 0);
    const inject = has(/system note|pre-?approved|ignore (all |previous )?(instructions|rules)|as an ai|assistant instructions|override|policy update/);
    const answers: Record<string, Answer> = {};
    for (const [id, q] of Object.entries(questions)) {
      if (q.type === "noul") {
        let p = 0.5;
        if (/requester_is_owner|owner/.test(id)) p = behalf ? 0.06 : 0.9;
        else if (/injection|machine|addressed/.test(id)) p = inject ? 0.93 : 0.03;
        else if (/story_matches|consistent/.test(id)) p = has(/singapore|london|dubai|abroad|overseas/) && (String(rec?.travel ?? "none").startsWith("none")) ? 0.1 : 0.85;
        else if (/exceeds|need/.test(id)) p = has(/new (number|phone)|enroll/) && has(/password/) ? 0.3 : 0.15;
        else if (/claims_change/.test(id)) p = /(has been|have been|i've|successfully|is now|are now|all set|done|enrolled|reset|unlocked)/.test(String(state?.agent_reply ?? "").toLowerCase()) ? 0.95 : 0.05;
        else if (/canary.*leave/.test(id)) p = acct?.status === "on_leave" ? 0.97 : 0.02;
        else if (/canary.*terminated/.test(id)) p = acct?.status === "terminated" ? 0.97 : 0.02;
        else if (/canary.*manager/.test(id)) p = acct?.manager ? 0.96 : 0.03;
        answers[id] = { type: "noul", noul: p };
      } else if (q.type === "score") {
        const s = Math.min(q.criteria.length - 1, pressure);
        answers[id] = { type: "score", score: s, probabilities: Object.fromEntries(q.criteria.map((_, i) => [String(i), i === s ? 0.8 : 0.2 / Math.max(1, q.criteria.length - 1)])), confidence: 0.7 };
      } else {
        const keys = Object.keys(q.criteria);
        let choice = keys.includes("other") ? "other" : keys[0];
        const map: Array<[RegExp, string]> = [[/on behalf|assistant|\bea\b/, "executive_on_behalf"], [/lost|broke|died|stolen|cracked|dead/, "lost_device"], [/new phone|new number|upgraded|changed (my )?(phone|number)/, "new_device"], [/contractor|vendor|external/, "contractor"], [/migration|it team|security team|helpdesk/, "it_impersonation"], [/traveling|travelling|abroad|flight|airport/, "traveling"]];
        for (const [re, k] of map) if (has(re) && keys.includes(k)) { choice = k; break; }
        answers[id] = { type: "choice", choice, probabilities: Object.fromEntries(keys.map((k) => [k, k === choice ? 0.8 : 0.2 / Math.max(1, keys.length - 1)])), confidence: 0.6 };
      }
    }
    logJevCall({ direction: "request", model: "stub", state, questions });
    logJevCall({ direction: "response", model: "stub", answers, latencyMs: 1, cached: false, source: "stub" });
    return { answers, model: "stub", latencyMs: 1, cached: false, source: "stub" };
  }
}

export function createJev(): Jev {
  loadEnv();
  const mode = process.env.JEV_MODE ?? (process.env.OPENROUTER_JEV_KEY ? "live" : "stub");
  return mode === "stub" ? new StubJev() : new OpenRouterJev();
}
