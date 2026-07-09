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
  `parent_step`, `parent_traj_ref`). Completion write-back is a `thought`
  step in the parent with `from_traj`/`from_step`/`from_traj_ref`.
- `merge` exists in the `traj` CLI but nothing currently writes it; the
  viewer renders it if present but never depends on it.

## Two eras, one grouping algorithm

- **Flat era** (current; `improve/generations/gen-00*`): the actor runs
  `shellm --traj <root>`, so run machinery is appended **inline** into the
  mind log, interleaved with concurrent monologue steps.
- **Fork era** (`.identities/botnick`): thinker runs forked child
  trajectories with explicit links.

The grouping in `trajectory.py` doesn't branch on era — both can coexist in
one log (flat-era logs still fork children for nested `shellm` calls):

1. Source-less machinery steps attach to the most recent unclosed
   `shellm-run` (a stack; `final` pops). A `shellm-run` pushed while another
   is open marks the run `confidence: "heuristic"`.
2. `run-summary` (written asynchronously) attaches to the most recently
   closed run, else the top of the stack.
3. `action` → run join: the actor embeds the action text at the end of the
   `shellm-run` command (`…ACTION: <text>`); match by whitespace-collapsed
   200-char prefix in either direction. On a miss, `action_step_id` stays
   null and the UI shows the steps adjacently.
4. `fork` steps resolve their child dir via `child_ref`, falling back to a
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

`RunGroup` carries `action_step_id`, ordered `step_ids`, `status`
(`running`/`done`), `tldr`, `confidence`. `TreeNode` carries per-trajectory
stats (`step_count`, `has_final`, `tldr`, `child_count`) with `children`
present only within the requested depth (lazy expansion).
