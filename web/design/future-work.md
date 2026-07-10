# Future work

Roughly ordered by expected value. Items marked *(cheap)* are small,
self-contained changes.

## Navigation & reading experience

- **Fork tree: auto-reveal the current node** *(cheap-ish)*. When viewing a
  sub-trajectory that's beyond the first page of a node's children (the tree
  windows 30 at a time), expand and scroll the tree to it. Needs the
  breadcrumb (already server-provided) to drive which nodes to open.
- **Deep-link to a step**: `#step-<id>` anchor handling on load (the DOM ids
  already exist; timeline click uses them) so a step can be shared/bookmarked.
- **Search**: client-side text search over step content with jump-to-match.
  The whole log is already in memory; this is mostly UI.
- **Swim-lane / per-thinker view**: a mode that lays sources out in parallel
  lanes against a shared time axis, making concurrency (monologue thinking
  while actor runs) visually explicit. The timeline bar is a primitive
  version of this.
- **Idle-strip default**: consider folding `prompt` steps by default too
  (they're the other big noise source; currently collapsed-but-present).

## Grouping & data fidelity

- **Crashed vs. running**: an unclosed run currently shows `running` when the
  session is live, `incomplete` otherwise. Could inspect the watchdog
  `feedback` step or trailing `shell-output` timing to distinguish "killed by
  inactivity timeout" explicitly.
- **Dispatch ↔ mind-log correlation**: dispatcher.log lines carry no step_id;
  a best-effort "find in mind log" link (match by type+source+ordinal
  proximity) was designed but not built. Better: patch `bin/thinkers` to log
  step_ids, then the join is exact — the viewer half is trivial after that.
- **Degraded thought content** *(cheap)*: flat-era monologue occasionally
  emits a raw JSON object as `content`
  (`{"type":"thought","content":"…"}` as a string); detect and unwrap when
  rendering. (Proposal card 04 in gen-001 targets the root cause.)
- **run-summary attribution**: matching "most recently closed run" can
  mis-attach when two runs close back-to-back before either summary lands;
  could match on the summarized command text instead.

## Scale

- **`?after=<step_id>` incremental mind-log fetch**: response would carry
  only new steps plus re-computed runs; react-query cache merge on the
  client. Needed when logs reach tens of thousands of steps or polling many
  identities at once.
- **Virtualized stream**: `content-visibility: auto` is fine at ~1k steps;
  at ~10k, move to a windowed list. Interacts badly with follow-mode and
  expand-all — design carefully.
- **Backend caching**: everything re-parses per request (microseconds at
  current sizes). An mtime-keyed cache of parsed trajectories is the obvious
  first lever; the tree endpoint over 174 children (one file scan each) is
  the first place it would matter.

## Liveness & streaming

- **SSE tail**: replace 2s polling with a server-sent stream of appended
  JSONL lines (files are append-only, so a byte-offset tail is easy). Only
  worth it if the 2s cadence ever feels laggy — the polling design was
  chosen deliberately for robustness/simplicity.
- **Home-page cost**: `/api/identities` re-scans and line-counts every mind
  log on each 5s poll; fine now, wasteful with many identities (see caching).

## Features not yet built

- **Memories frontmatter**: the list endpoint returns names only; parse YAML
  frontmatter (date/type/slug) for grouping and sorting like `mem list`.
- **Workdir browser**: a read-only file tree of the identity's `workdir/`
  (what the agent actually made). Harbor's viewer has a file-browser pattern
  (`@pierre/trees`) that could be cribbed if wanted.
- **Vitals / critiques integration** (improve-loop): surface
  `improve/generations/gen-NNN/vitals.csv` and `critiques/*.md` next to each
  session, and a generation-level compare view. This was consciously deferred
  from v1 scope ("generation browsing").
- **Session diffing**: side-by-side of two mind logs (e.g. same scenario
  across generations) — the improve loop's core comparison, currently done by
  eyeballing two terminal panes.
- **LLM report button**: `shellm-explore --report` equivalent — send the run
  tree to a model and render the analysis. Backend shells out to `llm` or
  reuses its API; needs a key at serve time, so keep it opt-in.

## Housekeeping

- Tests for `logs.py` (dispatcher parsing) and `discovery.py` edge cases
  (symlink cycles, unreadable dirs).
- Frontend has no linter; consider biome or eslint if it grows.
- Lockfile: `package-lock.json` (npm) is committed; if the project settles on
  bun or pnpm, swap in that runtime's lockfile and drop npm's.
- The Rust TUI (`tui/shellm`) and this viewer both re-implement step
  formatting; if `bin/traj`'s preview rules change, `trajectory.py`'s
  `step_preview` needs the same edit (a shared spec/golden file would help).
