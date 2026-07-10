# PLAN: exact run attribution in mind logs (kill the flat-era heuristics)

*Written 2026-07-10 from a design discussion. This file is self-contained:
it records the background, the decisions and their rationale, and the work
items, so the plan can be picked up cold.*

## Background (what you need to know to understand the plan)

**Trajectory vs. mind log.** A *trajectory* is the on-disk record of any
shellm run: an append-only JSONL file (`<hex8>-<slug>/trajectory.jsonl` +
sibling `blobs/`) where every step has `step_id`, `ts`, `type`. A *mind log*
is the role a particular trajectory plays in the thinkers system: an
identity's root trajectory (pointed at by `info.txt`'s `root_trajectory=`),
used as a shared bus that thinkers subscribe to and write to. Every mind log
is a trajectory; most trajectories aren't mind logs.

**Machinery steps.** The shellm loop writes seven step types, and they never
carry a `source` field: `shellm-run`, `prompt`, `reasoning`, `shell-output`,
`feedback`, `final`, `run-summary` (the set is `MACHINERY_TYPES` in
`web/src/shellm_web/trajectory.py`). Thinker steps (`thought`, `action`,
`observation`, `idle`, …) always carry `source` (thinker name). The web
viewer attributes steps by this absence/presence.

**Fork era vs. flat era.** Before commit `0eb4979` (2026-07-05), the actor
thinker ran actions as *forked child trajectories* (`_SHELLM_PARENT_TRAJ_ID`
mechanism: `fork` step in the mind log, machinery hidden in the child,
write-back `thought` at the end) — that's the `.identities/botnick` data.
That commit added `shellm --traj <ID>` (write steps directly into an
existing trajectory: no child traj, no fork step, no summary write-back) and
switched all thinker step scripts to `shellm --traj "$TRAJ_ID"`
(`thinkers/actor/step:89`), so run machinery now lands *inline* in the mind
log, interleaved with concurrent thinker steps — that's the
`improve/generations/gen-00*` data. Rationale from the commit: "making
in-flight work visible to other thinkers" — the mind log is a bus, and
forked children hid the actor's in-flight work from the monologue.
Note: nested `shellm "…"` calls made *by generated code* still fork children
in both eras; forking is current mechanism, not legacy.

**The cost of flat writes.** Nothing ties an inline machinery step to the
run it belongs to, so the viewer reconstructs structure heuristically
(`web/src/shellm_web/trajectory.py`):

1. Source-less machinery steps attach to a *stack* of open `shellm-run`s
   (`final` pops); a run opening while another is open is flagged
   `confidence: "heuristic"` (warning icon in the UI).
2. Async `run-summary` attaches to the "most recently closed run" — can
   mis-attach when two runs close back-to-back.
3. `action` → run join: the actor embeds the action text as an
   `…ACTION: <text>` suffix in the shellm command; matched by
   whitespace-collapsed 200-char prefix. On a miss, steps render adjacently.

**Root cause.** The writer knows the truth and throws it away. At
`bin/shellm:1851` the `shellm-run` step is appended and its step_id — which
`traj append` *prints back to the caller* — is discarded to `/dev/null`.
Every heuristic above reconstructs that discarded fact.

**Concurrency (not changing).** All writes go through `traj append`
(`bin/traj` ~line 540), which serializes concurrent writers with a
`mkdir`-based lock (`<file>.lock/` — atomic, portable to macOS which lacks
flock, works across Docker bind mounts), 10ms spin, stale locks stolen after
5s (holder killed mid-append). Guarantees line-level atomicity only; log
order = lock-acquisition order. This is fine for a bus and stays as is.

## Decisions

