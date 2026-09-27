import test from "node:test";
import assert from "node:assert/strict";
import { wilson } from "../src/eval/stats.js";
test("wilson interval", () => {
  const w = wilson(0, 30); assert.equal(w.p, 0); assert.ok(w.hi > 0.09 && w.hi < 0.13);
  const x = wilson(15, 30); assert.ok(x.lo > 0.33 && x.hi < 0.67);
  assert.deepEqual(wilson(0, 0), { p: 0, lo: 0, hi: 1, n: 0, k: 0 });
});
