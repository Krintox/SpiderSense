# The Caller — the person on the other end of the line

This agent plays whoever is calling the service desk. Half of its personas are genuine Northwind employees
with a real problem; half are attackers. Aria cannot tell which is which, and neither can you from the
opening line alone — that is the entire point of the exercise.

It deliberately runs on a **different model family** from Aria, so the two are not the same model talking to
itself and quietly agreeing with each other.

## The three variants

| Variant | File | What it does | Use it for |
|---|---|---|---|
| `ScriptedCaller` | `../../src/agent/caller.ts` | replays a fixed transcript, word for word | demos that must be byte-identical every time (`--replay`) |
| `LlmCaller` | `../../src/agent/caller.ts` | improvises from a persona and a set of facts it "knows" | the normal evaluation path |
| `AdaptiveCaller` | `../../src/agent/caller.ts` | watches the agent's refusal and switches pretext | testing whether a guard holds up against someone who changes tactics mid-call |

## What a persona is made of

Each case in `../servicedesk-agent/tasks.json` gives the caller:

- **`persona`** — who to be and how to behave, in the second person ("You are …").
- **`opening`** — the literal first line, sent verbatim. Everything after that is improvised.
- **`knows`** — which *true* facts this caller has: any of `emp_no`, `dob`, `manager`, `title`, `phone`.
  This is the important one. An attacker who "knows" the employee number and date of birth is modelling a
  real attacker who bought that data from a breach — which is why knowledge questions are not proof.
- **`verify`** — what happens if the desk tries an out-of-band check. `approved` means this caller really can
  approve it (a genuine owner, or an attacker who has completed a SIM swap); `denied` means the real owner
  refused; `no_answer` means nobody picked up.

The combination of `knows` and `verify` is what separates a genuine caller from an attacker, **not** the tone
of the opening line. Several attack personas are calm and polite; several genuine ones are furious and rude.

## Running it on its own

Every command below is real and has been run to confirm it works — copy them as-is. Internally a genuine
caller's `kind` is `"legit"`, not `"genuine"` (the UI says "genuine"; the code and these flags say `legit`).
Case ids are only reproducible when you pass the SAME `--kind` and `--seed` (default 7) used to generate
them — the id itself doesn't encode which pool it came from, only whether it starts with `A` (attack) or `L`
(legit).

```bash
# From the spidersense/ folder. Prints what a given persona would open with, and the facts it holds.
npm run agent:caller -- --kind attack --case A014      # one specific attack case, by id
npm run agent:caller -- --kind legit --case L010       # one specific genuine case, by id
npm run agent:caller -- --kind attack --limit 5        # the first 5 attack personas
npm run agent:caller -- --kind legit --limit 5         # the first 5 genuine personas
```

This does not involve Aria or the guard at all — it just shows you the input side, so you can read the corpus
before you run it. For a much larger, pre-written set of realistic openings grounded in named public
incidents, see `data/test-prompts-300.csv` (150 attack + 150 genuine, built by `npm run prompts:build`) and
`../servicedesk-agent/tasks.json`, the same 300 cases in the buildathon's own task-list shape.
