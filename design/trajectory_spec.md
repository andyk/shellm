# Trajectory Spec

A **trajectory** is an append-only log of steps stored as a JSONL file named `trajectory.jsonl` inside a directory. Each line is a JSON object representing one step. Trajectories record what an agent did, thought, observed, and produced during a run.

## Core concepts

A trajectory is itself a step. The first line of every `trajectory.jsonl` file is a step with `"type":"trajectory"` whose `step_id` serves as the trajectory's ID. This means trajectories and steps share a single ID namespace — any UUID in the system can be looked up uniformly with `traj show <id>`.

Steps are append-only. Once written, a step is never modified.

## Directory structure

Each trajectory is a directory containing `trajectory.jsonl`. Child trajectories are nested as subdirectories of their parent, so the filesystem mirrors the logical tree.

```
trajectories/
  729eb4ae-root/
    trajectory.jsonl
    blobs/
    008951e3-initialize-leos-subconscious/
      trajectory.jsonl
      blobs/
    30b06a82-generate-next-thought/
      trajectory.jsonl
```

Directory naming: `<hex8>-<slug>`, where:
- `<hex8>` — first 8 hex characters of the trajectory's UUID
- `<slug>` — human-readable label, sanitized to `[a-z0-9._-]`, max 60 chars

## Identifying a trajectory

A trajectory is located by two values:

| Name | Positional | Flag | Env var | Purpose |
|------|------------|------|---------|---------|
| traj_dir | — | `--traj_dir` | `$TRAJ_DIR` | Root trajectories directory |
| traj_id | `[ID]` | — | `$TRAJ_ID` | UUID (or 8-char hex prefix) of the trajectory |

All subcommands accept `[ID]` as an optional positional argument. Falls back to `$TRAJ_ID`. Resolution order: positional > env var.

The resolver (`_resolve_traj_id`) accepts:
1. An exact relative path (e.g. `729eb4ae-root/trajectory.jsonl`)
2. A directory-based path — `$traj_dir/$traj_id/trajectory.jsonl`
3. A basename without `.jsonl` (legacy)
4. A full UUID — extracts first 8 hex chars, searches recursively for a directory named `<hex8>-*`
5. An 8-char hex prefix — recursive directory search
6. Legacy flat file glob: `*_<hex8>_*.jsonl`

The search is recursive, so nested child trajectories are found regardless of depth.

## Step format

Every step is a single-line JSON object with at least these fields:

```json
{
  "type": "<step_type>",
  "step_id": "<uuid>",
  "ts": "<ISO 8601 with milliseconds and timezone>"
}
```

`type` and `step_id` are mandatory. `ts` is added automatically by `traj append`. All other fields depend on the step type.

### Automatic fields

| Field | Added by | Description |
|-------|----------|-------------|
| `step_id` | `traj append` | UUID v4, unique across all trajectories. Preserved if pre-set by caller (e.g. fork steps). |
| `ts` | `traj append` | ISO 8601 timestamp, e.g. `2026-05-16T13:26:06.846-0700` |

## Step types

### Structural types

These manage the trajectory tree itself.

#### `trajectory`

First step of every `trajectory.jsonl` file. Its `step_id` is the trajectory's ID.

```json
{"type":"trajectory", "step_id":"<uuid>", "ts":"..."}
```

Optional fields (absent for roots):
- `parent_traj` — UUID of the parent trajectory
- `parent_step` — UUID of the fork step in the parent trajectory that spawned this child
- `parent_traj_ref` — relative path from this trajectory's directory to the parent's directory (e.g. `..`)

#### `fork`

Records that a child trajectory was spawned from this point. The fork step's `step_id` is pre-generated and shared with the child trajectory's `parent_step` field for cross-referencing.

```json
{"type":"fork", "child":"<child-traj-uuid>", "child_ref":"<hex8>-<slug>/trajectory.jsonl", "step_id":"<uuid>", "ts":"..."}
```

- `child` — UUID of the child trajectory
- `child_ref` — relative path from this trajectory's directory to the child's `trajectory.jsonl`

### Reference pattern

All cross-trajectory references use three fields: a trajectory UUID, a step UUID within that trajectory, and a relative path for direct file access.

| Reference | Traj UUID | Step UUID | Relative path |
|-----------|-----------|-----------|---------------|
| Parent trajectory | `parent_traj` | `parent_step` | `parent_traj_ref` |
| Forked child | `child` | — | `child_ref` |
| Source sub-traj | `from_traj` | `from_step` | `from_traj_ref` |
| Spilled stdout | (implicit via `step_id`) | — | `stdout_ref` |
| Spilled stderr | (implicit via `step_id`) | — | `stderr_ref` |

The UUID is the stable identifier; the `_ref` path enables direct file access without searching.

Cross-trajectory references appear in two directions:
- **Upward** (`parent_traj`/`parent_step`/`parent_traj_ref`): on the child trajectory's first step, pointing to the parent that forked it
- **Downward** (`from_traj`/`from_step`/`from_traj_ref`): on `thought` steps written back to a parent trajectory after a sub-run completes, pointing to the sub-trajectory's final step

### Run lifecycle types

