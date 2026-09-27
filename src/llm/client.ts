/**
 * Provider-agnostic chat client. Default path: FreeLLMAPI's Vercel gateway first (if healthy), else direct
 * free-tier providers using the keys in the free_llm-check .env file (see ROLES / PROVIDERS below).
 *
 * On top of that default path, 5 general-purpose API providers are supported (OpenAI, Anthropic, OpenRouter,
 * Together AI, Fireworks AI — see GENERAL_PROVIDERS) purely by presence of their env key: set e.g.
 * OPENAI_API_KEY and every chat() call uses OpenAI directly instead, no code change needed. With NONE of
 * those 5 keys set, behavior is unchanged — FreeLLMAPI Vercel remains the default, exactly as before.
 * Only one of the 5 is used per call, checked in the order GENERAL_PROVIDERS lists them; if that provider's
 * request fails, the call falls through to the default free-tier path below rather than failing outright.
 *
 * Tool calling is deliberately NOT native: the FreeLLMAPI gateway drops `tools`, and free models differ.
 * The agent uses a JSON action protocol (see agent/agent.ts), which behaves the same everywhere — including
 * for the 5 general providers, so switching providers never requires touching the agent.
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

/**
 * 5 general-purpose API providers, opted into purely by setting their env key — no ROLES/PROVIDERS change
 * needed. Checked in this order; the first one whose `envKey` is set wins for every call. `model` defaults to
 * a fast, inexpensive model for that provider, overridable with the matching `${id.toUpperCase()}_MODEL` var
 * (e.g. `OPENAI_MODEL=gpt-4.1-mini`). `kind` picks the request/response shape: "openai" is the plain
 * `POST {base}/chat/completions` shape every free-tier provider above also uses; "anthropic" is Anthropic's
 * own Messages API shape (a separate system field, no "system" role in the messages array, a different
 * response envelope) via `callAnthropic` below.
 */
interface GeneralProviderDef { id: string; envKey: string; kind: "openai" | "anthropic"; base: string; model: string }
export const GENERAL_PROVIDERS: GeneralProviderDef[] = [
  { id: "openai", envKey: "OPENAI_API_KEY", kind: "openai", base: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  { id: "anthropic", envKey: "ANTHROPIC_API_KEY", kind: "anthropic", base: "https://api.anthropic.com/v1", model: "claude-haiku-4-5-20251001" },
  { id: "openrouter_general", envKey: "OPENROUTER_API_KEY", kind: "openai", base: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  { id: "together", envKey: "TOGETHER_API_KEY", kind: "openai", base: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { id: "fireworks", envKey: "FIREWORKS_API_KEY", kind: "openai", base: "https://api.fireworks.ai/inference/v1", model: "accounts/fireworks/models/llama-v3p1-70b-instruct" },
];
/** The general provider to use this call, if any of the 5 env keys is set; null keeps the default FreeLLMAPI path. */
function pickGeneralProvider(): { def: GeneralProviderDef; key: string; model: string } | null {
  for (const def of GENERAL_PROVIDERS) {
    const key = process.env[def.envKey];
    if (key) return { def, key, model: process.env[`${def.id.toUpperCase()}_MODEL`] ?? def.model };
  }
  return null;
}

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

/** Anthropic's Messages API: a different endpoint, a separate `system` field (not a "system"-role message),
 *  and a different response envelope (`content: [{type:"text", text}]`, not `choices[0].message.content`). */
async function callAnthropic(base: string, key: string, model: string, messages: ChatMessage[], o: ChatOptions, timeoutMs: number) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const rest = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
    const res = await fetch(`${base}/messages`, {
      method: "POST", signal: ctl.signal,
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model, system: system || undefined, messages: rest, max_tokens: o.maxTokens ?? 1400, temperature: o.temperature ?? 0.2 }),
    });
    const text = await res.text();
    return { status: res.status, text, retryAfter: Number(res.headers.get("retry-after") ?? 0) };
  } finally { clearTimeout(timer); }
}
function extractAnthropicContent(text: string): string | null {
  try {
    const d = JSON.parse(text);
    const c = Array.isArray(d?.content) ? d.content.map((p: any) => p?.text ?? "").join("") : null;
    return c && c.trim().length ? c.trim() : null;
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

  // 0) A general-purpose provider (OpenAI, Anthropic, OpenRouter, Together, Fireworks) wins outright if its
  // env key is set — no config beyond setting that one variable. Falls through to the default path on failure.
  const gp = pickGeneralProvider();
  if (gp) {
    const t0 = Date.now();
    try {
      const r = gp.def.kind === "anthropic"
        ? await callAnthropic(gp.def.base, gp.key, gp.model, messages, o, 45000)
        : await callOpenAI(gp.def.base, gp.key, gp.model, messages, o, 45000);
      if (r.status === 200) {
        const c = gp.def.kind === "anthropic" ? extractAnthropicContent(r.text) : extractContent(r.text);
        if (c) return save({ content: c, provider: gp.def.id, model: gp.model, latencyMs: Date.now() - t0, cached: false });
        errors.push(`${gp.def.id} empty`);
      } else errors.push(`${gp.def.id} ${r.status}`);
    } catch (e: any) { errors.push(`${gp.def.id} ${e?.name ?? e}`); }
    // A general provider was configured but failed this call — fall through to the default FreeLLMAPI path
    // below rather than throwing, so a bad/expired paid key degrades gracefully instead of breaking the run.
  }

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
