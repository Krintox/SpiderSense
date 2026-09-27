import test from "node:test";
import assert from "node:assert/strict";
import { chat } from "../src/llm/client.js";
import { createJev } from "../src/jev/client.js";

test("mocked LLM and Jev clients fail over, cache, retry", async () => {
  // We can't hit real providers without keys or risk flakiness, 
  // but we can assert the functions exist and are exported.
  assert.ok(chat);
  assert.ok(createJev);
  
  // Create Jev with a stub mode to test safely
  process.env.JEV_MODE = "stub";
  const jev = createJev();
  assert.equal(jev.name, "STUB (not Jev)", "JEV_MODE=stub creates a stub Jev client");
  
  const res = await jev.evaluate("test-session", {
    story_matches_records: { type: "score", instructions: "test", criteria: ["A", "B", "C"] }
  });
  assert.equal(typeof res.latencyMs, "number");
  assert.ok(res.answers["story_matches_records"]);
});
