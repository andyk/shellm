"""Identity import/export endpoint tests (CLI stubbed, byte plumbing real)."""

import gzip
import json
import stat
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from shellm_web import control
from shellm_web.server import create_app

ROOT_TRAJ = "ffffffff-6666-4666-8666-666666666666"
GZIP_BODY = gzip.compress(b"fake archive")


@pytest.fixture
def ident_root(tmp_path: Path) -> Path:
    identity = tmp_path / ".identities" / "porta"
    identity.mkdir(parents=True)
    (identity / "info.txt").write_text(
        f"name=porta\ncreated=2026-07-17T00:00:00\nroot_trajectory={ROOT_TRAJ}\n"
    )
    traj_dir = identity / "trajectories" / "ffffffff-root"
    traj_dir.mkdir(parents=True)
    (traj_dir / "trajectory.jsonl").write_text(
        json.dumps({"type": "trajectory", "step_id": ROOT_TRAJ, "ts": "t0"}) + "\n"
    )
    return tmp_path


@pytest.fixture
def client(ident_root: Path) -> TestClient:
    return TestClient(create_app(ident_root))


@pytest.fixture
def stub_bin(tmp_path: Path, monkeypatch) -> Path:
    stub = tmp_path / "stub-bin"
    stub.mkdir()
    monkeypatch.setattr(control, "BIN_DIR", stub)
    return stub


def _write_identity_stub(stub: Path, *, exit_code: int = 0, stderr: str = "") -> None:
    """Stub bin/identity: logs env+argv; `export` writes bytes to the -o
    target, `import` prints imported names on stdout."""
    script = stub / "identity"
    script.write_text(
        "#!/usr/bin/env bash\n"
        "{\n"
        '  echo "ARGS=$*"\n'
        '  echo "IDENTITY_DIR=$IDENTITY_DIR"\n'
        '  echo "IDENTITY_NAME=${IDENTITY_NAME:-unset}"\n'
        f"}} >> {stub}/calls.txt\n"
        'if [ "$1" = export ]; then\n'
        '  out=""\n'
        '  while [ $# -gt 0 ]; do [ "$1" = -o ] && out="$2"; shift; done\n'
        '  printf FAKEEXPORT > "$out"\n'
        "elif [ \"$1\" = import ]; then\n"
        f"  cp \"$2\" {stub}/uploaded.bin\n"
        "  echo porta-two\n"
        "fi\n"
        + (f"echo {json.dumps(stderr)} >&2\n" if stderr else "")
        + f"exit {exit_code}\n"
    )
    script.chmod(script.stat().st_mode | stat.S_IXUSR)


def _calls(stub: Path) -> str:
    return (stub / "calls.txt").read_text()


def test_export_identity_streams_archive(client: TestClient, stub_bin: Path, ident_root: Path):
    resp = client.get("/api/identities/.identities~porta/export")
    assert resp.status_code == 200, resp.text
    assert resp.content == b"FAKEEXPORT"
    assert resp.headers["content-type"] == "application/gzip"
    disposition = resp.headers["content-disposition"]
    assert "porta-" in disposition and ".shellm.tgz" in disposition
    calls = _calls(stub_bin)
    assert f"ARGS=export --path {ident_root}/.identities/porta -o " in calls
    assert "--soul-only" not in calls


def test_export_soul_only_flag(client: TestClient, stub_bin: Path):
    resp = client.get("/api/identities/.identities~porta/export?soul_only=true")
    assert resp.status_code == 200
    assert "--soul-only" in _calls(stub_bin)


def test_export_unknown_identity_404(client: TestClient, stub_bin: Path):
    assert client.get("/api/identities/.identities~ghost/export").status_code == 404
    assert not (stub_bin / "calls.txt").exists()


def test_export_all(client: TestClient, stub_bin: Path, ident_root: Path):
    resp = client.get("/api/export")
    assert resp.status_code == 200
    assert resp.content == b"FAKEEXPORT"
    assert "identities-" in resp.headers["content-disposition"]
    calls = _calls(stub_bin)
    assert "ARGS=export --all -o " in calls
    assert f"IDENTITY_DIR={ident_root}/.identities" in calls
    assert "IDENTITY_NAME=unset" in calls


def test_export_cli_failure_maps_to_409(client: TestClient, stub_bin: Path):
    _write_identity_stub(stub_bin, exit_code=1, stderr="identity: error: No identities found")
    resp = client.get("/api/export")
    assert resp.status_code == 409
    assert "No identities found" in resp.json()["detail"]["message"]


def test_import_uploads_and_reports_names(client: TestClient, stub_bin: Path, ident_root: Path):
    resp = client.post(
        "/api/identities/import",
        content=GZIP_BODY,
        headers={"Content-Type": "application/gzip"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["imported"] == [{"id": ".identities~porta-two", "name": "porta-two"}]
    calls = _calls(stub_bin)
    assert "ARGS=import " in calls
    assert "--name" not in calls
    assert f"IDENTITY_DIR={ident_root}/.identities" in calls
    # The uploaded bytes reached the CLI intact
    assert (stub_bin / "uploaded.bin").read_bytes() == GZIP_BODY


def test_import_with_rename(client: TestClient, stub_bin: Path):
    resp = client.post(
        "/api/identities/import?name=fresh-name",
        content=GZIP_BODY,
    )
    assert resp.status_code == 201
    assert "--name fresh-name" in _calls(stub_bin)


def test_import_validates_name(client: TestClient, stub_bin: Path):
    resp = client.post("/api/identities/import?name=Bad%20Name", content=GZIP_BODY)
    assert resp.status_code == 422
    assert not (stub_bin / "calls.txt").exists()


def test_import_rejects_non_gzip(client: TestClient, stub_bin: Path):
    resp = client.post("/api/identities/import", content=b"just some text")
    assert resp.status_code == 422
    assert "gzip" in resp.json()["detail"]
    assert not (stub_bin / "calls.txt").exists()
    # empty body is also a clean 422
    assert client.post("/api/identities/import", content=b"").status_code == 422


def test_import_size_cap(client: TestClient, stub_bin: Path, monkeypatch):
    monkeypatch.setenv("SHELLM_WEB_MAX_IMPORT_MB", "0")
    resp = client.post("/api/identities/import", content=GZIP_BODY)
    assert resp.status_code == 413
    assert not (stub_bin / "calls.txt").exists()


def test_import_cli_conflict_maps_to_409(client: TestClient, stub_bin: Path):
    _write_identity_stub(
        stub_bin,
        exit_code=1,
        stderr="identity: error: import: identity already exists: porta",
    )
    resp = client.post("/api/identities/import", content=GZIP_BODY)
    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]["message"]


def test_read_only_allows_export_blocks_import(ident_root: Path, stub_bin: Path):
    _write_identity_stub(stub_bin)
    ro = TestClient(create_app(ident_root, read_only=True))
    assert ro.get("/api/identities/.identities~porta/export").status_code == 200
    assert ro.get("/api/export").status_code == 200
    assert ro.post("/api/identities/import", content=GZIP_BODY).status_code == 403


@pytest.fixture(autouse=True)
def _default_stub(stub_bin: Path):
    _write_identity_stub(stub_bin)
