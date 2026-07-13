"""Shared synthetic-identity fixture for viewer backend tests."""

import json
from pathlib import Path

import pytest

ROOT_TRAJ = "aaaaaaaa-1111-4111-8111-111111111111"
CHILD_RESEARCH = "bbbbbbbb-2222-4222-8222-222222222222"
CHILD_NOTES = "cccccccc-3333-4333-8333-333333333333"
CHILD_GHOST = "dddddddd-4444-4444-8444-444444444444"


def _ts(second: int) -> str:
    return f"2026-07-10T12:00:{second:02d}.000-0700"


def _write_jsonl(path: Path, steps: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(s) + "\n" for s in steps))


@pytest.fixture
def synth_identity(tmp_path: Path) -> Path:
    """Fork-era identity: a root mind log with 3 forks (2 with child dirs on
    disk, 1 dangling) and 2 merge write-backs. Child trajectory dirs nest
    inside the root trajectory dir, mirroring shellm's on-disk layout."""
    identity = tmp_path / "synth"
    identity.mkdir()
    (identity / "info.txt").write_text(
        f"name=synth\ncreated=2026-07-10T12:00:00\nroot_trajectory={ROOT_TRAJ}\n"
    )
    root_dir = identity / "trajectories" / "aaaaaaaa-root"

    _write_jsonl(
        root_dir / "trajectory.jsonl",
        [
            {"type": "trajectory", "step_id": ROOT_TRAJ, "ts": _ts(0)},
            {
                "type": "thought",
                "step_id": "th1",
                "source": "inner_monologue",
                "content": "time to research",
                "ts": _ts(1),
            },
            {
                "type": "fork",
                "step_id": "fk1",
                "child": CHILD_RESEARCH,
                "child_ref": "bbbbbbbb-research/trajectory.jsonl",
                "ts": _ts(2),
            },
            {
                "type": "merge",
                "step_id": "m1",
                "content": "research done",
                "from_traj": CHILD_RESEARCH,
                "from_step": "b-final",
                "from_traj_ref": "bbbbbbbb-research",
                "ts": _ts(5),
            },
            {
                "type": "fork",
                "step_id": "fk2",
                "child": CHILD_NOTES,
                "child_ref": "cccccccc-notes/trajectory.jsonl",
                "ts": _ts(6),
            },
            {
                "type": "merge",
                "step_id": "m2",
                "content": "notes tidied",
                "from_traj": CHILD_NOTES,
                "from_step": "c-final",
                "from_traj_ref": "cccccccc-notes",
                "ts": _ts(8),
            },
            {
                "type": "fork",
                "step_id": "fk3",
                "child": CHILD_GHOST,
                "child_ref": "dddddddd-ghost/trajectory.jsonl",
                "ts": _ts(9),
            },
        ],
    )

    _write_jsonl(
        root_dir / "bbbbbbbb-research" / "trajectory.jsonl",
        [
            {
                "type": "trajectory",
                "step_id": CHILD_RESEARCH,
                "parent_traj": ROOT_TRAJ,
                "parent_step": "fk1",
                "parent_traj_ref": "..",
                "ts": _ts(3),
            },
            {
                "type": "reasoning",
                "step_id": "b-r1",
                "thought": "look around",
                "cmd": "ls",
                "ts": _ts(3),
            },
            {"type": "shell-output", "step_id": "b-o1", "stdout": "notes.md", "exit": 0, "ts": _ts(4)},
            {"type": "final", "step_id": "b-final", "content": "research done", "ts": _ts(4)},
        ],
    )

    _write_jsonl(
        root_dir / "cccccccc-notes" / "trajectory.jsonl",
        [
            {
                "type": "trajectory",
                "step_id": CHILD_NOTES,
                "parent_traj": ROOT_TRAJ,
                "parent_step": "fk2",
                "parent_traj_ref": "..",
                "ts": _ts(7),
            },
            {"type": "final", "step_id": "c-final", "content": "notes tidied", "ts": _ts(7)},
        ],
    )

    return identity
