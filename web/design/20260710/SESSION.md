# SESSION.md — 2026-07-10 working session state

*Bootstrap file for resuming this work in a fresh session. Repo:
`~/laude/repos/shellm` (note: `~/laude/shellm` is a different, older
checkout — don't confuse them). Nothing in this file is committed policy;
it's a snapshot of where we are. Lives at `web/design/20260710/SESSION.md`
(moved from the repo root).*

## What this session was about

Studying shellm's trajectory/mind-log architecture, then executing the plan
in **`web/design/20260710/PLAN.md`** — read that file first; it has the full
background, decisions (D1–D5), work items, and a Status section that is
up to date. This file adds only session-practical details the plan omits.
That plan's work items are now **all done except 5b**; current work is the
**Timeline tab** — see **`web/design/20260710/TIMELINE_PLAN.md`** (live
swimlane view of mind-log interactions + three more writer stamps:
`launched_by`, universal `trigger_step`, auto-`run_id` in `traj append`).

## Mental model (compressed; details in PLAN.md background section)

- One record shape: JSONL steps, mandatory `step_id`/`ts`/`type`, tagged
  union. A *mind log* is an identity's root trajectory used as a bus.
- Machinery steps = the 7 types the shellm loop writes, never carry
  `source`; thinker/chat steps always do. That absence/presence is how the
  viewer attributes steps.
- Flat era (since 0eb4979, 2026-07-05): the actor runs
  `shellm --traj <root>`, machinery lands inline in the mind log,
  interleaved with concurrent monologue. Nested shellm calls (no `--traj`)
  still fork child trajectories and, on completion, write a **`merge`**
  step back to the parent (was a source-less `thought` before 3031272).
- `chat repl` is not a shellm entry point — it's a bus client (`chat send`
  = one `traj append`). Only 3 things run the loop: you imperatively, a
  thinker reactively (`--traj`), generated code recursively (fork).
- A "run" = one execution of `run_loop`: `shellm-run` header … `final`.
  run identity = header's step_id. Many runs can share one trajectory
  (`--traj`); nested runs are separate runs in child trajectories.
- The format's guaranteed invariants (run_id on machinery, trigger_step on
  actor-launched headers) are documented in `design/trajectory_spec.md`
  ("Run identity" section + step-type registry).

## Work completed (all committed by Nick after review)

- `7748d17` — run_id stamping (work items 1 + 4): `bin/shellm` captures
  the `shellm-run` step_id from `traj append` (was discarded to /dev/null)
  and stamps `run_id` on prompt/reasoning/shell-output(×2 variants)/
  feedback/final(×2 sites)/run-summary; `generate_run_summary` gained the
  run step_id as arg 3. Viewer (`web/src/shellm_web/trajectory.py`) groups
  by explicit run_id (dict lookup); deleted the open-run stack, the
  "most recently closed" summary attribution, and `confidence`
  (backend + `types.ts` + warning icon in `run-group.tsx`).
- `c49c139` — trigger_step (work item 2): `thinkers/actor/step` exports
  `SHELLM_TRIGGER_STEP_ID` (trigger step's id, works for action AND message
  triggers); `bin/shellm` stamps it as `trigger_step` on the shellm-run
  step and **blanks the env var in the subprocess env** (env_vars array) so
  nested runs don't inherit it — `env "${env_vars[@]}"` augments, doesn't
  replace. Viewer joins actions exactly on trigger_step, ACTION-prefix
  match kept as legacy fallback. Message-triggered runs carry the field
  but the UI still only joins `action` steps.
- `a608d8f` — monologue JSON-wrapped content fix (work item 3): prompt rule
  + defensive unwrap in `thinkers/inner_monologue/step` (JSON envelope with
  `.content` unwrapped before the type classifier; `action`-typed envelope
  re-prefixed). Root cause: `_recent_stream` shows the model raw JSON step
  lines, which it mimics.
- `a37f136` — explainer one-pager checked in at
  `web/design/20260710/shellm-field-guide.html`.
- `c802e8c` — work item 6 docs: `design/trajectory_spec.md` gained the
  canonical step-type registry (18 types → family → writer; documented
  `idle`, `observation`, `tp-thought`, `message`) and the "Run identity"
  invariants section; machinery examples show run_id; `human-msg`/
  `agent-msg` marked legacy; dead `sub-run` removed from `bin/shellm`'s
  `--exclude-types`.
