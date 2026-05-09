# Plan: Add autonomous "headlong" mode to shelly

## Context

Headlong is an autonomous agent that generates a stream of consciousness — thoughts, actions, and observations — without waiting for human input. The original headlong (github.com/andyk/headlong, running at ~/Development/headlong_gandolf_overmind) is a three-process Python system with Supabase, a React webapp, and persistent daemons. Its core innovation is the **4-phase RLM thought generation lifecycle**: gather context → generate candidate thoughts → judge → finalize.

This plan ports that architecture into shelly, collapsing it onto existing shellm-universe primitives (`traj`, `context`, `llm`, `shellm`, `mem`). Instead of headlong being a separate tool, shelly itself becomes the framework — with `shelly start` / `shelly stop` running the autonomous loop alongside the existing conversational `shelly send` / `shelly repl`.

## Architecture overview

### The tick

```
shelly start (autonomous loop)
  └── each tick calls shelly think, which does:

      1. GENERATE THOUGHT (single shellm call — the "RLM")
         └── shellm with think.md prompt:
             ├── Stage 1: EXPLORE — bash: traj tail, mem search, mem dump
             ├── Stage 2: THINK — bash: llm sub-calls for analysis
             ├── Stage 3: GENERATE CANDIDATES — bash: 5 parallel shellm sub-runs
             │   ├── shellm sub-run → candidate-1.txt
             │   ├── shellm sub-run → candidate-2.txt
             │   ├── shellm sub-run → candidate-3.txt
             │   ├── shellm sub-run → candidate-4.txt
             │   └── shellm sub-run → candidate-5.txt
             ├── Stage 4: OPTIONALLY MORE — only if very different from existing
             └── Stage 5: PICK WINNER — bash: llm judge call → traj append

      2. ACT (only if winning thought is type=action)
         └── shellm call with action body as objective
             → writes observation step to traj

      3. DISPATCH THOUGHT PROCESSES
         └── for each registered TP:
             └── shellm call with TP prompt + recent context
                 → prompt has inline triage: "should I run? no → FINAL()"
                 → if yes: does the work, may write thoughts to traj
```

### The traj

All steps go into the persona's traj. Step types:

| Step type | Written by | Context role | Description |
|-----------|------------|-------------|-------------|
| `thought` | think (stage 5) | assistant | Generated thought |
| `action` | think (stage 5) | assistant | Thought starting with `action:` |
| `observation` | act (via traj append) | user | Optional result of action; written by shellm directly to traj |
| `human-msg` | send/append | user | Human input injected into the stream |
| `agent-run` | act | excluded | Metadata linking to child branch |
| `tp-thought` | TP dispatch | user | Thought from a Thought Process (recall, conscience, etc.) |

## Files to create/modify

### Modified: `bin/shelly` (~600 lines added)

New sections added to the existing file.

### New directory: `thought-processes/` (7 TPs, 7 prompt files)

Bundled system-wide defaults, installed alongside `skills/`.

Each TP is a single prompt file. The prompt includes inline triage at the top: "Given the recent thoughts, decide if this process should run. If not, call FINAL() immediately. If yes, do the work."

```
thought-processes/
  mind-wandering.md            # Walk memory graphs, surface associative connections
  values-beliefs-creator.md    # Synthesize experiences into value/belief mem entries
  values-beliefs-enforcer.md   # Conscience: "this doesn't feel right", nudge back
  intentions-goals-creator.md  # Distill explicit intentions from reflections
  intentions-goals-enforcer.md # "I got distracted", "oh yeah, I should..."
  learning.md                  # Skill distillation from recent experience
  system-architecture.md       # Self-modification of cognitive architecture
```

### Modified: `install.sh`

Add `thought-processes` directory to installation.

## `shelly think` — the 5-stage shellm call

### How it works

