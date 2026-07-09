"""Run-grouping regression tests against real trajectories in this repo."""

from pathlib import Path

import pytest

from shellm_web import discovery
from shellm_web.trajectory import load_trajectory, step_preview

REPO = Path(__file__).parents[2]
GEN1 = REPO / "improve" / "generations" / "gen-001" / "identities"
BOTNICK = REPO / ".identities" / "botnick"


def _root_traj_dir(identity_dir: Path) -> Path:
    identities = discovery.scan_identities(identity_dir.parent)
    matches = [i for i in identities if i.path == identity_dir]
    assert matches, f"identity not discovered: {identity_dir}"
    traj_dir = discovery.find_root_traj_dir(matches[0])
    assert traj_dir is not None
    return traj_dir


needs_gen1 = pytest.mark.skipif(not GEN1.is_dir(), reason="gen-001 data not present")
needs_botnick = pytest.mark.skipif(not BOTNICK.is_dir(), reason="botnick data not present")


@needs_gen1
def test_g001r1_single_unclosed_run():
    result = load_trajectory(_root_traj_dir(GEN1 / "g001r1"))
    assert result["step_count"] == 41
    assert len(result["runs"]) == 1
    run = result["runs"][0]
    # 1 shellm-run + 1 prompt + 4 reasoning + 4 shell-output, no final in this session
    assert len(run["step_ids"]) == 10
    assert run["status"] == "running"
    assert run["confidence"] == "exact"
    # the action -> run join must land
    assert run["action_step_id"] is not None
    action = next(s for s in result["steps"] if s["step_id"] == run["action_step_id"])
    assert action["type"] == "action"


@needs_gen1
def test_g001r2_three_closed_runs_all_joined():
    result = load_trajectory(_root_traj_dir(GEN1 / "g001r2"))
    runs = result["runs"]
    assert len(runs) == 3
    assert all(run["status"] == "done" for run in runs)
    assert all(run["action_step_id"] for run in runs)
    # each run's action is distinct
    assert len({run["action_step_id"] for run in runs}) == 3
    # machinery steps are all attributed to some run
    machinery = [
        s
        for s in result["steps"]
        if s["source"] is None
        and s["type"] in {"shellm-run", "prompt", "reasoning", "shell-output", "final"}
    ]
    assert all(s["run_id"] for s in machinery)
    # thinker steps are never swallowed into runs
    thinker = [s for s in result["steps"] if s["source"] is not None]
    assert all(s["run_id"] is None for s in thinker)


@needs_botnick
def test_botnick_fork_era():
    result = load_trajectory(_root_traj_dir(BOTNICK))
    assert result["step_count"] == 953
    # fork era: no inline machinery in the mind log
    assert result["runs"] == []
    forks = [s for s in result["steps"] if s["type"] == "fork"]
    assert len(forks) == 173
    assert all(s["fork"]["resolved"] for s in forks)
    writebacks = [s for s in result["steps"] if "writeback" in s]
    assert len(writebacks) == 142
    # a fork's child trajectory really is a child of this root
    fork = forks[0]
    traj_dir = _root_traj_dir(BOTNICK)
    child = load_trajectory(traj_dir / fork["fork"]["slug"])
    first = child["steps"][0]["raw"]
    assert first["parent_traj"] == result["traj_id"]


def test_previews():
    assert step_preview({"type": "reasoning", "thought": "look", "cmd": "ls  -la\n"}) == "look | ls -la"
    assert step_preview({"type": "final", "content": "done"}) == "done"
    assert step_preview({"type": "fork", "child": "abc", "child_ref": "abc123-x/trajectory.jsonl"}).startswith("-> abc123-x")
    assert step_preview({"type": "trajectory"}) == "root"
    assert step_preview({"type": "trajectory", "parent_traj": "0123456789"}) == "<- parent: 01234567"
    assert step_preview({"type": "shell-output", "exit": 0, "stdout": "hi"}) == "exit 0 · hi"


def test_blob_fields_survive_normalization():
    raw = {
        "type": "shell-output",
        "step_id": "s1",
        "ts": "2026-01-01T00:00:00+0000",
        "exit": 0,
        "stdout": "head...",
        "stdout_ref": "blobs/s1-000000.stdout",
        "stdout_bytes": 16290,
        "stdout_truncated": True,
    }
    from shellm_web.trajectory import normalize

    result = normalize([raw], Path("/nonexistent"))
    step = result["steps"][0]
    assert step["raw"]["stdout_truncated"] is True
    assert step["raw"]["stdout_ref"] == "blobs/s1-000000.stdout"
