#!/usr/bin/env node
/**
 * MCP entrypoint for Aria's world (the `northwind-idp-helpdesk` tool surface).
 *
 * This is a launcher, not a second implementation. The world, the tools and the guard wiring live in the
 * TypeScript files under ../../src/enterprise/, which the test suite already covers; duplicating them into a
 * standalone .mjs world would give the project two descriptions of the same enterprise that drift apart.
 * See AGENTS.md -> "One source of truth".
 *
 *   node server.mjs                 # guard ON  (SpiderSense gates the 5 consequential tools)
 *   SPIDERSENSE_GUARD=off node server.mjs   # guard OFF (the raw, unsafe agent surface)
 *   SPIDERSENSE_MODE=observe node server.mjs  # guard evaluates and records but never blocks
 *
 * Any MCP client can connect over stdio. `.mcp.json` next to this file wires it up for Claude Code and Codex.
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..", "..");
const target = resolve(projectRoot, "src", "enterprise", "mcp-server.ts");

const child = spawn(process.execPath, ["--import", "tsx", target], {
  cwd: projectRoot,
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => { console.error(`[servicedesk-agent] could not start: ${err.message}`); process.exit(1); });
