# Recovery State: Dropped Commit e763d7c

## What happened

Commit `e763d7c` ("Add executable bash blocks in SKILL.md, thinkers, identities, and CLI improvements") contained both legitimate code changes AND 2500+ runtime identity files (rob and lindsey's logs, trajectories, memories, blobs). The commit was 173K+ lines.

We dropped it from main via `git reset --hard` + force push to remove the identity data from git history. We then cherry-picked our subsequent commit on top.

## Reference branch

**`bloated-snapshot`** points to `e763d7c`. This branch preserves the full commit for cross-referencing. It contains:
- All the code changes we need
- All the identity runtime data we don't want in history

## Recovery status

### Fully restored (match bloated-snapshot)
- `bin/focus` - restored
- `bin/shellm` - restored
- `bin/shellm-explore` - restored
- `bin/skills` - restored
- `bin/traj` - restored
- `design/Bobbys-Brain` (symlink) - restored
- `design/THINKERS_spec.md` - restored
- `design/thinkers_revamp_plan.md` - restored
- `design/trajectory_spec.md` - restored
- `prompts/think.md` - restored
- `skills/mem/SKILL.md` - restored
- `thinkers/_lib/common.sh` - ported from bobby's identity instance
- `thinkers/*/step` - ported from bobby's identity instance, TP->thinker renamed
- `thinkers/*/prompt.md` - ported from bobby's identity instance
- `thinkers/*/subscriptions.jsonl` - ported, traj_id stripped, compacted to single-line

### Intentionally different from bloated-snapshot (our later commits improved these)
- `bin/context` - blob loading fix added (loads spilled stdout/stderr from blob files)
- `bin/identity` - shellm removed from kernel skills; loop refactored for mem+chat only
- `bin/thinkers` - individual start/stop added; `trajectory.jsonl` -> `root.jsonl` fix; initial kick on individual start; `_stop_dispatcher()` helper
- `install.sh` - dropped extra tools (traj-migrate, glob, put, sub, view); thinkers install path changed to `~/.shellm-thinkers`; thought-processes section replaced with thinkers
- `skills/shellm/SKILL.md` - references updated from think/TP to thinkers; THINKERS_DIR added to env table
- `thinkers/main/step` - uses `llm` directly instead of `shellm`
- `thinkers/main/subscriptions.jsonl` - `trigger_self: true` added

### Intentionally removed
- `bin/think` - replaced by `bin/thinkers`
- `thought-processes/*.md` - replaced by `thinkers/*/prompt.md`

### Found missing and restored after initial recovery
- `thinkers/main/prompt.md` - was in bloated-snapshot but not ported (main/step requires it)
- `bin/chat` `send-file` command - was never committed in any branch; implemented in session
  `f8ceefc3` (May 24) but lost when `git reset --hard` wiped uncommitted working tree changes
- `bin/thinkers` `_resolve_traj_file()` had `trajectory.jsonl` instead of `root.jsonl` — mismatch
  with `bin/traj` which uses `root.jsonl`

### Possibly still missing (check bloated-snapshot if issues arise)
- Any changes to files not listed above that were part of e763d7c but not in the diff filter
- The bloated commit may have included changes to other files bundled with identity data
- Uncommitted changes from session `f8ceefc3` beyond `send-file` (that session also fixed
  `cmd_history` and repl watcher to use `--filter type=` instead of `--type`)

## How to cross-reference

```bash
# See all non-identity changes from the bloated commit
git diff --stat 4f7c023..bloated-snapshot -- ':!.identities/'

# Compare a specific file
git diff bloated-snapshot -- bin/somefile

# Check out a file from the bloated commit
git checkout bloated-snapshot -- path/to/file
```
