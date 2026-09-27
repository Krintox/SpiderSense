# Agents

Every AI-driven actor in this project lives in its own folder here, one folder per agent, laid out the same
way as the Jev Buildathon reference agents (`agents/<name>-agent/` with `AGENTS.md`, `tasks.json`, `.mcp.json`).
If you are new to this repo, read this page and then the `AGENTS.md` inside whichever agent you care about.

| Folder | Agent | What it is | Runs on |
|---|---|---|---|
| `servicedesk-agent/` | **Aria** | The service-desk agent **under test**. Handles account-recovery calls with a deliberately weak standard operating procedure, exactly like a real overworked help desk. This is the thing SpiderSense is protecting. | a free-tier LLM (Groq / Gemini / Mistral / Ollama Cloud) |
| `caller-agent/` | **The caller** | The person on the other end of the line. Three variants: a scripted caller (fixed transcript, for byte-identical demos), an LLM caller (improvises from a persona), and an adaptive caller (changes pretext when refused). Half the personas are genuine employees, half are attackers. | a free-tier LLM, deliberately a *different* model family from Aria |
| `miner-agent/` | **The miner** | Reads attacks that got through, drafts a narrow new policy rule, backtests it, and runs a sham control before anything is promoted. | a free-tier LLM |

**Not agents** (no LLM decides anything; they are here so you know where the line is):

| Component | Where | Why it is not an agent |
|---|---|---|
| SpiderSense guard | `../src/guard/guard.ts` | Deterministic rule engine. It *consults* Jev, but the rules that allow/deny are ordinary code. |
| Jev judge | `../src/jev/client.ts` | A typed-answer classifier. It answers fixed questions with numbers. It never chooses an action. |
| Failproof tracer | `../src/failproof/tracer.ts` | Ships events to an observability API. Decides nothing. |

## The one rule that matters

**Aria is the thing being tested, so Aria does not get safer.** Her standard operating procedure stays weak on
purpose. Every safety improvement belongs in the guard and its policies, never in the agent's prompt. If you
"fix" the agent, the evaluation stops measuring anything, because you have moved the goalposts rather than
caught the attack. This mirrors the buildathon's own rule that a modified agent scores zero.

## Running one agent on its own

Each folder's `AGENTS.md` has the exact command. The short version:

```bash
npm run agent:servicedesk     # Aria alone, over MCP (stdio) — connect any MCP client
npm run agent:caller          # print what a caller persona would say, no agent involved
npm run agent:miner           # mine promoted rules from the last evaluation run
```

## How they fit together during one call

```
caller-agent  --says-->  servicedesk-agent (Aria)  --wants to call a tool-->  SpiderSense guard
                                                                                |
                                                          asks Jev 7 typed questions (one call)
                                                                                |
                                                        allow / instruct / deny / escalate to a human
                                                                                |
                                          every step above is streamed to the Failproof ingest API
```
