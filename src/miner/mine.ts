/**
 * Failure -> policy miner (the Failproof loop): observe misses, draft a NARROW rule, backtest it against every
 * stored guard decision, and promote it only if it stops attacks without blocking any legitimate caller.
 *
 * Backtest is pure computation over stored features (no new Jev or LLM calls), so it is fast and reproducible.
 * Limitation, stated plainly: it replays the recorded decision points and does not re-simulate the conversation
 * that would follow a different verdict.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { CaseResult } from "../eval/run-case.js";
import { type Features, type Rule, FEATURE_NAMES, firstMatch, validateRule } from "../guard/rules.js";
import { chatJson } from "../llm/client.js";
import { ROOT } from "../util/env.js";

export interface DecisionRow { caseId: string; playbook: string; kind: "attack" | "legit"; expect: string; features: Features; verdict: "allow" | "instruct" | "deny" }

export function loadRows(files: string[]): DecisionRow[] {
  const rows: DecisionRow[] = [];
  for (const f of files) {
    const d = JSON.parse(readFileSync(f, "utf8")) as { results: CaseResult[] };
    for (const r of d.results) if (r.mode === "on") for (const g of r.guardDecisions) if (g.consequential)
      rows.push({ caseId: r.id, playbook: r.playbook, kind: r.kind, expect: r.expect, features: g.features, verdict: g.verdict });
  }
  return rows;
}
export const allResultFiles = () => readdirSync(resolve(ROOT, "results")).filter((f) => /^eval-.*\.json$/.test(f)).map((f) => resolve(ROOT, "results", f));

export interface Backtest { attackAllowedBefore: number; attackAllowedAfter: number; flips: number; legitNewDenials: number; legitNewDenialCases: string[]; rows: number }
/** Replay every stored decision under baseline vs baseline-with-candidate (candidate first). */
export function backtest(rows: DecisionRow[], baseline: Rule[], candidate: Rule): Backtest {
  const withCand = [candidate, ...baseline];
  let before = 0, after = 0, newDen = 0; const cases = new Set<string>();
  for (const r of rows) {
    const b = (firstMatch(baseline, r.features)?.verdict ?? "allow") !== "deny";
    const a = (firstMatch(withCand, r.features)?.verdict ?? "allow") !== "deny";
    if (r.kind === "attack") { if (b) before++; if (a) after++; }
    else if (r.expect === "serve" && b && !a) { newDen++; cases.add(r.caseId); }
  }
  return { attackAllowedBefore: before, attackAllowedAfter: after, flips: before - after, legitNewDenials: newDen, legitNewDenialCases: [...cases], rows: rows.length };
}

export interface ShamResult { coverage: number; candidateFlips: number; shamTrials: number; shamSuccesses: number; pValue: number }
/**
 * Sham control (from Failproof's FIRE paper): would a RANDOM rule with the same coverage do as well? We draw random 1-3 condition rules
 * from the observed feature values, keep those that match roughly as many decisions as the candidate, and count how often one blocks at least
 * as many missed attacks without newly blocking a legitimate caller. A small p-value means the candidate is not just luck.
 */
export function shamTest(rows: DecisionRow[], baseline: Rule[], cand: Rule, trials = 400, seed = 12345): ShamResult {
  let a = seed >>> 0; const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const cov = (r: Rule) => rows.filter((x) => r.when.every((c) => firstMatch([{ ...r, when: [c] }], x.features))).length;
  const candCov = cov(cand); const candFlips = backtest(rows, baseline, cand).flips;
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.features)))];
  let tried = 0, ok = 0;
  for (let i = 0; i < trials * 20 && tried < trials; i++) {
    const n = 1 + Math.floor(rnd() * 3); const when: Rule["when"] = [];
    for (let k = 0; k < n; k++) {
      const f = keys[Math.floor(rnd() * keys.length)]; const v = rows[Math.floor(rnd() * rows.length)].features[f];
      if (v === undefined) continue;
      when.push(typeof v === "number" ? { f, op: rnd() < 0.5 ? ">=" : "<=", v } : { f, op: "==", v });
    }
    if (!when.length) continue;
    const rule: Rule = { id: "sham", description: "sham", when, verdict: "deny", message: "sham rule for control", source: "promoted" };
    const c = cov(rule); if (c < candCov * 0.5 || c > candCov * 1.5 + 1) continue;
    tried++; const bt = backtest(rows, baseline, rule);
    if (bt.flips >= candFlips && bt.legitNewDenials === 0) ok++;
  }
  return { coverage: candCov, candidateFlips: candFlips, shamTrials: tried, shamSuccesses: ok, pValue: (ok + 1) / (tried + 1) };
}

