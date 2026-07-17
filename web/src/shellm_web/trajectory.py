"""Parse and normalize shellm trajectory JSONL files.

Produces the wire shape the viewer renders:
- steps: normalized steps (preview one-liner, source, fork/writeback links)
- runs: inline shellm-run groups. Grouping is exact: every machinery step
  written by shellm since 2026-07-10 carries `run_id` (the step_id of its
  `shellm-run` header), so membership is a lookup even when concurrent runs
  interleave in one shared mind log. Machinery steps without `run_id`
  (pre-2026-07-10 logs) are left ungrouped and render as plain stream steps.
"""

import json
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Step types written by the shellm loop itself (never carry `source`).
MACHINERY_TYPES = {
    "shellm-run",
    "prompt",
    "reasoning",
    "shell-output",
    "feedback",
    "final",
    "run-summary",
}

_WS_RE = re.compile(r"\s+")


def _collapse(text: str, limit: int = 200) -> str:
    return _WS_RE.sub(" ", text).strip()[:limit]


def _first_str(raw: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = raw.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


def step_preview(raw: dict[str, Any]) -> str:
    """One-line preview per step type (ports bin/traj's formatter)."""
    step_type = raw.get("type", "")
    if step_type == "reasoning":
        thought = _collapse(_first_str(raw, "thought", "content"), 100)
        cmd = _collapse(_first_str(raw, "cmd"), 120)
        return f"{thought} | {cmd}" if thought and cmd else thought or cmd
    if step_type == "shell-output":
        exit_code = raw.get("exit")
        head = _collapse(_first_str(raw, "stdout") or _first_str(raw, "stderr"), 120)
        return f"exit {exit_code} · {head}" if exit_code is not None else head
    if step_type == "shellm-run":
        return _collapse(_first_str(raw, "command"), 160)
    if step_type == "run-summary":
        return _collapse(_first_str(raw, "tldr"), 160)
    if step_type == "final":
        content = _collapse(_first_str(raw, "content", "thought"), 100)
        cmd = _collapse(_first_str(raw, "cmd"), 120)
        return f"{content} | {cmd}" if content and cmd else content or cmd
    if step_type == "fork":
        return f"-> {_first_str(raw, 'child_ref', 'child')}"
    if step_type == "merge":
        content = _collapse(_first_str(raw, "content"), 140)
        return f"<- {content}" if content else f"<- {_first_str(raw, 'from_traj')}"
    if step_type == "trajectory":
        parent = _first_str(raw, "parent_traj")
        return f"<- parent: {parent[:8]}" if parent else "root"
    if step_type == "message":
        sender = _first_str(raw, "from")
        content = _collapse(_first_str(raw, "content"), 140)
        return f"{sender}: {content}" if sender else content
    return _collapse(_first_str(raw, "content", "thought"), 160)


@dataclass
class RunGroup:
    run_id: str  # = shellm-run step_id
    trigger_step_id: str | None = None  # step that triggered the run (any type)
    launched_by: str | None = None  # thinker that launched the run
    step_ids: list[str] = field(default_factory=list)
    started_ts: str = ""
    ended_ts: str | None = None
    status: str = "running"  # running | done
    command: str = ""
    model: str | None = None
    tldr: str | None = None
    # index into steps of the last step that mutated this run — lets the
    # mindlog endpoint ship only changed runs on ?since= deltas (a run's
    # command embeds the whole prompt, so unchanged runs are dead weight)
    last_touch: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "trigger_step_id": self.trigger_step_id,
            "launched_by": self.launched_by,
            "step_ids": self.step_ids,
            "started_ts": self.started_ts,
            "ended_ts": self.ended_ts,
            "status": self.status,
            "command": self.command,
            "model": self.model,
            "tldr": self.tldr,
            "last_touch": self.last_touch,
        }


def parse_jsonl(path: Path) -> list[dict[str, Any]]:
    """Read a trajectory.jsonl, skipping malformed lines."""
    steps: list[dict[str, Any]] = []
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(record, dict):
                    steps.append(record)
    except OSError:
        return []
    return steps