`cmd_think()` in shelly:
1. Resolves persona, ensures think prompt exists
2. Builds the think system prompt from `prompts/think.md` with `{{goals}}` and `{{persona_name}}` injected
3. Builds recent context from traj (last N steps)
4. Calls `shellm` with the think prompt as system context + recent thoughts as input
5. shellm runs the 5-stage lifecycle internally (Claude orchestrates via bash blocks)
6. shellm's FINAL output is the winning thought
7. `cmd_think()` writes the thought to traj (type=`thought` or `action`)

Then:
8. If type=action, calls `cmd_act()` to execute
9. Calls `cmd_triage_tps()` to run Thought Process triage

### The think.md prompt (the RLM prompt, ported to shellm)

This is the shellm-universe equivalent of the original headlong's 220-line `default_system_prompt.txt`. Instead of Python REPL blocks with `sql()`, `llm_query()`, `FINAL()`, it uses bash blocks with `traj`, `mem`, `llm`, `shellm`, and shellm's own FINAL mechanism.

Key structure of the prompt:

```markdown
You are the subconscious mind of {{persona_name}}. Your job is to generate
the next thought in their stream of consciousness.

You have bash available. Use it to explore, analyze, generate candidates,
and pick a winner.

## Available tools (via bash)

- `traj tail $TRAJ_DIR -n N` — read last N thoughts from the stream
- `traj search $TRAJ_DIR "query"` — search thought history
- `mem search "query"` — semantic search across memories
- `mem dump` — print all memories with summaries
- `llm -s "system" -M "messages_json" -t N` — sub-LLM call for analysis
- `shellm "prompt" > output.txt` — launch a sub-run with full tool-use
- `traj append $TRAJ_DIR <<< '{"type":"...","content":"..."}'` — write step

## Your current goals
{{goals}}

## THE THOUGHT GENERATION LIFECYCLE

You MUST progress through these stages. Each stage uses one or more bash
blocks. Do NOT skip stages.

### Stage 1: EXPLORE
Gather context. Read recent thoughts and search memories.
- Read last 20 thoughts via `traj tail`
- Search memories for current topics via `mem search`
- Search for goal-type memories via `mem dump` or grep
- Print everything — you need to SEE it before you can think.

### Stage 2: THINK
Analyze what you found. Use `llm` or `shellm` for sub-analysis if needed.
- What is the stream currently about?
- Is there an intention that hasn't been acted on?
- Am I stuck in a loop (same topic 3+ times)?
- What would ADVANCE the stream?
Think a little bit, then more if necessary.

### Stage 3: GENERATE 5 CANDIDATES
Generate 5 candidate thoughts in parallel via shellm sub-runs.
Each candidate gets full tool-use (can read files, search, etc.)
and should be a DIFFERENT type of thought:

1. Reflection, analysis, reasoning, or hard-thinking
2. Switch focus (or come back from a distraction)
3. Keep making progress on current work
4. Decide to take action (type=action)
5. Something creative or unexpected

Launch them in parallel with high temperature:
  for i in 1 2 3 4 5; do
    SHELLM_TEMPERATURE=0.9 shellm --no-docker \
      "context: ... Generate ONE candidate thought of type $i" \
      > /tmp/candidate-$i.txt 2>/dev/null &
  done
  wait

### Stage 4: OPTIONALLY GENERATE MORE
Read all candidates. If they are not diverse enough, generate
additional candidates — but ONLY if they would be very different
from everything generated so far.

### Stage 5: PICK WINNER
Use `llm` to judge candidates. Evaluate on:
1. Continuity — follows naturally from recent stream
2. Progress — advances, doesn't restate or ruminate
3. Specificity — references concrete details
4. Action bias — if intention expressed, acting beats reflecting

Write the winning thought to traj:
  echo '{"type":"thought","content":"...","source":"think"}' \
    | traj append $TRAJ_DIR

Then output the thought as your FINAL response.

## RULES
- NEVER start a thought with "observation:" — reserved for act
- If the thought is an action, it MUST start with "action:" as first chars
- Two consecutive non-action thoughts on same topic is max. Third must act.
- "I should..." / "Let me..." = intention. NEXT thought must be action.
- When stuck, bias toward action over reflection.
```

