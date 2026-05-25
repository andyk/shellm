# Rename Thought Processes to Thinkers, refactor `think` into `thinkers`

## Context

The current `bin/think` command is monolithic: a single `think step` call takes 4+ minutes because it serially runs a 5-stage thought generator, then the actor (if action), then dispatches all 7 thought processes one by one. This makes the agent too unresponsive for interactive chat.

The refactor decomposes `think` into independent **Thinkers** — modular units that each subscribe to trajectories and react to new steps. The identity's root trajectory becomes a shared bus: thinkers write to it, which broadcasts to all other subscribed thinkers. This enables concurrency (thinkers run in parallel) and composability (add/remove thinkers independently).

## Key design decisions

- **Delete `bin/think`** entirely (no backward compat wrapper)
- **No cooldown** on the main thinker — relies on source-filtering (a thinker never receives steps it wrote itself) and concurrency limits
- **Dispatcher uses multiple `tail -n 0 -F` processes** writing to a shared FIFO, with a single reader loop that routes steps to matching thinkers
- **Thinker `step` calls run as background jobs** with a configurable concurrency limit (`THINKERS_MAX_CONCURRENT`, default 4)
- **Subscriptions are static** — changes require `thinkers stop && thinkers start`

## What is a Thinker

A directory in `$THINKERS_DIR/<name>/` containing:

```
<name>/
  step                  # Required. Executable called per matching step.
                        # Receives step JSON on stdin. Identity env vars set.
  subscriptions.jsonl   # Required. One JSON object per line:
                        #   {"traj_id":"<uuid>", "types":["thought","action",...], "trigger_self": false}
                        #   traj_id defaults to $TRAJ_ID if absent.
                        #   types absent = subscribe to ALL types.
                        #   trigger_self: true = receive own output (default: false).
  start                 # Optional. Called on `thinkers start`. For long-running
                        # processes (e.g., sensory listeners). Must exit 0.
  stop                  # Optional. Called on `thinkers stop`.
  prompt.md             # Optional. Prompt template for shellm-based thinkers.
  (anything else)       # Thinker-specific files.
```

Self-triggering prevention: every step a thinker writes must include `"source":"<thinker-name>"`. The dispatcher skips delivering a step to the thinker named in its `source` field — **unless** the subscription entry has `"trigger_self": true`, which overrides this and allows the thinker to receive its own output.

## Files to create

### 1. `design/THINKERS_spec.md` — Spec document

Comprehensive spec covering what thinkers are, directory layout, subscription format, dispatcher behavior, step protocol, and core thinker descriptions. Written first to serve as the reference.

### 2. `thinkers/_lib/common.sh` — Shared helper library

Extract from `bin/think`:
- `_require_env()` (lines 43-60)
- `get_goals()` (lines 68-91)
- `load_prompt()` (lines 94-119)
- `collect_skill_vars()` (lines 184-208)
- Absolute path resolution helpers

### 3. `thinkers/main/` — Core thought generator

- `step`: Extracted from `bin/think` `cmd_step()` (lines 240-359). Reads recent context via `traj tail`, calls shellm with think prompt, determines thought vs action type, appends to trajectory with `"source":"main"`.
- `prompt.md`: Copy of `prompts/think.md`.
- `subscriptions.jsonl`: `{"types":["thought","action","observation","human-msg","agent-msg","merge"]}`

### 4. `thinkers/actor/` — Action executor

- `step`: Extracted from `bin/think` `_do_act()` (lines 366-438). Reads action body from stdin step JSON, builds action prompt via `identity prompt`, calls shellm with `_SHELLM_PARENT_TRAJ_ID` to fork/merge.
- `subscriptions.jsonl`: `{"types":["action"]}`

### 5. Seven TP thinkers — One per thought process

Each (`learning/`, `intentions-goals-creator/`, `intentions-goals-enforcer/`, `mind-wandering/`, `system-architecture/`, `values-beliefs-creator/`, `values-beliefs-enforcer/`) gets:
- `step`: Generic TP runner — loads `prompt.md`, gets recent context, calls shellm. All use the same template with `"source":"<thinker-name>"`.
- `prompt.md`: Copied from `thought-processes/<name>.md`.
- `subscriptions.jsonl`: `{"types":["thought","action","observation"]}`

