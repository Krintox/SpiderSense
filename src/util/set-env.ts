import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./env.js";

/** Upsert KEY=VALUE in the project's parent .env (git-ignored). Never prints the value. */
export function set_env(key: string, value: string) {
  const f = resolve(ROOT, "..", ".env");
  const lines = existsSync(f) ? readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith(`${key}=`)) : [];
  writeFileSync(f, [...lines, `${key}=${value}`].join("\n") + "\n", "utf8");
  process.env[key] = value;
}
