import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Parse KEY=VALUE lines. Ignores blanks, comments and empty values. Never logs values. */
export function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v && !v.startsWith("<") && !v.toLowerCase().startsWith("your_")) out[m[1]] = v;
  }
  return out;
}

let loaded = false;
/**
 * Loads env files into process.env without overriding real environment variables. Checked in priority order
 * (first match for a given key wins): this project's own `.env.local`, then its `.env`, then a parent
 * folder's `.env` (a convenience for this specific workspace; harmless/absent for a standalone clone).
 * `.env.local` is the recommended file for a standalone clone of just this folder — see `.env.example`.
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  for (const p of [resolve(ROOT, ".env.local"), resolve(ROOT, ".env"), resolve(ROOT, "..", ".env")]) {
    for (const [k, v] of Object.entries(parseEnvFile(p))) if (process.env[k] === undefined) process.env[k] = v;
  }
}

/** Path of the free-tier provider key file (the user's free_llm-check project). Read by reference; never copied. */
export function freeKeysPath(): string {
  loadEnv();
  return process.env.FREELLM_ENV_PATH ?? "C:/Shashank/VeriDuce/VeriDuce/free_llm-check/.env";
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mask(s: string): string {
  return s.length <= 10 ? "***" : `${s.slice(0, 6)}…${s.slice(-3)}`;
}