def _action_suffix(command: str) -> str | None:
    """Extract the trailing 'ACTION: <text>' from a shellm-run command."""
    idx = command.rfind("ACTION:")
    if idx == -1:
        return None
    return _collapse(command[idx + len("ACTION:") :])


class _Normalizer:
    """Stateful step normalizer: feed raw steps in order, read results any
    time. The state (open runs, unmatched actions, seen ids) is exactly what
    lets a cache continue where it left off when the jsonl grows."""

    def __init__(self, traj_dir: Path) -> None:
        self.traj_dir = traj_dir
        self.steps: list[dict[str, Any]] = []
        self.runs: list[RunGroup] = []
        self._runs_by_id: dict[str, RunGroup] = {}
        self._unmatched_actions: list[dict[str, Any]] = []
        self._seen_step_ids: set[str] = set()

    def ingest(self, raw: dict[str, Any]) -> None:
        step_type = raw.get("type", "")
        source = raw.get("source")
        step_id = raw.get("step_id", "")
        ts = raw.get("ts", "")

        normalized: dict[str, Any] = {
            "step_id": step_id,
            "ts": ts,
            "type": step_type,
            "source": source,
            "preview": step_preview(raw),
            "raw": raw,
            "run_id": None,
        }

        # Fork / write-back links
        if step_type == "fork" and raw.get("child"):
            child_ref = raw.get("child_ref", "")
            slug = child_ref.split("/")[0] if child_ref else str(raw["child"])[:8]
            resolved = bool(child_ref) and (self.traj_dir / child_ref).is_file()
            if not resolved:
                # child_ref missing or stale: try the hex8 glob
                matches = list(
                    self.traj_dir.glob(f"{str(raw['child'])[:8]}-*/trajectory.jsonl")
                )
                if matches:
                    slug = matches[0].parent.name
                    resolved = True
            normalized["fork"] = {
                "child_traj_id": raw["child"],
                "slug": slug,
                "resolved": resolved,
            }
        if raw.get("from_traj"):
            normalized["writeback"] = {
                "from_traj": raw["from_traj"],
                "from_step": raw.get("from_step"),
            }

        # Inline-run grouping (machinery steps carry no source)
        if source is None and step_type in MACHINERY_TYPES:
            if step_type == "shellm-run":
                run = RunGroup(
                    run_id=step_id,
                    started_ts=ts,
                    command=raw.get("command", ""),
                    model=raw.get("model"),
                    launched_by=raw.get("launched_by"),
                )
                # trigger -> run join. Exact when the run carries trigger_step
                # (thinkers export the triggering step's id; any step type can
                # trigger); otherwise fall back to the legacy ACTION:
                # command-suffix prefix match against action steps.
                trigger = raw.get("trigger_step")
                if trigger:
                    if trigger in self._seen_step_ids:
                        run.trigger_step_id = trigger
                        # consume so a later legacy run can't prefix-match it
                        self._unmatched_actions[:] = [
                            a for a in self._unmatched_actions if a["step_id"] != trigger
                        ]
                else:
                    suffix = _action_suffix(run.command)
                    if suffix:
                        for action in reversed(self._unmatched_actions):
                            action_text = _collapse(str(action["raw"].get("content", "")))
                            if action_text and (
                                action_text.startswith(suffix[:200])
                                or suffix.startswith(action_text[:200])
                            ):
                                run.trigger_step_id = action["step_id"]
                                self._unmatched_actions.remove(action)
                                break
                self.runs.append(run)
                self._runs_by_id[run.run_id] = run
                run.step_ids.append(step_id)
                run.last_touch = len(self.steps)
                normalized["run_id"] = run.run_id
            else:
                # Membership is explicit: the step's own run_id field points
                # at its shellm-run header. Steps without one (pre-run_id
                # logs) or with an unknown id stay ungrouped.
                run = self._runs_by_id.get(raw.get("run_id") or "")
                if run is not None:
                    run.step_ids.append(step_id)
                    run.last_touch = len(self.steps)
                    normalized["run_id"] = run.run_id
                    if step_type == "run-summary":
                        run.tldr = raw.get("tldr") or run.tldr
                    elif step_type == "final":
                        run.status = "done"
                        run.ended_ts = ts
        elif step_type == "action":
            self._unmatched_actions.append(normalized)

        if step_id:
            self._seen_step_ids.add(step_id)
        self.steps.append(normalized)