These mark the beginning, end, and metadata of a shellm run.

#### `shellm-run`

Written immediately after trajectory creation. Records how the run was invoked and its configuration.

```json
{
  "type": "shellm-run",
  "command": "<original command>",
  "workdir": "<path>",
  "model": "<model name>",
  "effort": "<low|medium|high|xhigh|max>",
  "max_iterations": "<N or empty>",
  "max_tokens": "<N or empty>",
  "inactivity_timeout": "<seconds>",
  "context_files": ["<path>", ...],
  "env": {"name":"<env name>", "type":"local|docker", ...}
}
```

| Field | Description |
|-------|-------------|
| `command` | The full `shellm ...` invocation string |
| `workdir` | Working directory for the run |
| `model` | LLM model used (e.g. `claude-sonnet-4-20250514`) |
| `effort` | Thinking effort level (`low`, `medium`, `high`, `xhigh`, `max`) |
| `max_iterations` | Iteration cap (empty string if unlimited) |
| `max_tokens` | Per-response token limit (empty string if default) |
| `inactivity_timeout` | Seconds before killing idle execution (default: `30`) |
| `context_files` | Array of `-f` file paths passed to the run |
| `env` | Execution environment metadata (local or Docker details) |

#### `prompt`

The user's initial prompt for the run.

```json
{"type":"prompt", "content":"<prompt text>"}
```

#### `run-summary`

Auto-generated summary of the run (produced asynchronously by a fast model).

```json
{"type":"run-summary", "tldr":"<one-line summary>", "full_summary":"<longer summary>"}
```

#### `final`

The agent's final answer — the run's output.

```json
{"type":"final", "thought":"<reasoning>", "content":"<answer>", "cmd":"<last code if any>"}
```

### Agent reasoning types

These record the agent's thought-action-observation loop.

#### `reasoning`

One iteration of the agent's reasoning, including the code it decided to execute.

```json
{"type":"reasoning", "thought":"<reasoning text>", "cmd":"<bash code>"}
```

#### `shell-output`

The result of executing a code block.

```json
{"type":"shell-output", "stdout":"<output>", "stderr":"<errors>", "exit":<code>}
```

When execution timed out:
```json
{"type":"shell-output", "stdout":"...", "stderr":"...", "exit":<code>, "timed_out":true, "feedback":"<inactivity message>"}
```

#### `feedback`

System-generated feedback injected into the conversation (e.g. after a timeout).

```json
{"type":"feedback", "content":"<feedback text>"}
```

### Think cycle types

These are produced by `think`, the autonomous thinking loop.

#### `thought`

A think-cycle thought (no action taken).

```json
{"type":"thought", "content":"<thought text>", "source":"think"}
```

