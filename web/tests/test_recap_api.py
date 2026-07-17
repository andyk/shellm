"""Recap endpoint tests: cached-file serving + fire-and-forget refresh."""

import json
import stat
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from shellm_web import control
from shellm_web.server import create_app

ROOT_TRAJ = "cdcdcdcd-8888-4888-8888-888888888888"


@pytest.fixture
def recap_identity(tmp_path: Path) -> Path:
    identity = tmp_path / ".identities" / "rec"
    identity.mkdir(parents=True)
    (identity / "info.txt").write_text(
        f"name=rec\ncreated=2026-07-17T00:00:00\nroot_trajectory={ROOT_TRAJ}\n"
    )
    traj = identity / "trajectories" / "cdcdcdcd-root"
    traj.mkdir(parents=True)
    steps = [{"type": "trajectory", "step_id": ROOT_TRAJ, "ts": "t0"}]
    steps += [
        {"type": "thought", "step_id": f"aa{i:06d}", "content": f"t{i}", "ts": f"t{i}"}
        for i in range(1, 10)
    ]
    (traj / "trajectory.jsonl").write_text(
        "".join(json.dumps(s) + "\n" for s in steps)
    )
    return identity


def _write_cache(identity: Path, raw_end_line: int = 8) -> Path:
    cache = identity / "trajectories" / "cdcdcdcd-root" / "recap"
    cache.mkdir()
    (cache / "themes.json").write_text(json.dumps({
        "generated_at": "2026-07-17T12:00:00", "model": "test-model",
        "episodes": 1, "raw_end_line": raw_end_line, "total_lines": raw_end_line,
        "arc": "an arc", "themes": [{
            "name": "building", "description": "made things",
            "episodes": [1], "key_steps": [{"step": "aa000001", "note": "started"}],
        }],
    }))
    (cache / "episodes.jsonl").write_text(json.dumps({
        "idx": 1, "raw_start_line": 2, "raw_end_line": raw_end_line,
        "first_step": "aa000001", "last_step": "aa000007",
        "first_ts": "t1", "last_ts": "t7", "n_steps": 7, "partial": False,
        "model": "test-model", "created": "2026-07-17T12:00:00",
        "title": "an episode", "summary": "stuff happened",
        "themes": ["building"], "notable_steps": [{"step": "aa000003", "note": "peak"}],
    }) + "\n")
    return cache


@pytest.fixture
def client(recap_identity: Path) -> TestClient:
    return TestClient(create_app(recap_identity.parent.parent))


@pytest.fixture
def stub_bin(tmp_path: Path, monkeypatch) -> Path:
    stub = tmp_path / "stub-bin"
    stub.mkdir()
    script = stub / "recap"
    script.write_text(
        "#!/usr/bin/env bash\n"
        "{\n"
        '  echo "ARGS=$*"\n'
        '  echo "TRAJ_DIR=$TRAJ_DIR"\n'
        '  echo "TRAJ_ID=$TRAJ_ID"\n'
        f"}} >> {stub}/calls.txt\n"
    )
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setattr(control, "BIN_DIR", stub)
    return stub


def _wait_for_calls(stub: Path) -> str:
    for _ in range(50):
        if (stub / "calls.txt").exists():
            return (stub / "calls.txt").read_text()
        time.sleep(0.05)
    raise AssertionError("stub CLI was never invoked")


def test_recap_unavailable(client: TestClient):
    body = client.get("/api/identities/.identities~rec/recap").json()
    assert body == {
        "identity": {"id": ".identities~rec", "name": "rec"},
        "refreshing": False,
        "available": False,
    }


def test_recap_serves_cache(client: TestClient, recap_identity: Path):
    _write_cache(recap_identity)
    body = client.get("/api/identities/.identities~rec/recap").json()
    assert body["available"] is True
    assert body["themes"]["arc"] == "an arc"
    assert body["themes"]["themes"][0]["key_steps"][0]["step"] == "aa000001"
    assert body["episodes"][0]["title"] == "an episode"
    # trajectory has 10 lines, cache covers 8 -> 2 new steps
    assert body["new_steps"] == 2


def test_recap_reports_refreshing(client: TestClient, recap_identity: Path):
    cache = _write_cache(recap_identity)
    (cache / ".lock").mkdir()
    body = client.get("/api/identities/.identities~rec/recap").json()
    assert body["refreshing"] is True


def test_recap_refresh_fires_cli(client: TestClient, stub_bin: Path, recap_identity: Path):
    resp = client.post("/api/identities/.identities~rec/recap/refresh", json={})
    assert resp.status_code == 202, resp.text
    calls = _wait_for_calls(stub_bin)
    assert "ARGS=-q" in calls
    assert f"TRAJ_ID={ROOT_TRAJ}" in calls
    assert str(recap_identity / "trajectories") in calls


def test_recap_refresh_rebuild_flag(client: TestClient, stub_bin: Path):
    resp = client.post(
        "/api/identities/.identities~rec/recap/refresh", json={"rebuild": True}
    )
    assert resp.status_code == 202
    assert "--rebuild" in _wait_for_calls(stub_bin)


def test_recap_refresh_conflicts_with_lock(
    client: TestClient, stub_bin: Path, recap_identity: Path
):
    cache = _write_cache(recap_identity)
    (cache / ".lock").mkdir()
    resp = client.post("/api/identities/.identities~rec/recap/refresh", json={})
    assert resp.status_code == 409
    assert not (stub_bin / "calls.txt").exists()


def test_recap_read_only(recap_identity: Path, stub_bin: Path):
    _write_cache(recap_identity)
    ro = TestClient(create_app(recap_identity.parent.parent, read_only=True))
    assert ro.get("/api/identities/.identities~rec/recap").json()["available"] is True
    resp = ro.post("/api/identities/.identities~rec/recap/refresh", json={})
    assert resp.status_code == 403
