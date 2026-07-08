# improve log

Running narrative of the self-improvement loop: what was observed, proposed, accepted, and what happened next generation.

*(Reset 2026-07-08 after the build-validation runs. Those runs' findings — the llm thinking-params bug that silently breaks the actor, the missing failure-observation contract, and the rest — are summarized in [design/overview.md](design/overview.md) and will resurface as proposal cards on the next cycle.)*

## Human observations (feed into next synthesis)

- 2026-07-08: **`thinkers stop` leaks processes — diagnosed and fixed outside the loop.** Every stop leaked a `tail -n 0 -F <trajectory>` feeder plus its tagger stage (argv shows the parent's `thinkers start ...` cmdline). Root cause, confirmed by repro with a dummy no-LLM thinker: both cleanup paths kill by PID tree (`pgrep -P` on the recorded pipeline-wrapper PIDs), which races against wrapper death — orphaned stages reparent to init and escape enumeration. Fix in `bin/thinkers`: `_kill_traj_tails` sweeps feeders by argv pattern from the `run/traj_files` list (snapshotted in `_stop_dispatcher` before the dispatcher's trap deletes it); the tagger then exits on EOF. Verified: 4/4 stop rounds clean, both stop-all and stop-named paths. Meta-lesson for the loop: this defect was invisible to the critic (host-process state, not trajectory content) — vitals candidate: post-stop stray process count.