When a thought originates from a completed sub-trajectory (e.g. after a thinker's shellm run), it includes cross-references:

```json
{"type":"thought", "content":"<result>", "from_traj":"<sub-traj-uuid>", "from_step":"<final-step-uuid>", "from_traj_ref":"<hex8>-<slug>"}
```

#### `action`

A think-cycle thought that begins with "action:" — triggers execution in a child trajectory.

```json
{"type":"action", "content":"action: <description>", "source":"think"}
```

### Conversation types

Produced by `chat` for human-agent messaging.

#### `human-msg`

A message from a human into the thought stream.

```json
{"type":"human-msg", "content":"<message>"}
```

#### `agent-msg`

The agent's conversational reply.

```json
{"type":"agent-msg", "content":"<message>"}
```

## Blob spilling

When `stdout` or `stderr` exceeds 4096 bytes (configurable via `$SHELLM_STDOUT_INLINE_LIMIT`), the full content is written to a blob file and the inline value is truncated.

Blob files live in a `blobs/` directory inside the same trajectory directory as the `trajectory.jsonl` that references them.

### Blob file naming

```
blobs/<step_id>-<blob_id>.stdout
blobs/<step_id>-<blob_id>.stderr
```

`blob_id` is a zero-padded hex counter per step (e.g. `000000`).

### Truncated step fields

When a field is spilled, three extra fields are added to the step:

```json
{
  "stdout": "<first 4096 bytes>",
  "stdout_ref": "blobs/<step_id>-<blob_id>.stdout",
  "stdout_bytes": 52341,
  "stdout_truncated": true
}
```

`traj show <step_id> --full` restores the full content from the blob.

## Tree structure

Trajectories form a tree via `fork` steps and `parent_traj` fields:

- A **root** trajectory has no `parent_traj` field on its first step.
- A **child** trajectory has `"parent_traj":"<parent-uuid>"` and `"parent_step":"<fork-step-uuid>"` on its first step, and the parent has a corresponding `"fork"` step with `"child":"<child-uuid>"`.
- When a child completes, the parent records a `"thought"` step with `from_traj`/`from_step`/`from_traj_ref` pointing to the child's final step.

The filesystem mirrors this: child trajectory directories are nested inside their parent's directory.

`traj list` renders this tree:

```
>>> 729eb4ae: hello world (5 steps)
├── acce682d: sub task (3 steps)
│   └── f362b564: deep subtask (1 steps)
└── 248d5f75: second child (1 steps)
```

`>>>` marks the trajectory you're viewing from.

`traj list --steps` expands each trajectory to show individual steps inline, with child trajectories rendered under their fork steps:

```
>>> 729eb4ae: hello world (7 steps)
    ├── aaa11111 [shellm-run] shellm 'hello world'
    ├── aaa11112 [prompt] hello world
    ├── aaa11113 [fork] -> acce682d-...
    │   └── acce682d: sub task (3 steps)
    │       ├── bbb11111 [prompt] do the sub task
    │       └── bbb11112 [final] done
    ├── aaa11114 [thought] (from acce682d)
    └── aaa11115 [final] Hello!
```

## Expected step ordering

A complete shellm run trajectory follows this order:

```
trajectory                      # created by traj new
shellm-run                      # run metadata (model, effort, env, etc.)
prompt                          # the user's request
run-summary                     # async, may appear at any point after prompt
reasoning → shell-output        # repeated per iteration (the agent loop)
final                           # the agent's answer (terminates the loop)
```

The `reasoning → shell-output` pair repeats for each iteration. If the LLM responds without a code block, a `final` step is written directly (no `reasoning`/`shell-output` pair for that iteration).

The `run-summary` step is generated asynchronously and may land anywhere after the `prompt` step — often between `prompt` and the first `reasoning`, but sometimes after `final`.

## CLI reference

```
traj <command> [ID] [options]
```

All commands accept `[ID]` as an optional positional argument (trajectory ID, UUID, or 8-char hex prefix). Falls back to `$TRAJ_ID`. All commands also accept `--traj_dir DIR`.

| Command | Syntax | Description |
|---------|--------|-------------|
| `new` | `new [--slug TEXT] [--field key=val ...]` | Create a new trajectory. Outputs UUID then relative dir path. |
| `append` | `append [ID] [--field key=val ...]` | Append a step from stdin JSON or `--field` flags. |
| `fork` | `fork [ID] [--child CHILD_ID] [--slug TEXT] [--step-id UUID]` | Append a fork step. Auto-creates child traj if `--child` omitted. |
| `merge` | `merge <child_id> [ID] [--field key=val ...]` | Append a merge step from a completed child. |
| `show` | `show <id> [--full] [--field F]` | Show a trajectory or step by ID. Searches all files in traj_dir. |
| `tail` | `tail [ID] [-n N] [-f] [--type T1,T2]` | Stream recent steps (like `tail` for JSONL). |
| `search` | `search <pattern> [ID] [--field F] [-i] [-C N] [-E]` | Search step fields for a pattern. |
| `count` | `count [ID]` | Print step count. |
| `last` | `last [ID] [--field KEY]` | Print the last step. `--field` extracts one field. |
| `cat` | `cat [ID] [--filter F] [-r] [--raw]` | Output all steps (formatted or JSONL). |
| `exists` | `exists [ID]` | Exit 0 if trajectory exists and has steps. |
| `list` | `list [ID] [--parents N\|all] [--children N\|all] [--steps] [--json]` | List tree as ASCII. `--steps` expands inline. |
| `isroot` | `isroot [ID]` | Exit 0 if trajectory has no parent. |
| `root` | `root [ID]` | Walk up to root and print its directory name. |

## Example: complete trajectory

```
729eb4ae-root/
  trajectory.jsonl
  blobs/
  acce682d-sub-task/
    trajectory.jsonl
```

`729eb4ae-root/trajectory.jsonl`:
```jsonl
{"type":"trajectory","step_id":"729eb4ae-2a49-4b41-9db6-8ff3aa500d2a","ts":"2026-05-16T13:26:06.846-0700"}
{"type":"shellm-run","command":"shellm 'echo hello'","workdir":"/tmp/work","model":"claude-sonnet-4-20250514","effort":"high","max_iterations":"","max_tokens":"","inactivity_timeout":"30","context_files":[],"env":{"name":"local","type":"local"},"step_id":"aaa11111-0000-0000-0000-000000000001","ts":"2026-05-16T13:26:06.850-0700"}
{"type":"prompt","content":"echo hello","step_id":"aaa11111-0000-0000-0000-000000000002","ts":"2026-05-16T13:26:06.855-0700"}
{"type":"run-summary","tldr":"Ran echo command","full_summary":"","step_id":"aaa11111-0000-0000-0000-000000000003","ts":"2026-05-16T13:26:07.100-0700"}
{"type":"fork","child":"acce682d-1234-5678-9abc-def012345678","step_id":"aaa11111-0000-0000-0000-000000000004","ts":"2026-05-16T13:26:08.000-0700"}
{"type":"thought","content":"Sub task done","from_traj":"acce682d-1234-5678-9abc-def012345678","from_step":"bbb11111-0000-0000-0000-000000000002","from_traj_ref":"acce682d-sub-task","step_id":"aaa11111-0000-0000-0000-000000000005","ts":"2026-05-16T13:26:09.000-0700"}
{"type":"final","thought":"Got the output, returning it.","content":"hello","step_id":"aaa11111-0000-0000-0000-000000000006","ts":"2026-05-16T13:26:10.000-0700"}
```
