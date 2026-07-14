"""Mutations: shell out to the repo's bash CLIs (thinkers, chat, identity,
shellm-killall) with the same environment `identity shell` would set.

Process management stays in bash — this module only builds env, serializes
concurrent mutations per identity, and maps CLI failures to HTTP errors.
"""

import os
import subprocess
import threading
from pathlib import Path

from fastapi import HTTPException

from shellm_web.discovery import IdentityInfo, _parse_info_txt

# Repo layout: <repo>/web/src/shellm_web/control.py -> <repo>/bin
BIN_DIR = Path(
    os.environ.get("SHELLM_BIN_DIR") or Path(__file__).resolve().parents[3] / "bin"
)

DEFAULT_TIMEOUT = 60

# Serialize start/stop per identity: cmd_stop rewrites run/active_thinkers
# with a non-atomic grep>tmp;mv, so concurrent mutations can clobber it.
_locks_guard = threading.Lock()
_identity_locks: dict[str, threading.Lock] = {}


def identity_lock(identity_id: str) -> threading.Lock:
    with _locks_guard:
        lock = _identity_locks.get(identity_id)
        if lock is None:
            lock = threading.Lock()
            _identity_locks[identity_id] = lock
        return lock


def identity_env(identity: IdentityInfo, root: Path | None = None) -> dict[str, str]:
    """Replicate the env exports of `identity shell` (bin/identity:302-325)."""
    info = _parse_info_txt(identity.path / "info.txt")
    d = str(identity.path)
    root_traj = info.get("root_trajectory", "")
    env = os.environ.copy()
    env.update(
        {
            "SHELLM_WEB_SERVE_ROOT": str(root) if root else "",
            "IDENTITY_DIR": d,
            "IDENTITY_NAME": info.get("name", identity.path.name),
            "MEM_DIR": f"{d}/memories",
            "SKILLS_DIR": f"{d}/skills",
            "SKILLS_KERNEL_DIR": f"{d}/kernel",
            "TRAJ_DIR": f"{d}/trajectories",
            "TRAJ_ID": root_traj,
            "ROOT_TRAJ_ID": root_traj,
            "THINKERS_DIR": f"{d}/thinkers",
            "SHELLM_HOME": f"{d}/.shellm",
            "SKILLSRC": f"{d}/skills/.skillsrc",
            "SHELLM_TRAJ_DIR": f"{d}/trajectories",
            "SHELLM_ENVS_DIR": f"{d}/.shellm/envs",
            "SHELLM_WORKDIRS_DIR": f"{d}/.shellm/workdirs",
            "SHELLM_BROKER_DIR": f"{d}/.shellm/docker-broker",
            "SHELLM_CONF_DIR": f"{d}/.shellm",
            "CHATRC": f"{d}/chat/.chatrc",
            "THINK_MODEL": info.get("think_model")
            or os.environ.get("SHELLM_MODEL", "claude-opus-4-7"),
            "THINK_TICK_INTERVAL": info.get("interval", "0"),
            "THINK_CONTEXT_TAIL": os.environ.get("THINK_CONTEXT_TAIL", "30"),
            "PATH": f"{BIN_DIR}:{env.get('PATH', '')}",
        }
    )
    return env


# Source .env files before exec'ing the target CLI: the serve root's first
# (llm/shellm load .env from cwd, and terminal sessions run from the repo
# root), then the identity's own, so identity-specific keys win.
_ENV_WRAPPER = (
    "set -a; "
    '[ -n "$SHELLM_WEB_SERVE_ROOT" ] && [ -f "$SHELLM_WEB_SERVE_ROOT/.env" ] '
    '&& . "$SHELLM_WEB_SERVE_ROOT/.env"; '
    '[ -f "$IDENTITY_DIR/.env" ] && . "$IDENTITY_DIR/.env"; '
    "set +a; "
    'exec "$0" "$@"'
)


def _wrap(cli: str, *args: str) -> list[str]:
    return ["bash", "-c", _ENV_WRAPPER, str(BIN_DIR / cli), *args]


