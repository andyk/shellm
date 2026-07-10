# shellm web viewer

A web UI for browsing shellm **mind logs** (an identity's root trajectory), the
**runs** dispatched by thinkers, and the **fork tree** of nested shellm
sub-runs — with live updating while a session is running. The construction is
React Router 7 SPA served by a small FastAPI backend that reads trajectory JSONL
straight off disk.

Modeled after the Harbor Job Viewer: https://github.com/harbor-framework/harbor

## Usage

```bash
# Serve the shellm repo itself (finds all identity dirs under it)
bin/shellm-web

# Serve any directory containing identity dirs
bin/shellm-web ~/some/dir

# Dev mode: vite dev server (hot reload) + uvicorn --reload
bin/shellm-web --dev

# Options
bin/shellm-web [ROOT] [--port N] [--host H] [--rebuild] [--dev]
```

Requires [uv](https://docs.astral.sh/uv/) for the backend and a JS package
manager for the frontend — bun, pnpm, or npm, auto-detected in that order.
Set `SHELLM_WEB_JS=bun|pnpm|npm` to force one (`pnpm` works via corepack even
when not installed globally). The first production launch builds the frontend
automatically (`--rebuild` forces it).

## What it shows

- **Home** — every identity dir under the root (any directory with an
  `info.txt` containing `root_trajectory=`), grouped by location, with live
  badges and last activity.
- **Mind log** (`/i/<identity>`) — the root trajectory as a step stream:
  - steps colored by type with thinker attribution (`source`) chips;
    machinery steps (no `source`) get a gear glyph
  - inline actor runs grouped into collapsible blocks
    (`shellm-run → reasoning/shell-output → final`), joined to the `action`
    step that triggered them
  - consecutive `idle` steps folded into strips
  - type/source filters (URL-persisted), expand-all, and a proportional
    timeline bar (click to jump)
  - fork steps link to child trajectories; write-back thoughts link back
- **Sub-trajectory** (`/i/<identity>/t/<traj_id>`) — drill into forked
  sub-runs (and sub-runs of sub-runs) with breadcrumbs and a lazy fork-tree
  sidebar; blob-spilled stdout/stderr can be loaded in place.
- **Thinkers** (`/i/<identity>/thinkers`) — dispatcher.log parsed into
  dispatch events plus a tail view of each `run/logs/*.log`.
- **Memories** (`/i/<identity>/memories`) — the identity's memory files.

## Live updating

A session counts as live when `run/dispatcher.pid` points at a running
process or the mind log was modified in the last 30 seconds. While live,
the frontend polls every 2 seconds (react-query `refetchInterval`) and a
follow pill keeps the view pinned to the newest steps; scrolling up pauses
following.

## Layout

```
web/
├── pyproject.toml        # backend package (fastapi + uvicorn)
├── src/shellm_web/       # FastAPI backend
│   ├── server.py         #   app factory + API endpoints + SPA serving
│   ├── discovery.py      #   identity dir scanning
│   ├── trajectory.py     #   JSONL parsing, run grouping, previews
│   ├── tree.py           #   fork-tree resolution
│   ├── liveness.py       #   session liveness
│   ├── logs.py           #   thinker log tails, dispatcher.log parsing
│   ├── safety.py         #   path containment + name whitelists
│   └── static/           #   built frontend (generated)
├── tests/                # pytest against real repo fixtures
└── viewer/               # React Router 7 SPA (vite, tailwind v4, shadcn/ui)
```

## Development

```bash
bin/shellm-web --dev            # backend :8080-8089, frontend :5173
cd web && uv run pytest         # backend tests
cd web/viewer && npm run typecheck
```

The backend API is plain JSON under `/api/*` — see `src/shellm_web/server.py`
for the endpoint list. Trajectory semantics (step types, fork/merge links,
blob spillover) follow `design/trajectory_spec.md`.
