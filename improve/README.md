# improve — self-improvement loop (v0 POC)

A recursive self-improvement loop for the shellm organism. An LLM reads the mind logs of bounded autonomous sessions, critiques them against a human-likeness rubric, and after a few sessions synthesizes ranked change proposals. A human picks which proposals to apply; the loop repeats on the mutated agent.

North star: a more human-like agent (24/7 on-rails, self-set goals, learning, legible mind log). Docs: [design/overview.md](design/overview.md) (what this is), [design/goals.md](design/goals.md) (north star, sub-goals, GEPA framing), [design/next-steps.md](design/next-steps.md) (roadmap), [design/runbook.md](design/runbook.md) (full run + debugging guide).

## The loop

```
                 ┌──────────────────────────────────────────────┐
                 ▼                                              │
1. observe    session.sh      run a fresh identity for ~1 min   │
2. measure    vitals.sh       mechanical psychometrics → CSV    │
3. introspect critique.sh     LLM reads the mind log → critique │
   (repeat 1-3 for ~3 sessions)                                 │
4. synthesize synthesize.sh   critiques → ranked proposal cards │
5. decide     (human)         mv chosen cards to accepted/      │
6. apply      apply.sh        agent implements the card         │
                 └──────────── next generation ─────────────────┘
```

## Quickstart (two commands per iteration)

```bash
# Stages 1-4: run the whole scenario battery, critique each session, synthesize cards
improve/cycle.sh

# Stage 5: review each card interactively, accept/skip. Prints a claude command.
improve/decide.sh

# Stage 6: run the printed command — Claude Code independently verifies each
# card against the codebase, implements the survivors, runs the gates:
cd <repo> && claude "$(cat improve/generations/gen-001/accepted/PROMPT.md)"

# Review, commit manually, then iterate on the mutated organism:
git diff && git add -p ...
improve/cycle.sh --new-gen
```

Each stage is also a standalone script if you want to drive it by hand:

```bash
improve/session.sh --scenario improve/scenarios/orient.md      # observe+measure (one session)
improve/critique.sh <trajectory.jsonl>                         # introspect (one session)
improve/synthesize.sh                                          # critiques → proposal cards
mv .../proposals/01-*.md .../accepted/                         # decide, by hand
improve/handoff.sh                                             # bundle accepted/ → PROMPT.md + claude command
```

(`apply.sh` — the agent implementing cards on itself via shellm — still exists as an experimental alternative, but the Claude Code handoff is the default: fresh eyes verify the card before any edit.)

Useful flags:
- `session.sh --minutes 2 --model claude-haiku-4-5-20251001` — longer session, cheaper mind
- `session.sh --memories <prior-run>/memories` — seed memories from an earlier run (cross-session learning scenarios, e.g. `pipes-note.md` then `pipes-recall.md`)
- `session.sh --new-gen` — start the next generation (after applying proposals)
- `session.sh --local` — run thinker shellm calls without Docker (faster, unsandboxed)
- every script takes `--model`; critique/synthesis default to `$IMPROVE_MODEL` or `$SHELLM_MODEL`

## Layout

```
improve/
  cycle.sh      meta-harness: stages 1-4 (sessions → critiques → proposals)
  decide.sh     meta-harness: stage 5 (interactive card review → handoff command)
  handoff.sh    stage 6: accepted cards → PROMPT.md + claude bootstrap command
  session.sh vitals.sh critique.sh synthesize.sh apply.sh
  decisions.md  committed decision ledger: every reviewed card + its fate
                (accepted/skipped, then the verifier's IMPLEMENTED/REVISED/
                REJECTED verdict). Fed back into critique + synthesis as
                anti-whiplash memory: no re-proposing applied fixes, no
                reverts on thin evidence, no resurrecting declined cards.
  prompts/      critic.md, synthesizer.md
  scenarios/    seed stimuli ("training instances"); <name>.memories-from
                sidecars chain a scenario onto an earlier one's memories
  generations/  gen-NNN/           (runtime artifacts, not committed)
    identities/<run>/              the session's whole identity: trajectories/, memories/, run/logs/
    sessions.csv vitals.csv
    critiques/*.md
    proposals/*.md  accepted/
```

## Resetting

All runtime state lives in `generations/` (gitignored), so a full reset is:

```bash
rm -rf improve/generations        # next cycle.sh starts fresh at gen-001
```

Optionally trim `improve/log.md` back to its header. Nothing else is touched by the loop — the only writes outside `generations/` are `apply.sh`'s working-tree edits, which you review and undo via git (`git diff`, `git checkout -- <file>`). Note that resetting deletes unapplied proposal cards; any that reflect real defects will be re-derived by the next cycle. If a session was hard-killed, also check for strays: `pgrep -f dispatch.fifo` (dispatcher) and `docker ps` (per-run containers, ids under `<identity>/.shellm/envs/*/container_id`).

## v0 constraints

- **No git automation.** apply.sh only edits the working tree; the human reviews `git diff` and commits. Generation branches come later.
- Sub-goals measured by vitals are rotating proxies (on-rails-ness, grounded action, cross-session learning, self-direction) — each generation, sanity-check that proxy gains actually look more human, not just better numbers.
- The improver never modifies `improve/` itself.


## References:

* Lilian Weng - Harness Engineering for Self-Improvement. https://lilianweng.github.io/posts/2026-07-04-harness/
* Agrawal, A. et al. “GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning.” arXiv preprint. https://arxiv.org/abs/2507.19457

## Cheatsheet

```bash
improve/cycle.sh
improve/decide.sh

# Review, commit manually, then iterate on the mutated organism

improve/cycle.sh --new-gen
```
