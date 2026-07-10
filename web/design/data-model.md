# Data model the viewer depends on

The backend reads shellm's on-disk formats directly; this file records the
ground truths it relies on. The authoritative specs are
`design/trajectory_spec.md` and `design/THINKERS_spec.md` at the repo root —
if those change, `web/src/shellm_web/trajectory.py` and `tree.py` are the
code to revisit.

## Trajectory files

- Layout: `<TRAJ_DIR>/<hex8>-<slug>/trajectory.jsonl` + sibling `blobs/`;
  child trajectory dirs are **nested inside** the parent's dir.
- Every step has `step_id` (uuid), `ts` (ISO 8601 ms + tz), `type`.
- **Thinker steps carry `source`** (`seed`, `inner_monologue`, `actor`,
  `chat`); **machinery steps written by the shellm loop carry no `source`**
  (`shellm-run`, `prompt`, `reasoning`, `shell-output`, `feedback`, `final`,
  `run-summary`). This absence is how the viewer attributes steps.
- Blob spillover: `stdout`/`stderr` over 4096 bytes keep a truncated inline
  head plus `stdout_ref` (`blobs/<step_id>-<hex6>.stdout`), `stdout_bytes`,
  `stdout_truncated` (same for stderr).
- Fork links: parent `fork` step (`child` uuid, `child_ref` relpath, its
  `step_id` shared with the child) ↔ child first step (`parent_traj`,
  `parent_step`, `parent_traj_ref`). Completion write-back is a `merge`
  step in the parent with `content` + `from_traj`/`from_step`/
  `from_traj_ref` (since 2026-07-10; legacy logs use a source-less
  `thought` with the same fields — the viewer's writeback-link handling is
  type-agnostic, keyed on `from_traj`, so both render identically).

## Run grouping: exact via run_id

- **Flat era** (current; the actor runs `shellm --traj <root>`): run
  machinery is appended **inline** into the mind log, interleaved with
  concurrent monologue steps.
- **Fork era** (`.identities/botnick`): thinker runs forked child
  trajectories with explicit links.

Since 2026-07-10, every machinery step shellm writes carries
`run_id` = the step_id of its `shellm-run` header, so grouping in
`trajectory.py` is a lookup, not a heuristic — correct even when concurrent
runs interleave in one shared mind log:

1. A `shellm-run` step opens a run group keyed by its own step_id.
2. Other source-less machinery steps attach to the group named by their
   `run_id`; `final` closes it; `run-summary` (async) sets its tldr.
3. **Legacy logs (pre-run_id)**: machinery steps without `run_id` are left
   ungrouped and render as plain stream steps — never guessed at. A legacy
   `shellm-run` header still opens a (member-less) group.
4. Trigger → run join: exact when the `shellm-run` step carries
   `trigger_step` (thinker step scripts export the triggering step's id
   via `SHELLM_TRIGGER_STEP_ID`; shellm blanks it for executed code so
   nested runs don't inherit it). Any step type can be the trigger, and
   several runs may share one trigger; the join lands in
   `RunGroup.trigger_step_id`. The run also carries `launched_by` (the
   thinker name, from the dispatcher's `SHELLM_LAUNCHED_BY`). Legacy runs
   without `trigger_step` fall back to the ACTION: command-suffix prefix
   match (whitespace-collapsed 200-char prefix in either direction). On a
   miss, `trigger_step_id` stays null and the UI shows the steps
   adjacently. The stream view turns only `action`-type triggers into run
   headers (hiding the action step); other trigger types keep rendering
   as their own stream steps.
5. `fork` steps resolve their child dir via `child_ref`, falling back to a
   `<hex8>-*` glob; `from_traj` write-backs become links.

## Identity dirs and liveness

- An identity dir is any directory whose `info.txt` has `root_trajectory=`
  (`discovery.py` walks the serve root, depth ≤ 6, pruning
  trajectories/workdir/blobs/run/…; symlinked dirs are skipped, which
  correctly hides the `default → <name>` aliases).
- The mind log dir is `trajectories/<root_id[:8]>-*` (fallback: first dir
  with a trajectory.jsonl).
- Live = `run/dispatcher.pid` points at a running process OR the mind log's
  mtime is < 30s old. The second clause is what makes plain (non-thinker)
  writes and simulated sessions register as live.
- Thinker logs: `run/logs/<name>.log` freeform; `dispatcher.log` lines
  matching `[dispatcher] step: type=… source=…` and
  `[dispatcher]   dispatch -> <thinker> (active=N)` parse into events.
  Dispatcher lines carry **no step_id or timestamp**, so correlation with
  mind-log steps can only ever be best-effort.

## Wire shape (backend → frontend)

See `web/viewer/app/lib/types.ts`. The load-bearing type:

```ts
interface NormalizedStep {
  step_id: string; ts: string; type: StepType;
  source: string | null;          // thinker name, or null for machinery
  preview: string;                // one-liner (ports bin/traj's formatter)
  raw: Record<string, unknown>;   // all original fields, blob refs included
  run_id: string | null;          // inline-run membership (= shellm-run step_id)
  fork?: { child_traj_id, slug, resolved };
  writeback?: { from_traj, from_step };
}
```

`NormalizedStep.run_id` means *membership* and is set for machinery steps
only; a thinker/structural step written from inside a run (`observation`,
`fork`, `merge`, …) carries its `run_id` in `raw` — an *association* the
timeline view can use without the step being swallowed into the run group.

`RunGroup` carries `trigger_step_id`, `launched_by`, ordered `step_ids`,
`status` (`running`/`done`), `tldr`. `TreeNode` carries per-trajectory
stats (`step_count`, `has_final`, `tldr`, `child_count`) with `children`
present only within the requested depth (lazy expansion).
