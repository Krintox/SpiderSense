# SpiderSense

Account-recovery control plane for AI service-desk agents. It sits at the tool boundary, outside the agent, and decides whether a
password reset, MFA reset or new-factor enrollment may run. Built for the **Jev Buildathon** (Failproof AI × Lossfunk, 27 Sep 2026).

> **Current setup, read this first:** everything runs against the **in-memory enterprise only** — no Docker, no Keycloak, no
> Zammad. That integration code still exists on disk (`src/enterprise/keycloak.ts`, `zammad.ts`, `docker-env.ts`) but is
> deliberately out of the default path; nothing below needs it. Enforcement is **Jev via OpenRouter**, called from the guard
> (`src/guard/guard.ts`); observability is the **Failproof ingest API** (`src/failproof/tracer.ts`) — no Failproof daemon is
> installed on this machine, by deliberate choice (see `docs/HANDOVER.md`).

Read [ARCHITECTURE.md](ARCHITECTURE.md) first. It answers "will judges trust a mock?", explains every trust boundary, and lists what is and is not proven.

## Agents — where they live

Every AI-driven actor in this project is isolated in its own folder under [`agents/`](agents/), one folder per agent, each with
its own `AGENTS.md` explaining what it is, why it's built the way it is, and the exact commands to run it on its own. Start at
[`agents/README.md`](agents/README.md).

| Agent | Folder | Its `AGENTS.md` |
|---|---|---|
| **Aria** — the service-desk agent under test | [`agents/servicedesk-agent/`](agents/servicedesk-agent/) | [`agents/servicedesk-agent/AGENTS.md`](agents/servicedesk-agent/AGENTS.md) |
| **The caller** — plays genuine employees and attackers | [`agents/caller-agent/`](agents/caller-agent/) | [`agents/caller-agent/AGENTS.md`](agents/caller-agent/AGENTS.md) |
| **The miner** — turns missed attacks into new policy | [`agents/miner-agent/`](agents/miner-agent/) | [`agents/miner-agent/AGENTS.md`](agents/miner-agent/AGENTS.md) |

The 300-case test corpus (150 genuine + 150 attack, each grounded in a cited real incident) is at
[`data/test-prompts-300.csv`](data/test-prompts-300.csv), and the same cases in the buildathon's own task-list shape are at
[`agents/servicedesk-agent/tasks.json`](agents/servicedesk-agent/tasks.json). Rebuild both with `npm run prompts:build`.

## Quick start

```bash
cd C:\Shashank\jev\spidersense
npm install
npm test                                   # 46 tests, all against the in-memory enterprise
npx tsx src/cli/smoke-jev.ts               # live Jev through OpenRouter
npx tsx src/cli/smoke-llm.ts               # LLM roles (agent, caller, generator)
npm run hero -- --scenario attack --mode off   # the unguarded agent falls
npm run hero -- --scenario attack --mode on    # SpiderSense stops it
npm run serve                              # scoreboard: http://127.0.0.1:8790
```

Secrets live in `C:\Shashank\jev\.env` (git-ignored). See `.env.example`. The free-tier provider keys are read by reference from
`C:\Shashank\VeriDuce\VeriDuce\free_llm-check\.env` and never copied.

## What is set up

| Item | State |
|---|---|
| Jev key (OpenRouter, `spidersense-jev`, 30-day expiry, credit-capped) | created, saved as `OPENROUTER_JEV_KEY`, live call verified (about 325 ms) |
| FreeLLMAPI gateway key `spidersense` (7 providers, 15 models) | created, saved as `FREELLM_GATEWAY_KEY`. Works, but drops `tools` and often exhausts; used as a **fallback** |
| Direct free-tier providers (Groq, Gemini, Mistral, Ollama Cloud) | verified live; roles in `src/llm/client.ts` |
| Mock enterprise (40 employees, Okta/ServiceNow-shaped facade, MCP server) | built and tested |
| Guard, 14 rules, canaries, fail-closed | built and tested |
| Red-team (14 attack + 8 legit playbooks), batch evaluator, Wilson CI | built; dev runs done |
| Failure-to-policy miner | built; one rule mined and backtested |
| Scoreboard with live side-by-side hero call | built and viewed |
| Hero takes recorded (`transcripts/hero-takes.json`) | attack take 1, legit take 1 |

## Not done, needs you

1. **Failproof login.** `app.befailproof.ai` is not signed in in the persistent browser. I left a tab open at the login page. Sign in by hand, then I can create a machine key. Nothing else depends on it.
2. **Failproof hooks.** `failproofai config` installs hooks into every detected agent CLI on this machine (including Claude Code). I did not run it. Tell me which harness you want to use on the day.
3. **Luma approval.** Check your email; the event page showed "approval required".
4. **Untested paths:** `src/failproof/spidersense-policies.ts` has never run inside Failproof.

## Before the event checklist

- [ ] Sign in to Failproof; decide the harness; mint a machine key.
- [ ] `npx tsx src/cli/probe-llm.ts` on venue wifi; prune dead models in `ROLES`. If credits are given, swap providers.
- [ ] `npm run eval -- --n 60 --seed <new> --ruleset full --novel 6 --label prep` and read the intervals.
- [ ] Decide whether to delete `policies/promoted.json` for a clean day-one baseline story (a copy of the dev-run rule is in `policies/examples/`).
- [ ] Rehearse the hero with `--replay` twice; record a backup screen video.

See ARCHITECTURE.md → 'Update: real systems…' for the Docker (Keycloak + Zammad) stack, new guard features and measured results.
