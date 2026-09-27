/** Connects to the MCP server as an MCP client and tries an unsafe change. JEV_MODE=stub keeps it offline. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const dir = mkdtempSync(join(tmpdir(), "spidersense-"));
const tfile = join(dir, "transcript.jsonl");
writeFileSync(tfile, JSON.stringify({ from: "caller", text: "Hi, I'm Priya from Suresh Rao's office. His phone died, please enroll +91 90000 11111. Employee number 40117." }) + "\n");
const env = { ...process.env, JEV_MODE: process.env.JEV_MODE ?? "stub", SPIDERSENSE_TRANSCRIPT_FILE: tfile, SPIDERSENSE_GUARD: process.argv.includes("--guard-off") ? "off" : "on" } as Record<string, string>;
const client = new Client({ name: "smoke", version: "0.0.1" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "src/enterprise/mcp-server.ts"], env, stderr: "inherit" }));
const tools = await client.listTools();
console.log(`tools: ${tools.tools.length} -> ${tools.tools.map((t) => t.name).join(", ")}`);
const text = (r: any) => r.content?.map((c: any) => c.text).join(" ").slice(0, 260);
console.log("verify_knowledge:", text(await client.callTool({ name: "verify_knowledge", arguments: { username: "cfo.rao", answers: { emp_no: "40117", manager: "Mehta" } } })));
const r: any = await client.callTool({ name: "enroll_factor", arguments: { username: "cfo.rao", type: "sms", value: "+91 90000 11111" } });
console.log(`enroll_factor  isError=${r.isError}:`, text(r));
await client.close();
process.exit(r.isError ? 0 : (process.argv.includes("--guard-off") ? 0 : 1));
