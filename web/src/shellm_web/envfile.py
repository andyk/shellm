"""Read and edit .env files (identity config), redacting secret values.

Full secret values never leave the server: the API returns a short peek
(prefix…suffix) so keys are recognizable but not recoverable.
"""

import re
from pathlib import Path

ENV_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
SECRET_KEY_RE = re.compile(r"KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL", re.IGNORECASE)
# Values of these shapes can be written unquoted; anything else is
# single-quoted so `set -a; . .env` parses it as one word.
_BARE_VALUE_RE = re.compile(r"^[A-Za-z0-9_.:/@+=,-]*$")

_LINE_RE = re.compile(
    r"^\s*(?:export\s+)?(?P<key>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?P<value>.*)$"
)


def _unquote(raw: str) -> str:
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "\"'":
        return raw[1:-1]
    return raw


def parse_env_file(path: Path) -> list[tuple[str, str]]:
    """KEY/value pairs in file order; later duplicates win (like sourcing)."""
    entries: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    for line in lines:
        if line.lstrip().startswith("#"):
            continue
        match = _LINE_RE.match(line)
        if match:
            entries[match.group("key")] = _unquote(match.group("value"))
    return list(entries.items())


def is_secret(key: str) -> bool:
    return bool(SECRET_KEY_RE.search(key))


def redacted_entry(key: str, value: str) -> dict:
    """Wire form of one entry; secrets get a peek, never the full value."""
    if not is_secret(key):
        return {"key": key, "value": value, "secret": False}
    if len(value) > 12:
        peek = f"{value[:6]}…{value[-4:]}"
    elif value:
        peek = "••••••"
    else:
        peek = ""
    return {"key": key, "value": peek, "secret": True}


def _quote_value(value: str) -> str:
    if _BARE_VALUE_RE.match(value):
        return value
    return "'" + value.replace("'", "'\\''") + "'"


def upsert_env_var(path: Path, key: str, value: str) -> None:
    """Replace every assignment of key (preserving comments and other lines),
    or append one. Creates the file if missing."""
    new_line = f"{key}={_quote_value(value)}"
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        lines = []
    replaced = False
    result = []
    for line in lines:
        match = _LINE_RE.match(line)
        if match and match.group("key") == key and not line.lstrip().startswith("#"):
            if not replaced:
                result.append(new_line)
                replaced = True
            # drop duplicate assignments of the same key
            continue
        result.append(line)
    if not replaced:
        result.append(new_line)
    path.write_text("".join(f"{line}\n" for line in result), encoding="utf-8")


def delete_env_var(path: Path, key: str) -> bool:
    """Remove every assignment of key. Returns True if anything was removed."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return False
    result = []
    removed = False
    for line in lines:
        match = _LINE_RE.match(line)
        if match and match.group("key") == key and not line.lstrip().startswith("#"):
            removed = True
            continue
        result.append(line)
    if removed:
        path.write_text("".join(f"{line}\n" for line in result), encoding="utf-8")
    return removed
