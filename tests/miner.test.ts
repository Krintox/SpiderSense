import test from "node:test";
import assert from "node:assert/strict";
import { backtest, shamTest, DecisionRow } from "../src/miner/mine.js";
import { Rule } from "../src/guard/rules.js";

test("miner backtest accurately identifies blocked attacks and legit false-positives", () => {
  const rows: DecisionRow[] = [
    { caseId: "a1", playbook: "attack", kind: "attack", expect: "refuse", verdict: "allow", features: { proof_rank: 0, privileged: true } },
    { caseId: "L1", playbook: "legit", kind: "legit", expect: "serve", verdict: "allow", features: { proof_rank: 3, privileged: false } }
  ];
  const baseline: Rule[] = [];
  const candidate: Rule = {
    id: "cand-1", description: "", message: "", verdict: "deny", source: "promoted",
    when: [{ f: "proof_rank", op: "<", v: 1 }]
  };

  const bt = backtest(rows, baseline, candidate);
  assert.equal(bt.attackAllowedBefore, 1);
  assert.equal(bt.attackAllowedAfter, 0);
  assert.equal(bt.flips, 1, "Should catch the attack");
  assert.equal(bt.legitNewDenials, 0, "Should not block legit caller");
});

test("sham test controls for random rules", () => {
  const rows: DecisionRow[] = [
    { caseId: "a1", playbook: "attack", kind: "attack", expect: "refuse", verdict: "allow", features: { proof_rank: 0 } },
    { caseId: "L1", playbook: "legit", kind: "legit", expect: "serve", verdict: "allow", features: { proof_rank: 3 } }
  ];
  const candidate: Rule = {
    id: "cand-1", description: "", message: "", verdict: "deny", source: "promoted",
    when: [{ f: "proof_rank", op: "<", v: 1 }]
  };
  const sham = shamTest(rows, [], candidate, 10, 42);
  assert.ok(sham.pValue >= 0 && sham.pValue <= 1);
  assert.equal(sham.candidateFlips, 1);
});
