"""Fork-tree resolution and path-safety tests."""

from pathlib import Path

import pytest
from fastapi import HTTPException

from shellm_web import discovery, safety, tree


def _root_dir(identity_dir: Path) -> Path:
    identities = discovery.scan_identities(identity_dir.parent)
    identity = next(i for i in identities if i.path == identity_dir)
    traj_dir = discovery.find_root_traj_dir(identity)
    assert traj_dir is not None
    return traj_dir


def test_tree_shallow(synth_identity):
    root = _root_dir(synth_identity)
    node = tree.build_tree(root, depth=1)
    assert node["child_count"] == 3
    # the dangling fork has no child dir on disk -> only 2 resolvable
    assert [c["slug"] for c in node["children"]] == ["bbbbbbbb-research", "cccccccc-notes"]
    child = node["children"][0]
    assert child["step_count"] == 4
    assert child["has_final"] is True
    # depth=1: grandchildren omitted even when child_count > 0
    assert all("children" not in c for c in node["children"])


def test_tree_depth_zero_omits_children(synth_identity):
    node = tree.build_tree(_root_dir(synth_identity), depth=0)
    assert "children" not in node
    assert node["child_count"] == 3


def test_find_traj_dir_and_breadcrumb(synth_identity):
    root = _root_dir(synth_identity)
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
