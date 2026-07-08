# Session context — bootstrapping a fresh collaborator (human or AI)

*Written 2026-07-08 at the end of the build session. Read this plus [overview.md](overview.md) and [runbook.md](runbook.md) and you have the whole picture; this file holds the context and decisions that don't live naturally in the other docs.*

## How this project came to be (decision trail)

1. Nick read Lilian Weng's "Harness Engineering for Self-Improvement" (2026-07-04) and asked what a v0 recursive self-improvement loop would look like for shellm.
2. Early framings (mutate the system prompt only; benchmark-gated evolution on Terminal-Bench) were **rejected** in favor of: the whole agent is the candidate, and the optimization direction is **human-likeness** (the Headlong virtual-person thesis), which current benchmarks don't measure. TB2 remains useful as a failure-mode catalog (`terminal_bench2_eval/failure_analysis.md`), not as the objective.
3. The GEPA paper (arXiv:2507.19457) was adopted as the reference frame — see the mapping table in [goals.md](goals.md). v0 deliberately diverges (single lineage, human selection, weak proxies) but every structure was chosen so the faithful-GEPA upgrades in [next-steps.md](next-steps.md) are incremental.
4. Nick's standing constraints, in force for all future work:
   - **No git write automation, anywhere.** Nick reviews diffs and commits manually. (He commits with his own messages; check `git log` for state rather than assuming.)
   - **Human decides** which proposals are applied (v0); automation of that gate must be earned via the roadmap, not assumed.
   - The loop never modifies `improve/` itself.
   - **Don't have shellm modify its own code "just yet"** — the apply stage was rebuilt (2026-07-08, commit 4154e92) as a Claude Code handoff with independent verification. `apply.sh` (shellm self-modifies) survives only as an explicitly experimental alternative.

## Current state (as of 2026-07-08)

- All committed: `3a341bf` (loop v0) → `940aa3a`/`3ec3832` (process-leak fixes) → `4154e92` (Claude Code handoff).
- The loop has run 2 full validation generations (later reset; `generations/` is gitignored and disposable). Findings from those runs are summarized in [overview.md](overview.md) — the underlying defects are **still unfixed in the organism** and will re-derive as cards on the next cycle:
  - `bin/llm` sends adaptive-thinking params to models that don't support them → actor 100% broken under haiku (use `claude-sonnet-5` as the mind until fixed; haiku is then a good regression test).
  - Actor failures emit no observation step → the mind is blind to its own failed actions (found independently by both generations).
  - Monologue paraphrase-loops when starved of observations; `vitals.sh` dup detection is exact-match and scores these 0.00 (known proxy weakness).
  - Seed thoughts in `bin/identity _seed_thoughts()` read as a checklist, not a mind waking up.
  - Skills manual reprinted in full every monologue tick (context bloat).
- Fixed outside the loop (already committed): `thinkers stop` process leak — PID-tree kills raced wrapper death; `_kill_traj_tails` in `bin/thinkers` sweeps by argv pattern now. Full diagnosis in `improve/log.md`.

## Where a fresh session should start

1. `improve/cycle.sh` (60s+ sessions — 20s was too short for the actor to finish anything) → `improve/decide.sh` → run the printed `claude` command → `git diff`, Nick commits → `improve/cycle.sh --new-gen`.
2. The first post-mutation generation (organism actually changed) hasn't happened yet — that comparison in `vitals.csv` across gen dirs is the loop's first real test.
3. Top roadmap items when the basic crank turns reliably: fuzzy thought-repetition proxy, per-scenario vitals matrix, then the automatic-acceptance gate (see [next-steps.md](next-steps.md)).

## Working conventions that proved useful

- **Empirical debugging with dummy thinkers**: a thinker whose `step` is `cat >/dev/null; exit 0` lets you exercise the whole dispatch/stop lifecycle with zero API calls (used to corner the process leak). Build test identities in a scratch dir, never in `.identities/`.
- **Two memory files, different jobs**: `improve/decisions.md` is the structured, committed decision ledger (decide.sh appends per-card lines; the Claude Code handoff updates verdicts; critique.sh and synthesize.sh feed recent entries back to the LLM for credit assignment and anti-whiplash continuity — added 2026-07-08 after Nick asked whether synthesis knew about prior fixes; it didn't). `improve/log.md` is the freeform narrative for everything else, especially defects invisible to the critic (host-process state, cost, wall-time).
- **Scenario design**: each scenario targets a sub-goal; cross-session pairs chain via `<name>.memories-from` sidecars (cycle.sh wires the memories automatically). One run per scenario per generation; replicate only when a finding smells like a fluke.
- Model habits: mind = `claude-sonnet-5`; critic/synthesizer default to opus (`IMPROVE_MODEL` overrides); `--critic-model claude-sonnet-5` for cheap validation cycles.
- Everything runs the repo checkout via PATH-prepend — no reinstall after edits; `.env` at repo root supplies API keys and is auto-sourced by the improve scripts.
