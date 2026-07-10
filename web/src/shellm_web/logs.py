"""Thinker log tails and dispatcher.log event parsing."""

import re
from pathlib import Path
from typing import Any

DISPATCH_STEP_RE = re.compile(
    r"\[dispatcher\]\s+step:\s+type=(?P<type>\S+)(?:\s+source=(?P<source>\S+))?"
)
DISPATCH_FIRE_RE = re.compile(
    r"\[dispatcher\]\s+dispatch\s+->\s+(?P<thinker>\S+)(?:\s+\(active=(?P<active>\d+)\))?"
)


def list_logs(identity_dir: Path) -> list[dict[str, Any]]:
    logs_dir = identity_dir / "run" / "logs"
    if not logs_dir.is_dir():
        return []
    result = []
    for path in sorted(logs_dir.glob("*.log")):
        stat = path.stat()
        result.append({"name": path.name, "bytes": stat.st_size, "mtime": stat.st_mtime})
    return result


def tail_log(log_path: Path, tail_bytes: int) -> dict[str, Any]:
    total = log_path.stat().st_size
    with log_path.open("rb") as fh:
        if total > tail_bytes:
            fh.seek(total - tail_bytes)
        data = fh.read()
    content = data.decode("utf-8", errors="replace")
    if total > tail_bytes:
        # drop the (likely partial) first line
        content = content.split("\n", 1)[-1]
    return {
        "name": log_path.name,
        "content": content,
        "total_bytes": total,
        "truncated": total > tail_bytes,
    }


def parse_dispatch_log(identity_dir: Path, max_events: int = 2000) -> list[dict[str, Any]]:
    """Parse dispatcher.log into structured events (newest last)."""
    log_path = identity_dir / "run" / "logs" / "dispatcher.log"
    if not log_path.is_file():
        return []
    events: list[dict[str, Any]] = []
    for line in log_path.read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if match := DISPATCH_STEP_RE.search(stripped):
            events.append(
                {
                    "kind": "step",
                    "type": match.group("type"),
                    "source": match.group("source"),
                    "raw": stripped,
                }
            )
        elif match := DISPATCH_FIRE_RE.search(stripped):
            active = match.group("active")
            events.append(
                {
                    "kind": "dispatch",
                    "thinker": match.group("thinker"),
                    "active": int(active) if active is not None else None,
                    "raw": stripped,
                }
            )
        else:
            events.append({"kind": "other", "raw": stripped})
    return events[-max_events:]
