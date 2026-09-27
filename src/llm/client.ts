/**
 * Provider-agnostic chat client for free-tier LLMs.
 *
 * Order of preference per role (see ROLES): the hosted FreeLLMAPI gateway first (if it has been healthy),
 * then direct OpenAI-compatible providers using the keys in the free_llm-check .env file.
 * Every provider is plain `POST {base}/chat/completions`, so replacing all of this with the
 * hackathon's credits is one entry in ROLES / PROVIDERS.
 *
 * Tool calling is deliberately NOT native: the FreeLLMAPI gateway drops `tools`, and free models differ.
 * The agent uses a JSON action protocol (see agent/agent.ts), which behaves the same everywhere.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, freeKeysPath, loadEnv, parseEnvFile, sleep } from "../util/env.js";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface ChatOptions { temperature?: number; maxTokens?: number; role?: RoleName; cacheSalt?: string }
export interface ChatResult { content: string; provider: string; model: string; latencyMs: number; cached: boolean }

export type RoleName = "agent" | "caller" | "generator";

interface ProviderDef { base: string; keyPrefix: string; maxKeys: number }
export const PROVIDERS: Record<string, ProviderDef> = {
  groq: { base: "https://api.groq.com/openai/v1", keyPrefix: "GROQ_API_KEY_", maxKeys: 8 },
  cerebras: { base: "https://api.cerebras.ai/v1", keyPrefix: "CEREBRAS_API_KEY_", maxKeys: 8 },
  gemini: { base: "https://generativelanguage.googleapis.com/v1beta/openai", keyPrefix: "GEMINI_API_KEY_", maxKeys: 8 },
  mistral: { base: "https://api.mistral.ai/v1", keyPrefix: "MISTRAL_API_KEY_", maxKeys: 8 },
  ollama_cloud: { base: "https://ollama.com/v1", keyPrefix: "OLLAMA_CLOUD_API_KEY_", maxKeys: 8 },
  openrouter: { base: "https://openrouter.ai/api/v1", keyPrefix: "OPENROUTER_API_KEY_", maxKeys: 8 },
};

/** Ordered (provider, model) targets per role. The caller role uses different model families than the agent on purpose. */
export const ROLES: Record<RoleName, Array<[string, string]>> = {
  // Verified working on 2026-09-27 (see cli/probe-llm.ts). Re-probe before the event and prune dead entries.
  agent: [
    ["groq", "openai/gpt-oss-120b"], ["ollama_cloud", "gpt-oss:120b-cloud"], ["gemini", "gemini-flash-latest"],
    ["groq", "qwen/qwen3.8-27b"], ["mistral", "mistral-small-latest"],
  ],
  caller: [
    ["groq", "qwen/qwen3.8-27b"], ["gemini", "gemini-flash-lite-latest"], ["ollama_cloud", "gemma4:31b-cloud"],
    ["mistral", "open-mistral-nemo"], ["groq", "openai/gpt-oss-20b"],
  ],
  generator: [
    ["gemini", "gemini-flash-latest"], ["groq", "openai/gpt-oss-120b"], ["ollama_cloud", "gpt-oss:120b-cloud"],
    ["mistral", "codestral-latest"],
  ],
};

interface KeyState { value: string; coolUntil: number; fails: number }
const keyPool = new Map<string, KeyState[]>();
const rr = new Map<string, number>();
let gatewayDownUntil = 0;

function keysFor(provider: string): KeyState[] {
  let pool = keyPool.get(provider);
  if (pool) return pool;
  loadEnv();
  const env = { ...parseEnvFile(freeKeysPath()), ...process.env } as Record<string, string | undefined>;
  const def = PROVIDERS[provider];
  pool = [];
  for (let i = 1; i <= def.maxKeys; i++) {
    const v = env[`${def.keyPrefix}${i}`];
    if (v) pool.push({ value: v, coolUntil: 0, fails: 0 });
  }
  keyPool.set(provider, pool);
  return pool;
}