### 6. `bin/thinkers` — New CLI (~350 lines)

Subcommands:

| Command | Description |
|---------|-------------|
| `thinkers start` | Call `start` on thinkers that have it, launch dispatcher |
| `thinkers stop` | Kill dispatcher, call `stop` on thinkers, clean up PIDs |
| `thinkers status` | Show dispatcher state + per-thinker status |
| `thinkers list` | List installed thinkers with subscription info |
| `thinkers new <name>` | Scaffold a new thinker directory |

**Dispatcher internals** (run as background process from `thinkers start`):

1. Read all `subscriptions.jsonl` files, resolve `traj_id` to file paths via `_resolve_traj_id` pattern (or default to `$TRAJ_ID`)
2. Create a FIFO at `$IDENTITY_DIR/run/dispatch.fifo`
3. For each unique trajectory file, start `tail -n 0 -F <file>` piped through a tagger that prefixes each line with the file path, all writing to the FIFO
4. Main loop reads from FIFO: parse step JSON, extract `type` and `source`, find matching thinkers, skip self-triggers, run `step` as background job
5. Concurrency: `wait -n` when at `$THINKERS_MAX_CONCURRENT` active jobs

**PID tracking**:
```
$IDENTITY_DIR/run/
  dispatcher.pid
  dispatch.fifo
  tail_pids         # One PID per line for tail -F processes
  logs/
    main.log        # Per-thinker step output
    actor.log
    ...
  thinkers/
    <name>.pid      # PID from thinker's `start` script (if any)
```

## Files to modify

### 7. `install.sh`

- Replace `think` with `thinkers` in TOOLS array
- Replace `thought-processes/` installation block with `thinkers/` installation:
  - Copy/symlink each `thinkers/*/` to `~/.shelly-thinkers/`
  - Ensure `step`, `start`, `stop` are executable after copy
- Keep prompts installation (think.md still useful standalone)

### 8. `bin/identity`

- **`cmd_new()`**: Add `mkdir -p "$identity_dir/thinkers"`, add `_ensure_thinkers()` call after `_ensure_kernel`
- **`_ensure_thinkers()`** (new helper): Copies bundled thinkers from `~/.shelly-thinkers/` (or repo `thinkers/`) into identity's `thinkers/` dir. Updates `subscriptions.jsonl` to use the identity's root `TRAJ_ID`.
- **`_write_activate_script()`**: Add `export THINKERS_DIR="$_id_dir/thinkers"`
- **`cmd_shell()`**: Add `export THINKERS_DIR="$identity_dir/thinkers"` alongside other exports
- **Deactivate function**: Add `THINKERS_DIR` to unset list

### 9. `skills/shellm/SKILL.md`

- Replace `think` references with `thinkers`
- Replace "thought-processes" with "thinkers" in architecture description
- Update the bin/ reference table

## Files to delete

### 10. `bin/think`

Delete entirely.

### 11. `thought-processes/*.md` (eventually)

Keep during transition but the content moves into `thinkers/*/prompt.md`. Can delete once all identities have migrated.

## Execution order

1. Write `design/THINKERS_spec.md`
2. Create `thinkers/_lib/common.sh`
3. Create `thinkers/main/` (step, prompt.md, subscriptions.jsonl)
4. Create `thinkers/actor/` (step, subscriptions.jsonl)
5. Create 7 TP thinkers (each with step, prompt.md, subscriptions.jsonl)
6. Create `bin/thinkers`
7. Modify `install.sh`
8. Modify `bin/identity`
9. Update `skills/shellm/SKILL.md`
10. Delete `bin/think`
11. Syntax check all new scripts: `bash -n bin/thinkers` + each `step` script
12. Functional test

## Verification

1. `bash -n bin/thinkers` — syntax check
2. `bash -n thinkers/main/step` and all other step scripts
3. `thinkers list` — lists all 9 core thinkers with subscriptions
4. `thinkers new test-thinker` — scaffolds correctly
5. `thinkers start` — starts dispatcher, shows status
6. Append a `human-msg` step to root traj manually → verify main thinker's step is called (check log)
7. `thinkers status` — shows dispatcher running
8. `thinkers stop` — clean shutdown, PIDs cleaned up
9. End-to-end: `identity shell rob`, `thinkers start`, `chat send "hello"`, verify thinker activity in logs