- `3031272` — **merge is real** (Nick's call: commit to it, not delete):
  shellm's forked-child write-back (both `_SHELLM_PARENT_TRAJ_ID` sites:
  success + max-iterations) writes `type:"merge"` — same fields, `content`
  + `from_traj`/`from_step`/`from_traj_ref`, no `source`. Readers already
  spoke merge; remaining fan-out was subscriptions (+`merge` for the four
  generic thinkers + `thinkers create` scaffold) and previews
  (`trajectory.py` + `bin/traj` ×3 show `content`, uuid fallback). Old
  logs: a `thought` carrying `from_traj` is a legacy merge; viewer
  writeback links are type-agnostic on `from_traj` so both render the same.

## Key decisions to remember (beyond PLAN.md's D1–D5)

- **Backwards compatibility (amended D2)**: don't break existing agents;
  the viewer *ignores* machinery without run_id (renders as plain stream,
  legacy `shellm-run` headers open member-less groups). Ignoring > guessing.
- **`merge` decision (2026-07-10)**: committed to it — it's the write-back
  step for completed forked children; `thought` is now purely monologue
  output (always has `source`).
- gen-001 pytest fixtures were repurposed as *legacy-behavior* tests
  (machinery stays ungrouped), not deleted.

## What remains

1. **5b — fresh real-session fixture**: run one live thinkers session in
   the new format (needs API key), check it in as a test fixture, and use
   it as the manual viewer verification pass (runs group with no gaps,
   action joins exact; a fresh nested fork should now produce a `merge`).
   Nick was bootstrapping a new identity for this.
2. *(optional follow-up, flagged not planned)*: nested runs ending via the
   **no-code-block final path** (`bin/shellm` ~2016: response with no bash
   block becomes `final` directly) never write a write-back to the parent —
   true before the merge change and still true. Small fix if parity wanted.

## Verification harness (reusable)

Stubbed-llm end-to-end runs, no API key needed:
- Stub script at `<scratchpad>/stubbin/llm` — put it first on PATH, set
  `TRAJ_DIR` to a scratch dir, run
  `./bin/shellm --env local --workdir <dir> "prompt"`.
- The stub **must** emit a ```bash block (or the run never finals): a
  plain-prose response gets extracted as a *command* and the loop spins
  forever — set `SHELLM_MAX_ITERATIONS` as a belt-and-braces cap (macOS
  has no `timeout(1)`). Executed code can end the run by setting
  `FINAL="answer"` (captured by the code wrapper).
- llm receives the messages JSON via `-M` in argv, so a stateless stub can
  branch on `"$*"`: match the summary generator first (its prompt contains
  "Analyze the context and goal"), then task markers in the prompt text.
- Gotchas: run with stdin closed/redirected (shellm blocks reading piped
  stdin for $CONTEXT in background invocations). Nested runs *should*
  inherit the stub via PATH but have been observed escaping to the real
  API with a real key in the env — unset `ANTHROPIC_API_KEY` if that
  matters.
- `--traj <id>` against an existing trajectory exercises the shared-log
  path; nested fork + merge write-back verified end-to-end 2026-07-10.
- Tests: `cd web && uv run pytest -q` (12 passing, incl. merge
  normalization + preview cases). Frontend: `cd web/viewer && npm run
  typecheck`.

## Artifacts & references

- Explainer one-pager (trajectory format, machinery vs sourced, entry
  points, zimbot worked example):
  https://claude.ai/code/artifact/04abfe17-556b-4aca-b0e8-6e6cd27f235a
  — committed at `web/design/20260710/shellm-field-guide.html` (a37f136).
  Note: Artifact-flavored HTML (no doctype/html/head wrapper; content
  starts with `<title>`); browsers render the raw file fine too.
  **Not yet updated for the merge change** (still describes write-backs as
  thought steps).
- Good sample data: flat-era mind log
  `improve/generations/gen-001/identities/g001r1/trajectories/90109600-root/trajectory.jsonl`
  (41 lines, one of everything); fork-era
  `.identities/botnick/trajectories/01a8f825-root/` (173 forks). Both
  predate run_id/merge — legacy format.
- Design docs: `web/design/overview.md`, `web/design/data-model.md`
  (grouping + write-back sections rewritten this session),
  `design/trajectory_spec.md` (registry + invariants added this session),
  `design/THINKERS_spec.md`.

## Standing constraints

- **Never commit/branch/push** — Nick commits manually after review.
- Nick reviews diffs between steps; keep changes scoped per work item.
