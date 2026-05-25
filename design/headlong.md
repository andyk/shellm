# `headlong` — a stream-of-consciousness agent in the shelllm universe

Build a CLI tool `headlong` that ports the core idea of [headlong](https://github.com/andyk/headlong) into the shelllm universe (alongside `shelllm`, `shelly`, `mem`, `skills`). Same design paradigm as those tools: POSIX/bash scripts, small composable commands, text files for state, no long-running daemons, bash 3.2.57 as the minimum target.

## Core thesis

The headlong hypothesis: if we spend enough tokens on "unconscious" thought processes before producing each next "conscious" thought, an agent thinking loop can run 24x7 and stay on the rails — it can keep selecting reasonable next actions and goals without a human in the loop.

The proposed architecture for that hypothesis is a **log of thoughts** that acts as shared state between multiple subagents, each representing one unconscious thought process with a dedicated purpose. This doc ports that architecture to shelllm-universe primitives.

### Relationship to existing tools

- **`shelly`** is turn-taking: a human gives an objective, shelly achieves it. `headlong` is the same shape as `shelly` but generates the next objective for shelly instead of waiting for a human to type it.
- **`shelllm`** is the underlying one-shot LLM call with bash tool-use. Every subagent in `headlong` is a `shelllm` invocation with a specialized system prompt.
- **`mem`** is the long-term memory store. `headlong` uses `mem add`, `mem search`, and `mem dump` — it does not duplicate that functionality. Goals also live in `mem`.
- **`skills`** is available to subagents the same way it's available to `shelly`: each subagent can call `skills list --format=prompt` to discover what skills are loaded.
- **`traj`** is the trajectory/step log substrate. `headlong` uses `traj` for its thought log instead of SQLite.
- **`context`** builds JSON messages arrays from traj for LLM calls.

`headlong` is an orchestrator that composes these existing tools via a shared log of thoughts.

## Architecture

### The log of thoughts

One append-mostly log of thoughts is the only agent-specific state. It lives at `~/.config/headlong/traj/` using the `traj` tool:

```
~/.config/headlong/traj/
  trajectory.jsonl              # main thought stream
  <branch-uuid>.jsonl     # child branches (shelly runs)
  blobs/                  # spilled large fields
```

Each thought is a traj step with a `type` field and a `source` field indicating which subagent wrote it:

```json
{"type":"human","content":"action: Write a blog post about being headlong","source":"human"}
{"type":"thought","content":"I should start by outlining...","source":"think"}
{"type":"action","content":"action: create an outline for the blog post","source":"think"}
{"type":"agent-run","branch":"<uuid>","source":"act"}
{"type":"observation","content":"observation: shelly created outline.md with 5 sections","source":"act"}
{"type":"recall","content":"recalled memory: I wrote a similar post last week about...","source":"recall"}
{"type":"thought","content":"Good, the outline is done. Now I should...","source":"think"}
```

Each step also gets auto-assigned `step_id` (UUID) and `ts` by traj.

There is no memories table. Memories live in `mem` (the shared `~/.config/mem/memories.db`). This is deliberate: memories should survive `headlong` being uninstalled/reinstalled, and other tools (and the human) should be able to read/write them.

### Goals → mem

Goals live in `mem` as memories with type `goal`:

```bash
mem add --type goal "Write a blog post about being headlong"
mem search "goal"       # find goals
mem edit <name> "..."   # update goal text
mem forget <name>       # remove goal
```

Goal status (active/background/done) is tracked in the memory body text or frontmatter. The `focus` subagent reads goals via `mem search --type goal` or `mem dump` and updates them via `mem edit`.

This is simpler than a dedicated goals table. Goals don't need priority sorting or complex queries — the focus subagent is an LLM that reads all goals as text and decides what to do.

### Thought grammar

A "thought" is just a blob of text written to the log. Two reserved forms:

- A thought whose body starts with `action:` is an **action thought** — a directive the agent is issuing to itself. When `headlong act` sees one that has not yet been executed, it hands the body (minus the `action:` prefix) to `shelly` as an objective.
- A thought whose body starts with `observation:` is an **observation thought** — the result of an action. Only `headlong act` is allowed to produce these (the thought generator must never emit `observation:`).

Everything else is a "plain" thought: reflection, planning, noticing, whatever. There's no schema around it. Plain thoughts are the substrate; action/observation pairs are the interface to the environment.

Action/observation pairs are linked by convention: the observation that immediately follows an action in the log is assumed to be its result.

### Subagents

Each subagent is one subcommand of `headlong`. Each one reads from the shared log (via `context`) and from `mem`, makes one LLM call, and writes back to the log (via `traj append`). None of them are long-running processes. All are independently runnable from the shell for debugging.

| Subagent | Purpose | Reads | Writes |
|---|---|---|---|
| `headlong think`    | Generate the next thought                       | last N thoughts via `context`, active goals via `mem` | 1 traj step (type=`thought`, source=`think`) |
| `headlong act`      | Execute unprocessed `action:` thoughts via `shelly` | last unprocessed `action:` thought via `traj` | `agent-run` step + `observation` step (source=`act`) |
| `headlong recall`   | Surface relevant memories into the log          | last N thoughts via `context`, `mem search`   | 0..k traj steps (type=`recall`, source=`recall`) |
| `headlong remember` | Turn recent thoughts into memories              | last N thoughts via `context`                 | 0..k calls to `mem add` |
| `headlong focus`    | Manage goals via mem                            | last N thoughts via `context`, `mem dump`     | 0..1 `mem add`/`mem edit` calls |

The `think` subagent is the only one required for the loop to make forward progress. The others enrich the stream and can be skipped on any given tick.

### Subagent context via `context`

Each subagent uses `context` to build its input messages:

```bash
# headlong think
messages=$(context ~/.config/headlong/traj \
  --assistant-types thought,action \
  --user-types observation,recall,human \
  --tail 30)
llm -s "$think_prompt" -M "$messages" --stream
```

The system prompts for each subagent still live in `~/.config/headlong/prompts/` as editable files.

### Recall via traj search

The `recall` subagent extracts keywords from recent thoughts via an LLM call, then searches:

```bash
# Search thought log
traj search ~/.config/headlong/traj "<keywords>" --field content -i

# Search memories
mem search "<keywords>"
```

Grep-based search via `traj search` is less sophisticated than FTS5 ranking but is sufficient — the recall subagent is already using an LLM to pick keywords and filter results.

### Actuation via shelly as child branch

When `headlong act` executes an action, it:
1. Generates a branch UUID
2. Records `{type: "agent-run", branch: "<uuid>", source: "act"}` in trajectory.jsonl
3. Invokes `shelly send "<action body>"` with shelly writing its trajectory as a child branch under `~/.config/headlong/traj/<uuid>.jsonl`
4. Captures shelly's response and records `{type: "observation", content: "observation: <response>", source: "act"}` in trajectory.jsonl

### The run loop

`headlong run` is a bash loop with a configurable tick budget. On each tick it runs the subagents in a fixed order, each subject to a timeout:

```
tick:
  focus      (cheap; may be skipped if recent focus exists)
  recall     (cheap; may be skipped if last thought not yet "settled")
  think      (required)
  act        (only if the newly-generated thought is an action)
  remember   (every N ticks, or when thought backlog is large)
  sleep <tick_interval>
```

A lockfile at `~/.config/headlong/run.lock` (via `flock`) prevents concurrent `headlong run` invocations against the same traj directory.

The run loop is pure bash — no Python, no Node, no long-running Python process. Each iteration is a fresh set of CLI invocations. This matters: it means you can `Ctrl-C` the run loop at any time, inspect the traj with `traj tail`, edit a thought by hand, and restart, and the next tick picks up cleanly from the current state of the log.

## Command surface

### Setup / inspection

```
headlong init
  Create ~/.config/headlong/ and traj directory. Idempotent.

headlong log [N]
  Wraps `traj tail ~/.config/headlong/traj -n N`.
  Print the last N thoughts (default 20).
  If stdout is a TTY and fzf is available, pipe through fzf for interactive selection.

headlong show <id>
  Wraps `traj show ~/.config/headlong/traj <id>`.
  Print the full body of a single thought to stdout.

headlong append [--source human] <body>
  Wraps `traj append ~/.config/headlong/traj` with source defaulting to `human`.
  Manually append a thought. Body from arg or stdin. Prints new id to stdout.

headlong prompt <body>
  Convenience: equivalent to `headlong append --source human "action: <body>"`.
  For giving headlong a human-initiated objective to carry out.

headlong tail
  Wraps `traj tail ~/.config/headlong/traj -f`.
  Follow the log (like `tail -f`). Prints thoughts as they are appended.
```

### Subagents

```
headlong think [--dry-run]
  Generate the next thought. Uses `context` to build messages and `llm` to call
  the model with a system prompt from prompts/think.md. Must not start with
  'observation:'. On --dry-run, prints to stdout without writing to the log.

headlong act [--dry-run]
  Find the most recent 'action:' thought whose step_id is more recent than
  the most recent 'observation:' thought. If one exists, hand its body (minus
  "action: ") to `shelly` as an objective. Record the shelly run as a child
  branch and capture the response as an observation step.
  On --dry-run, prints the action that would be taken.

headlong recall [--n <count>] [--dry-run]
  Take the last 5 thoughts via `context`, extract salient keywords via an LLM
  call, search `mem` and `traj search` for matches, and write up to <count>
  (default 3) recall steps into the log. Skipped silently if nothing relevant
  is found.

headlong remember [--window <count>] [--dry-run]
  Scan the last <count> (default 50) thoughts via `context`, ask the LLM to
  identify 0..k things worth remembering long-term, and write each one via
  `mem add`. Intended to run every ~N ticks, not every tick.

headlong focus [<subcmd>]
  Manage goals via mem. Subcommands:
    headlong focus show               # mem search --type goal
    headlong focus set <body>         # mem add --type goal "<body>"
    headlong focus background <name>  # mem edit <name> with status change
    headlong focus done <name>        # mem edit <name> or mem forget <name>
    headlong focus list               # mem dump --type goal
  With no subcommand, run the focus subagent: look at recent thoughts via
  `context`, decide if goals should change, and update via `mem`.
```

### The loop

```
headlong run [--tick-interval <seconds>] [--max-ticks <n>] [--remember-every <n>]
  Run the full loop. Default tick-interval=30, max-ticks=unlimited,
  remember-every=10. Uses flock on ~/.config/headlong/run.lock.
  Logs one line per tick to stderr summarizing what happened.

headlong stop
  Create ~/.config/headlong/stop.flag. The run loop checks for this at the
  top of each tick and exits cleanly if present, then deletes the flag.
```

## Step type conventions

No registry, no schema enforcement. Just documented conventions:

**headlong step types:**
- `thought` — generated thought from the think subagent (assistant)
- `action` — directive the agent issues to itself, body starts with `action:` (assistant)
- `observation` — result of executing an action via shelly (user)
- `recall` — surfaced memory from the recall subagent (user)
- `human` — human-injected thought or prompt (user)
- `agent-run` — spawned shelly run, links to child branch (metadata, excluded from context)

## System prompts

Each subagent's system prompt lives in a separate file under `~/.config/headlong/prompts/`:

```
prompts/
  think.md
  act.md
  recall.md
  remember.md
  focus.md
```

These are plain text / markdown with `{{variable}}` placeholders that the calling script fills in before piping to `llm`. Keeping them as editable files (not embedded in bash heredocs) means:

1. The human can hand-edit a prompt and the next tick picks up the edit.
2. A future `headlong optimize` command (GEPA-style) can rewrite these files based on human edits to thoughts in the log, without needing to touch the bash code.
3. Prompts are easy to diff across versions.

The installer (`headlong init`) drops default versions of all five prompts into this directory if they don't already exist.

## Dependency chain

```
headlong
  ├── traj (thought log)
  ├── context (build messages for subagent LLM calls)
  ├── llm (make the LLM calls)
  ├── mem (goals + long-term memory)
  └── shelly (actuation — execute actions)
        ├── traj (conversation history, child branch of headlong's traj)
        ├── context (build messages)
        ├── llm (or via shellm)
        ├── mem (persona memories)
        └── skills (capabilities)
              └── shellm (when shelly delegates to shellm)
                    ├── traj (run trajectory, child branch)
                    ├── context (build messages)
                    └── llm
```

## Style constraints (shelllm-universe)

- **Pure bash, POSIX-first.** Bash 3.2.57 minimum (macOS stock). No `declare -A`, no `mapfile`, no `${var,,}`, no `**` globstar. See the shelllm styleguide.
- **Each script < 500 lines.** If it's getting longer, split it. `headlong` can be a dispatcher script that sources subcommand scripts from `lib/headlong/`.
- **External deps:** `bash`, `coreutils`, `jq`, `curl`, `flock`. Optionally `fzf` for TTY enhancement. Plus `shelllm`, `shelly`, `mem`, `traj`, `context`, and `llm` on `$PATH`.
- **stdout = data, stderr = diagnostics.** `headlong log` prints records to stdout so it pipes. Progress/debug lines to stderr.
- **`set -euo pipefail`** at the top of every script.
- **Quote all expansions. `local` everything inside functions. `readonly` for constants.**
- **Errors** go to stderr prefixed with `headlong: error: ` and exit with a nonzero code.
- **`--help`** on every subcommand, writing concise usage to stderr and exiting 0.
- **Config** under `~/.config/headlong/` (XDG). Prompts directory, and tick interval overridable via `HEADLONG_PROMPTS_DIR`, `HEADLONG_TICK_INTERVAL` env vars.

## Non-goals (explicitly out of scope for this first pass)

- **No web UI.** The original headlong has a Next.js / ProseMirror frontend for editing thoughts in realtime. `traj tail`/`traj search` + hand-editing via appending steps is the v1 interface. A TUI (fzf-based) can come later.
- **No Supabase.** All state is local traj files + mem. No network calls except the Anthropic API calls that `llm` already makes.
- **No RLM depth > 1.** Each subagent makes a single `llm` call. `shelllm` itself uses bash as a tool, so there is already one level of tool-use recursion — that's enough for v1.
- **No GEPA optimization loop in v1.** The prompts are hand-authored. A `headlong optimize` subcommand that uses human edits to thoughts as implicit preference labels can come later. Leave the prompts in editable files so a future optimizer can rewrite them in place.
- **No multi-agent coordination.** One traj directory, one agent. Running two agents requires two separate config dirs.
- **No background Python processes.** The original headlong has a thought generator daemon and an actuation daemon as separate Python processes sharing Supabase state. The shelllm-universe port collapses all of those into one bash loop; the "processes" become sequential CLI invocations.

## Testing

- Each subcommand's `--dry-run` flag produces parseable output without mutating state. Integration tests should exercise every subcommand in dry-run mode first.
- An `headlong test` subcommand (or just a `tests/` directory of bats scripts) sets up a temp config dir and runs a sequence: `init` → `append` a seed thought → `think` → assert one new step → `act` (should no-op, no action yet) → `append` an `action: ...` thought → `act` → assert an observation came back → etc.
- Each subagent should be runnable against a fixed traj snapshot for regression testing. Commit a `tests/fixtures/seed-traj/` directory with a canonical short stream and snapshot the output of each subagent against it.

## The first meaningful end-to-end demo

```bash
headlong init
headlong focus set "Write a short blog post about what it feels like to be headlong."
headlong run --tick-interval 10 --max-ticks 20
# In another terminal:
headlong tail
```

The goal should drive the stream: `think` should plan, some action thoughts should emerge, `act` should hand them to `shelly`, `shelly` will use bash to actually write files, and observations flow back into the log. `remember` should fire once or twice and drop salient facts into `mem`. At the end, `traj tail ~/.config/headlong/traj` should read like a coherent internal monologue that got from "I should write a blog post" to "here's the blog post" without a human typing anything into `shelly`.

## Summary of the core ported idea

Original headlong: subconscious processes are Python daemons sharing state in Supabase, thought generator is an RLM, memories and thoughts are separate tables, actuation is its own process.

shelllm-universe headlong: subconscious processes are CLI invocations sharing state in `traj`, thought generator is one `llm` call with context built by `context`, memories live in `mem`, goals live in `mem`, actuation is a CLI invocation that calls `shelly` as a child branch. Same architecture, same thesis, but collapsed onto the primitives that already exist in this universe — and therefore runnable with a single `headlong run` command and inspectable with `traj tail` and `traj search`.