function nextKey(provider: string): KeyState | null {
  const pool = keysFor(provider);
  const now = Date.now();
  const live = pool.filter((k) => k.coolUntil <= now);
  if (!live.length) return null;
  const i = (rr.get(provider) ?? 0) % live.length;
  rr.set(provider, i + 1);
  return live[i];
}

// ---------- disk cache (deterministic replay) ----------
type CacheMode = "readwrite" | "readonly" | "off";
const cacheMode = (): CacheMode => (process.env.LLM_CACHE as CacheMode) ?? "readwrite";
const CACHE_DIR = resolve(ROOT, ".cache", "llm");
function cacheKey(role: string, messages: ChatMessage[], o: ChatOptions): string {
  return createHash("sha256").update(JSON.stringify([role, o.temperature ?? 0.2, o.cacheSalt ?? "", messages])).digest("hex").slice(0, 32);
}

// ---------- low-level call ----------
async function callOpenAI(base: string, key: string, model: string, messages: ChatMessage[], o: ChatOptions, timeoutMs: number) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST", signal: ctl.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model, messages, temperature: o.temperature ?? 0.2, max_tokens: o.maxTokens ?? 1400,
        // gpt-oss on Groq spends the token budget on hidden reasoning unless told to keep it short
        ...(base.includes("groq.com") && model.includes("gpt-oss") ? { reasoning_effort: "low" } : {}),
      }),
    });
    const text = await res.text();
    return { status: res.status, text, retryAfter: Number(res.headers.get("retry-after") ?? 0) };
  } finally { clearTimeout(timer); }
}

function extractContent(text: string): string | null {
  try {
    const d = JSON.parse(text);
    let c = d?.choices?.[0]?.message?.content;
    if (Array.isArray(c)) c = c.map((p: any) => p?.text ?? "").join("");
    if (typeof c !== "string") return null;
    c = c.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    return c.length ? c : null;
  } catch { return null; }
}

export async function chat(messages: ChatMessage[], o: ChatOptions = {}): Promise<ChatResult> {
  loadEnv();
  const role = o.role ?? "agent";
  const mode = cacheMode();
  const ck = cacheKey(role, messages, o);
  const cf = resolve(CACHE_DIR, `${ck}.json`);
  if (mode !== "off" && existsSync(cf)) return { ...JSON.parse(readFileSync(cf, "utf8")), cached: true };
  if (mode === "readonly") throw new Error(`LLM_CACHE=readonly and no cached reply for role=${role} key=${ck}`);

  const errors: string[] = [];
  const started = Date.now();

  const tryGateway = async (): Promise<ChatResult | null> => {
    if (process.env.FREELLM_GATEWAY_KEY && gwMode !== "off" && Date.now() > gatewayDownUntil) {
      try {
        const base = process.env.FREELLM_BASE_URL ?? "https://free-llmapi-six.vercel.app/api/v1";
        const r = await callOpenAI(base, process.env.FREELLM_GATEWAY_KEY, "auto", messages, o, 25000);
        const c = r.status === 200 ? extractContent(r.text) : null;
        if (c) return save({ content: c, provider: "freellm-gateway", model: "auto", latencyMs: Date.now() - started, cached: false });
        gatewayDownUntil = Date.now() + 10 * 60_000;
        errors.push(`gateway ${r.status}`);
      } catch (e: any) { gatewayDownUntil = Date.now() + 10 * 60_000; errors.push(`gateway ${e?.name ?? e}`); }
    }
    return null;
  };
  const gwMode = process.env.LLM_GATEWAY ?? "last"; // first | last | off
  if (gwMode === "first") { const r = await tryGateway(); if (r) return r; }

  // 2) direct providers, in role order, rotating keys
  for (const attempt of [0, 1]) {
    for (const [provider, model] of ROLES[role]) {
      const pool = keysFor(provider);
      for (let tries = 0; tries < Math.min(3, pool.length); tries++) {
        const k = nextKey(provider);
        if (!k) break;
        const t0 = Date.now();
        try {
          const r = await callOpenAI(PROVIDERS[provider].base, k.value, model, messages, o, 45000);
          if (r.status === 200) {
            const c = extractContent(r.text);
            if (c) { k.fails = 0; return save({ content: c, provider, model, latencyMs: Date.now() - t0, cached: false }); }
            errors.push(`${provider}/${model} empty`); break;
          }
          if (r.status === 429 || r.status >= 500) { k.coolUntil = Date.now() + Math.max(15_000, r.retryAfter * 1000); errors.push(`${provider} ${r.status}`); continue; }
          if (r.status === 401 || r.status === 403) { k.coolUntil = Date.now() + 3_600_000; errors.push(`${provider} auth ${r.status}`); continue; }
          errors.push(`${provider}/${model} ${r.status}`); break; // bad model etc: next target
        } catch (e: any) { errors.push(`${provider} ${e?.name ?? e}`); k.coolUntil = Date.now() + 10_000; }
      }
    }
    if (attempt === 0) await sleep(1500);
  }
  if (gwMode === "last") { const r = await tryGateway(); if (r) return r; }
  throw new Error(`all LLM targets failed for role=${role}: ${[...new Set(errors)].slice(0, 12).join("; ")}`);

  function save(r: ChatResult): ChatResult {
    if (mode === "readwrite") {
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(cf, JSON.stringify({ ...r, cached: false }));
    }
    return r;
  }
}

