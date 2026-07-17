"""Append-aware trajectory cache + incremental mindlog endpoint."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from shellm_web import trajectory
from shellm_web.server import create_app

ROOT_TRAJ = "fbfbfbfb-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


def _step(i: int, **extra) -> dict:
    return {"type": "thought", "step_id": f"s{i:04d}", "content": f"idea {i}",
            "source": "inner_monologue", "ts": f"2026-07-17T10:{i % 60:02d}:00", **extra}


def _write(jsonl: Path, steps: list[dict], append: bool = False) -> None:
    mode = "a" if append else "w"
    with jsonl.open(mode) as fh:
        for s in steps:
            fh.write(json.dumps(s) + "\n")


@pytest.fixture
def traj_dir(tmp_path: Path) -> Path:
    d = tmp_path / "fbfbfbfb-root"
    d.mkdir()
    _write(d / "trajectory.jsonl", [{"type": "trajectory", "step_id": ROOT_TRAJ, "ts": "t0"}])
    return d


def test_incremental_matches_full_reparse(traj_dir: Path):
    jsonl = traj_dir / "trajectory.jsonl"
    cache = trajectory.TrajectoryCache()

    # grow the log in stages, including a run with trigger joins
    _write(jsonl, [_step(i) for i in range(1, 4)], append=True)
    first = cache.load(traj_dir)
    assert first["step_count"] == 4

    _write(jsonl, [
        {"type": "action", "step_id": "act1", "content": "do the thing",
         "source": "inner_monologue", "ts": "t"},
    ], append=True)
    cache.load(traj_dir)

    _write(jsonl, [
        {"type": "shellm-run", "step_id": "run1", "command": "shellm ...",
         "trigger_step": "act1", "ts": "t"},
        {"type": "reasoning", "step_id": "r1", "thought": "hm", "cmd": "ls",
         "run_id": "run1", "ts": "t"},
        {"type": "final", "step_id": "f1", "content": "done", "run_id": "run1", "ts": "t"},
    ], append=True)
    incremental = cache.load(traj_dir)
    full = trajectory.load_trajectory(traj_dir)

    assert incremental["step_count"] == full["step_count"] == 8
    assert incremental["steps"] == full["steps"]
    assert incremental["runs"] == full["runs"]
    # the run resolved its trigger and closed, across separate refreshes
    assert incremental["runs"][0]["trigger_step_id"] == "act1"
    assert incremental["runs"][0]["status"] == "done"


def test_torn_tail_deferred(traj_dir: Path):
    jsonl = traj_dir / "trajectory.jsonl"
    cache = trajectory.TrajectoryCache()
    _write(jsonl, [_step(1)], append=True)
    with jsonl.open("a") as fh:
        fh.write('{"type":"thought","step_id":"torn","content":"half')  # no newline
    body = cache.load(traj_dir)
    assert body["step_count"] == 2  # torn line not consumed
    with jsonl.open("a") as fh:
        fh.write(' written"}\n')
    body = cache.load(traj_dir)
    assert body["step_count"] == 3
    assert body["steps"][-1]["raw"]["content"] == "half written"


def test_replaced_file_resets(traj_dir: Path):
    jsonl = traj_dir / "trajectory.jsonl"
    cache = trajectory.TrajectoryCache()
    _write(jsonl, [_step(i) for i in range(1, 10)], append=True)
    assert cache.load(traj_dir)["step_count"] == 10

    # rewrite shorter (e.g. restored from backup)
    _write(jsonl, [{"type": "trajectory", "step_id": ROOT_TRAJ, "ts": "t0"}, _step(1)])
    assert cache.load(traj_dir)["step_count"] == 2


# ---------------------------------------------------------------------------
# Endpoint: ?since= deltas
# ---------------------------------------------------------------------------


@pytest.fixture
def ident_root(tmp_path: Path) -> Path:
    identity = tmp_path / ".identities" / "scaly"
    identity.mkdir(parents=True)
    (identity / "info.txt").write_text(
        f"name=scaly\ncreated=x\nroot_trajectory={ROOT_TRAJ}\n"
    )
    d = identity / "trajectories" / "fbfbfbfb-root"
    d.mkdir(parents=True)
    _write(
        d / "trajectory.jsonl",
        [{"type": "trajectory", "step_id": ROOT_TRAJ, "ts": "t0"}]
        + [_step(i) for i in range(1, 6)],
    )
    return tmp_path


def test_mindlog_since(ident_root: Path):
    client = TestClient(create_app(ident_root))
    url = "/api/identities/.identities~scaly/mindlog"

    full = client.get(url).json()
    assert full["step_count"] == 6
    assert len(full["steps"]) == 6
    assert full["since"] is None

    delta = client.get(f"{url}?since=6").json()
    assert delta["step_count"] == 6
    assert delta["steps"] == []
    assert delta["since"] == 6

    jsonl = (
        ident_root / ".identities" / "scaly" / "trajectories"
        / "fbfbfbfb-root" / "trajectory.jsonl"
    )
    _write(jsonl, [_step(6), _step(7)], append=True)
    delta = client.get(f"{url}?since=6").json()
    assert delta["step_count"] == 8
    assert [s["step_id"] for s in delta["steps"]] == ["s0006", "s0007"]
    assert delta["identity"]["name"] == "scaly"

    # runs ship as deltas too: only those touched by unseen steps
    _write(jsonl, [
        {"type": "shellm-run", "step_id": "runA", "command": "shellm big-prompt", "ts": "t"},
        {"type": "final", "step_id": "finA", "content": "done", "run_id": "runA", "ts": "t"},
    ], append=True)
    delta = client.get(f"{url}?since=8").json()
    assert [r["run_id"] for r in delta["runs"]] == ["runA"]
    assert delta["runs"][0]["status"] == "done"
    # once seen, an untouched run drops out of later deltas
    assert client.get(f"{url}?since=10").json()["runs"] == []
    # full fetches still carry every run
    assert [r["run_id"] for r in client.get(url).json()["runs"]] == ["runA"]

    # since beyond the log is an empty delta, not an error
    assert client.get(f"{url}?since=999").json()["steps"] == []
    # negative rejected
    assert client.get(f"{url}?since=-1").status_code == 422
