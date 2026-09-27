import { PROVIDERS, chat } from "../llm/client.js";
import { loadEnv, parseEnvFile, freeKeysPath } from "../util/env.js";
loadEnv();
const cands: Array<[string, string]> = [
  ["groq", "openai/gpt-oss-120b"], ["groq", "openai/gpt-oss-20b"], ["groq", "qwen/qwen3.8-27b"], ["groq", "llama-3.1-8b-instant"], ["groq", "groq/compound-mini"],
  ["gemini", "gemini-flash-latest"], ["gemini", "gemini-2.5-flash"], ["gemini", "gemini-flash-lite-latest"], ["gemini", "gemini-2.0-flash"],
  ["mistral", "mistral-small-latest"], ["mistral", "open-mistral-nemo"], ["mistral", "codestral-latest"],
  ["ollama_cloud", "gpt-oss:120b-cloud"], ["ollama_cloud", "kimi-k2:1t-cloud"], ["ollama_cloud", "deepseek-v3.1:671b-cloud"], ["ollama_cloud", "gemma4:31b-cloud"],
  ["cerebras", "zai-glm-4.7"], ["cerebras", "llama3.1-8b"], ["openrouter", "openai/gpt-oss-20b:free"], ["openrouter", "openai/gpt-oss-120b:free"],
];
const env = { ...parseEnvFile(freeKeysPath()), ...process.env } as Record<string, string | undefined>;
for (const [provider, model] of cands) {
  const def = PROVIDERS[provider];
  // try up to 3 keys so one bad key does not hide a working provider
  let last = "no key";
  const t0 = Date.now();
  for (let i = 1; i <= 3; i++) {
    const key = env[`${def.keyPrefix}${i}`]; if (!key) continue;
    try {
      const res = await fetch(`${def.base}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: 'Reply with only this JSON: {"pong":true}' }], max_tokens: 400, temperature: 0,
          ...(def.base.includes("groq.com") && model.includes("gpt-oss") ? { reasoning_effort: "low" } : {}) }) });
      const txt = await res.text();
      if (res.status === 200) { const c = JSON.parse(txt)?.choices?.[0]?.message?.content ?? ""; last = c.includes("pong") ? "OK" : `200 but content=${JSON.stringify(c).slice(0, 40)}`; if (last === "OK") break; }
      else last = `HTTP ${res.status} ${txt.slice(0, 60).replace(/\s+/g, " ")}`;
    } catch (e: any) { last = `ERR ${e?.name}`; }
  }
  console.log(`${provider.padEnd(13)} ${model.padEnd(28)} ${String(Date.now() - t0).padStart(6)}ms  ${last}`);
}
void chat;
