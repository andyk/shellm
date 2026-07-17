"""Per-identity thinker status, mirroring `bin/thinkers` cmd_status.

All state is derived from files under <identity>/run/ plus os.kill(pid, 0)
liveness probes — the same sources the CLI reads. Note: step_pids is
append-only and pids can be recycled by the OS, so a recycled pid may
briefly misreport a thinker as active; this matches `thinkers status`.
"""

import json
import os
from pathlib import Path

from shellm_web.liveness import pid_alive


def is_disabled(thinker_dir: Path) -> bool:
    """Marker file the CLI honors too: touch <thinker>/disabled."""
    return (thinker_dir / "disabled").is_file()


def list_thinker_dirs(
    identity_dir: Path, include_disabled: bool = False
) -> list[Path]:
    """Thinker dirs under <identity>/thinkers/: need step + subscriptions.jsonl."""
    thinkers_root = identity_dir / "thinkers"
    if not thinkers_root.is_dir():
        return []
    result = []
    for child in sorted(thinkers_root.iterdir()):
        if not child.is_dir() or child.name.startswith("_"):
            continue
        if not include_disabled and is_disabled(child):
            continue
        if (child / "step").is_file() and (child / "subscriptions.jsonl").is_file():
            result.append(child)
    return result


def _pid_running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except (ProcessLookupError, PermissionError, OSError):
        return False
    return True


def _read_lines(path: Path) -> list[str]:
    try:
        return [line for line in path.read_text().splitlines() if line.strip()]
    except OSError:
        return []


def _live_steps_by_thinker(run_dir: Path) -> dict[str, int]:
    """Parse run/step_pids ("pid name" lines) and count live steps per thinker."""
    counts: dict[str, int] = {}
    for line in _read_lines(run_dir / "step_pids"):
        parts = line.split(None, 1)
        if len(parts) != 2:
            continue
        pid_str, name = parts
        try:
            pid = int(pid_str)
        except ValueError:
            continue
        if _pid_running(pid):
            counts[name] = counts.get(name, 0) + 1
    return counts


def _pending_by_thinker(run_dir: Path) -> dict[str, list[str]]:
    """run/pending/<name>.<type> flags -> {name: [types]}."""
    pending: dict[str, list[str]] = {}
    pending_dir = run_dir / "pending"
    if not pending_dir.is_dir():
        return pending
    for flag in sorted(pending_dir.iterdir()):
        if not flag.is_file() or "." not in flag.name:
            continue
        name, _, step_type = flag.name.rpartition(".")
        pending.setdefault(name, []).append(step_type)
    return pending


def _subscription_info(thinker_dir: Path) -> tuple[list[str], bool]:
    """types + trigger_self from the first line of subscriptions.jsonl."""
    try:
        with (thinker_dir / "subscriptions.jsonl").open() as fh:
            first = fh.readline()
        sub = json.loads(first)
        types = sub.get("types") or ["all"]
        trigger_self = bool(sub.get("trigger_self", False))
        return [str(t) for t in types], trigger_self
    except (OSError, ValueError, AttributeError):
        return ["all"], False


def thinkers_status(identity_dir: Path) -> dict:
    """Full per-identity thinker status (GET .../thinkers payload body)."""
    run_dir = identity_dir / "run"
    dispatcher_alive, dispatcher_pid = pid_alive(run_dir / "dispatcher.pid")
    active_set = set(_read_lines(run_dir / "active_thinkers"))
    live_steps = _live_steps_by_thinker(run_dir)
    pending = _pending_by_thinker(run_dir)

    thinkers = []
    for thinker_dir in list_thinker_dirs(identity_dir, include_disabled=True):
        name = thinker_dir.name
        types, trigger_self = _subscription_info(thinker_dir)
        steps_in_flight = live_steps.get(name, 0)

        # Precedence mirrors cmd_status: disabled marker wins, then a live
        # per-thinker daemon pid, then draining (deactivated but steps still
        # finishing after a drain stop), then stopped (dispatcher down or
        # not active), then active/idle.
        daemon_alive, daemon_pid = pid_alive(run_dir / "thinkers" / f"{name}.pid")
        if is_disabled(thinker_dir):
            state = "disabled"
        elif daemon_alive:
            state = "running"
        elif (not dispatcher_alive or name not in active_set) and steps_in_flight > 0:
            state = "draining"
        elif not dispatcher_alive or name not in active_set:
            state = "stopped"
        elif steps_in_flight > 0:
            state = "active"
        else:
            state = "idle"

        log_bytes: int | None = None
        log_mtime: float | None = None
        log_file = run_dir / "logs" / f"{name}.log"
        try:
            stat = log_file.stat()
            log_bytes = stat.st_size
            log_mtime = stat.st_mtime
        except OSError:
            pass

        thinkers.append(
            {
                "name": name,
                "state": state,
                "steps_in_flight": steps_in_flight,
                "pid": daemon_pid if daemon_alive else None,
                "types": types,
                "trigger_self": trigger_self,
                "pending": pending.get(name, []),
                "log_bytes": log_bytes,
                "log_mtime": log_mtime,
            }
        )

    enabled_count = sum(1 for t in thinkers if t["state"] != "disabled")
    return {
        "dispatcher": {
            "running": dispatcher_alive,
            "pid": dispatcher_pid if dispatcher_alive else None,
        },
        "active_thinkers": len(active_set) if dispatcher_alive else 0,
        "thinkers_total": enabled_count,
        "thinkers_disabled": len(thinkers) - enabled_count,
        "steps_in_flight": sum(live_steps.values()),
        "pending_total": sum(len(v) for v in pending.values()),
        "thinkers": thinkers,
    }


def thinkers_summary(identity_dir: Path) -> dict:
    """Cheap subset merged into each GET /api/identities item."""
    run_dir = identity_dir / "run"
    dispatcher_alive, dispatcher_pid = pid_alive(run_dir / "dispatcher.pid")
    thinker_names = {d.name for d in list_thinker_dirs(identity_dir)}
    active_set = set(_read_lines(run_dir / "active_thinkers")) & thinker_names
    live_steps = _live_steps_by_thinker(run_dir)
    return {
        "dispatcher": {
            "running": dispatcher_alive,
            "pid": dispatcher_pid if dispatcher_alive else None,
        },
        "thinkers_total": len(thinker_names),
        "thinkers_active": len(active_set) if dispatcher_alive else 0,
        "steps_in_flight": sum(live_steps.values()) if dispatcher_alive else 0,
    }
