"""Launch the shellm web viewer

Prod:  shellm-web [ROOT]         # build frontend if missing, serve on one port
Dev:   shellm-web --dev [ROOT]   # vite dev server + uvicorn --reload
"""

import argparse
import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path

PACKAGE_DIR = Path(__file__).parent
STATIC_DIR = PACKAGE_DIR / "static"
WEB_DIR = PACKAGE_DIR.parent.parent  # <repo>/web
VIEWER_DIR = WEB_DIR / "viewer"

DEFAULT_PORT_RANGE = range(8080, 8090)


def _find_available_port(host: str, ports: range) -> int:
    for port in ports:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind((host, port))
                return port
            except OSError:
                continue
    raise SystemExit(f"No available port in {ports.start}-{ports.stop - 1}")


def _js_runtime() -> list[str]:
    """Pick the JS package manager for the frontend.

    Order: $SHELLM_WEB_JS override, then bun > pnpm > npm by availability.
    pnpm falls back to `corepack pnpm` (bundled with node) when not installed
    directly.
    """

    def resolve(name: str) -> list[str] | None:
        if shutil.which(name):
            return [name]
        if name == "pnpm" and shutil.which("corepack"):
            return ["corepack", "pnpm"]
        return None

    override = os.environ.get("SHELLM_WEB_JS")
    if override:
        runtime = resolve(override)
        if runtime is None:
            raise SystemExit(f"SHELLM_WEB_JS={override} but it isn't on PATH")
        return runtime
    for name in ("bun", "pnpm", "npm"):
        if name == "pnpm" and not shutil.which("pnpm"):
            continue  # corepack fallback only when pnpm is asked for explicitly
        runtime = resolve(name)
        if runtime is not None:
            return runtime
    raise SystemExit(
        "No JS package manager found; install bun, pnpm, or npm "
        "(or set SHELLM_WEB_JS)"
    )


def _build_frontend() -> None:
    runtime = _js_runtime()
    print(f"Building frontend with {' '.join(runtime)} in {VIEWER_DIR} ...", file=sys.stderr)
    subprocess.run([*runtime, "install"], cwd=VIEWER_DIR, check=True)
    subprocess.run([*runtime, "run", "build"], cwd=VIEWER_DIR, check=True)
    build_dir = VIEWER_DIR / "build" / "client"
    if not build_dir.is_dir():
        raise SystemExit(f"Frontend build output missing: {build_dir}")
    if STATIC_DIR.exists():
        shutil.rmtree(STATIC_DIR)
    shutil.copytree(build_dir, STATIC_DIR)


def _run_production(root: Path, host: str, port: int, rebuild: bool) -> None:
    import uvicorn

    from shellm_web.server import create_app

    if rebuild or not (STATIC_DIR / "index.html").is_file():
        _build_frontend()
    app = create_app(root, STATIC_DIR)
    print(f"shellm-web serving {root} at http://{host}:{port}", file=sys.stderr)
    uvicorn.run(app, host=host, port=port, log_level="info")


def _run_dev(root: Path, host: str, port: int) -> None:
    import uvicorn

    runtime = _js_runtime()
    env = os.environ.copy()
    env["VITE_API_URL"] = f"http://{host}:{port}"
    frontend = subprocess.Popen([*runtime, "run", "dev"], cwd=VIEWER_DIR, env=env)
    print(
        f"shellm-web dev: backend http://{host}:{port}, frontend http://localhost:5173",
        file=sys.stderr,
    )
    try:
        os.environ["SHELLM_WEB_ROOT"] = str(root)
        uvicorn.run(
            "shellm_web:create_app_from_env",
            host=host,
            port=port,
            factory=True,
            reload=True,
            reload_dirs=[str(PACKAGE_DIR)],
            log_level="info",
        )
    finally:
        frontend.terminate()
        try:
            frontend.wait(timeout=5)
        except subprocess.TimeoutExpired:
            frontend.kill()


def main() -> None:
    parser = argparse.ArgumentParser(prog="shellm-web", description=__doc__)
    parser.add_argument("root", nargs="?", default=".", help="Directory to scan for identities")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=None, help="Port (default: first free in 8080-8089)")
    parser.add_argument("--dev", action="store_true", help="Run vite dev server + uvicorn --reload")
    parser.add_argument("--rebuild", action="store_true", help="Force a frontend rebuild")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not root.is_dir():
        raise SystemExit(f"Not a directory: {root}")
    port = args.port or _find_available_port(args.host, DEFAULT_PORT_RANGE)

    if args.dev:
        _run_dev(root, args.host, port)
    else:
        _run_production(root, args.host, port, args.rebuild)


if __name__ == "__main__":
    main()
