/**
 * Immutable policy versions (like Failproof's policy editor: every publish is a new version, a bad rollout is undone by redeploying an older one).
 *   policies/versions/v0001.json ...   immutable snapshots of the promoted rule set
 *   policies/promoted.json             the currently deployed promoted rules (what the guard loads)
 *   policies/current.json              {version}
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../util/env.js";
import type { Rule } from "./rules.js";

const DIR = resolve(ROOT, "policies");
const VDIR = resolve(DIR, "versions");

export interface PolicyVersion { version: number; createdAt: string; parent: number | null; note: string; rules: Rule[]; meta?: unknown }

const file = (n: number) => resolve(VDIR, `v${String(n).padStart(4, "0")}.json`);
export function listVersions(): PolicyVersion[] {
  if (!existsSync(VDIR)) return [];
  return readdirSync(VDIR).filter((f) => /^v\d+\.json$/.test(f)).sort().map((f) => JSON.parse(readFileSync(resolve(VDIR, f), "utf8")));
}
export function currentVersion(): number { const f = resolve(DIR, "current.json"); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).version : 0; }

/** Publish a new immutable version and deploy it as the current promoted set. */
export function publish(rules: Rule[], note: string, meta?: unknown): PolicyVersion {
  mkdirSync(VDIR, { recursive: true });
  const all = listVersions(); const next = (all.at(-1)?.version ?? 0) + 1;
  const v: PolicyVersion = { version: next, createdAt: new Date().toISOString(), parent: currentVersion() || null, note, rules: rules.map((r) => ({ ...r, source: "promoted" as const })), meta };
  writeFileSync(file(next), JSON.stringify(v, null, 2));
  writeFileSync(resolve(DIR, "promoted.json"), JSON.stringify(v.rules, null, 2));
  writeFileSync(resolve(DIR, "current.json"), JSON.stringify({ version: next }));
  return v;
}
/** Roll back = publish a NEW version whose rules equal an older one. History is never rewritten. */
export function rollback(to: number): PolicyVersion {
  const old = listVersions().find((v) => v.version === to);
  if (!old) throw new Error(`no such version v${to}`);
  return publish(old.rules, `rollback to v${to}`, { rollbackOf: to });
}
export function diff(a: PolicyVersion, b: PolicyVersion) {
  const A = new Map(a.rules.map((r) => [r.id, JSON.stringify(r)])), B = new Map(b.rules.map((r) => [r.id, JSON.stringify(r)]));
  return { added: [...B.keys()].filter((k) => !A.has(k)), removed: [...A.keys()].filter((k) => !B.has(k)), changed: [...B.keys()].filter((k) => A.has(k) && A.get(k) !== B.get(k)) };
}
