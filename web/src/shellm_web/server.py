"""FastAPI app factory for the shellm web viewer."""

import json
import logging
import os
import re
import shutil
import signal
import subprocess
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.background import BackgroundTask

from shellm_web import (
    chat,
    control,
    discovery,
    envfile,
    liveness,
    logs,
    safety,
    thinkers,
    trajectory,
    tree,
)

logger = logging.getLogger(__name__)

VERSION = "0.1.0"

# The repo the running server code lives in (…/web/src/shellm_web/server.py)
_CODE_REPO = Path(__file__).resolve().parents[3]

# The built frontend; deleting it makes the next startup rebuild (see cli.py).
_STATIC_DIR = Path(__file__).resolve().parent / "static"


def _schedule_restart(delay: float = 0.75) -> None:
    """Exit shortly after the current response flushes. Under systemd
    (Restart=always) the service comes back on the freshly pulled code and
    rebuilds static/; without a supervisor the process just stops."""
    threading.Timer(delay, lambda: os.kill(os.getpid(), signal.SIGTERM)).start()


def _git_info() -> dict[str, str | None]:
    """commit/branch of the code repo, or Nones outside a git checkout."""

    def rev_parse(*args: str) -> str | None:
        try:
            proc = subprocess.run(
                ["git", "-C", str(_CODE_REPO), "rev-parse", *args],
                capture_output=True, text=True, timeout=5,
            )
        except (OSError, subprocess.TimeoutExpired):
            return None
        return proc.stdout.strip() or None if proc.returncode == 0 else None

    return {
        "git_commit": rev_parse("--short", "HEAD"),
        "git_branch": rev_parse("--abbrev-ref", "HEAD"),
    }