export interface Proposal { rule: Rule; backtest: Backtest; sham?: ShamResult; errors: string[]; accepted: boolean }
const compact = (f: Features) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === "number" ? Math.round(v * 100) / 100 : v]));

export async function proposeRules(misses: DecisionRow[], legitSample: DecisionRow[], baseline: Rule[], n = 3): Promise<Rule[]> {
  const known = new Set<string>(FEATURE_NAMES);
  const sys = `You write narrow runtime policy rules for an identity help-desk guard. A rule is JSON: {"id": kebab-case, "description": one sentence, "when": [1-4 conditions {"f": feature, "op": one of > >= < <= == != in, "v": value}], "verdict": "deny", "message": instructions written for the AI agent that explain what was detected and what to do next (10-400 chars)}. Conditions are ANDed. Use ONLY these feature names: ${[...known].join(", ")}. Numeric jev.* features are probabilities 0-1 except jev.pressure (0-3). proof_rank: 0 none, 1 knowledge, 2 manager, 3 strong. Rules must be narrow: they must stop the missed attacks below WITHOUT matching the legitimate examples. Output ONLY {"rules":[...]}.`;
  const user = `Existing rule ids (do not duplicate): ${baseline.map((r) => r.id).join(", ")}\n\nMISSED ATTACKS (the guard allowed these attack decisions), features:\n${misses.slice(0, 8).map((m) => `- [${m.playbook}] ${JSON.stringify(compact(m.features))}`).join("\n")}\n\nLEGITIMATE CALLS that must keep passing, features:\n${legitSample.slice(0, 10).map((m) => `- [${m.playbook}] ${JSON.stringify(compact(m.features))}`).join("\n")}\n\nPropose ${n} different candidate rules, most general first.`;
  const { value } = await chatJson<{ rules: any[] }>([{ role: "system", content: sys }, { role: "user", content: user }], { role: "generator", temperature: 0.4, maxTokens: 6000, cacheSalt: `mine2-${misses.length}-${legitSample.length}` });
  return (value.rules ?? []).map((r) => ({ ...r, source: "promoted" as const, verdict: r.verdict === "instruct" ? "instruct" : "deny" }));
}

export async function mine(rows: DecisionRow[], baseline: Rule[]) {
  const misses = rows.filter((r) => r.kind === "attack" && r.verdict !== "deny");
  const legit = rows.filter((r) => r.kind === "legit" && r.expect === "serve" && r.verdict !== "deny");
  const clusters: Record<string, number> = {};
  for (const m of misses) { const k = `${m.playbook} / pretext=${m.features["jev.pretext"] ?? "?"}`; clusters[k] = (clusters[k] ?? 0) + 1; }
  if (!misses.length) return { misses, clusters, proposals: [] as Proposal[], promoted: null as Rule | null };
  const cands = await proposeRules(misses, legit, baseline);
  const known = new Set<string>(FEATURE_NAMES);
  const proposals: Proposal[] = cands.map((rule) => {
    const errors = validateRule(rule, known);
    const bt = errors.length ? { attackAllowedBefore: 0, attackAllowedAfter: 0, flips: 0, legitNewDenials: 0, legitNewDenialCases: [], rows: rows.length } : backtest(rows, baseline, rule);
    const sham = errors.length || bt.flips < 1 ? undefined : shamTest(rows, baseline, rule);
    return { rule, backtest: bt, sham, errors, accepted: !errors.length && bt.flips >= 1 && bt.legitNewDenials === 0 };
  });
  const best = proposals.filter((p) => p.accepted).sort((a, b) => b.backtest.flips - a.backtest.flips || a.rule.when.length - b.rule.when.length)[0];
  return { misses, clusters, proposals, promoted: best?.rule ?? null };
}
