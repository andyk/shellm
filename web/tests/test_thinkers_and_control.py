"""Thinker status computation and control-endpoint tests."""

import json
import os
import stat
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from shellm_web import control, thinkers
from shellm_web.server import create_app

ROOT_TRAJ = "eeeeeeee-5555-4555-8555-555555555555"


def _make_thinker(identity: Path, name: str, types: list[str] | None = None) -> None:
    tdir = identity / "thinkers" / name
    tdir.mkdir(parents=True)
    step = tdir / "step"
    step.write_text("#!/usr/bin/env bash\ncat >/dev/null\n")
    step.chmod(step.stat().st_mode | stat.S_IXUSR)
    sub = {"types": types} if types else {}
    (tdir / "subscriptions.jsonl").write_text(json.dumps(sub) + "\n")


@pytest.fixture
def control_identity(tmp_path: Path) -> Path:
    """Root dir containing one identity with two thinkers and a mind log."""
    identity = tmp_path / ".identities" / "ctl"
    identity.mkdir(parents=True)
    (identity / "info.txt").write_text(
        f"name=ctl\ncreated=2026-07-14T00:00:00\nroot_trajectory={ROOT_TRAJ}\n"
        "think_model=test-model\n"
    )
    traj_dir = identity / "trajectories" / "eeeeeeee-root"
    traj_dir.mkdir(parents=True)
    (traj_dir / "trajectory.jsonl").write_text(
        json.dumps({"type": "trajectory", "step_id": ROOT_TRAJ, "ts": "t0"}) + "\n"
        + json.dumps(
            {
                "type": "message",
                "step_id": "m1",
                "content": "hi ctl",
                "from": "nick",
                "to": "ctl",
                "ts": "t1",
            }
        )
        + "\n"
        + json.dumps(
            {
                "type": "message",
                "step_id": "m2",
                "content": "hi nick",
                "from": "ctl",
                "to": "nick",
                "ts": "t2",
            }
        )
        + "\n"
    )
    _make_thinker(identity, "alpha", ["message"])
    _make_thinker(identity, "beta_two")
    (identity / "thinkers" / "_lib").mkdir()
    return identity


# ---------------------------------------------------------------------------
# Status computation
# ---------------------------------------------------------------------------


def test_status_never_started(control_identity: Path):
    status = thinkers.thinkers_status(control_identity)
    assert status["dispatcher"] == {"running": False, "pid": None}
    assert status["thinkers_total"] == 2
    assert {t["name"] for t in status["thinkers"]} == {"alpha", "beta_two"}
    assert all(t["state"] == "stopped" for t in status["thinkers"])
    alpha = next(t for t in status["thinkers"] if t["name"] == "alpha")
    assert alpha["types"] == ["message"]


def test_status_running_mix(control_identity: Path):
    run = control_identity / "run"
    (run / "pending").mkdir(parents=True)
    (run / "dispatcher.pid").write_text(str(os.getpid()))
    (run / "active_thinkers").write_text("alpha\n")
    # one live step (our own pid), one dead
    (run / "step_pids").write_text(f"{os.getpid()} alpha\n999999 alpha\n")
    (run / "pending" / "alpha.message").write_text("{}")

    status = thinkers.thinkers_status(control_identity)
    assert status["dispatcher"]["running"] is True
    alpha = next(t for t in status["thinkers"] if t["name"] == "alpha")
    beta = next(t for t in status["thinkers"] if t["name"] == "beta_two")
    assert alpha["state"] == "active"
    assert alpha["steps_in_flight"] == 1
    assert alpha["pending"] == ["message"]
    assert beta["state"] == "stopped"  # not in active_thinkers
    assert status["steps_in_flight"] == 1
    assert status["pending_total"] == 1


def test_status_dead_dispatcher(control_identity: Path):
    run = control_identity / "run"
    run.mkdir()
    (run / "dispatcher.pid").write_text("999999")
    (run / "active_thinkers").write_text("alpha\nbeta_two\n")
    status = thinkers.thinkers_status(control_identity)
    assert status["dispatcher"]["running"] is False
    assert all(t["state"] == "stopped" for t in status["thinkers"])
    summary = thinkers.thinkers_summary(control_identity)
    assert summary["thinkers_active"] == 0


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


@pytest.fixture
def client(control_identity: Path) -> TestClient:
    return TestClient(create_app(control_identity.parent.parent))


@pytest.fixture
def stub_bin(tmp_path: Path, monkeypatch) -> Path:
    """Fake CLI dir; each stub dumps env + argv to <stub>/calls.txt."""
    stub = tmp_path / "stub-bin"
    stub.mkdir()
    monkeypatch.setattr(control, "BIN_DIR", stub)
    return stub