### Key differences from original headlong's prompt

| Original (Python REPL) | shellm-universe (bash) |
|------------------------|----------------------|
| `sql("SELECT ... FROM thoughts")` | `traj tail $TRAJ_DIR -n 20` |
| `vector_search_memories("query")` | `mem search "query"` |
| `llm_query(prompt, max_tokens)` | `llm -s "prompt" -t max_tokens` |
| `FINAL("thought")` / `FINAL_VAR("x")` | Write to traj + shellm's FINAL |
| 3 candidates via `llm_query` | 5 candidates via parallel `shellm` sub-runs |
| Python `re.search` for parsing | bash text processing |

### shellm invocation for think

```bash
# In cmd_think():
shellm --env "$persona_name" \
    --workdir "$run_dir" \
    --var "MEM_DIR=$abs_mem_dir" \
    --var "TRAJ_DIR=$traj_dir" \
    --bin "$(command -v mem)" \
    --bin "$(command -v traj)" \
    --bin "$(command -v context)" \
    --bin "$(command -v llm)" \
    --bin "$(command -v shellm)" \
    "$full_message"
```

Note: `shellm` itself is passed as a `--bin` so the RLM can launch sub-runs for candidate generation. The sub-runs use `--no-docker` (they run inside the outer container).

## `shelly act` — action execution

When the winning thought is type=action:

1. Strip `action: ` prefix to get the directive body
2. Record an `agent-run` step (metadata linking to branch UUID)
3. Call shellm with the full shelly system prompt (skills, memories, kernel) + the directive as input
4. shellm does its work (tool-use loop with bash)
5. The act prompt instructs shellm to write its observation directly to traj via `traj append` when done — creating an observation is optional and uses `traj append`, NOT shellm's FINAL mechanism. FINAL is used only to signal "I'm done acting."

This means the act shellm call has `traj` available as a `--bin` and knows about `$TRAJ_DIR`. The observation step (type=`observation`) is written by the act shellm itself, not captured from FINAL output. This matches how the original headlong env daemon works: it inserts observation thoughts directly into the DB, not by returning a value.

This reuses shelly's existing shellm integration: full system prompt, Docker env, skills, mem. The act subagent has the full capability of shelly — it's essentially `shelly send` but the input comes from the thought stream instead of a human.

## Thought Processes — framework

### What is a Thought Process

A TP is a pre-packaged cognitive process that optionally runs after each thought to maintain the agent's coherence. Each TP is a **single prompt file** (`.md`) that serves as the system prompt for one shellm call. The prompt includes **inline triage** at the top: the shellm agent first decides if this TP should run given the recent context. If not, it calls FINAL() immediately (cheap — one LLM turn). If yes, it does the full work and may write thoughts to traj.

### Directory structure

**System-wide defaults** (bundled in repo):
```
thought-processes/<tp-name>.md    # Single prompt file with inline triage
```

**Per-persona overrides** (created by user or by the agent itself):
```
~/.shelly/personas/<name>/thought-processes/<tp-name>.md
```

Per-persona TPs take precedence over bundled defaults. A persona can also have custom TPs that don't exist system-wide.

### Discovery

`discover_thought_processes()` scans:
1. Bundled `thought-processes/` directory (resolved relative to the shelly binary)
2. Persona's `thought-processes/` directory
3. Merges: persona files override bundled files with the same name, persona-only TPs are added

Returns a list of TP names with resolved file paths.

### Dispatch

For each discovered TP:
1. Read the prompt file
2. Inject `{{recent_thoughts}}` (last 10-20 from traj) and `{{goals}}`
3. Call shellm with the prompt + context
4. The shellm call has access to `traj`, `mem`, `llm` (same bins as think)
5. The TP either calls FINAL() immediately (triage: no) or does its work and may write `tp-thought` steps to traj

Each TP call is cheap when it triages out — one LLM turn, no tool-use, straight to FINAL(). Only TPs that decide to run consume significant tokens.

### Bundled Thought Processes (v1)

Each prompt follows this structure: inline triage condition → if no, FINAL() → if yes, do the work.

