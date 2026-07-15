"""Path-safety guards for file-serving endpoints."""

import re
from pathlib import Path

from fastapi import HTTPException

BLOB_NAME_RE = re.compile(r"^[0-9a-f-]{36}-[0-9a-f]{6}\.(stdout|stderr)$")
LOG_NAME_RE = re.compile(r"^[A-Za-z0-9_.\-]+\.log$")
MEMORY_NAME_RE = re.compile(r"^[A-Za-z0-9_.\-]+\.md$")
# Underscores allowed: existing thinkers (inner_monologue, ...) use them even
# though `thinkers new` only scaffolds hyphenated names.
THINKER_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
# Same rule `identity new` enforces.
IDENTITY_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
CHAT_FROM_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def contained_path(base: Path, *parts: str) -> Path:
    """Resolve base/parts and require the result to stay inside base."""
    resolved = (base / Path(*parts)).resolve()
    base_resolved = base.resolve()
    if resolved != base_resolved and not resolved.is_relative_to(base_resolved):
        raise HTTPException(status_code=404, detail="Not found")
    return resolved


def checked_name(name: str, pattern: re.Pattern[str]) -> str:
    if not pattern.match(name):
        raise HTTPException(status_code=404, detail="Not found")
    return name
