# Next steps

## Immediate (the loop is telling us what to do)

1. **Work through gen-001's proposal cards.** The two low-risk mechanical ones first: `01-fix-adaptive-thinking-flag` (bin/llm shouldn't send thinking params to models that don't support them) and `02-emit-observation-on-actor-failure` (a failed action must still produce an observation step — the mind must never be blind to its own failures). Apply → review diff → commit → `session.sh --new-gen` and see if the vitals move.
2. **Run a cross-session learning pair**: `pipes-note.md`, then `pipes-recall.md` with `--memories` pointing at the first run's memories dir. This exercises sub-goal 3, which gen-001 didn't test.
3. **Extend the session ladder**: once 1-minute sessions run clean, try `--minutes 5`.

## Measurement improvements

- **Fuzzy thought-repetition proxy.** Exact-match dedup scored the g001r1 paraphrase spiral at 0.00. Cheap options: shingle overlap (shared 4-word n-grams between consecutive thoughts), or an embedding-free token-Jaccard threshold. Keep it pure bash/jq if possible.
- **Observation-referencing rate**: fraction of post-observation thoughts that mention content from the observation (crude keyword overlap is fine to start).
- **Per-scenario vitals matrix** (`improve/metrics.csv` aggregating across generations): the GEPA "training instance" scores. Needed before any automatic acceptance.
- **Cost/token accounting per session** so generation-over-generation comparisons are budget-aware.

## Loop machinery (in GEPA order)

1. **Fixed scenario battery** — grow scenarios/ to ~6-8 covering all sub-goals; every generation runs the same battery so scores are comparable.
2. **Automatic acceptance gate** — a candidate is auto-accepted when it improves vitals on the scenario minibatch without regressing others; human review shifts to spot-checking. (Human stays the merge gate.)
3. **Generation branches** — `improve/gen-NNN` git branches, one per generation; `git log --graph` becomes the lineage tree. (Deferred: no git automation in v0 by explicit decision.)
4. **Pareto candidate pool** — keep multiple live branches, select parents instance-wise (best on ≥1 scenario), GEPA-style.
5. **Merge/crossover** — `git merge` improvement branches that fixed different components.
6. **The improver as a resident thinker** — improvement as a continuous background process on the trajectory bus rather than a batch pipeline (the distinctly-shellm move; most prior art is offline).
7. **Improving the improver** — allow cards to target `improve/` itself (STOP-style), only after the gates are trusted.

## Known gaps / debts

- `apply.sh` infers changed files from `git status` diffing before/after — fragile if the user edits concurrently; fine for v0.
- `session.sh` doesn't yet implement `--traj ID` registration of live external trajectories (critique.sh accepts any trajectory path, so this is cosmetic).
- Docker wasn't running during gen-001, so sessions executed on the host. Fine for benign scenarios; start Docker for anything riskier (session cleanup already removes per-run containers).
- Critic/synthesizer prompts are v0 drafts; they'll need iteration as failure modes shift (that iteration is itself loggable in `log.md`).
- No guard yet against two concurrent sessions in the same generation colliding on run numbering (last-writer wins on `gen-NNN/identities/gXXXrN`).