def _write_stub(stub: Path, name: str, exit_code: int = 0, stderr: str = "") -> None:
    script = stub / name
    script.write_text(
        "#!/usr/bin/env bash\n"
        "{\n"
        f'  echo "CLI={name}"\n'
        '  echo "ARGS=$*"\n'
        '  echo "IDENTITY_DIR=$IDENTITY_DIR"\n'
        '  echo "TRAJ_ID=$TRAJ_ID"\n'
        '  echo "THINK_MODEL=$THINK_MODEL"\n'
        '  echo "PATH=$PATH"\n'
        '  echo "PWD=$PWD"\n'
        '  echo "APIKEY=$ANTHROPIC_API_KEY"\n'
        '  echo "STDIN=$(cat)"\n'
        f"}} >> {stub}/calls.txt\n"
        + (f"echo {json.dumps(stderr)} >&2\n" if stderr else "")
        + f"exit {exit_code}\n"
    )
    script.chmod(script.stat().st_mode | stat.S_IXUSR)


def _calls(stub: Path) -> str:
    return (stub / "calls.txt").read_text()


def test_identities_include_summary(client: TestClient):
    items = client.get("/api/identities").json()
    assert len(items) == 1
    assert items[0]["dispatcher"] == {"running": False, "pid": None}
    assert items[0]["thinkers_total"] == 2
    assert items[0]["thinkers_active"] == 0


def test_thinkers_endpoint(client: TestClient, control_identity: Path):
    identity_id = ".identities~ctl"
    body = client.get(f"/api/identities/{identity_id}/thinkers").json()
    assert body["identity"]["name"] == "ctl"
    assert body["thinkers_total"] == 2


def test_start_invokes_cli_with_env(client: TestClient, stub_bin: Path):
    _write_stub(stub_bin, "thinkers")
    resp = client.post(
        "/api/identities/.identities~ctl/thinkers/start", json={"names": ["alpha"]}
    )
    assert resp.status_code == 200, resp.text
    calls = _calls(stub_bin)
    assert "ARGS=start alpha" in calls
    assert "/.identities/ctl" in calls
    assert f"TRAJ_ID={ROOT_TRAJ}" in calls
    assert "THINK_MODEL=test-model" in calls
    assert f"PATH={stub_bin}:" in calls


