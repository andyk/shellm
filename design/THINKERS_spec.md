# Thinkers — Modular Reactive Thought Processes

## Overview

Thinkers replace the monolithic `think` command with independent, modular units that subscribe to trajectories and react to new steps. The identity's root trajectory becomes a shared bus: thinkers write to it, which broadcasts to all other subscribed thinkers. This enables concurrency (thinkers run in parallel) and composability (add/remove thinkers independently).

## What is a Thinker

A thinker is a directory in `$THINKERS_DIR/<name>/` containing:

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

## Step Protocol

Every step a thinker writes to the trajectory **must** include `"source":"<thinker-name>"`. For example:

```json
{"type":"thought","content":"...","source":"main"}
{"type":"tp-thought","content":"...","source":"learning"}
{"type":"action","content":"action: do something","source":"main"}
```

The `source` field is used by the dispatcher for self-triggering prevention.

## Subscription Format

`subscriptions.jsonl` contains one JSON object per line:

```jsonl
{"types":["thought","action","observation","human-msg","agent-msg","merge"]}
{"traj_id":"abc-123","types":["action"],"trigger_self":true}
```

Fields:
- **traj_id** (optional): Trajectory UUID to watch. Defaults to `$TRAJ_ID` (the identity's root trajectory).
- **types** (optional): Array of step types to match. If absent, matches ALL step types.
- **trigger_self** (optional, default `false`): When `false`, the dispatcher skips delivering a step to the thinker named in the step's `source` field. When `true`, the thinker receives its own output.

## Dispatcher Behavior

The dispatcher is a background process launched by `thinkers start`. It:

1. Reads all `subscriptions.jsonl` files from `$THINKERS_DIR/*/subscriptions.jsonl`
2. Resolves each `traj_id` to a file path (defaults to `$TRAJ_DIR/$TRAJ_ID`)
3. Creates a FIFO at `$IDENTITY_DIR/run/dispatch.fifo`
4. For each unique trajectory file, starts `tail -n 0 -F <file>` piped through a tagger that prefixes each line with the trajectory ID, all writing to the FIFO
5. Main loop reads from FIFO:
   - Parse step JSON
   - Extract `type` and `source` fields
   - Find all thinkers whose subscription matches the step type and trajectory
   - Skip delivery to the thinker named in `source` (unless `trigger_self: true`)
   - Run matching thinker's `step` as a background job, passing the step JSON on stdin
6. Concurrency control: `wait -n` when at `$THINKERS_MAX_CONCURRENT` active jobs (default: 4)

## Self-Triggering Prevention

When a step is appended to a trajectory, the dispatcher reads its `source` field. If `source` matches a thinker's name, that thinker will **not** receive the step — unless the thinker's subscription entry has `"trigger_self": true`.

This prevents infinite loops where a thinker reacts to its own output.

## PID and Runtime Files

```
$IDENTITY_DIR/run/
  dispatcher.pid        # PID of the dispatcher process
  dispatch.fifo         # Named pipe for step routing
  tail_pids             # One PID per line for tail -F processes
  logs/
    main.log            # Per-thinker step output
    actor.log
    learning.log
    ...
  thinkers/
    <name>.pid          # PID from thinker's `start` script (if any)
```

## Environment Variables

Thinker `step` scripts receive all identity environment variables:

| Variable | Description |
|----------|-------------|
| `IDENTITY_DIR` | Identity root directory |
| `IDENTITY_NAME` | Identity name |
| `MEM_DIR` | Memory directory |
| `SKILLS_DIR` | Installed skills directory |
| `SKILLS_KERNEL_DIR` | Kernel skills directory |
| `TRAJ_DIR` | Trajectory directory |
| `TRAJ_ID` | Root trajectory UUID |
| `SHELLM_HOME` | shellm working state |
| `THINKERS_DIR` | Directory containing all thinkers |
| `THINK_MODEL` | LLM model for thinker calls |
| `THINK_CONTEXT_TAIL` | Number of recent steps to include as context |

## CLI: `bin/thinkers`

| Command | Description |
|---------|-------------|
| `thinkers start` | Call each thinker's `start` script (if present), launch dispatcher |
| `thinkers stop` | Kill dispatcher, call each thinker's `stop` script, clean up PIDs |
| `thinkers status` | Show dispatcher state + per-thinker status |
| `thinkers list` | List installed thinkers with subscription info |
| `thinkers new <name>` | Scaffold a new thinker directory |

## Core Thinkers

### main

The primary thought generator. Reads recent context via `traj tail`, calls `shellm` with the think prompt, determines if the output is a thought or action, and writes to trajectory with `"source":"main"`.

**Subscribes to:** `thought`, `action`, `observation`, `human-msg`, `agent-msg`, `merge`

### actor

The action executor. When a step of type `action` arrives, reads the action body, builds a system prompt via `identity prompt`, calls `shellm` with fork/merge support, and writes observations back.

**Subscribes to:** `action`

### learning

Extracts lessons from action/observation pairs and stores them as memories.

**Subscribes to:** `thought`, `action`, `observation`

### intentions-goals-creator

Notices emerging intentions and goals from reflection, stores them as todo/objective memories.

**Subscribes to:** `thought`, `action`, `observation`

### intentions-goals-enforcer

Detects when the thought stream drifts from active goals and gently redirects attention.

**Subscribes to:** `thought`, `action`, `observation`

### mind-wandering

Walks memory, surfaces associative connections, and injects recalled memories into the stream.

**Subscribes to:** `thought`, `action`, `observation`

### system-architecture

Meta-cognitive process that observes how the thinking system works and suggests or makes improvements.

**Subscribes to:** `thought`, `action`, `observation`

### values-beliefs-creator

Notices emerging values and beliefs from experience and reflection, stores them as memories.

**Subscribes to:** `thought`, `action`, `observation`

### values-beliefs-enforcer

Notices when behavior conflicts with stored values and gently flags the misalignment.

**Subscribes to:** `thought`, `action`, `observation`

## Installation

Thinkers are installed to `~/.shelly-thinkers/` by `install.sh`. When a new identity is created, `identity new` copies bundled thinkers into `$IDENTITY_DIR/thinkers/` and updates `subscriptions.jsonl` to use the identity's root `TRAJ_ID`.

## Subscriptions Are Static

Changes to `subscriptions.jsonl` require restarting the dispatcher:

```bash
thinkers stop && thinkers start
```

The dispatcher reads subscriptions once at startup.