def _identity_or_404(root: Path, identity_id: str) -> discovery.IdentityInfo:
    try:
        return discovery.resolve_identity(root, identity_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Identity not found") from None


def _count_steps(jsonl: Path) -> int:
    try:
        with jsonl.open("rb") as fh:
            return sum(1 for line in fh if line.strip())
    except OSError:
        return 0


def _iso(ts: float | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


class ThinkerActionBody(BaseModel):
    names: list[str] = []
    no_self_trigger: bool = False


class ChatSendBody(BaseModel):
    content: str
    from_name: str


class NewIdentityBody(BaseModel):
    name: str


class RecapRefreshBody(BaseModel):
    rebuild: bool = False


class KillallBody(BaseModel):
    dry_run: bool = False


class EnvVarBody(BaseModel):
    key: str
    value: str


def create_app(
    root: Path, static_dir: Path | None = None, *, read_only: bool = False
) -> FastAPI:
    root = root.resolve()
    app = FastAPI(title="shellm web viewer", version=VERSION)
    # Default "*" suits local use; deployments should pin this to their
    # public origin(s) via SHELLM_WEB_ALLOWED_ORIGINS (comma-separated).
    allowed_origins = [
        origin.strip()
        for origin in os.environ.get("SHELLM_WEB_ALLOWED_ORIGINS", "*").split(",")
        if origin.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def _require_controls() -> None:
        if read_only:
            raise HTTPException(status_code=403, detail="Server is read-only")

    def _checked_thinker_names(identity: discovery.IdentityInfo, names: list[str]) -> None:
        enabled = {d.name for d in thinkers.list_thinker_dirs(identity.path)}
        installed = {
            d.name for d in thinkers.list_thinker_dirs(identity.path, include_disabled=True)
        }
        for name in names:
            if not safety.THINKER_NAME_RE.match(name):
                raise HTTPException(status_code=422, detail=f"Invalid thinker name: {name}")
            if name not in installed:
                raise HTTPException(status_code=404, detail=f"Thinker not found: {name}")
            if name not in enabled:
                raise HTTPException(
                    status_code=409,
                    detail=f"Thinker '{name}' is disabled — enable it first",
                )

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok"}

    # Resolved once at startup: the code can't change under a running server
    # (both update paths restart the service after pulling).
    git_info = _git_info()

    # Opt-in: the dash can pull its own repo and restart itself. Enabled on
    # the demo deployment (systemd restarts it); off by default elsewhere —
    # without a supervisor the process would just exit.
    self_update_enabled = (
        os.environ.get("SHELLM_WEB_SELF_UPDATE") == "1" and not read_only
    )
    update_lock = threading.Lock()

    @app.get("/api/config")
    def config() -> dict:
        return {
            "root": str(root),
            "version": VERSION,
            "controls_enabled": not read_only,
            "self_update_enabled": self_update_enabled,
            **git_info,
        }

    @app.post("/api/update", status_code=202)
    def self_update() -> dict:
        _require_controls()
        if not self_update_enabled:
            raise HTTPException(
                status_code=403,
                detail="Self-update is disabled (set SHELLM_WEB_SELF_UPDATE=1)",
            )
        if not update_lock.acquire(blocking=False):
            raise HTTPException(status_code=409, detail="Update already in progress")
        # On success the lock is held until the process exits — by design.
        keep_locked = False
        try:
            try:
                proc = subprocess.run(
                    ["git", "-C", str(_CODE_REPO), "pull", "--ff-only"],
                    capture_output=True, text=True, timeout=180,
                )
            except (OSError, subprocess.TimeoutExpired) as exc:
                raise HTTPException(
                    status_code=500, detail=f"git pull failed: {exc}"
                ) from exc
            if proc.returncode != 0:
                stderr_lines = [l for l in (proc.stderr or "").splitlines() if l.strip()]
                raise HTTPException(
                    status_code=409,
                    detail={
                        "message": stderr_lines[-1] if stderr_lines else "git pull failed",
                        "stderr": proc.stderr,
                    },
                )
            new_commit = _git_info()["git_commit"]
            if new_commit == git_info["git_commit"]:
                return {
                    "ok": True,
                    "updated": False,
                    "commit": new_commit,
                    "restarting": False,
                }
            shutil.rmtree(_STATIC_DIR, ignore_errors=True)
            _schedule_restart()
            keep_locked = True
            return {
                "ok": True,
                "updated": True,
                "from_commit": git_info["git_commit"],
                "to_commit": new_commit,
                "restarting": True,
            }
        finally:
            if not keep_locked:
                update_lock.release()

    @app.get("/api/identities")
    def identities() -> list[dict]:
        result = []
        for identity in discovery.scan_identities(root):
            traj_dir = discovery.find_root_traj_dir(identity)
            jsonl = traj_dir / "trajectory.jsonl" if traj_dir else None
            status = liveness.identity_status(identity.path, jsonl)
            summary = thinkers.thinkers_summary(identity.path)
            result.append(
                {
                    "id": identity.id,
                    "name": identity.name,
                    "path_rel": identity.path_rel,
                    "created": identity.created,
                    "root_trajectory": identity.root_trajectory,
                    "group": identity.group,
                    "live": status["live"],
                    "last_activity_ts": _iso(status["mindlog_mtime"]),
                    "step_count": _count_steps(jsonl) if jsonl else 0,
                    **summary,
                }
            )
        result.sort(key=lambda item: item["last_activity_ts"] or "", reverse=True)
        return result

    @app.get("/api/identities/{identity_id}/status")
    def identity_status(identity_id: str) -> dict:
        identity = _identity_or_404(root, identity_id)
        traj_dir = discovery.find_root_traj_dir(identity)
        jsonl = traj_dir / "trajectory.jsonl" if traj_dir else None
        status = liveness.identity_status(identity.path, jsonl)
        status["step_count"] = _count_steps(jsonl) if jsonl else 0
        status["mindlog_mtime"] = _iso(status["mindlog_mtime"])
        return status

    @app.get("/api/identities/{identity_id}/mindlog")
    def mindlog(identity_id: str) -> dict:
        identity = _identity_or_404(root, identity_id)
        traj_dir = discovery.find_root_traj_dir(identity)
        if traj_dir is None:
            raise HTTPException(status_code=404, detail="No mind log trajectory found")
        result = trajectory.load_trajectory(traj_dir)
        jsonl = traj_dir / "trajectory.jsonl"
        status = liveness.identity_status(identity.path, jsonl)
        result["live"] = status["live"]
        result["dir_rel"] = traj_dir.relative_to(identity.path).as_posix()
        result["identity"] = {"id": identity.id, "name": identity.name}
        return result

    def _root_traj_dir_or_404(identity: discovery.IdentityInfo):
        traj_dir = discovery.find_root_traj_dir(identity)
        if traj_dir is None:
            raise HTTPException(status_code=404, detail="No mind log trajectory found")
        return traj_dir

    @app.get("/api/identities/{identity_id}/tree")
    def identity_tree(
        identity_id: str,
        node: str | None = Query(default=None),
        depth: int = Query(default=2, ge=0, le=6),
    ) -> dict:
        identity = _identity_or_404(root, identity_id)
        root_traj_dir = _root_traj_dir_or_404(identity)
        target = root_traj_dir
        if node:
            found = tree.find_traj_dir(root_traj_dir, node)
            if found is None:
                raise HTTPException(status_code=404, detail="Trajectory not found")
            target = found
        return tree.build_tree(target, depth)

    @app.get("/api/identities/{identity_id}/traj/{traj_id}")
    def sub_trajectory(identity_id: str, traj_id: str) -> dict:
        identity = _identity_or_404(root, identity_id)
        root_traj_dir = _root_traj_dir_or_404(identity)
        traj_dir = tree.find_traj_dir(root_traj_dir, traj_id)
        if traj_dir is None:
            raise HTTPException(status_code=404, detail="Trajectory not found")
        result = trajectory.load_trajectory(traj_dir)
        result["breadcrumb"] = tree.breadcrumb(root_traj_dir, traj_dir)
        first = result["steps"][0]["raw"] if result["steps"] else {}
        parent_traj = first.get("parent_traj")
        result["parent"] = (
            {"traj_id": parent_traj, "step_id": first.get("parent_step")}
            if parent_traj
            else None
        )
        result["identity"] = {"id": identity.id, "name": identity.name}
        result["dir_rel"] = traj_dir.relative_to(identity.path).as_posix()
        status = liveness.identity_status(identity.path, traj_dir / "trajectory.jsonl")
        result["live"] = status["live"]
        return result

    @app.get("/api/identities/{identity_id}/traj/{traj_id}/blob/{name}")
    def blob(
        identity_id: str,
        traj_id: str,
        name: str,
        head: int = Query(default=262144, ge=1, le=8 * 1024 * 1024),
    ) -> Response:
        identity = _identity_or_404(root, identity_id)
        root_traj_dir = _root_traj_dir_or_404(identity)
        traj_dir = tree.find_traj_dir(root_traj_dir, traj_id)
        if traj_dir is None:
            raise HTTPException(status_code=404, detail="Trajectory not found")
        safety.checked_name(name, safety.BLOB_NAME_RE)
        blob_path = safety.contained_path(traj_dir / "blobs", name)
        if not blob_path.is_file():
            raise HTTPException(status_code=404, detail="Blob not found")
        total = blob_path.stat().st_size
        with blob_path.open("rb") as fh:
            data = fh.read(head)
        return Response(
            content=data,
            media_type="text/plain; charset=utf-8",
            headers={
                "X-Blob-Bytes": str(total),
                "X-Blob-Truncated": "1" if total > head else "0",
            },
        )

    @app.get("/api/identities/{identity_id}/logs")
    def identity_logs(identity_id: str) -> list[dict]:
        identity = _identity_or_404(root, identity_id)
        return logs.list_logs(identity.path)

    @app.get("/api/identities/{identity_id}/logs/{name}")
    def identity_log(
        identity_id: str,
        name: str,
        tail_bytes: int = Query(default=65536, ge=1, le=8 * 1024 * 1024),
    ) -> dict:
        identity = _identity_or_404(root, identity_id)
        safety.checked_name(name, safety.LOG_NAME_RE)
        log_path = safety.contained_path(identity.path / "run" / "logs", name)
        if not log_path.is_file():
            raise HTTPException(status_code=404, detail="Log not found")
        return logs.tail_log(log_path, tail_bytes)

    @app.get("/api/identities/{identity_id}/dispatch")
    def identity_dispatch(identity_id: str) -> list[dict]:
        identity = _identity_or_404(root, identity_id)
        return logs.parse_dispatch_log(identity.path)

    @app.get("/api/identities/{identity_id}/memories")
    def identity_memories(identity_id: str) -> list[dict]:
        identity = _identity_or_404(root, identity_id)
        mem_dir = identity.path / "memories"
        if not mem_dir.is_dir():
            return []
        result = []
        for path in sorted(mem_dir.glob("*.md"), reverse=True):
            result.append({"name": path.name, "mtime": path.stat().st_mtime})
        return result

    @app.get("/api/identities/{identity_id}/memories/{name}")
    def identity_memory(identity_id: str, name: str) -> dict:
        identity = _identity_or_404(root, identity_id)
        safety.checked_name(name, safety.MEMORY_NAME_RE)
        memory_path = safety.contained_path(identity.path / "memories", name)
        if not memory_path.is_file():
            raise HTTPException(status_code=404, detail="Memory not found")
        return {"name": name, "content": memory_path.read_text(encoding="utf-8", errors="replace")}

    @app.get("/api/identities/{identity_id}/recap")
    def identity_recap(identity_id: str) -> dict:
        """Serve the cached recap (bin/recap output) for the mind log."""
        identity = _identity_or_404(root, identity_id)
        traj_dir = _root_traj_dir_or_404(identity)
        cache = traj_dir / "recap"
        refreshing = (cache / ".lock").is_dir()
        base = {
            "identity": {"id": identity.id, "name": identity.name},
            "refreshing": refreshing,
        }
        themes_file = cache / "themes.json"
        episodes_file = cache / "episodes.jsonl"
        if not themes_file.is_file():
            return {**base, "available": False}
        try:
            themes = json.loads(themes_file.read_text())
            episodes = [
                json.loads(line)
                for line in episodes_file.read_text().splitlines()
                if line.strip()
            ]
        except (OSError, ValueError):
            return {**base, "available": False}
        total_lines = _count_steps(traj_dir / "trajectory.jsonl")
        return {
            **base,
            "available": True,
            "themes": themes,
            "episodes": episodes,
            "new_steps": max(0, total_lines - int(themes.get("raw_end_line") or 0)),
        }

    @app.post("/api/identities/{identity_id}/recap/refresh", status_code=202)
    def identity_recap_refresh(identity_id: str, body: RecapRefreshBody) -> dict:
        _require_controls()
        identity = _identity_or_404(root, identity_id)
        _root_traj_dir_or_404(identity)
        cache_lock = None
        traj_dir = discovery.find_root_traj_dir(identity)
        if traj_dir is not None:
            cache_lock = traj_dir / "recap" / ".lock"
        if cache_lock is not None and cache_lock.is_dir():
            raise HTTPException(status_code=409, detail="A recap is already running")
        return control.recap_refresh(root, identity, body.rebuild)

    @app.get("/api/identities/{identity_id}/thinkers")
    def identity_thinkers(identity_id: str) -> dict:
        identity = _identity_or_404(root, identity_id)
        result = thinkers.thinkers_status(identity.path)
        for entry in result["thinkers"]:
            entry["log_mtime"] = _iso(entry["log_mtime"])
        result["identity"] = {"id": identity.id, "name": identity.name}
        return result

    @app.post("/api/identities/{identity_id}/thinkers/start")
    def thinkers_start(identity_id: str, body: ThinkerActionBody) -> dict:
        _require_controls()
        identity = _identity_or_404(root, identity_id)
        enabled = thinkers.list_thinker_dirs(identity.path)
        if not enabled:
            raise HTTPException(status_code=409, detail="Identity has no thinkers")
        _checked_thinker_names(identity, body.names)
        # Expand "start all" to explicit names: the CLI's named-start path
        # kicks each thinker once with a manual-trigger step, while its
        # start-all path only arms the dispatcher — thinkers would then sit
        # idle until some new trajectory step happens to arrive.
        names = body.names or [d.name for d in enabled]
        return control.thinkers_start(root, identity, names, body.no_self_trigger)

    @app.post("/api/identities/{identity_id}/thinkers/stop")
    def thinkers_stop(identity_id: str, body: ThinkerActionBody) -> dict:
        _require_controls()
        identity = _identity_or_404(root, identity_id)
        _checked_thinker_names(identity, body.names)
        return control.thinkers_stop(root, identity, body.names)

    @app.post("/api/identities/{identity_id}/thinkers/{name}/step", status_code=202)
    def thinkers_step(identity_id: str, name: str) -> dict:
        _require_controls()
        identity = _identity_or_404(root, identity_id)
        _checked_thinker_names(identity, [name])
        return control.thinkers_step(root, identity, name)

    def _thinker_dir_or_404(identity: discovery.IdentityInfo, name: str) -> Path:
        if not safety.THINKER_NAME_RE.match(name):
            raise HTTPException(status_code=422, detail=f"Invalid thinker name: {name}")
        for tdir in thinkers.list_thinker_dirs(identity.path, include_disabled=True):
            if tdir.name == name:
                return tdir
        raise HTTPException(status_code=404, detail=f"Thinker not found: {name}")

    @app.post("/api/identities/{identity_id}/thinkers/{name}/disable")
    def thinkers_disable(identity_id: str, name: str) -> dict:
        _require_controls()
        identity = _identity_or_404(root, identity_id)
        tdir = _thinker_dir_or_404(identity, name)
        status = thinkers.thinkers_status(identity.path)
        entry = next(t for t in status["thinkers"] if t["name"] == name)
        stopped = False
        if entry["state"] not in ("stopped", "disabled"):
            control.thinkers_stop(root, identity, [name])
            stopped = True
        (tdir / "disabled").touch()
        return {"ok": True, "name": name, "disabled": True, "stopped_first": stopped}

    @app.post("/api/identities/{identity_id}/thinkers/{name}/enable")
    def thinkers_enable(identity_id: str, name: str) -> dict:
        _require_controls()
        identity = _identity_or_404(root, identity_id)
        tdir = _thinker_dir_or_404(identity, name)
        (tdir / "disabled").unlink(missing_ok=True)
        # The dispatcher builds its subscription map at startup; a thinker
        # enabled while it runs won't receive events until a restart.
        dispatcher_running = thinkers.thinkers_status(identity.path)["dispatcher"]["running"]
        return {
            "ok": True,
            "name": name,
            "disabled": False,
            "needs_restart": dispatcher_running,
        }

    @app.get("/api/identities/{identity_id}/chat")
    def identity_chat(
        identity_id: str, tail: int = Query(default=200, ge=1, le=2000)
    ) -> dict:
        identity = _identity_or_404(root, identity_id)
        traj_dir = _root_traj_dir_or_404(identity)
        status = liveness.identity_status(identity.path, traj_dir / "trajectory.jsonl")
        return {
            "identity": {"id": identity.id, "name": identity.name},
            "live": status["live"],
            "messages": chat.chat_messages(traj_dir, identity.name, tail),
        }

    @app.post("/api/identities/{identity_id}/chat")
    def identity_chat_send(identity_id: str, body: ChatSendBody) -> dict:
        _require_controls()
        identity = _identity_or_404(root, identity_id)
        if not body.content.strip():
            raise HTTPException(status_code=422, detail="Empty message")
        if not safety.CHAT_FROM_RE.match(body.from_name):
            raise HTTPException(status_code=422, detail="Invalid sender name")
        return control.chat_send(root, identity, body.content, body.from_name)

    # -- Import / export ---------------------------------------------------
    # Archives are produced/consumed by `identity export` / `identity import`
    # (bin/identity); the endpoints only move bytes. Export stays available in
    # read-only mode: it reveals nothing the viewer doesn't already show, and
    # it doubles as the backup path.

    def _export_download(tmp: Path, basename: str) -> FileResponse:
        safe = re.sub(r"[^A-Za-z0-9._-]", "-", basename) or "identity"
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        return FileResponse(
            tmp,
            media_type="application/gzip",
            filename=f"{safe}-{stamp}.shellm.tgz",
            background=BackgroundTask(tmp.unlink, missing_ok=True),
        )

    @app.get("/api/identities/{identity_id}/export")
    def export_identity(
        identity_id: str, soul_only: bool = Query(default=False)
    ) -> FileResponse:
        identity = _identity_or_404(root, identity_id)
        tmp = control.identity_export(root, identity, soul_only)
        return _export_download(tmp, identity.name)

    @app.get("/api/export")
    def export_all_identities(soul_only: bool = Query(default=False)) -> FileResponse:
        tmp = control.identity_export_all(root, soul_only)
        return _export_download(tmp, "identities")

    @app.post("/api/identities/import", status_code=201)
    async def import_identities(
        request: Request, name: str | None = Query(default=None)
    ) -> dict:
        _require_controls()
        if name is not None and not safety.IDENTITY_NAME_RE.match(name):
            raise HTTPException(
                status_code=422,
                detail="Invalid identity name (use lowercase alphanumeric + hyphens)",
            )
        max_bytes = int(os.environ.get("SHELLM_WEB_MAX_IMPORT_MB", "512")) * 1024 * 1024
        fd, tmp_name = tempfile.mkstemp(suffix=".shellm.tgz")
        tmp = Path(tmp_name)
        total = 0
        first_chunk = b""
        try:
            with os.fdopen(fd, "wb") as out:
                async for chunk in request.stream():
                    if not first_chunk:
                        first_chunk = chunk
                    total += len(chunk)
                    if total > max_bytes:
                        raise HTTPException(
                            status_code=413,
                            detail=f"Archive exceeds SHELLM_WEB_MAX_IMPORT_MB ({max_bytes // (1024 * 1024)} MB)",
                        )
                    out.write(chunk)
            if not first_chunk.startswith(b"\x1f\x8b"):
                raise HTTPException(
                    status_code=422, detail="Not a gzip archive (.shellm.tgz expected)"
                )
            return await run_in_threadpool(control.identity_import, root, tmp, name)
        finally:
            tmp.unlink(missing_ok=True)

    @app.post("/api/identities", status_code=201)
    def create_identity(body: NewIdentityBody) -> dict:
        _require_controls()
        if not safety.IDENTITY_NAME_RE.match(body.name):
            raise HTTPException(
                status_code=422,
                detail="Invalid identity name (use lowercase alphanumeric + hyphens)",
            )
        return control.identity_new(root, body.name)

    @app.post("/api/killall")
    def api_killall(body: KillallBody) -> dict:
        _require_controls()
        return control.killall(body.dry_run)

    @app.get("/api/identities/{identity_id}/env")
    def identity_env_get(identity_id: str) -> dict:
        identity = _identity_or_404(root, identity_id)
        own = [
            envfile.redacted_entry(key, value)
            for key, value in envfile.parse_env_file(identity.path / ".env")
        ]
        own_keys = {entry["key"] for entry in own}
        inherited = [
            {**envfile.redacted_entry(key, value), "overridden": key in own_keys}
            for key, value in envfile.parse_env_file(root / ".env")
        ]
        return {
            "identity": {"id": identity.id, "name": identity.name},
            "env": own,
            "inherited": inherited,
            "note": "Changes take effect the next time thinkers are started.",
        }

    @app.put("/api/identities/{identity_id}/env")
    def identity_env_put(identity_id: str, body: EnvVarBody) -> dict:
        _require_controls()
        identity = _identity_or_404(root, identity_id)
        if not envfile.ENV_KEY_RE.match(body.key):
            raise HTTPException(
                status_code=422,
                detail="Invalid variable name (letters, digits, underscores)",
            )
        if any(ch in body.value for ch in "\n\r\x00"):
            raise HTTPException(status_code=422, detail="Value must be a single line")
        envfile.upsert_env_var(identity.path / ".env", body.key, body.value)
        return {"ok": True, **envfile.redacted_entry(body.key, body.value)}

    @app.delete("/api/identities/{identity_id}/env/{key}")
    def identity_env_delete(identity_id: str, key: str) -> dict:
        _require_controls()
        identity = _identity_or_404(root, identity_id)
        if not envfile.ENV_KEY_RE.match(key):
            raise HTTPException(status_code=422, detail="Invalid variable name")
        removed = envfile.delete_env_var(identity.path / ".env", key)
        if not removed:
            raise HTTPException(status_code=404, detail="Variable not found")
        return {"ok": True, "key": key}

    # Static frontend (registered last so /api wins)
    if static_dir and static_dir.exists():
        assets_dir = static_dir / "assets"
        if assets_dir.exists():
            app.mount("/assets", StaticFiles(directory=assets_dir), name="static_assets")

        @app.get("/favicon.ico")
        def favicon() -> FileResponse:
            return FileResponse(static_dir / "favicon.ico")

        @app.get("/{path:path}")
        def serve_spa(path: str) -> FileResponse:
            return FileResponse(static_dir / "index.html")

    return app
