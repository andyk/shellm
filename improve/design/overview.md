# improve/ — what this is and what got built

*Status: v0 POC, built 2026-07-08. Loop validated end-to-end same day (gen-001, two sessions).*

## The idea in one paragraph

A recursive self-improvement loop for the shellm organism: run the agent autonomously for short bounded sessions, have an LLM read the resulting mind logs and critique them against a human-likeness rubric, synthesize the critiques into ranked change proposals targeting any text in the repo (thinker prompts, skills, harness code, seed thoughts), let a human pick which proposals to apply, apply them, and repeat on the mutated agent. The whole agent is the thing being optimized — a "candidate" is conceptually a snapshot of the entire repo.

## Why it fits shellm specifically

- The agent's action language (bash) and the harness's implementation language (bash) are the same, and every piece of the organism is a text file. One mutation mechanism — "propose a diff to a file" — covers prompts, context, workflows, and harness code alike.
- Trajectories already record everything; `traj`, `llm`, `identity`, and `thinkers` provide all the plumbing. The five loop scripts are thin glue (~700 lines total).
- The critic's natural-language reflection on execution traces is the core learning signal — this is GEPA's central finding (arXiv:2507.19457), and it validated immediately: gen-001's first critique found a real harness bug (see below).

## The pipeline

```
1. observe     session.sh     fresh identity, minimal thinker roster
                              (inner_monologue + actor), scenario seeded as a
                              chat message, mind runs for ~1 min, stopped.
                              The identity dir IS the session artifact.
2. measure     vitals.sh      mechanical psychometrics (no LLM): step counts,
                              thought dup rate, action→observation follow-
                              through, max gap, memories written, log errors.
3. introspect  critique.sh    LLM reads scenario + trajectory + thinker logs
                              + vitals → evidence-cited critique (prompts/critic.md).
4. synthesize  synthesize.sh  all critiques + vitals + component map → ranked
                              proposal cards, one component per card
                              (prompts/synthesizer.md).
5. decide      human          mv chosen cards from proposals/ to accepted/.
6. apply       handoff.sh     accepted cards → PROMPT.md + a claude command.
                              Claude Code independently verifies each card
                              against the codebase (IMPLEMENT/REVISE/REJECT),
                              implements survivors, runs gates (bash -n,
                              shellcheck, test_context.sh). NO git automation
                              — human reviews the diff and commits.
                              (apply.sh: experimental shellm-self-modifies
                              alternative, not the default path.)
```

Artifacts per generation live in `generations/gen-NNN/`: `identities/<run>/` (trajectories, memories, thinker logs), `sessions.csv`, `vitals.csv`, `critiques/`, `proposals/`, `accepted/`.

## What gen-001 proved

- **Session g001r1** (haiku): every actor invocation crashed — `llm` sends adaptive-thinking params to models that don't support them. 4 actions, 0 observations; the starving monologue spiraled into 8 paraphrased "I'm stuck in a loop" thoughts.
- **Session g001r2** (sonnet): healthy — follow-through 1.00, 2 memories written, 0 errors.
- The critic caught, with cited evidence: the thinking-params bug; that actor failures emit no observation step (the mind is blind to its own failed actions — a harness contract gap); a likely `action:`-line extractor bug; per-tick context bloat (full skills manual reprinted every monologue tick); and that the newborn seed thoughts "read like a system checklist rather than a mind waking up."
- Synthesis turned that into 5 well-formed cards, correctly ranking the two low-risk mechanical fixes first.
- Known proxy weakness confirmed: `dup_thought_rate` is exact-match, so paraphrase loops score 0.00. The critic catches them semantically; a fuzzier mechanical proxy is future work.

## Design invariants (v0)

- The loop never modifies `improve/` itself (apply.sh refuses such cards).
- The critic/synthesizer never grade their own applied changes; cross-generation comparison comes from vitals + the next generation's critiques.
- Human decides what gets applied, and separately what gets committed. No git write automation anywhere.
- Fresh identity per session run; sessions don't contaminate each other. Cross-session memory continuity is opt-in via `session.sh --memories <prior-run>/memories`.

See also: [goals.md](goals.md), [next-steps.md](next-steps.md), [runbook.md](runbook.md).
