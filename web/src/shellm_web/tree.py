"""Fork-tree resolution for trajectory directories.

Ports bin/shellm-explore's tree walk: a trajectory dir contains nested child
trajectory dirs; fork steps carry child (uuid) + child_ref (relative path).
"""

import json
from pathlib import Path
from typing import Any


def _iter_steps(jsonl: Path):
    try:
        with jsonl.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(record, dict):
                    yield record
    except OSError:
        return


def _child_dirs(traj_dir: Path) -> dict[str, Path]:
    """Map fork child traj_id -> child dir, resolving refs then globs."""
    children: dict[str, Path] = {}
    for step in _iter_steps(traj_dir / "trajectory.jsonl"):
        if step.get("type") != "fork" or not step.get("child"):
            continue
        child_id = str(step["child"])
        child_ref = step.get("child_ref", "")
        candidate = (traj_dir / child_ref).parent if child_ref else None
        if candidate is None or not (candidate / "trajectory.jsonl").is_file():
            matches = sorted(traj_dir.glob(f"{child_id[:8]}-*"))
            candidate = next(
                (m for m in matches if (m / "trajectory.jsonl").is_file()), None
            )
        if candidate is not None:
            children[child_id] = candidate
    return children


def _node_summary(traj_dir: Path) -> dict[str, Any]:
    """Cheap single-pass stats for one trajectory node."""
    traj_id = ""
    parent_step_id: str | None = None
    started_ts = ""
    last_ts = ""
    step_count = 0
    has_final = False
    tldr: str | None = None
    child_count = 0
    for step in _iter_steps(traj_dir / "trajectory.jsonl"):
        step_count += 1
        ts = step.get("ts", "")
        if step_count == 1:
            traj_id = step.get("step_id", "")
            parent_step_id = step.get("parent_step")
            started_ts = ts
        if ts:
            last_ts = ts
        step_type = step.get("type")
        if step_type == "final":
            has_final = True
        elif step_type == "run-summary":
            tldr = step.get("tldr") or tldr
        elif step_type == "fork":
            child_count += 1
    return {
        "traj_id": traj_id,
        "slug": traj_dir.name,
        "parent_step_id": parent_step_id,
        "started_ts": started_ts,
        "last_ts": last_ts,
        "step_count": step_count,
        "has_final": has_final,
        "tldr": tldr,
        "child_count": child_count,
    }


def build_tree(traj_dir: Path, depth: int = 2) -> dict[str, Any]:
    """TreeNode for traj_dir; children included down to `depth` levels."""
    node = _node_summary(traj_dir)
    if depth > 0 and node["child_count"] > 0:
        children = []
        for child_dir in _child_dirs(traj_dir).values():
            children.append(build_tree(child_dir, depth - 1))
        children.sort(key=lambda c: c["started_ts"])
        node["children"] = children
    return node


def find_traj_dir(root_traj_dir: Path, traj_id: str) -> Path | None:
    """Locate a (possibly deeply nested) trajectory dir by its id."""
    root_first = next(_iter_steps(root_traj_dir / "trajectory.jsonl"), None)
    if root_first and root_first.get("step_id") == traj_id:
        return root_traj_dir
    prefix = traj_id[:8]
    for candidate in sorted(root_traj_dir.rglob(f"{prefix}-*")):
        jsonl = candidate / "trajectory.jsonl"
        if not jsonl.is_file():
            continue
        first = next(_iter_steps(jsonl), None)
        if first and first.get("step_id") == traj_id:
            return candidate
    return None


def breadcrumb(root_traj_dir: Path, traj_dir: Path) -> list[dict[str, str]]:
    """Chain of {traj_id, slug} from the root down to traj_dir."""
    chain: list[dict[str, str]] = []
    current: Path | None = traj_dir
    root_resolved = root_traj_dir.resolve()
    while current is not None:
        first = next(_iter_steps(current / "trajectory.jsonl"), None)
        chain.append(
            {
                "traj_id": first.get("step_id", "") if first else "",
                "slug": current.name,
            }
        )
        if current.resolve() == root_resolved:
            break
        parent = current.parent
        current = parent if (parent / "trajectory.jsonl").is_file() else None
    chain.reverse()
    return chain