def run_cli(
    cmd: list[str],
    env: dict[str, str],
    cwd: Path,
    *,
    stdin_text: str | None = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            cmd,
            env=env,
            cwd=str(cwd),
            input=stdin_text,
            stdin=subprocess.DEVNULL if stdin_text is None else None,
            capture_output=True,
            text=True,
            timeout=timeout,
            # New session so backgrounded children (the dispatcher) survive
            # uvicorn Ctrl-C / --reload, which signal the whole process group.
            start_new_session=True,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(
            status_code=500,
            detail={"message": f"{cmd[3] if len(cmd) > 3 else cmd[0]} timed out after {timeout}s"},
        ) from exc


def _raise_for_failure(proc: subprocess.CompletedProcess) -> None:
    if proc.returncode == 0:
        return
    stderr_lines = [line for line in (proc.stderr or "").splitlines() if line.strip()]
    message = stderr_lines[-1] if stderr_lines else f"exit code {proc.returncode}"
    raise HTTPException(
        status_code=409,
        detail={
            "message": message,
            "stderr": proc.stderr,
            "exit_code": proc.returncode,
        },
    )


def _result(action: str, names: list[str], proc: subprocess.CompletedProcess) -> dict:
    return {
        "ok": True,
        "action": action,
        "names": names,
        "exit_code": proc.returncode,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
    }


def thinkers_start(
    root: Path,
    identity: IdentityInfo,
    names: list[str],
    no_self_trigger: bool = False,
) -> dict:
    args = ["start"]
    if no_self_trigger:
        args.append("--no-self-trigger")
    args.extend(names)
    with identity_lock(identity.id):
        proc = run_cli(_wrap("thinkers", *args), identity_env(identity, root), root)
    _raise_for_failure(proc)
    return _result("start", names, proc)


def thinkers_stop(root: Path, identity: IdentityInfo, names: list[str]) -> dict:
    with identity_lock(identity.id):
        proc = run_cli(
            _wrap("thinkers", "stop", *names), identity_env(identity, root), root
        )
    _raise_for_failure(proc)
    return _result("stop", names, proc)


def thinkers_step(root: Path, identity: IdentityInfo, name: str) -> dict:
    """Fire-and-forget manual trigger: cmd_step tees output to run/logs/<name>.log
    and may run for minutes (it can call an LLM), so don't block the request."""
    subprocess.Popen(
        _wrap("thinkers", "step", name),
        env=identity_env(identity, root),
        cwd=str(root),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    return {"ok": True, "action": "step", "names": [name]}


def chat_send(root: Path, identity: IdentityInfo, content: str, from_name: str) -> dict:
    env = identity_env(identity, root)
    to_name = env["IDENTITY_NAME"]
    proc = run_cli(
        _wrap("chat", "send", "--from", from_name, "--to", to_name),
        env,
        root,
        stdin_text=content,
    )
    _raise_for_failure(proc)
    return {"ok": True, "from": from_name, "to": to_name}


def identity_new(root: Path, name: str) -> dict:
    env = os.environ.copy()
    env["PATH"] = f"{BIN_DIR}:{env.get('PATH', '')}"
    env["IDENTITY_DIR"] = str(root / ".identities")
    # With IDENTITY_NAME set, bin/identity treats IDENTITY_DIR as an active
    # identity and rebases to its parent — make sure we pass the root form.
    env.pop("IDENTITY_NAME", None)
    proc = run_cli([str(BIN_DIR / "identity"), "new", name], env, root)
    _raise_for_failure(proc)
    return {
        "ok": True,
        "id": f".identities~{name}",
        "name": name,
        "stderr": proc.stderr,
    }


def killall(dry_run: bool = False) -> dict:
    env = os.environ.copy()
    env["PATH"] = f"{BIN_DIR}:{env.get('PATH', '')}"
    args = [str(BIN_DIR / "shellm-killall")] + (["--dry-run"] if dry_run else [])
    proc = run_cli(args, env, BIN_DIR.parent)
    _raise_for_failure(proc)
    return {"ok": True, "dry_run": dry_run, "stdout": proc.stdout, "stderr": proc.stderr}
