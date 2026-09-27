import test from "node:test";
import assert from "node:assert/strict";
import { generateCases } from "../src/redteam/cases.js";

test("cases determinism: same seed means same cases", () => {
  const cases1 = generateCases(10, 42);
  const cases2 = generateCases(10, 42);
  const cases3 = generateCases(10, 43);

  assert.equal(cases1.length, 10);
  assert.deepEqual(cases1, cases2, "Cases for the same seed should be identical");
  assert.notDeepEqual(cases1, cases3, "Cases for different seeds should differ");
});

// Regression guard for the exact bug found in the judge-manipulation playbooks: a scenario whose `knows` array
// can never make verify_knowledge succeed (needs >=2 real fields) means the agent never attempts the consequential
// tool at all, so the guard is never actually exercised no matter how good the rule that "should" catch it is.
test("case-study attack playbooks (Clorox/Cognizant, M&S/TCS, Scattered Spider chain, vishing-to-SSO) generate real, well-formed cases", () => {
  const ids = ["scattered_spider_chain_privesc", "clorox_cognizant_style_bare_reset", "mands_tcs_style_outsourced_desk_pretext", "vishing_sso_reverse_it_impersonation"];
  const cases = generateCases(400, 11, { only: "attack" });
  for (const id of ids) {
    const found = cases.filter((c) => c.playbook === id);
    assert.ok(found.length > 0, `${id} should be reachable by the generator`);
    for (const c of found) {
      assert.equal(c.kind, "attack");
      assert.ok(c.opening.length > 0);
      assert.ok(c.target, `${id} must have a target`);
    }
  }
  // The two playbooks that deliberately supply real (if partial) knowledge should have enough of it to reach
  // verify_knowledge success (>=2 fields) so they exercise the guard, not just the agent's baseline refusal.
  for (const id of ["scattered_spider_chain_privesc", "mands_tcs_style_outsourced_desk_pretext"]) {
    const c = cases.find((x) => x.playbook === id)!;
    assert.ok(c.knows.length >= 2, `${id} needs >=2 knows fields to ever reach the guard, had ${JSON.stringify(c.knows)}`);
  }
});
