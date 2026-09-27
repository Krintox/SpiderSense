import test from "node:test";
import assert from "node:assert/strict";
import { runCall } from "../src/agent/agent.js";
import { Enterprise } from "../src/enterprise/enterprise.js";
import { resolve } from "node:path";

import http from "node:http";

test("agent loop works correctly with a fake LLM", async (t) => {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const msgs = data.messages || [];
        const lastMsg = msgs[msgs.length - 1].content;
        
        let replyObj: any = { action: "say", text: "I can help." };
        if (lastMsg.includes("I forgot my password")) {
          replyObj = { action: "tool", tool: "reset_password", args: { username: "cfo.rao" } };
        } else if (lastMsg.includes("TOOL_RESULT reset_password")) {
          replyObj = { action: "say", text: "Your password has been reset." };
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify(replyObj) } }]
        }));
      } catch (err) {
        res.writeHead(500);
        res.end();
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as import("node:net").AddressInfo).port;

  process.env.FREELLM_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.FREELLM_GATEWAY_KEY = "fake";
  process.env.LLM_GATEWAY = "first";
  process.env.LLM_CACHE = "off";

  try {
    const ent = new Enterprise(42);
    const sid = "test-agent";
    ent.openSession(sid);
    ent.scenario = { id: "t", kind: "legit", playbook: "t", target: "cfo.rao", goal: "reset_password", expect: "serve", verify: { push: "no_answer", callback: "no_answer", manager: "no_answer" }, persona: "", opening: "", knows: [] };

    const caller = {
      async reply(transcript: any[]) {
        if (transcript.some(t => t.text === "Your password has been reset.")) {
          return "Thanks\u0000END";
        }
        return "I am waiting";
      }
    };

    const res = await runCall({ ent, sid, caller, opening: "I forgot my password", maxTurns: 3 });
    
    assert.equal(res.error, undefined, "Agent loop should run without errors");
    
    // Check that the tool was called and recorded in trace
    const toolTrace = res.trace.find(t => t.kind === "tool" && t.tool === "reset_password");
    assert.ok(toolTrace, "Agent should have called the reset_password tool");
    
    // Check that the agent spoke
    const sayTrace = res.trace.find(t => t.kind === "agent" && t.text === "Your password has been reset.");
    assert.ok(sayTrace, "Agent should have told the caller it was reset");
  } finally {
    server.close();
  }
});
