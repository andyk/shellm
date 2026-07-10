# PLAN: Timeline tab — live swimlane view of mind-log interactions

*Written 2026-07-10 from a brainstorm with Nick. Self-contained: background,
decisions, work items, verification. Companion to `PLAN.md` (exact run
attribution) in this directory — this plan consumes the invariants that one
established (`run_id`, `trigger_step`, `merge`) and adds the last missing
writer stamps.*

## Goal

A new per-identity viewer tab ("Timeline") that makes the *interactions
between components* glanceable: time runs down the page, the mind log's
writers each get a swimlane column, every step is a small square, shellm
runs are summary blocks nested in the lane of the thinker that launched
them, and exact causal edges (trigger → run, merge → fork) are drawn
between lanes. Runs live: you can watch an identity's components ticking
autonomously.

```
 time    │ monologue │    actor     │ learning  │ goals_mgr │  chat
─────────┼───────────┼──────────────┼───────────┼───────────┼───────
13:02:11 │ ■ thought │              │           │           │
13:02:19 │ ■ action ─────▶┌───────┐ │           │           │
13:02:31 │ ■ thought │    │ run   │ │           │           │
13:02:44 │           │    └───────┘ │           │           │
13:02:45 │           │ ■ observation ──▶┌─────┐ │           │
13:02:51 │ ■ thought │              │   │ run │ │           │
  ⋯ 4m ⋯ ┆           ┆              ┆   └─────┘ ┆           ┆
13:07:02 │           │              │           │           │ ■ msg
```

## Background (what you need to know)

- Every mind-log step already knows its writer: thinker/chat steps carry
  `source`; the 7 machinery types never do and (since `7748d17`) carry
  `run_id` = their `shellm-run` header's step_id. Actor-launched headers
  carry `trigger_step` (`c49c139`). Forked children write back `merge`
  steps (`3031272`). See `design/trajectory_spec.md` §Registry and
  §Run identity.
- **All five thinkers launch runs** — every `thinkers/*/step` calls
  `shellm --traj "$TRAJ_ID"`. For the four generic thinkers the run *is*
  their turn.
- **The launcher is not in the data.** `trigger_step` names the step that
  *triggered* the thinker (e.g. the monologue's `action`), not the thinker
  that *launched* the run. And only `actor/step` exports
  `SHELLM_TRIGGER_STEP_ID` today — the other four thinkers' runs are
  anonymous. Inference cannot rescue this (all four generic thinkers
  subscribe to the same step types; sniffing the prompt text in `command`
  is the class of heuristic this project deletes).
- The dispatcher pipes the trigger step JSON to each step script's stdin
  (`bin/thinkers:615`) but sets no per-dispatch env. The dispatcher log has
  no timestamps or step_ids, so it cannot provide exact edges (known D5
  gap in PLAN.md; unchanged here).
- `observation` steps (and any step written by generated code inside a
  run) carry no `run_id` — `traj append` doesn't know it's inside a run.
- Viewer plumbing that exists and gets reused: `NormalizedStep`
  (source/run_id/fork/writeback + preview), `RunGroup`
  (command/model/tldr/status/timestamps), `step-card.tsx`,
  `step-colors.ts`, `run-group.tsx`, `follow-pin.tsx`, `live-badge.tsx`,
  the `/status` endpoint (cheap, returns `step_count`).

## Decisions

**T1 — Runs render inside the launcher's lane; the launcher is stamped by
the writer.** New field `launched_by` on the `shellm-run` header. The
dispatcher exports the thinker's name at dispatch; shellm stamps it and
blanks it in the executed-code env (exactly the `trigger_step` pattern) so
nested runs don't inherit it. Runs without `launched_by` (legacy logs,
imperative runs) fall back to a separate "runs" lane — tolerated, never
guessed (amended-D2 ethos). Note: machinery still **never carries
`source`**; `launched_by` is a distinct field and readers must not treat
it as source.

**T2 — Writer stamps are in scope, viz-heuristics are not.** Three stamps
(work items 1–3) land first so the viz is exact-join only: `launched_by`
everywhere, `trigger_step` universalized to all five thinkers (on their
runs AND on steps they append directly), and auto-`run_id` in
`traj append` for steps written by code executing inside a run. Together
these complete the causal chain *thought → action → run → observation →
next thought*.

**T3 — Ordinal time, not linear.** One row per step, evenly spaced;
wall-clock gutter on the left; a visible divider row ("⋯ 4m ⋯") when the
gap between consecutive steps exceeds a threshold (start: 60s). Linear
time is unusable here (seconds-cadence monologue vs. minutes of idle).

**T4 — Oldest at top, auto-follow.** Matches "time runs down" and the
existing stream UX (`follow-pin.tsx`): pinned-to-bottom by default, pin
releases on scroll-up. Newest-at-top as a toggle is a stretch item, not
v1 — build the easy one first, add the toggle only if the follow pin
feels wrong in practice.

