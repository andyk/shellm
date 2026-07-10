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
def test_g001r1_legacy_log_run_header_only():
    """Pre-run_id logs: the shellm-run header still opens a group (it knows
    its own id) and the action join still lands, but machinery steps carry
    no run_id and stay ungrouped in the stream."""
    result = load_trajectory(_root_traj_dir(GEN1 / "g001r1"))
    assert result["step_count"] == 41
    assert len(result["runs"]) == 1
    run = result["runs"][0]
    assert run["step_ids"] == [run["run_id"]]
    assert run["status"] == "running"
    # the action -> run join must land
    assert run["trigger_step_id"] is not None
    action = next(s for s in result["steps"] if s["step_id"] == run["trigger_step_id"])
    assert action["type"] == "action"


@needs_gen1
def test_g001r2_legacy_machinery_stays_ungrouped():
    result = load_trajectory(_root_traj_dir(GEN1 / "g001r2"))
    runs = result["runs"]
    assert len(runs) == 3
    assert all(run["trigger_step_id"] for run in runs)
    # each run's action is distinct
    assert len({run["trigger_step_id"] for run in runs}) == 3
    # legacy machinery carries no run_id -> ignored for grouping, never lost
    machinery = [
        s
        for s in result["steps"]
        if s["source"] is None
        and s["type"] in {"prompt", "reasoning", "shell-output", "final"}
    ]
    assert machinery
    assert all(s["run_id"] is None for s in machinery)
    # without run_id-stamped finals, legacy runs never close
    assert all(run["status"] == "running" for run in runs)
    # thinker steps are never swallowed into runs
    thinker = [s for s in result["steps"] if s["source"] is not None]
    assert all(s["run_id"] is None for s in thinker)


def _step(step_type, step_id, ts="2026-07-10T12:00:00.000-0700", **fields):
    return {"type": step_type, "step_id": step_id, "ts": ts, **fields}


def test_run_id_grouping_exact_with_interleaved_runs():
    """New-format logs: membership comes from the explicit run_id stamp,
    so two concurrent runs interleaving in one mind log group exactly —
    the case the old stack heuristic could not attribute."""
    from shellm_web.trajectory import normalize

    raw = [
        _step("trajectory", "t0"),
        _step("action", "a1", source="inner_monologue", content="measure disk usage"),
        _step("shellm-run", "r1", command="shellm --traj t0 ... ACTION: measure disk usage"),
        _step("prompt", "p1", content="...", run_id="r1"),
        _step("action", "a2", source="inner_monologue", content="please tidy the notes directory"),
        # trigger_step joins exactly even though the ACTION text would not
        # prefix-match the action content
        _step("shellm-run", "r2", command="shellm --traj t0 ... ACTION: tidy notes", trigger_step="a2"),
        _step("reasoning", "s1", thought="du", cmd="du -sh .", run_id="r1"),
        _step("reasoning", "s2", thought="ls", cmd="ls notes/", run_id="r2"),
        _step("thought", "th1", source="inner_monologue", content="both running"),
        _step("shell-output", "o2", stdout="a.md", exit=0, run_id="r2"),
        _step("shell-output", "o1", stdout="1.2G", exit=0, run_id="r1"),
        _step("final", "f2", content="tidied", run_id="r2", ts="2026-07-10T12:00:05.000-0700"),
        _step("final", "f1", content="1.2G", run_id="r1", ts="2026-07-10T12:00:06.000-0700"),
        _step("run-summary", "sum1", tldr="Measured disk usage", run_id="r1"),
        # unknown run_id: ignored, not crashed on
        _step("prompt", "px", content="orphan", run_id="r-gone"),
    ]
    result = normalize(raw, Path("/nonexistent"))
    runs = {run["run_id"]: run for run in result["runs"]}
    assert set(runs) == {"r1", "r2"}
    assert runs["r1"]["step_ids"] == ["r1", "p1", "s1", "o1", "f1", "sum1"]
    assert runs["r2"]["step_ids"] == ["r2", "s2", "o2", "f2"]
    assert runs["r1"]["status"] == "done" and runs["r2"]["status"] == "done"
    assert runs["r1"]["ended_ts"] == "2026-07-10T12:00:06.000-0700"
    # run-summary lands on the right run even though r2 closed in between
    assert runs["r1"]["tldr"] == "Measured disk usage"
    assert runs["r2"]["tldr"] is None
    # action joins: legacy prefix fallback for r1, exact trigger_step for r2
    assert runs["r1"]["trigger_step_id"] == "a1"
    assert runs["r2"]["trigger_step_id"] == "a2"
    # thinker steps untouched; orphan machinery ungrouped but present
    steps = {s["step_id"]: s for s in result["steps"]}
    assert steps["th1"]["run_id"] is None
    assert steps["px"]["run_id"] is None


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
    # merge write-backs carry the child's answer; bare CLI merges fall back to the uuid
    assert step_preview({"type": "merge", "content": "sub done", "from_traj": "abc"}) == "<- sub done"
    assert step_preview({"type": "merge", "from_traj": "abc"}) == "<- abc"


def test_launched_by_and_nonaction_triggers():
    """launched_by is surfaced on the run group, and trigger_step joins any
    step type (a monologue thought triggering a generic thinker's run), with
    one step able to trigger several runs."""
    from shellm_web.trajectory import normalize

    raw = [
        _step("trajectory", "t0"),
        _step("thought", "th1", source="inner_monologue", content="I learned something"),
        _step("shellm-run", "r1", command="shellm --traj t0 ...", trigger_step="th1", launched_by="learning"),
        _step("shellm-run", "r2", command="shellm --traj t0 ...", trigger_step="th1", launched_by="goals_manager"),
        _step("final", "f1", content="noted", run_id="r1"),
        _step("final", "f2", content="no goals change", run_id="r2"),
        # unknown trigger id: join skipped, not guessed
        _step("shellm-run", "r3", command="shellm --traj t0 ...", trigger_step="ghost"),
    ]
    result = normalize(raw, Path("/nonexistent"))
    runs = {run["run_id"]: run for run in result["runs"]}
    assert runs["r1"]["launched_by"] == "learning"
    assert runs["r2"]["launched_by"] == "goals_manager"
    assert runs["r1"]["trigger_step_id"] == "th1"
    assert runs["r2"]["trigger_step_id"] == "th1"
    assert runs["r3"]["trigger_step_id"] is None
    assert runs["r3"]["launched_by"] is None
    # the triggering thought is a normal stream step, not swallowed
    thought = next(s for s in result["steps"] if s["step_id"] == "th1")
    assert thought["run_id"] is None


def test_merge_writeback_normalization():
    """shellm's forked-child write-back is a merge step: writeback link built
    from from_traj, never grouped into a run."""
    from shellm_web.trajectory import normalize

    raw = [
        _step("trajectory", "t0"),
        _step("fork", "fk1", child="c1", child_ref="c1-sub/trajectory.jsonl"),
        _step(
            "merge",
            "m1",
            content="inner result",
            from_traj="c1",
            from_step="c1-final",
            from_traj_ref="c1-sub",
        ),
    ]
    result = normalize(raw, Path("/nonexistent"))
    merge = next(s for s in result["steps"] if s["step_id"] == "m1")
    assert merge["writeback"] == {"from_traj": "c1", "from_step": "c1-final"}
    assert merge["run_id"] is None
    assert result["runs"] == []


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