**D1 — Writers stamp exact links; readers stop guessing.**
Machinery steps carry `run_id` (= their `shellm-run`'s step_id);
`shellm-run` carries `trigger_step` (= the `action` step that caused it)
when launched by the actor. These become *guaranteed invariants of the
format*, documented in `design/trajectory_spec.md`.

**D2 — Old data is tolerated, not migrated.** *(Amended 2026-07-10: the
original decision was "throw old data away, no compatibility"; revised to
"don't break existing agents; the viewer ignores anything without run_id".)*
Consequences:
- Viewer heuristics are still *deleted*: the open-run stack, the
  run-summary "most recently closed" rule, and the `confidence` field
  (wire shape + UI warning icon) all go. The ACTION-prefix action→run join
  stays until `trigger_step` (work item 2) lands.
- Old-format logs parse and render fine as a plain step stream; their
  machinery steps carry no `run_id` and are simply never grouped. A legacy
  `shellm-run` header still opens a (member-less) run block, since it knows
  its own id.
- The writer change is purely additive, so old agents, `bin/traj`, and the
  TUI are unaffected.

**D3 — Fix data bugs at the writer, not the renderer.**
Flat-era monologue occasionally emits a raw JSON object serialized into
`content` (`{"type":"thought","content":"…"}` as a string). With old data
disposable, do NOT add a render-time unwrap in the viewer (previously
planned as a cheap fix); fix the thinker that writes it (gen-001 proposal
card 04 targets this).

**D4 — Prune dead step types; document live ones; do NOT rename.**
The frontend union (`web/viewer/app/lib/types.ts`) has 18 types; the spec
documents ~14. Add the undocumented live ones (`idle`, `tp-thought`,
`message`) to `design/trajectory_spec.md` as a single canonical registry
(type → family: machinery/thinker/structural/conversation → writer). Delete
truly dead types: `sub-run` (only referenced in an exclude list,
`bin/shellm:1941`; nothing writes it) and decide on `merge` (the `traj` CLI
can write it; nothing does — commit to it or remove the subcommand).
Renames (`tp-thought`→`thought`, collapsing `message`/`human-msg`/
`agent-msg`) are rejected even with zero migration burden: the cost was
never migration, it's the fan-out across `bin/traj` previews, the Rust TUI
(`tui/shellm`), thinker scripts, THINKERS spec, and the viewer, for modest
value.

**D5 — Explicitly out of scope** (deeper than we want to go now):
crashed-vs-running run disambiguation (needs watchdog forensics),
dispatcher.log ↔ mind-log correlation (right fix is `bin/thinkers` logging
step_ids — a different program), SSE tailing, stream virtualization,
`?after=` incremental fetch, on-disk type renames, any change to the
`traj append` locking.

## Status (2026-07-10)

- **Done — work item 1**: `bin/shellm` stamps `run_id` on prompt / reasoning /
  shell-output / feedback / final (both sites) / run-summary;
  `generate_run_summary` takes the run step_id as an argument.
- **Done — work item 2**: `thinkers/actor/step` exports
  `SHELLM_TRIGGER_STEP_ID` (the triggering step's id, message or action);
  `bin/shellm` stamps it as `trigger_step` on the `shellm-run` step and
  blanks the env var for executed code so nested runs don't inherit it.
  Viewer joins exactly on `trigger_step`, keeping the ACTION-prefix match
  as fallback for legacy logs (message-triggered runs carry the field but
  are not yet joined in the UI — same semantics as before). Verified with
  the stubbed-llm harness: `trigger_step` on the header, executed code
  sees the var blank.
- **Done — work item 4, revised per amended D2**: `trajectory.py` groups by
  explicit `run_id` (dict lookup); stack / summary-attachment heuristics and
  `confidence` deleted from the backend, `types.ts`, and `run-group.tsx`.
- **Done — tests**: gen-001 tests rewritten as legacy-behavior tests
  (machinery stays ungrouped), plus a synthetic new-format test covering two
  interleaved runs grouping exactly, summary attribution by id, and
  unknown-run_id orphans. 11 passed; frontend typecheck clean. Verified
  end-to-end with a stubbed `llm`: two runs appended into one trajectory via
  `--traj` grouped exactly by `load_trajectory`.
- **Done — work item 3**: monologue JSON-wrapped content fixed at the
  writer, per gen-001 accepted proposal 04. Root cause: `_recent_stream`
  shows the model raw JSON step lines, which it occasionally mimics.
  Two-part fix: an output-format rule in
  `thinkers/inner_monologue/prompt.md` (plain prose, never the JSON
  envelope), plus a defensive unwrap in `thinkers/inner_monologue/step`
  (a response that parses as a JSON object with a `content` key is
  unwrapped before the type classifier; an `action`-typed envelope is
  re-prefixed so it still classifies as an action). Verified against the
  g001r1 evidence case plus edge cases (non-JSON brace-prefixed prose,
  envelope without content key) — all classify correctly.
- **Not done**: 5b (fresh real-session fixture), 6 (trajectory_spec
  registry + the `merge` decision; the data-model.md grouping section was
  updated alongside the code).

## Work items (in order)

1. **`bin/shellm`: stamp `run_id`.** Capture the step_id printed by
   `traj append` when writing the `shellm-run` step (`bin/shellm:1851` —
   currently `>/dev/null`). Add `run_id: $rid` to the jq templates for
   `prompt`, `reasoning`, `shell-output`, `feedback`, `final`
   (append sites near lines 1869, 2013, 2257, 2284–2289). Pass the id to
   the background summary generator so `run-summary` (append at ~1602)
   carries it too. `final` carries `run_id` like everything else
   (uniformity; the viewer treats it as both member and closer).

2. **Actor → exact trigger link.** In `thinkers/actor/step` (~line 89),
   export the triggering step's id (e.g. `SHELLM_TRIGGER_STEP_ID`; the
   actor already has the step JSON in hand). In `bin/shellm`, include it as
   `trigger_step` on the `shellm-run` step when set. The `…ACTION: <text>`
   command suffix can stay for human readability but is no longer load-
   bearing.

3. **Fix the monologue JSON-wrapped `content` bug at its source**
   (see D3; root-cause fix in the inner_monologue thinker).

4. **Viewer simplification** (`web/src/shellm_web/trajectory.py`,
   `web/viewer/app/lib/types.ts`, run-group UI): group by `run_id`, join
   actions by `trigger_step`, delete the stack / summary-attachment rule /
   prefix match / `confidence` plumbing and its warning icon.

5. **Tests / fixtures.** The pytest suite (`web/tests/`) currently verifies
   grouping against real repo data (gen-001 unclosed runs, botnick's 173
   forks) — that data is being thrown away. Replace with: (a) a hand-written
   golden JSONL fixture in the new format covering closed run, unclosed
   run, concurrent thinker interleave, fork + nested fork, blob spill;
   (b) one freshly generated real session, to keep the "tests run against
   real data" property.

6. **Docs.** `design/trajectory_spec.md`: step-type registry (D4),
   `run_id`/`trigger_step` invariants (D1). `web/design/data-model.md`:
   replace the "two eras, one grouping algorithm" section with the exact-
   join description. Note `merge` decision outcome.

## Verification

- `cd web && uv run pytest` against the new fixtures.
- Run a fresh thinkers session end-to-end; confirm in the web viewer that
  runs group with no warning icons, actions join their runs exactly, and
  `run-summary` lands on the right run when two runs close back-to-back.
- `cd web/viewer && npm run typecheck`.
