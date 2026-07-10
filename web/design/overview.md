# shellm web viewer — design overview

*Written 2026-07-09, alongside the initial implementation.*

## Why this exists

shellm's mind logs (an identity's root trajectory: the JSONL "mind bus" of
`thought`/`action`/`observation`/… steps written by thinkers) and the trees of
nested shellm sub-runs were only readable through terminal tools — `traj tail`,
`traj repl`, `shellm-explore`. That works for spot checks but not for the
questions that actually come up when studying a session:

1. Reading the mind log as a narrative — who (which thinker) wrote what, with
   the noise (idle ticks, prompt dumps) out of the way.
2. Understanding dispatch: an `action` appears, the dispatcher fires the
   actor, a shellm run executes — seeing that as one unit instead of steps
   scattered through an interleaved stream.
3. Drilling into sub-agents of sub-agents: fork trees, each sub-run's
   reasoning/shell-output/final, including blob-spilled output.
4. Watching all of the above **live** while a session runs.

The construction is inspired by Harbor results viewer
(https://github.com/harbor-framework/harbor, `apps/viewer` +
`src/harbor/viewer`), which had already solved the skeleton problems: SPA
served by a small Python backend, filesystem-as-database, polling-based
liveness. We evaluated adapting Harbor's viewer directly (shellm → ATIF
conversion) and rejected it: ATIF's turn-based schema (`source` limited to
system/user/agent, linear steps) has no home for thinker attribution, typed
mind-bus steps, or fork trees — exactly the semantics we want to see.

## Architecture

```
bin/shellm-web                     bash launcher (uv run --project web)
web/src/shellm_web/                FastAPI backend
  server.py                        create_app(root, static_dir); /api/*; SPA catch-all
  discovery.py                     identity scan: dirs with info.txt (root_trajectory=)
  trajectory.py                    JSONL parse → normalized steps + run groups + previews
  tree.py                          fork-tree walk, traj-by-id lookup, breadcrumbs
  liveness.py                      dispatcher.pid alive OR mindlog mtime < 30s
  logs.py                          thinker log tails; dispatcher.log → events
  safety.py                        path containment + name whitelists
web/viewer/                        React Router 7 SPA (ssr:false), Tailwind v4, shadcn/ui
  app/routes/                      home · identity (mind log) · sub-traj · thinkers · memories
  app/components/                  step-card, run-group, stream, fork-tree, timeline-bar,
                                   follow-pin, blob-output, expandable-text, …
  app/lib/                         api.ts (fetch wrappers), types.ts, step-colors.ts,
                                   traj-context.ts, highlighter.tsx (shiki)
```

Serving modes (both via `bin/shellm-web`):
- **Prod (default)**: build frontend if missing (bun > pnpm > npm, override
  `SHELLM_WEB_JS`), copy to `src/shellm_web/static/`, single uvicorn serves
  API + static with an SPA catch-all registered after all `/api` routes.
- **Dev (`--dev`)**: vite dev server on :5173 with `VITE_API_URL` pointing at
  uvicorn `--reload` (via the `create_app_from_env` import-string factory,
  root passed in `SHELLM_WEB_ROOT`).

## Key decisions and rationale

**Server pre-computes normalization, run grouping, and tree resolution.**
Grouping needs filesystem knowledge the client can't have (resolving
`child_ref` relpaths and bare child UUIDs against `<hex8>-*` dirs, checking
blob existence), and the reference logic already existed in portable form in
`bin/traj` and `bin/shellm-explore`. One normalized wire shape keeps the
client era-agnostic (see data-model.md). The client keeps only presentation
state: filters, expand, follow.

**Live update = react-query polling, no SSE.**
`refetchInterval: live ? 2000 : false`, with a cheap `/status` endpoint always
polled at 2s driving everything else. Mind logs are small (≤ ~1k steps
observed), so each poll re-fetches and re-parses the whole log — this also
keeps run grouping correct when a late `final`/`run-summary` retroactively
closes a run. `?after=<step_id>` incremental fetch is a documented later
optimization, not needed at current scale.

**Identity IDs are registry-resolved, never paths.** An id is the
root-relative path with `/` → `~` (e.g. `.identities~botnick`), and the
backend only resolves it through a fresh discovery scan. Every file-serving
endpoint (blobs, logs, memories) combines a name whitelist regex with
`resolve()` + `is_relative_to()` containment. Traversal attempts fall through
to the SPA catch-all or 404 — covered by tests.

**Runs render as collapsible blocks; interleaved thinker steps stay in the
outer stream.** The mind log's concurrency (monologue keeps thinking while
the actor works) is part of what the viewer should show, so run machinery is
pulled *into* a block anchored at its `shellm-run` position, while
thinker-attributed steps remain at their true timestamps outside it.

**No virtualization in v1.** 953 step cards render fine with
`content-visibility: auto`; a virtualizer would fight follow-mode and
expand-all. Revisit around 10k steps.

**Backend is a real package, not a uv inline script.** Multi-module (grouping,
tree, dispatch parsing are each nontrivial ports), and uvicorn `--reload`
needs an import string. The `bin/` single-file-bash convention is preserved by
keeping the user-facing launcher a thin bash wrapper.

## What was verified

- pytest (`web/tests/`, 10 tests) against **real repo data**: run grouping on
  gen-001 (g001r1: 1 unclosed run, action joined; g001r2: 3 closed runs, all
  actions joined, thinker steps never swallowed), botnick's 173 forks all
  resolving + parent/child linkage, blob field preservation, tree depth
  semantics, breadcrumbs, path-safety rejection.
- Headless-Chrome screenshots of every page against both data eras, plus a
  simulated live session (step appender writing 1 step/s) confirming liveness
  detection, 2s polling, and the follow pill.
- Path traversal probes against blob/log endpoints return index.html or 404,
  never file contents.

## Known rough edges (deliberate v1 scope)

- Flat-era run grouping is heuristic for resumed/crashed runs: a run with no
  `final` shows as `running` when live, `incomplete` when not; nested inline
  runs get `confidence: "heuristic"` (surfaced as a warning icon).
- The `action`→run join (ACTION: suffix prefix-match) degrades to unjoined
  adjacency on a miss — it never guesses.
- The fork tree doesn't auto-expand to reveal the currently-viewed node when
  it's outside the first page of children.