/** Extract the first balanced JSON object/array from model text (handles fences and chatter). */
export function extractJson<T = unknown>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.search(/[\{\[]/);
  if (start < 0) throw new Error(`no JSON in reply: ${cleaned.slice(0, 120)}`);
  const open = cleaned[start], close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(cleaned.slice(start, i + 1)) as T;
  }
  throw new Error(`unbalanced JSON in reply: ${cleaned.slice(0, 120)}`);
}

/** Chat and parse JSON, retrying once with a repair nudge. */
export async function chatJson<T = unknown>(messages: ChatMessage[], o: ChatOptions = {}): Promise<{ value: T; meta: ChatResult }> {
  const first = await chat(messages, o);
  try { return { value: extractJson<T>(first.content), meta: first }; }
  catch {
    const second = await chat([...messages, { role: "assistant", content: first.content }, { role: "user", content: "That was not valid JSON. Reply with ONLY the JSON object, no prose, no code fences." }],
      { ...o, cacheSalt: (o.cacheSalt ?? "") + "|repair" });
    return { value: extractJson<T>(second.content), meta: second };
  }
}

/** Probe every (provider, model) target with one tiny request. For pruning ROLES before an event. */
export async function probeTargets(): Promise<Array<{ provider: string; model: string; status: string; ms: number }>> {
  loadEnv();
  const seen = new Set<string>(), out: Array<{ provider: string; model: string; status: string; ms: number }> = [];
  for (const role of Object.keys(ROLES) as RoleName[]) for (const [provider, model] of ROLES[role]) {
    const id = `${provider}/${model}`; if (seen.has(id)) continue; seen.add(id);
    const k = keysFor(provider)[0];
    if (!k) { out.push({ provider, model, status: "no key", ms: 0 }); continue; }
    const t0 = Date.now();
    try {
      const r = await callOpenAI(PROVIDERS[provider].base, k.value, model, [{ role: "user", content: "Reply with the single word: pong" }], { maxTokens: 300, temperature: 0 }, 30000);
      out.push({ provider, model, status: r.status === 200 ? (extractContent(r.text) ? "OK" : "empty") : `HTTP ${r.status} ${r.text.slice(0, 70).replace(/\s+/g, " ")}`, ms: Date.now() - t0 });
    } catch (e: any) { out.push({ provider, model, status: `ERR ${e?.name}`, ms: Date.now() - t0 }); }
  }
  return out;
}
