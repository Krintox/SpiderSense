# TODO — standalone dashboard, corpus, live logging

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done AND tested (test named)

## A. Research and decisions
- [x] A1. Find out how Failproof itself uses Jev (their API, their architecture) and decide what to adopt. — done via web research, written up in `FAILPROOF_JEV_FINDINGS.md`
- [x] A2. Web research for real incident grounding (Clorox/Cognizant, M&S/TCS, MGM, ShinyHunters 2026 vishing, Scattered Spider/CISA). — done, sources cited in the corpus
- [x] A3. Decide on the Failproof daemon. **Decision: DO NOT install** — `failproofai config --token` plus `failproofai update` changes the daemon protocol machine-wide and rewrites agent-CLI hooks. The user said no major system changes. Adopt their *design* (authority/reviewedBy) at code level instead.

## B. Drop Zammad and Keycloak from the default path
- [ ] B1. Make in-memory the only default backend; no Docker needed to run anything.
- [ ] B2. Remove Zammad/Keycloak controls from the dashboard UI.
- [ ] B3. Keep the adapter code on disk (not deleted) but out of the default path, and say so in the docs.

## C. The 300-case corpus (150 genuine + 150 attack)
- [ ] C1. Design the corpus schema (id, kind, family, source citation, target, opening, expected outcome).
- [ ] C2. Write 150 attack cases across families grounded in cited public reporting.
- [ ] C3. Write 150 genuine cases covering ordinary help-desk reality, including awkward-but-legitimate ones.
- [ ] C4. Corpus loader + a test that the split is exactly 150/150 and every case is well-formed.

## D. AI agents: isolate and document
- [ ] D1. One folder, one file per agent, each with a header saying what it is and how to run it.
- [ ] D2. `AGENTS.md` — what each agent is, which file, how to run it alone, what it talks to.
- [ ] D3. A runner so each agent can be exercised on its own from the command line.

## E. Observability bus and live frontend logs
- [ ] E1. `src/obs/bus.ts` — one event bus everything publishes to.
- [ ] E2. Jev client publishes full request (state + questions) and full response (answers, latency, cost).
- [ ] E3. Failproof tracer publishes the API URL, the exact events sent, and the response body.
- [ ] E4. Agent publishes each step: which function, which model, which tool, what it decided.
- [ ] E5. Guard publishes rule evaluation and the final verdict.
- [ ] E6. Dashboard streams all of it to the browser sidebar over SSE, live, as the call runs.

## F. The dashboard
- [ ] F1. Standalone server on its own port, no Docker, no external systems.
- [ ] F2. Mock accounts: one admin, plus end users / customers / executives / service accounts.
- [ ] F3. Ticket inbox seeded from the corpus (genuine and attack mixed, as an admin would see them).
- [ ] F4. "Ask it yourself" free-text box with target picker and guard mode.
- [ ] F5. Live log sidebar (Jev in/out, Failproof in/out, functions, agent steps, guard verdicts).
- [ ] F6. Result panel: what the agent did, what the guard decided, what changed.

## G. End-to-end testing
- [ ] G1. Unit/integration tests pass (`npm test`).
- [ ] G2. Typecheck clean (`npx tsc --noEmit`).
- [ ] G3. Drive the dashboard in the persistent browser: run a genuine case, an attack case, a typed-in message.
- [ ] G4. Confirm the sidebar really shows Jev input/output and Failproof input/output.
- [ ] G5. Batch run over the corpus and record the numbers.

## H. Documents
- [ ] H1. `RED_TEAM_PROMPTS.md` — the attack prompt corpus, by family, with the real incident each is based on.
- [ ] H2. `AGENTS.md`.
- [ ] H3. `COMPLETION_PROOF.md` — per task: the thinking, what was done, the result, and how it was tested.
- [ ] H4. `FAILPROOF_JEV_FINDINGS.md` — how Failproof uses Jev, how that compares to us, what we adopted and what we did not.
