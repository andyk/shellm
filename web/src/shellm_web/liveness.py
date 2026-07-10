"""Session liveness: dispatcher.pid alive OR mind log recently modified."""

import os
import time
from pathlib import Path

RECENT_SECONDS = 30


def pid_alive(pid_file: Path) -> tuple[bool, int | None]:
    try:
        pid = int(pid_file.read_text().strip())
    except (OSError, ValueError):
        return False, None
    try:
        os.kill(pid, 0)
    except (ProcessLookupError, PermissionError, OSError):
        return False, pid
    return True, pid


def identity_status(identity_dir: Path, mindlog_path: Path | None) -> dict:
    alive, pid = pid_alive(identity_dir / "run" / "dispatcher.pid")
    mtime: float | None = None
    size: int | None = None
    if mindlog_path is not None and mindlog_path.is_file():
        stat = mindlog_path.stat()
        mtime = stat.st_mtime
        size = stat.st_size
    recent = mtime is not None and (time.time() - mtime) < RECENT_SECONDS
    return {
        "live": alive or recent,
        "pid_alive": alive,
        "dispatcher_pid": pid,
        "mindlog_mtime": mtime,
        "mindlog_bytes": size,
    }
