"""Self-update endpoint tests: real local git repos, restart stubbed."""

import json
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from shellm_web import server
from shellm_web.server import create_app

ROOT_TRAJ = "abababab-7777-4777-8777-777777777777"

_GIT_ENV = {
    "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
    "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t",
    "HOME": "/nonexistent",  # ignore user gitconfig
}


def _git(cwd: Path, *args: str) -> str:
    proc = subprocess.run(
        ["git", "-C", str(cwd), *args],
        capture_output=True, text=True, env={**_GIT_ENV, "PATH": "/usr/bin:/bin"},
    )
    assert proc.returncode == 0, proc.stderr
    return proc.stdout.strip()


@pytest.fixture
def serve_root(tmp_path: Path) -> Path:
    identity = tmp_path / "serve" / ".identities" / "upd"
    identity.mkdir(parents=True)
    (identity / "info.txt").write_text(
        f"name=upd\ncreated=2026-07-17T00:00:00\nroot_trajectory={ROOT_TRAJ}\n"
    )
    traj = identity / "trajectories" / "abababab-root"
    traj.mkdir(parents=True)
    (traj / "trajectory.jsonl").write_text(
        json.dumps({"type": "trajectory", "step_id": ROOT_TRAJ, "ts": "t0"}) + "\n"
    )
    return tmp_path / "serve"


@pytest.fixture
def code_repos(tmp_path: Path, monkeypatch) -> dict:
    """origin (bare) + workstation clone + 'box' clone, with restart/static
    plumbing stubbed onto the server module."""
    origin = tmp_path / "origin.git"
    origin.mkdir()
    _git(origin, "init", "--bare", "--initial-branch=main", ".")

    work = tmp_path / "work"
    _git(tmp_path, "clone", str(origin), str(work))
    (work / "README").write_text("v1\n")
    _git(work, "add", "README")
    _git(work, "commit", "-m", "c1")
    _git(work, "push", "-q", "origin", "main")

    box = tmp_path / "box"
    _git(tmp_path, "clone", str(origin), str(box))
    monkeypatch.setattr(server, "_CODE_REPO", box)

    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("built")
    monkeypatch.setattr(server, "_STATIC_DIR", static)

    restarts: list[bool] = []
    monkeypatch.setattr(server, "_schedule_restart", lambda *a, **k: restarts.append(True))
    return {"origin": origin, "work": work, "box": box, "static": static, "restarts": restarts}


def _push_commit(work: Path, name: str) -> str:
    (work / "README").write_text(f"{name}\n")
    _git(work, "add", "README")
    _git(work, "commit", "-m", name)
    _git(work, "push", "-q", "origin", "main")
    return _git(work, "rev-parse", "--short", "HEAD")


def test_self_update_pulls_and_restarts(serve_root: Path, code_repos: dict, monkeypatch):
    monkeypatch.setenv("SHELLM_WEB_SELF_UPDATE", "1")
    client = TestClient(create_app(serve_root))
    assert client.get("/api/config").json()["self_update_enabled"] is True

    new_commit = _push_commit(code_repos["work"], "c2")
    resp = client.post("/api/update")
    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["updated"] is True and body["restarting"] is True
    assert body["to_commit"] == new_commit
    # box repo actually advanced, frontend build removed, restart scheduled
    assert _git(code_repos["box"], "rev-parse", "--short", "HEAD") == new_commit
    assert not code_repos["static"].exists()
    assert code_repos["restarts"] == [True]

    # lock stays held after a successful update (process is about to exit)
    assert client.post("/api/update").status_code == 409


def test_self_update_noop_when_current(serve_root: Path, code_repos: dict, monkeypatch):
    monkeypatch.setenv("SHELLM_WEB_SELF_UPDATE", "1")
    client = TestClient(create_app(serve_root))
    resp = client.post("/api/update")
    assert resp.status_code == 202
    body = resp.json()
    assert body["updated"] is False and body["restarting"] is False
    assert code_repos["static"].exists()
    assert code_repos["restarts"] == []
    # lock released — retry allowed
    assert client.post("/api/update").status_code == 202


def test_self_update_git_failure_is_409_and_retryable(
    serve_root: Path, code_repos: dict, tmp_path: Path, monkeypatch
):
    monkeypatch.setenv("SHELLM_WEB_SELF_UPDATE", "1")
    # a repo with no upstream: pull fails
    lone = tmp_path / "lone"
    lone.mkdir()
    _git(lone, "init", "--initial-branch=main", ".")
    monkeypatch.setattr(server, "_CODE_REPO", lone)
    client = TestClient(create_app(serve_root))
    assert client.post("/api/update").status_code == 409
    assert client.post("/api/update").status_code == 409  # lock released, same error
    assert code_repos["restarts"] == []


def test_self_update_gating(serve_root: Path, code_repos: dict, monkeypatch):
    # flag unset -> 403, and config says so
    monkeypatch.delenv("SHELLM_WEB_SELF_UPDATE", raising=False)
    client = TestClient(create_app(serve_root))
    assert client.get("/api/config").json()["self_update_enabled"] is False
    assert client.post("/api/update").status_code == 403

    # read-only wins even with the flag set
    monkeypatch.setenv("SHELLM_WEB_SELF_UPDATE", "1")
    ro = TestClient(create_app(serve_root, read_only=True))
    assert ro.get("/api/config").json()["self_update_enabled"] is False
    assert ro.post("/api/update").status_code == 403
    assert code_repos["restarts"] == []