**1. mind-wandering.md** — Walk memory graphs, surface associative connections. Searches mem for topics related to recent thoughts, surfaces 1-3 recalled memories as `tp-thought` steps. Triages out if recent thoughts are already referencing diverse memories.

**2. values-beliefs-creator.md** — Synthesize recent experiences into value/belief mem entries (`mem add --type value/belief`). Triages out if no new values/beliefs are emerging from recent thoughts.

**3. values-beliefs-enforcer.md** — The conscience. Reads values/beliefs from mem, compares with recent actions/thoughts. If misaligned, writes a `tp-thought` like "This doesn't feel right — I believe X but I'm doing Y." Triages out if everything is aligned.

**4. intentions-goals-creator.md** — Distill explicit intentions from recent reflections. Calls `mem add --type goal/intention`. May write a `tp-thought` acknowledging the new goal. Triages out if no new intentions are emerging.

**5. intentions-goals-enforcer.md** — Reads goals from mem, compares with recent thoughts. Writes a `tp-thought` like "I think I got distracted from X" or "Oh yeah, I should get back to Y." Triages out if the agent is on track.

**6. learning.md** — Skill distillation from recent action/observation pairs. Calls `mem add --type skill/fact`. Triages out if no lessons to extract.

**7. system-architecture.md** — Self-modification. Can edit `prompts/think.md`, create/modify TPs in the persona's `thought-processes/` dir. The recursive self-improvement TP. Triages out if the system is working well.

## New functions to add to `bin/shelly`

### Config variables (~10 lines)

```bash
SHELLY_TICK_INTERVAL="${SHELLY_TICK_INTERVAL:-30}"
SHELLY_THINK_MODEL="${SHELLY_THINK_MODEL:-${SHELLM_MODEL:-claude-sonnet-4-5-20250929}}"
SHELLY_CONTEXT_TAIL="${SHELLY_CONTEXT_TAIL:-30}"
```

### Helper functions (~110 lines)

- **`get_goals()`** (~25 lines) — Scan `$SHELLY_MEMORIES_DIR/*.md` for `type: goal` in YAML frontmatter, return bullet list
- **`load_prompt(name, persona_dir)`** (~20 lines) — Read `prompts/$name.md`, replace `{{goals}}` via awk, `{{persona_name}}` via sed
- **`ensure_think_prompt(persona_dir)`** (~30 lines) — Create default `prompts/think.md` if missing (the full 5-stage lifecycle prompt)
- **`acquire_lock(lock_dir)` / `release_lock(lock_dir)`** (~35 lines) — mkdir-based POSIX locking with PID tracking and stale lock detection

### Core functions (~250 lines)

- **`cmd_think(dry_run, model)`** (~100 lines) — The main orchestrator:
  1. Build think prompt with goals injected
  2. Build context from traj
  3. Call shellm (the 5-stage RLM)
  4. Parse output, write to traj
  5. If action: call `_do_act()`
  6. Call `_dispatch_thought_processes()`

- **`_do_act(action_body)`** (~70 lines) — Execute an action thought:
  1. Record agent-run step
  2. Call shellm with full system prompt + act prompt instructing it to optionally write an observation to traj via `traj append` and use FINAL only to signal completion

- **`_dispatch_thought_processes(persona_dir, traj_dir)`** (~60 lines) — TP dispatch:
  1. `discover_thought_processes()` — find all TP prompt files
  2. For each: inject {{recent_thoughts}} + {{goals}}, call shellm
  3. Each TP self-triages inline (FINAL() if nothing to do)

### Loop functions (~70 lines)

- **`cmd_start(tick_interval, max_ticks, model)`** (~55 lines) — acquire lock, tick loop: cmd_think → sleep → repeat
- **`cmd_stop()`** (~15 lines) — touch stop.flag

### Utility subcommands (~70 lines)

