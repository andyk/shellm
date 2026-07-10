"""Discover shellm identity directories under a serve root.

An identity dir is any directory containing an info.txt with a
root_trajectory= line (see e.g. .identities/<name>/ or
improve/generations/gen-NNN/identities/<run>/).
"""

import logging
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

MAX_DEPTH = 6
PRUNE_DIRS = {
    "trajectories",
    "workdir",
    "workdirs",
    "blobs",
    "run",
    "node_modules",
    ".git",
    ".shellm",
    "memories",
    "skills",
    "kernel",
    "thinkers",
    "static",
    "build",
}


@dataclass
class IdentityInfo:
    id: str  # root-relative path with "/" -> "~"
    name: str
    path: Path  # absolute identity dir
    path_rel: str
    created: str | None
    root_trajectory: str | None
    group: str  # parent dir relative to root, e.g. ".identities", "improve/generations/gen-001/identities"


def _parse_info_txt(path: Path) -> dict[str, str]:
    fields: dict[str, str] = {}
    try:
        for line in path.read_text().splitlines():
            if "=" in line:
                key, _, value = line.partition("=")
                fields[key.strip()] = value.strip()
    except OSError:
        pass
    return fields


def identity_id_for(rel: str) -> str:
    return rel.replace("/", "~")


def scan_identities(root: Path) -> list[IdentityInfo]:
    """Walk root for identity dirs (info.txt with root_trajectory)."""
    found: list[IdentityInfo] = []

    def walk(directory: Path, depth: int) -> None:
        info_txt = directory / "info.txt"
        if info_txt.is_file():
            fields = _parse_info_txt(info_txt)
            if "root_trajectory" in fields:
                rel = directory.relative_to(root).as_posix()
                group = str(Path(rel).parent) if rel != "." else "."
                found.append(
                    IdentityInfo(
                        id=identity_id_for(rel),
                        name=fields.get("name", directory.name),
                        path=directory,
                        path_rel=rel,
                        created=fields.get("created"),
                        root_trajectory=fields.get("root_trajectory"),
                        group=group,
                    )
                )
                return  # identity dirs don't nest
        if depth >= MAX_DEPTH:
            return
        try:
            children = sorted(directory.iterdir())
        except OSError:
            return
        for child in children:
            if child.is_dir() and not child.is_symlink() and child.name not in PRUNE_DIRS:
                walk(child, depth + 1)

    walk(root, 0)
    return found


def resolve_identity(root: Path, identity_id: str) -> IdentityInfo:
    """Resolve an identity id strictly via a fresh scan (never as a raw path)."""
    for identity in scan_identities(root):
        if identity.id == identity_id:
            return identity
    raise KeyError(identity_id)


def find_root_traj_dir(identity: IdentityInfo) -> Path | None:
    """Locate the mind log's trajectory dir for an identity."""
    traj_root = identity.path / "trajectories"
    if not traj_root.is_dir():
        return None
    root_id = identity.root_trajectory or ""
    if root_id:
        matches = sorted(traj_root.glob(f"{root_id[:8]}-*"))
        for match in matches:
            if (match / "trajectory.jsonl").is_file():
                return match
    # Fallback: any dir whose trajectory.jsonl exists
    for candidate in sorted(traj_root.iterdir()):
        if (candidate / "trajectory.jsonl").is_file():
            return candidate
    return None
