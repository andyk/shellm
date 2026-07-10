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
        return _collapse(_first_str(raw, "content", "thought"), 160)
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
    action_step_id: str | None = None
    step_ids: list[str] = field(default_factory=list)
    started_ts: str = ""
    ended_ts: str | None = None
    status: str = "running"  # running | done
    command: str = ""
    model: str | None = None
    tldr: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "action_step_id": self.action_step_id,
            "step_ids": self.step_ids,
            "started_ts": self.started_ts,
            "ended_ts": self.ended_ts,
            "status": self.status,
            "command": self.command,
            "model": self.model,
            "tldr": self.tldr,
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


def normalize(raw_steps: list[dict[str, Any]], traj_dir: Path) -> dict[str, Any]:
    """Normalize steps and group inline runs. Returns {steps, runs}."""
    steps: list[dict[str, Any]] = []
    runs: list[RunGroup] = []
    runs_by_id: dict[str, RunGroup] = {}
    unmatched_actions: list[dict[str, Any]] = []

    for raw in raw_steps:
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
            resolved = bool(child_ref) and (traj_dir / child_ref).is_file()
            if not resolved:
                # child_ref missing or stale: try the hex8 glob
                matches = list(traj_dir.glob(f"{str(raw['child'])[:8]}-*/trajectory.jsonl"))
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
                )
                # action -> run join. Exact when the run carries trigger_step
                # (the actor exports the triggering step's id); otherwise fall
                # back to the legacy ACTION: command-suffix prefix match.
                trigger = raw.get("trigger_step")
                if trigger:
                    for action in unmatched_actions:
                        if action["step_id"] == trigger:
                            run.action_step_id = action["step_id"]
                            unmatched_actions.remove(action)
                            break
                else:
                    suffix = _action_suffix(run.command)
                    if suffix:
                        for action in reversed(unmatched_actions):
                            action_text = _collapse(str(action["raw"].get("content", "")))
                            if action_text and (
                                action_text.startswith(suffix[:200])
                                or suffix.startswith(action_text[:200])
                            ):
                                run.action_step_id = action["step_id"]
                                unmatched_actions.remove(action)
                                break
                runs.append(run)
                runs_by_id[run.run_id] = run
                run.step_ids.append(step_id)
                normalized["run_id"] = run.run_id
            else:
                # Membership is explicit: the step's own run_id field points
                # at its shellm-run header. Steps without one (pre-run_id
                # logs) or with an unknown id stay ungrouped.
                run = runs_by_id.get(raw.get("run_id") or "")
                if run is not None:
                    run.step_ids.append(step_id)
                    normalized["run_id"] = run.run_id
                    if step_type == "run-summary":
                        run.tldr = raw.get("tldr") or run.tldr
                    elif step_type == "final":
                        run.status = "done"
                        run.ended_ts = ts
        elif step_type == "action":
            unmatched_actions.append(normalized)

        steps.append(normalized)

    return {"steps": steps, "runs": [run.to_dict() for run in runs]}


def load_trajectory(traj_dir: Path) -> dict[str, Any]:
    """Load and normalize a trajectory directory. Returns wire dict."""
    jsonl = traj_dir / "trajectory.jsonl"
    raw_steps = parse_jsonl(jsonl)
    traj_id = raw_steps[0].get("step_id", "") if raw_steps else ""
    result = normalize(raw_steps, traj_dir)
    result["traj_id"] = traj_id
    result["step_count"] = len(result["steps"])
    return result