- **`cmd_focus(sub, ...)`** (~20 lines) — wraps mem for goal management (set/show/done)
- **`cmd_log(n)`** (~5 lines) — wraps traj tail
- **`cmd_append(--type, text)`** (~20 lines) — inject step into traj
- **`discover_thought_processes(persona_dir)`** (~25 lines) — scan bundled + persona TP dirs, return merged list

### Dispatch changes (~80 lines)

- **`main()` dispatch** (~45 lines) — add start/stop/think/act/focus/log/append/triage cases
- **`cmd_help()`** (~20 lines) — add autonomous mode section
- **`cmd_repl()`** (~15 lines) — add /start /stop /think /focus /log slash commands

## Per-persona directory additions

```
personas/<name>/
  ... (existing)
  prompts/              # NEW — editable prompt templates
    think.md            # The 5-stage RLM prompt
  thought-processes/    # NEW — per-persona TP overrides
  run.lock/             # NEW (transient) — mkdir-based lockdir
  stop.flag             # NEW (transient) — stop sentinel
```

## How shelly works now

Shelly IS the headlong agent. There is no separate "conversational mode." The loop must be running for shelly to do anything useful.

**`shelly send <message>`:** Writes a `human-msg` step to traj, then automatically runs 10 ticks so the agent processes the message. Prints a message at the start and end:
```
[shelly] Message received. Running 10 ticks...
[tick 1] ...
...
[tick 10] ...
[shelly] 10 ticks complete. Run `shelly start` to keep the agent going.
```
This gives the user an immediate response without requiring a persistent loop. But it's still the headlong architecture — the agent thinks autonomously, the human message is just another thought in the stream.

**`shelly append`:** Non-blocking injection into the stream. Allows specifying `--type`. Does NOT run any ticks — the message sits in the traj until the next tick processes it.

**`shelly start`:** Starts the persistent autonomous loop. This is how you "turn on" the agent for continuous operation. Runs until `shelly stop` or Ctrl-C.

**`shelly repl`:** Interactive mode — starts the loop in the background, shows the thought stream (like `traj tail -f`), and accepts typed input as human-msg injections. Ctrl-C stops the loop.

**Lock scope:** Only `cmd_start` locks (prevents two loops for same persona). `cmd_send` doesn't lock — concurrent traj appends are fine.

## Bash 3.2.57 compatibility

Same constraints as all shellm tools:
- No `declare -A`, `mapfile`, `${var,,}`, `|&`, `**` globstar
- mkdir-based locking (no flock)
- `while IFS= read -r` instead of mapfile
- `case` patterns for case-insensitive matching
- `tr '[:upper:]' '[:lower:]'` for lowercase

## Verification

```bash
# 1. Set a goal
shelly focus set "Write a haiku about being an AI"
shelly focus show

# 2. Dry-run think (no state mutation)
shelly think --dry-run
# Should show the 5-stage lifecycle running, with candidate generation

# 3. Run 2 ticks with short interval
shelly start --max-ticks 2 --tick-interval 10
# Should produce thoughts, actions, observations, and TP outputs

# 4. Inspect the log
shelly log
# Shows the full stream: thoughts, actions, observations, tp-thoughts

# 5. Check TPs ran
shelly log 30 | grep tp-thought
# Should see outputs from triggered TPs

# 6. Manual injection during loop
shelly start --tick-interval 15 &
shelly append "I think the haiku should be about memory"
shelly log 5
shelly stop
wait

# 7. Conversational mode still works alongside
shelly send "What are my current goals?"
```

## Implementation order

1. **Helpers**: config vars, get_goals, load_prompt, ensure_think_prompt, lock functions
2. **Think prompt**: write the full think.md (the 5-stage RLM prompt)
3. **cmd_think**: the core orchestrator (think + act + TP triage)
4. **cmd_start/stop**: the tick loop
5. **Utility commands**: focus, log, append
6. **TP framework**: discover_thought_processes, dispatch (single shellm call per TP)
7. **Bundled TPs**: write all 7 prompt files (each with inline triage)
8. **Dispatch integration**: main(), cmd_help(), cmd_repl()
9. **install.sh**: add thought-processes/ to installation