def normalize(raw_steps: list[dict[str, Any]], traj_dir: Path) -> dict[str, Any]:
    """Normalize steps and group inline runs. Returns {steps, runs}."""
    normalizer = _Normalizer(traj_dir)
    for raw in raw_steps:
        normalizer.ingest(raw)
    return {
        "steps": normalizer.steps,
        "runs": [run.to_dict() for run in normalizer.runs],
    }


class _CacheEntry:
    def __init__(self, traj_dir: Path) -> None:
        self.normalizer = _Normalizer(traj_dir)
        self.offset = 0        # bytes consumed, through the last complete line
        self.inode: int | None = None
        self.traj_id = ""


class TrajectoryCache:
    """Append-aware parse cache. Trajectories are append-only, so a refresh
    reads only the new bytes and continues normalizing from saved state —
    O(new steps) per poll instead of O(log). A shrunken or replaced file
    (different inode, or size below the consumed offset) resets the entry.
    A trailing partial line (a step mid-append) is left unconsumed and picked
    up whole on the next refresh."""

    def __init__(self, max_entries: int = 8) -> None:
        self._entries: dict[Path, _CacheEntry] = {}
        self._lock = threading.Lock()
        self._max_entries = max_entries

    def load(self, traj_dir: Path) -> dict[str, Any]:
        """Wire dict like load_trajectory; steps list is shared with the
        cache — callers must treat it as read-only and build their own
        response envelope."""
        traj_dir = traj_dir.resolve()
        with self._lock:
            entry = self._entries.get(traj_dir)
            if entry is None:
                if len(self._entries) >= self._max_entries:
                    # Drop the entry with the fewest parsed steps (cheapest
                    # to rebuild); good enough for a handful of identities.
                    victim = min(
                        self._entries, key=lambda k: len(self._entries[k].normalizer.steps)
                    )
                    del self._entries[victim]
                entry = _CacheEntry(traj_dir)
                self._entries[traj_dir] = entry
            self._refresh(entry, traj_dir)
            return {
                "steps": entry.normalizer.steps,
                "runs": [run.to_dict() for run in entry.normalizer.runs],
                "traj_id": entry.traj_id,
                "step_count": len(entry.normalizer.steps),
            }

    def _refresh(self, entry: _CacheEntry, traj_dir: Path) -> None:
        jsonl = traj_dir / "trajectory.jsonl"
        try:
            stat = jsonl.stat()
        except OSError:
            entry.normalizer = _Normalizer(traj_dir)
            entry.offset = 0
            entry.inode = None
            entry.traj_id = ""
            return

        if entry.inode != stat.st_ino or stat.st_size < entry.offset:
            entry.normalizer = _Normalizer(traj_dir)
            entry.offset = 0
            entry.inode = stat.st_ino

        if stat.st_size == entry.offset:
            return  # nothing new

        try:
            with jsonl.open("rb") as fh:
                fh.seek(entry.offset)
                chunk = fh.read()
        except OSError:
            return

        # Only consume complete lines; a torn tail waits for the next poll.
        last_newline = chunk.rfind(b"\n")
        if last_newline == -1:
            return
        consumed = chunk[: last_newline + 1]
        entry.offset += len(consumed)

        for line in consumed.decode("utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(record, dict):
                entry.normalizer.ingest(record)

        if not entry.traj_id and entry.normalizer.steps:
            entry.traj_id = entry.normalizer.steps[0].get("raw", {}).get("step_id", "")


# Process-wide cache used by the API endpoints.
CACHE = TrajectoryCache()


def load_trajectory(traj_dir: Path) -> dict[str, Any]:
    """Load and normalize a trajectory directory. Returns wire dict."""
    jsonl = traj_dir / "trajectory.jsonl"
    raw_steps = parse_jsonl(jsonl)
    traj_id = raw_steps[0].get("step_id", "") if raw_steps else ""
    result = normalize(raw_steps, traj_dir)
    result["traj_id"] = traj_id
    result["step_count"] = len(result["steps"])
    return result
