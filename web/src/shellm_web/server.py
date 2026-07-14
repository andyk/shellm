"""FastAPI app factory for the shellm web viewer."""

import logging
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from shellm_web import (
    chat,
    control,
    discovery,
    liveness,
    logs,
    safety,
    thinkers,
    trajectory,
    tree,
)

logger = logging.getLogger(__name__)

VERSION = "0.1.0"


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


class KillallBody(BaseModel):
    dry_run: bool = False


def create_app(
    root: Path, static_dir: Path | None = None, *, read_only: bool = False
) -> FastAPI:
    root = root.resolve()
    app = FastAPI(title="shellm web viewer", version=VERSION)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def _require_controls() -> None:
        if read_only:
            raise HTTPException(status_code=403, detail="Server is read-only")

    def _checked_thinker_names(identity: discovery.IdentityInfo, names: list[str]) -> None:
        installed = {d.name for d in thinkers.list_thinker_dirs(identity.path)}
        for name in names:
            if not safety.THINKER_NAME_RE.match(name):
                raise HTTPException(status_code=422, detail=f"Invalid thinker name: {name}")
            if name not in installed:
                raise HTTPException(status_code=404, detail=f"Thinker not found: {name}")

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/api/config")
    def config() -> dict:
        return {"root": str(root), "version": VERSION, "controls_enabled": not read_only}

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
        if not thinkers.list_thinker_dirs(identity.path):
            raise HTTPException(status_code=409, detail="Identity has no thinkers")
        _checked_thinker_names(identity, body.names)
        return control.thinkers_start(root, identity, body.names, body.no_self_trigger)

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
