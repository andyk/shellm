# SESSION.md — 2026-07-10 working session state

*Bootstrap file for resuming this work in a fresh session. Repo:
`~/laude/repos/shellm` (note: `~/laude/shellm` is a different, older
checkout — don't confuse them). Nothing in this file is committed policy;
it's a snapshot of where we are.*

## What this session was about

Studying shellm's trajectory/mind-log architecture, then executing the plan
in **`web/design/20260710/PLAN.md`** — read that file first; it has the full
background, decisions (D1–D5), work items, and a Status section that is
up to date. This file adds only session-practical details the plan omits.

## Mental model (compressed; details in PLAN.md background section)

- One record shape: JSONL steps, mandatory `step_id`/`ts`/`type`, tagged
  union. A *mind log* is an identity's root trajectory used as a bus.
- Machinery steps = the 7 types the shellm loop writes, never carry
  `source`; thinker/chat steps always do. That absence/presence is how the
  viewer attributes steps.
- Flat era (since 0eb4979, 2026-07-05): the actor runs
  `shellm --traj <root>`, machinery lands inline in the mind log,
  interleaved with concurrent monologue. Nested shellm calls (no `--traj`)
  still fork child trajectories.
- `chat repl` is not a shellm entry point — it's a bus client (`chat send`
  = one `traj append`). Only 3 things run the loop: you imperatively, a
  thinker reactively (`--traj`), generated code recursively (fork).
- A "run" = one execution of `run_loop`: `shellm-run` header … `final`.
  run identity = header's step_id. Many runs can share one trajectory
  (`--traj`); nested runs are separate runs in child trajectories.

## Work completed

**Committed by Nick after review:**
- `7748d17` — run_id stamping (PLAN work item 1 + 4): `bin/shellm` captures
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
  but the UI still only joins `action` steps (unchanged semantics; data is
  there if we want message joins later).

**Uncommitted, awaiting Nick's review** (work item 3, monologue JSON bug):
- `thinkers/inner_monologue/prompt.md` — new Rules bullet: output plain
  prose, never the JSON envelope.
- `thinkers/inner_monologue/step` — defensive unwrap before the type
  classifier: response starting with `{` that parses as a JSON object with
  `.content` is unwrapped; an `action`-typed envelope gets `action: `
  re-prefixed so it still classifies as an action. Root cause was
  `_recent_stream` (in `thinkers/_lib/common.sh`) showing the model raw
  JSON step lines, which it mimics. See gen-001
  `improve/generations/gen-001/accepted/04-monologue-unwrap-json.md`.
- `web/design/20260710/PLAN.md` — Status section updated.
- Also uncommitted: this file.

## Key decisions to remember (beyond PLAN.md's D1–D5)

- **Backwards compatibility (amended D2)**: don't break existing agents;
  the viewer *ignores* machinery without run_id (renders as plain stream,
  legacy `shellm-run` headers open member-less groups). Ignoring > guessing.
- gen-001 pytest fixtures were repurposed as *legacy-behavior* tests
  (machinery stays ungrouped), not deleted.

## What remains (from PLAN.md Status)

1. **5b — fresh real-session fixture**: run one live thinkers session in
   the new format (needs API key), check it in as a test fixture, and use
   it as the manual viewer verification pass (runs group with no gaps,
   action joins exact, no warning icons — icon no longer exists).
2. **6 — spec docs**: add the step-type registry to
   `design/trajectory_spec.md` (document `idle`, `tp-thought`, `message`;
   record run_id/trigger_step invariants), remove the dead `sub-run`
   reference (`bin/shellm`, search `--exclude-types`), and decide `merge`:
   nothing writes it — commit or delete `traj merge`. **The merge call is
   Nick's decision.**

## Verification harness (reusable)

Stubbed-llm end-to-end runs, no API key needed:
- Stub script at `<scratchpad>/stubbin/llm` — prints a canned response with
  a ```bash block; put it first on PATH, set `TRAJ_DIR` to a scratch dir,
  run `./bin/shellm --env local --workdir <dir> "prompt"`.
- Gotchas learned: run it with stdin closed/redirected (shellm blocks
  reading piped stdin for $CONTEXT in background invocations); a
  turn-counter stub races with the async run-summary generator (it also
  calls llm) — prefer stateless stubs or match on prompt content.
- `--traj <id>` against an existing trajectory exercises the shared-log
  path; two runs in one file grouped exactly via
  `load_trajectory` (checked with `uv run python` in `web/`).
- Tests: `cd web && uv run pytest -q` (11 passing). Frontend:
  `cd web/viewer && npm run typecheck`.
- Unwrap logic test cases in `<scratchpad>/unwrap_test.sh` (scratchpad is
  session-specific; recreate from PLAN.md status notes if gone).

## Artifacts & references

- Explainer one-pager (trajectory format, machinery vs sourced, entry
  points, zimbot worked example):
  https://claude.ai/code/artifact/04abfe17-556b-4aca-b0e8-6e6cd27f235a
  — copy checked into the repo at
  `web/design/20260710/shellm-field-guide.html` (uncommitted). Note: the
  file is Artifact-flavored HTML (no doctype/html/head wrapper; content
  starts with `<title>`), so open it via the artifact URL for best results;
  browsers render the raw file fine too.
- Good sample data: flat-era mind log
  `improve/generations/gen-001/identities/g001r1/trajectories/90109600-root/trajectory.jsonl`
  (41 lines, one of everything); fork-era
  `.identities/botnick/trajectories/01a8f825-root/` (173 forks).
- Design docs: `web/design/overview.md`, `web/design/data-model.md`
  (grouping section rewritten this session), `design/trajectory_spec.md`,
  `design/THINKERS_spec.md`.

## Standing constraints

- **Never commit/branch/push** — Nick commits manually after review.
- Nick reviews diffs between steps; keep changes scoped per work item.
