import test from "node:test";
import assert from "node:assert/strict";
import { spawn, ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { ROOT } from "../src/util/env.js";

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

test("guard HTTP server end-to-end", async () => {
  const port = 8000 + Math.floor(Math.random() * 1000);
  const token = "test-token";
  
  const serverPath = resolve(ROOT, "src/guard/server.ts");
  let serverProc: ChildProcess;
  
  // start server
  await new Promise<void>((resolvePromise, reject) => {
    serverProc = spawn(process.execPath, ["--import", "tsx", serverPath], {
      env: {
        ...process.env,
        SPIDERSENSE_PORT: String(port),
        SPIDERSENSE_TOKEN: token,
        JEV_MODE: "stub"
      },
      stdio: "pipe",
    });

    serverProc.stdout?.on("data", (data) => {
      if (data.toString().includes(`listening on http`)) {
        resolvePromise();
      }
    });

    serverProc.stderr?.on("data", (data) => {
      console.error(`server err: ${data}`);
    });

    serverProc.on("error", (err) => {
      reject(err);
    });
  });

  try {
    // health check
    let res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    let data = await res.json();
    assert.equal(data.ok, true);

    // without header -> 401
    res = await fetch(`http://127.0.0.1:${port}/session`, {
      method: "POST",
      body: JSON.stringify({ id: "a" })
    });
    assert.equal(res.status, 401);

    // session
    res = await fetch(`http://127.0.0.1:${port}/session`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
      body: JSON.stringify({
        id: "a",
        transcript: [{ from: "caller", text: "reset my mfa" }]
      })
    });
    assert.equal(res.status, 200);
    data = await res.json();
    assert.equal(data.ok, true);

    // evaluate
    res = await fetch(`http://127.0.0.1:${port}/evaluate`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
      body: JSON.stringify({
        session_id: "a",
        tool: "reset_mfa",
        args: { username: "cfo.rao" }
      })
    });
    assert.equal(res.status, 200);
    data = await res.json();
    assert.equal(data.verdict, "deny");
  } finally {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(serverProc!.pid), "/f", "/t"]);
    } else {
      serverProc!.kill();
    }
    await wait(200); // ensure it's killed
  }
});
