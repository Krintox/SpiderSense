# The Miner — turns attacks that got through into new policy

When an attack succeeds, someone has to write the rule that would have stopped it. This agent does that
first draft, and then has to prove the rule is real before anything is promoted.

## What it does, in order

1. **Read the misses.** Load the last evaluation run and pull out every attack decision the guard allowed.
2. **Cluster them** by playbook and pretext, so a family of near-identical failures is drafted against once.
3. **Draft a narrow rule** (this is the only LLM step). It is given the features of the missed attacks *and*
   the features of legitimate calls that must keep passing, and it must output a rule in the same ordered
   JSON condition language the built-in rules use — no new syntax, no free-text judgement.
4. **Backtest it** against every recorded decision: how many attacks does it flip to blocked, and does it
   deny anything legitimate? Any new legitimate denial disqualifies the rule outright.
5. **Sham control.** Draw hundreds of *random* rules with the same coverage and see how many do as well by
   chance. This is the step that stops us fooling ourselves: a rule that only looks good because it happens
   to match the miss is indistinguishable from a random rule, and gets rejected.
6. **Promote** the survivor as a new immutable policy version.

Step 5 is the one people skip. Without it, every mined rule looks like a win.

## Why an LLM at all

Only for step 3, the drafting. Steps 4 and 5 are arithmetic, and they are what decides whether the rule
lives. The LLM is a writer here, not a judge — if it writes nonsense, the backtest and the sham control
throw it away.

## Files

| File | What it is |
|---|---|
| `../../src/miner/mine.ts` | clustering, drafting, backtest, sham control |
| `../../src/cli/mine.ts` | the command-line entry point |
| `../../src/guard/versions.ts` | immutable policy versions; history is never rewritten |
| `../../policies/versions/` | every promoted version on disk |

## Running it on its own

```bash
# From the spidersense/ folder.
npm run mine -- --ruleset v1        # mine the latest results, backtest, sham-control, promote a survivor
npm run policy -- list              # see the versions that exist
npm run policy -- diff 1 2          # what changed between two versions
npm run policy -- rollback 1        # go back; the newer version stays in history
```

The whole loop, baseline through promotion through re-run:

```bash
npm run loop -- --n 30 --seed 41 --ruleset v1
```

Read the sham-control p-value it prints before believing any improvement. On the last run the promoted rule
came out at p = 0.060, which is **not** significant — reported as such rather than as a win.
