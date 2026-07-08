# Goals: north star and how we measure toward it

## North star

A more **human-like agent** — the Headlong virtual person: runs 24/7, sets its own goals, learns, and keeps a mind log a human can read like a diary. The architectural bet is mind-as-log-of-thoughts: conscious loop, subconscious thinkers, tools, and the human all read and write the same trajectory; the filesystem is the state layer, keeping the mind legible to humans and LLMs.

**This is explicitly not well measured by current benchmarks.** The final arbiter stays the critic rubric plus human judgment reading the mind log ("does this read more like a person?"). Everything below is a proxy.

## v0 sub-goals (rotating proxies)

Each has a mechanical proxy in `vitals.sh`. They are expected to **rotate as they saturate**, and each generation's review should sanity-check that proxy gains aren't Goodharting away from the north star.

1. **On-rails-ness** — coherent forward progress: no repetition loops, stalls, or thinker crashes. *Proxies: dup thought rate, max inter-step gap, log error count.* Ladder: clean 1-minute sessions → clean 5-minute → clean 30-minute.
2. **Grounded action** — thoughts → actions → observations → changed thoughts. *Proxies: action→observation follow-through; (future) observation-referencing rate.*
3. **Cross-session learning** — something learned in session N is recalled and applied in session N+1. *Proxies: memories written; recall scenarios (`pipes-note.md` → `pipes-recall.md` via `--memories`).*
4. **Self-direction** — when the seed goal is exhausted, the agent formulates a sensible next objective rather than idling or looping. *Proxy: goal-directed steps after seed completion + critic judgment.*

Plus two cross-cutting rubric dimensions the critic always assesses: **legibility** (diary-readability of the log) and **mechanical defects** (dispatch misfires, contract violations, prompt/tool friction).

## GEPA framing (arXiv:2507.19457)

GEPA evolves compound AI systems by reflecting in natural language on execution traces, mutating one module at a time, and keeping a Pareto pool of candidates selected per training instance. We generalize its candidate from "set of module prompts" to "the whole agent as text":

| GEPA concept | Here (v0) | Faithful later |
|---|---|---|
| Candidate | The repo working tree (organism) | Pool of git branches |
| Module chosen for mutation | One proposal card = one component | Round-robin / reflective choice |
| Rollout | A bounded autonomous session | Same, more scenarios |
| Training instance | A seed scenario | Fixed battery, per-scenario score matrix |
| μ (scalar metric) | vitals.csv per session | Per-scenario vitals matrix |
| μf (textual feedback) | critiques | Same, richer evaluator traces |
| Reflective mutation | synthesize.sh proposal cards | Same, auto-applied |
| Candidate selection | Human picks cards; single lineage | Instance-wise Pareto over branches |
| Lineage tree | (git history, manual commits) | git log across gen branches |
| Merge/crossover | Out of scope | `git merge` of improvement branches |

v0's deliberate divergences (for speed): single lineage, human acceptance instead of minibatch-score gating, weak proxy metrics. The structure is chosen so each upgrade is incremental, not a rewrite.

## shellm's own hypotheses this loop should respect

- Basic metacognition tools + a bash prompt beat custom LLM tools.
- Programmatic access to the agent's own trajectory improves performance.
- Ideal context is assembled per-step from all the agent's resources (trajectory, memories, skills).

Proposals that fight these bets (e.g. adding heavy frameworks, hiding state outside the filesystem) should be viewed with suspicion at decide time.