**T5 — Details in a modal.** Click a square → modal with the existing
step-card; click a run block → modal with the run's member machinery
steps (reusing run-group internals). No inline expansion: zero reflow,
and the live timeline keeps ticking behind the modal.

**T6 — Live = cheap polling.** Poll `/status` every ~2s; refetch the
mindlog only when `step_count` changes. SSE and `?after=` incremental
fetch stay deferred (same rationale as PLAN.md D5); the escalation path
is unchanged.

**T7 — Lanes derived from data, not config.** Lanes = distinct `source`
values seen + `launched_by` values seen, plus the fallback "runs" lane
(only rendered if needed) and chat. Order: `inner_monologue`, `actor`,
then others by first appearance, chat last. A thinker that never wrote
never gets a column.

**T8 — Out of scope**: ghost squares for fired-but-wrote-nothing thinker
turns (needs dispatcher-log timestamps — revisit later), SSE, `?after=`,
row virtualization (revisit when a mind log hurts), dispatcher.log
correlation, any mobile-specific layout.

## Work items (in order)

1. **`launched_by` stamp.**
   - `bin/thinkers`: export the thinker's name (env var
     `SHELLM_LAUNCHED_BY`) when invoking a step script — check both
     dispatch sites (~line 615 `(printf '%s' "$trigger_json" | …/step)`
     and the pending-fire path near ~320).
   - `bin/shellm`: stamp `launched_by` on the `shellm-run` header when the
     var is set (next to the `trigger_step` stamping, ~line 1854); add
     `SHELLM_LAUNCHED_BY=""` to the `env_vars` blanking array (~2070).
   - Viewer: `RunGroup` gains `launched_by` (backend dataclass +
     `types.ts`).

2. **Universal `trigger_step`.**
   - The four generic thinker step scripts capture stdin
     (`step_json=$(cat)` — mind the shellm-stdin gotcha: their later
     `shellm` call must have stdin redirected) and export
     `SHELLM_TRIGGER_STEP_ID` like `actor/step` does → their runs' headers
     carry `trigger_step`.
   - `inner_monologue/step` (which appends directly instead of running
     shellm): stamp `trigger_step` field on the thought/action/idle steps
     it writes, from its stdin trigger JSON. Skip when the trigger id is
     empty (startup seed).
   - Viewer: generalize the run↔trigger join in `trajectory.py` — today it
     only joins `action`-type triggers into `action_step_id`; rename to /
     add `trigger_step_id` joining any step type (keep `action_step_id`
     semantics or migrate the field, decide at the diff), keep the
     ACTION-prefix legacy fallback as is.

3. **Auto-`run_id` in `traj append`.**
   - `bin/shellm`: export the run header's step_id (env
     `SHELLM_RUN_STEP_ID`) into the executed-code env (`env_vars` array).
   - `bin/traj` `cmd_append`: if `SHELLM_RUN_STEP_ID` is set and the
     incoming step has no `run_id`, stamp it. Steps written by generated
     code inside a run — `observation`, `tp-thought`, ad-hoc appends — now
     link to their run. Steps appended outside runs (dispatcher env, chat)
     are unaffected; nested runs are fine (each shellm sets its own value
     for its own subprocess env; explicit `run_id` is never overwritten).
   - Viewer: `observation` squares get an edge/association to their run
     block.

4. **Spec/docs.** `design/trajectory_spec.md`: add `launched_by` to the
   `shellm-run` fields and the Run-identity invariants; note
   `trigger_step` is now stamped by all thinkers (runs *and* directly
   appended steps); note `run_id` may appear on any step written inside a
   run (registry notes for `observation`/`tp-thought`). Update
   `web/design/data-model.md` (trigger join generalization, `launched_by`
   on RunGroup).

