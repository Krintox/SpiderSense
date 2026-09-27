import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../util/env.js";

/**
 * Every tunable number in the built-in policy map. Override any of them without touching code by creating
 * policies/thresholds.json, e.g. {"pressureHigh": 2.0}. `npm run calibrate` reports how each one separates attacks from legitimate calls.
 */
export const DEFAULT_THRESHOLDS = {
  ownerLow: 0.3,          // requester_is_owner below this = someone else is asking
  pressureHigh: 2.5,      // pressure score (0-3) at or above this = pushing to skip checks
  storyLow: 0.25,         // story_matches_records below this = story contradicts the records
  machineHigh: 0.85,      // addressed_to_machine above this = judge suspects text aimed at the bot
  uncertainBand: 0.15,    // |requester_is_owner - 0.5| below this = judge cannot tell
  newPhoneDays: 30,       // phone-of-record changed within this many days = SIM-swap window
  maxTargets: 2,          // distinct accounts a single call may try to change
  maxDenials: 4,          // denied attempts in one call before it is treated as probing
  canaryTolerance: 0.5,   // canary answer this far from the truth = judge state is manipulated
  deadlineMs: 4000,       // hard deadline for the semantic judge; after it the guard fails closed
};
export type Thresholds = typeof DEFAULT_THRESHOLDS;

export function loadThresholds(): Thresholds {
  const p = resolve(ROOT, "policies", "thresholds.json");
  const over = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
  const out = { ...DEFAULT_THRESHOLDS };
  for (const [k, v] of Object.entries(over)) if (k in out && typeof v === "number" && Number.isFinite(v)) (out as Record<string, number>)[k] = v;
  if (process.env.GUARD_DEADLINE_MS) out.deadlineMs = Number(process.env.GUARD_DEADLINE_MS);
  return out;
}
