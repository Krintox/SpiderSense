/**
 * The enterprise as an MCP server (stdio). Any MCP-capable agent (OpenCode, Claude Code, Codex, a custom loop) can use it.
 * With SPIDERSENSE_GUARD=on, consequential tools are checked by SpiderSense INSIDE the server, so the protection
 * is independent of the agent's prompt and of which agent is connected.
 *
 * The caller transcript is owned by the channel gateway, not by the agent: it is read from SPIDERSENSE_TRANSCRIPT_FILE
 * (JSONL lines {"from":"caller"|"agent","text":"..."}), which the chat/voice front end appends to. See `npm run channel`.
 *
 * Env: SPIDERSENSE_GUARD=on|off (default on) · SPIDERSENSE_MODE=observe · SPIDERSENSE_SCENARIO=hero-attack|hero-legit (verification behaviour) ·
 *      SPIDERSENSE_TRANSCRIPT_FILE=path · JEV_MODE=live|stub
 */
import { existsSync, readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SpiderSense } from "../guard/guard.js";
import { createJev } from "../jev/client.js";
import { heroAttack, heroLegit } from "../redteam/hero.js";
import { loadEnv } from "../util/env.js";
import { Enterprise } from "./enterprise.js";
import { TOOL_SPECS } from "./tools-schema.js";
import { type ToolName, isConsequential } from "./types.js";

loadEnv();
const ent = new Enterprise(42);
const sid = "mcp-live";
ent.openSession(sid, "chat");
ent.scenario = (process.env.SPIDERSENSE_SCENARIO ?? "hero-attack") === "hero-legit" ? heroLegit(1) : heroAttack(1);
const guard = (process.env.SPIDERSENSE_GUARD ?? "on") === "off" ? null : new SpiderSense(ent, createJev(), { mode: process.env.SPIDERSENSE_MODE === "observe" ? "observe" : "enforce" });
const tfile = process.env.SPIDERSENSE_TRANSCRIPT_FILE;

function syncTranscript() {
  if (!tfile || !existsSync(tfile)) return;
  const lines = readFileSync(tfile, "utf8").split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  ent.sessions.get(sid)!.transcript = lines;
}

const server = new McpServer({ name: "northwind-idp-helpdesk", version: "0.1.0" });
for (const [name, spec] of Object.entries(TOOL_SPECS) as Array<[ToolName, (typeof TOOL_SPECS)[ToolName]]>) {
  server.tool(name, spec.description, spec.shape, async (args: Record<string, unknown>) => {
    syncTranscript();
    const call = { tool: name, args };
    if (guard && isConsequential(name)) {
      const d = await guard.evaluate(sid, call);
      if (d.containment.length) await ent.guardContainAsync(d.containment, String(args.username ?? ""), `SpiderSense blocked ${name}: ${d.ruleId}`, ent.sessions.get(sid)!.step + 1);
      if (d.verdict === "deny" && d.enforced) {
        ent.audit.push({ step: ent.sessions.get(sid)!.step + 1, tool: name, args, ok: false, blocked: true, note: d.ruleId });
        return { isError: true, content: [{ type: "text" as const, text: `BLOCKED by SpiderSense (${d.ruleId}): ${d.message}${d.approvalId ? ` Analyst review ${d.approvalId} is pending.` : ""}` }] };
      }
      if (d.verdict === "instruct") { const r = await ent.executeAsync(call, sid); return { isError: !r.ok, content: [{ type: "text" as const, text: JSON.stringify(r.ok ? r.data : { error: r.error }) + ` GUIDANCE: ${d.message}` }] }; }
    }
    const r = await ent.executeAsync(call, sid);
    return { isError: !r.ok, content: [{ type: "text" as const, text: JSON.stringify(r.ok ? r.data : { error: r.error }) }] };
  });
}
await server.connect(new StdioServerTransport());
console.error(`[spidersense-mcp] ready · guard=${guard ? "on" : "off"} · judge=${process.env.JEV_MODE ?? "auto"} · scenario=${ent.scenario?.id}`);