5. **Timeline tab.**
   - New route (`timeline.tsx`) + entry in `identity-tabs.tsx`: label
     "Timeline", live pulse badge (reuse `live-badge.tsx`) when the
     identity is live.
   - Layout: CSS grid; lane headers sticky at top; left wall-clock gutter;
     ordinal rows; gap-divider rows per T3.
   - Squares colored by step type (reuse `step-colors.ts`), with type
     glyph/tooltip (preview text). Run blocks span their rows in the
     launcher's lane: tldr (fallback: command tail) · duration ·
     iteration count (# shell-outputs) · model; pulsing border while
     `status: running`.
   - Edges: absolutely-positioned SVG overlay. v1 edges: `trigger_step` →
     run block, `trigger_step` → directly-appended step (monologue),
     `merge` → its `fork`, `run_id`-associated `observation` → run block.
     Hovering a square/block highlights incident edges.
   - Modal per T5.
   - Live per T6, follow-pin per T4.
   - DOM only, no d3/canvas; densities are hundreds of steps.

6. **Tests / fixtures.** pytest: `launched_by` surfaced on RunGroup;
   generalized trigger join (message- and thought-triggered runs);
   auto-run_id append behavior (in `bin/traj`, test via a synthetic append
   with the env var set — plus the don't-overwrite case). The fresh
   real-session fixture (5b from PLAN.md, still open) doubles as the
   Timeline demo/verification data — bootstrap it after items 1–3 so it
   carries the new stamps.

## Verification

- Stubbed-llm end-to-end (see SESSION.md harness notes): a dispatcher-less
  simulation — export `SHELLM_LAUNCHED_BY`/`SHELLM_TRIGGER_STEP_ID` by
  hand, run `shellm --traj`, assert header stamps; assert both vars blank
  inside executed code; assert an `observation` appended by executed code
  carries `run_id`.
- `cd web && uv run pytest -q`; `cd web/viewer && npm run typecheck`.
- Live session: run a fresh thinkers identity, open Timeline, confirm:
  every run sits in a named lane (none in fallback), edges land on the
  right squares, gap dividers appear across idle stretches, follow-pin
  tracks new rows, modal opens without reflow.

## Status (2026-07-10)

- **Done — work items 1–4** (awaiting Nick's review/commit):
  1. `launched_by`: `bin/thinkers` exports `SHELLM_LAUNCHED_BY` at both
     dispatch sites (`_dispatch_step` + the CLI kick loop); `bin/shellm`
     stamps it on the header and blanks it in the executed-code env.
  2. Universal `trigger_step`: the four generic thinkers capture stdin and
     export `SHELLM_TRIGGER_STEP_ID`; `inner_monologue` stamps
     `trigger_step` directly on the thought/action/idle steps it appends
     (append rewritten printf→jq). Viewer: `action_step_id` renamed to
     `trigger_step_id`, exact join generalized to any seen step type (one
     step can trigger several runs); `RunGroup` gains `launched_by`; the
     stream view keeps action-only header-swallowing semantics
     (non-action triggers render as their own steps).
  3. Auto-`run_id`: `bin/shellm` exports `SHELLM_RUN_STEP_ID` in the
     executed-code env; `bin/traj cmd_append` stamps `run_id` on appended
     steps lacking one (`shellm-run`/`trajectory` excluded; explicit
     run_id never overwritten). `cmd_new` writes directly so trajectory
     steps never hit the stamp; `fork`/`merge` go through append and pick
     up the enclosing run's id — intended.
  4. Docs: trajectory_spec (header fields, registry rows, Run-identity
     invariants incl. launched_by ≠ source, automatic-fields table) and
     data-model.md (generalized trigger join, membership-vs-association
     note, stale `confidence` mention removed).
  Verified: stubbed end-to-end run — header carries both stamps, executed
  code sees both vars blank, its appended observation auto-carries the
  run's id; viewer surfaces launched_by, refuses to join an unknown
  trigger id. 13 pytest passed; typecheck clean; `bash -n` clean on all
  touched scripts.
- **Done — work item 5 (Timeline tab UI)**, awaiting Nick's review/commit.
  New files: `web/viewer/app/lib/timeline-model.ts` (pure layout: lanes
  from data, ordinal rows with per-row heights, run blocks with extents,
  gap dividers, all four edge kinds — deterministic coordinates so the SVG
  overlay needs no DOM measurement), `components/timeline-view.tsx`
  (scroll container + sticky lane headers, cells with preview text, run
  blocks with sticky in-block summaries, hover-highlighted edges, in-lane
  nesting of steps a run wrote, container-based follow pill),
  `components/timeline-detail.tsx` (modal: step card / run summary +
  members), `routes/timeline.tsx` (page + legend); `routes.ts` and
  `identity-tabs.tsx` register the tab.
  Implementation notes discovered while verifying in the browser:
  timestamps in one log can carry **mixed TZ offsets** (steps written from
  inside a run's env) — all comparisons/clock display go through
  `Date.parse`, never string compares; an open run's extent = its latest
  member's ts (so legacy member-less headers stay point blocks);
  `overflow-hidden` on a block would become the sticky summary's scroll
  container and misplace it (comment in the code). Verified against
  legacy data (botnick-neo: unattributed runs → `shellm` fallback lane,
  prefix-fallback trigger edges) and a synthetic new-format identity
  (`.identities/timeline-demo/`, gitignored, kept as a demo: launched_by
  lanes for actor+learning, exact trigger/dispatch/assoc edges, nested
  in-run steps, 4m gap divider, light+dark, modals, hover). 13 pytest,
  typecheck clean, no console errors. NOTE: restart `shellm-web` after
  pulling backend changes — uvicorn (non-dev) serves stale code.
- **Remaining**: live-session verification (start thinkers on a fresh
  identity and watch it tick — doubles as PLAN.md 5b fixture capture);
  optional stretch items per T4/T8 (newest-at-top toggle, ghost squares,
  `?after=`).
