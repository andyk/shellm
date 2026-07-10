"""Fork-tree resolution and path-safety tests."""

from pathlib import Path

import pytest
from fastapi import HTTPException

from shellm_web import discovery, safety, tree

REPO = Path(__file__).parents[2]
BOTNICK = REPO / ".identities" / "botnick"

needs_botnick = pytest.mark.skipif(not BOTNICK.is_dir(), reason="botnick data not present")


def _botnick_root() -> Path:
    identities = discovery.scan_identities(BOTNICK.parent)
    identity = next(i for i in identities if i.path == BOTNICK)
    traj_dir = discovery.find_root_traj_dir(identity)
    assert traj_dir is not None
    return traj_dir


@needs_botnick
def test_tree_shallow():
    root = _botnick_root()
    node = tree.build_tree(root, depth=1)
    assert node["child_count"] == 173
    assert len(node["children"]) >= 170  # a couple may be unresolvable
    child = node["children"][0]
    assert child["step_count"] > 0
    # depth=1: grandchildren omitted even when child_count > 0
    assert all("children" not in c for c in node["children"])


@needs_botnick
def test_tree_depth_zero_omits_children():
    node = tree.build_tree(_botnick_root(), depth=0)
    assert "children" not in node
    assert node["child_count"] == 173


@needs_botnick
def test_find_traj_dir_and_breadcrumb():
    root = _botnick_root()
    node = tree.build_tree(root, depth=1)
    child = node["children"][0]
    child_dir = tree.find_traj_dir(root, child["traj_id"])
    assert child_dir is not None
    assert child_dir.name == child["slug"]
    crumbs = tree.breadcrumb(root, child_dir)
    assert len(crumbs) == 2
    assert crumbs[0]["traj_id"] == node["traj_id"]
    assert crumbs[1]["traj_id"] == child["traj_id"]
    # root lookup returns the root dir itself
    assert tree.find_traj_dir(root, node["traj_id"]) == root


def test_blob_name_whitelist():
    ok = "6780702f-3f7c-411e-bc3d-0bea2187ad30-000000.stdout"
    assert safety.checked_name(ok, safety.BLOB_NAME_RE) == ok
    for bad in [
        "../../../etc/passwd",
        "x.stdout",
        "6780702f-3f7c-411e-bc3d-0bea2187ad30-000000.txt",
        "6780702f-3f7c-411e-bc3d-0bea2187ad30-000000.stdout/../x",
    ]:
        with pytest.raises(HTTPException):
            safety.checked_name(bad, safety.BLOB_NAME_RE)


def test_contained_path_rejects_escape(tmp_path: Path):
    base = tmp_path / "blobs"
    base.mkdir()
    (tmp_path / "secret.txt").write_text("nope")
    inside = safety.contained_path(base, "a.stdout")
    assert inside.parent == base.resolve()
    with pytest.raises(HTTPException):
        safety.contained_path(base, "../secret.txt")
