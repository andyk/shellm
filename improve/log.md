# improve log

Running narrative of the self-improvement loop: what was observed, proposed, accepted, and what happened next generation.

*(Reset 2026-07-08 after the build-validation runs. Those runs' findings — the llm thinking-params bug that silently breaks the actor, the missing failure-observation contract, and the rest — are summarized in [design/overview.md](design/overview.md) and will resurface as proposal cards on the next cycle.)*

## Human observations (feed into next synthesis)

- 2026-07-08: **`thinkers stop` leaks processes.** Every session leaves behind a `tail -n 0 -F <trajectory>` feeder and a process holding the original `thinkers start` argv (likely the ticker/dispatcher subshell — forked children keep the parent cmdline). Dispatcher itself dies; the tails and wrapper survive. Reproduced across 8 sessions on 2026-07-08, and Nick's separate `botnick` identity shows the same signature. Suspect `cmd_stop` kills `dispatcher.pid` but misses `tail_pids` entries or reparented subshells. Target: `bin/thinkers` (`cmd_stop`/`_start_dispatcher`). This is invisible to the critic (it's host-process state, not trajectory content) — a vitals candidate: post-stop stray count.