def test_start_sources_root_env_file(
    client: TestClient, stub_bin: Path, control_identity: Path, monkeypatch
):
    """The serve root's .env supplies API keys (llm reads .env from cwd, and
    terminal sessions run from the repo root) — the web-launched CLI must see
    it too. The identity's own .env wins over the root's."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    root = control_identity.parent.parent
    (root / ".env").write_text("ANTHROPIC_API_KEY=root-key\n")
    _write_stub(stub_bin, "thinkers")
    client.post("/api/identities/.identities~ctl/thinkers/start", json={})
    calls = _calls(stub_bin)
    assert "APIKEY=root-key" in calls
    assert f"PWD={root}" in calls

    (control_identity / ".env").write_text("ANTHROPIC_API_KEY=identity-key\n")
    client.post("/api/identities/.identities~ctl/thinkers/start", json={})
    assert "APIKEY=identity-key" in _calls(stub_bin)


def test_start_conflict_maps_to_409(client: TestClient, stub_bin: Path):
    _write_stub(
        stub_bin,
        "thinkers",
        exit_code=1,
        stderr="thinkers: error: Dispatcher already running (PID 42). Use `thinkers stop` first.",
    )
    resp = client.post("/api/identities/.identities~ctl/thinkers/start", json={})
    assert resp.status_code == 409
    assert "Dispatcher already running" in resp.json()["detail"]["message"]


def test_name_validation(client: TestClient, stub_bin: Path):
    _write_stub(stub_bin, "thinkers")
    bad = client.post(
        "/api/identities/.identities~ctl/thinkers/start", json={"names": ["../evil"]}
    )
    assert bad.status_code == 422
    ghost = client.post(
        "/api/identities/.identities~ctl/thinkers/stop", json={"names": ["ghost"]}
    )
    assert ghost.status_code == 404
    assert not (stub_bin / "calls.txt").exists()


def test_step_trigger_fires(client: TestClient, stub_bin: Path):
    _write_stub(stub_bin, "thinkers")
    resp = client.post("/api/identities/.identities~ctl/thinkers/alpha/step")
    assert resp.status_code == 202
    # fire-and-forget: wait for the stub to write
    import time

    for _ in range(50):
        if (stub_bin / "calls.txt").exists():
            break
        time.sleep(0.05)
    assert "ARGS=step alpha" in _calls(stub_bin)


def test_chat_get(client: TestClient):
    body = client.get("/api/identities/.identities~ctl/chat").json()
    contents = [m["content"] for m in body["messages"]]
    assert contents == ["hi ctl", "hi nick"]
    assert body["messages"][0]["from"] == "nick"


def test_chat_send_pipes_stdin(client: TestClient, stub_bin: Path):
    _write_stub(stub_bin, "chat")
    resp = client.post(
        "/api/identities/.identities~ctl/chat",
        json={"content": "hello there", "from_name": "nick"},
    )
    assert resp.status_code == 200, resp.text
    calls = _calls(stub_bin)
    assert "ARGS=send --from nick --to ctl" in calls
    assert "STDIN=hello there" in calls


def test_chat_send_validation(client: TestClient, stub_bin: Path):
    _write_stub(stub_bin, "chat")
    resp = client.post(
        "/api/identities/.identities~ctl/chat",
        json={"content": "  ", "from_name": "nick"},
    )
    assert resp.status_code == 422
    resp = client.post(
        "/api/identities/.identities~ctl/chat",
        json={"content": "hi", "from_name": "nick; rm -rf"},
    )
    assert resp.status_code == 422


def test_create_identity(client: TestClient, stub_bin: Path, control_identity: Path):
    _write_stub(stub_bin, "identity")
    resp = client.post("/api/identities", json={"name": "newbie"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["id"] == ".identities~newbie"
    calls = _calls(stub_bin)
    assert "ARGS=new newbie" in calls
    root = control_identity.parent.parent
    assert f"IDENTITY_DIR={root}/.identities" in calls

    bad = client.post("/api/identities", json={"name": "Bad Name"})
    assert bad.status_code == 422


def test_killall(client: TestClient, stub_bin: Path):
    _write_stub(stub_bin, "shellm-killall")
    resp = client.post("/api/killall", json={"dry_run": True})
    assert resp.status_code == 200
    assert "ARGS=--dry-run" in _calls(stub_bin)


def test_disabled_marker_states(control_identity: Path):
    (control_identity / "thinkers" / "beta_two" / "disabled").touch()
    status = thinkers.thinkers_status(control_identity)
    beta = next(t for t in status["thinkers"] if t["name"] == "beta_two")
    assert beta["state"] == "disabled"
    assert status["thinkers_total"] == 1
    assert status["thinkers_disabled"] == 1
    summary = thinkers.thinkers_summary(control_identity)
    assert summary["thinkers_total"] == 1


def test_enable_disable_endpoints(client: TestClient, control_identity: Path, stub_bin: Path):
    _write_stub(stub_bin, "thinkers")
    marker = control_identity / "thinkers" / "beta_two" / "disabled"

    # disable a stopped thinker: marker written, no CLI stop needed
    resp = client.post("/api/identities/.identities~ctl/thinkers/beta_two/disable")
    assert resp.status_code == 200
    assert resp.json()["stopped_first"] is False
    assert marker.is_file()
    assert not (stub_bin / "calls.txt").exists()

    # starting or stepping a disabled thinker is a 409 with a clear message
    resp = client.post(
        "/api/identities/.identities~ctl/thinkers/start", json={"names": ["beta_two"]}
    )
    assert resp.status_code == 409
    assert "disabled" in resp.json()["detail"]

    # enable removes the marker; dispatcher down -> no restart hint
    resp = client.post("/api/identities/.identities~ctl/thinkers/beta_two/enable")
    assert resp.status_code == 200
    assert resp.json()["needs_restart"] is False
    assert not marker.is_file()

    # disabling an idle thinker (dispatcher up + active) stops it via the CLI
    run = control_identity / "run"
    run.mkdir(exist_ok=True)
    (run / "dispatcher.pid").write_text(str(os.getpid()))
    (run / "active_thinkers").write_text("beta_two\n")
    resp = client.post("/api/identities/.identities~ctl/thinkers/beta_two/disable")
    assert resp.status_code == 200
    assert resp.json()["stopped_first"] is True
    assert "ARGS=stop beta_two" in _calls(stub_bin)
    assert marker.is_file()

    # enabling while the dispatcher runs flags the restart requirement
    resp = client.post("/api/identities/.identities~ctl/thinkers/beta_two/enable")
    assert resp.json()["needs_restart"] is True


def test_env_endpoints(client: TestClient, control_identity: Path):
    identity_env = control_identity / ".env"
    identity_env.write_text(
        "# identity secrets\n"
        "ANTHROPIC_API_KEY=sk-ant-abc123456789xyzw\n"
        "SHELLM_MODEL=claude-opus-4-7\n"
    )
    root_env = control_identity.parent.parent / ".env"
    root_env.write_text("OPENAI_API_KEY=sk-oai-9876543210abcdef\nLANG=C\n")

    body = client.get("/api/identities/.identities~ctl/env").json()
    by_key = {entry["key"]: entry for entry in body["env"]}
    # secret: redacted peek only, never the full value
    assert by_key["ANTHROPIC_API_KEY"]["secret"] is True
    assert by_key["ANTHROPIC_API_KEY"]["value"] == "sk-ant…xyzw"
    assert "abc123456789" not in str(body)
    # non-secret: full value
    assert by_key["SHELLM_MODEL"] == {
        "key": "SHELLM_MODEL",
        "value": "claude-opus-4-7",
        "secret": False,
    }
    inherited = {entry["key"]: entry for entry in body["inherited"]}
    assert inherited["OPENAI_API_KEY"]["secret"] is True
    assert inherited["OPENAI_API_KEY"]["overridden"] is False

    # upsert: update existing + add new (value with spaces gets quoted)
    resp = client.put(
        "/api/identities/.identities~ctl/env",
        json={"key": "ANTHROPIC_API_KEY", "value": "sk-ant-new456789012pqrs"},
    )
    assert resp.status_code == 200
    assert resp.json()["value"] == "sk-ant…pqrs"
    client.put(
        "/api/identities/.identities~ctl/env",
        json={"key": "GREETING", "value": "hello world"},
    )
    text = identity_env.read_text()
    assert "# identity secrets" in text  # comments preserved
    assert "ANTHROPIC_API_KEY=sk-ant-new456789012pqrs" in text
    assert "GREETING='hello world'" in text
    assert text.count("ANTHROPIC_API_KEY") == 1

    # invalid key / multiline value
    assert (
        client.put(
            "/api/identities/.identities~ctl/env",
            json={"key": "BAD-KEY", "value": "x"},
        ).status_code
        == 422
    )
    assert (
        client.put(
            "/api/identities/.identities~ctl/env",
            json={"key": "OK", "value": "a\nb"},
        ).status_code
        == 422
    )

    # delete
    assert (
        client.delete("/api/identities/.identities~ctl/env/GREETING").status_code
        == 200
    )
    assert "GREETING" not in identity_env.read_text()
    assert (
        client.delete("/api/identities/.identities~ctl/env/GREETING").status_code
        == 404
    )


def test_cors_allowlist_from_env(control_identity: Path, monkeypatch):
    monkeypatch.setenv("SHELLM_WEB_ALLOWED_ORIGINS", "https://agents.example.com")
    pinned = TestClient(create_app(control_identity.parent.parent))
    allowed = pinned.get("/api/health", headers={"Origin": "https://agents.example.com"})
    assert allowed.headers.get("access-control-allow-origin") == "https://agents.example.com"
    denied = pinned.get("/api/health", headers={"Origin": "https://evil.example.com"})
    assert "access-control-allow-origin" not in denied.headers

    # default "*": any origin is allowed (starlette echoes the origin when
    # credentials are enabled rather than sending a literal *)
    monkeypatch.delenv("SHELLM_WEB_ALLOWED_ORIGINS")
    open_client = TestClient(create_app(control_identity.parent.parent))
    resp = open_client.get("/api/health", headers={"Origin": "https://anywhere.example"})
    assert resp.headers.get("access-control-allow-origin") == "https://anywhere.example"


def test_read_only_blocks_mutations(control_identity: Path):
    ro_client = TestClient(create_app(control_identity.parent.parent, read_only=True))
    assert ro_client.get("/api/config").json()["controls_enabled"] is False
    for path, body in [
        ("/api/identities/.identities~ctl/thinkers/start", {}),
        ("/api/identities/.identities~ctl/thinkers/stop", {}),
        ("/api/identities/.identities~ctl/thinkers/alpha/step", None),
        ("/api/identities/.identities~ctl/thinkers/alpha/disable", None),
        ("/api/identities/.identities~ctl/thinkers/alpha/enable", None),
        ("/api/identities/.identities~ctl/chat", {"content": "x", "from_name": "n"}),
        ("/api/identities", {"name": "x"}),
        ("/api/killall", {}),
    ]:
        resp = ro_client.post(path, json=body)
        assert resp.status_code == 403, path
    assert (
        ro_client.put(
            "/api/identities/.identities~ctl/env", json={"key": "K", "value": "v"}
        ).status_code
        == 403
    )
    assert (
        ro_client.delete("/api/identities/.identities~ctl/env/K").status_code == 403
    )
