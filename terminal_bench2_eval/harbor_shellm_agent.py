"""
Harbor harness for shellm agent.

This wraps the local `shellm` bash executable so it can be invoked by Harbor
inside benchmark task containers. Docker access (dind) is enabled so shellm
can recursively spawn child containers when it decides to.

Required env in the task container:
    ANTHROPIC_API_KEY            forwarded via --ae from the harbor CLI
    /var/run/docker.sock         mounted in via --mounts-json
    /usr/local/bin/shellm        copied in via the host shellm binary

Configurable kwargs (passed via `--ak key=value`):
    effort           : Reasoning effort (low/medium/high/xhigh/max). default: max
    max_iterations   : Max iterations per shellm call.  default: 1000
    max_depth        : Max nested shellm recursion depth.  default: 1000
    docker_access    : none/broker/socket/dind. default: none (top-level)
    inactivity_timeout: seconds before killing idle exec. default: 300
"""

import os
import shlex
from pathlib import Path

from harbor.agents.base import BaseAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


# Aggressive system prompt addition that encourages thinking hard and recursing.
PROMPT_PREAMBLE = (
    "You are evaluating on terminal-bench 2.0 inside the task's own "
    "container. The task fixture (files, services, etc.) lives right here "
    "in this filesystem (commonly under /app). Operate directly on it; "
    "do NOT spin up a separate container for top-level work.\n\n"
    "## How to use recursion\n"
    "Use recursion AGGRESSIVELY: spawn nested shellm sub-calls whenever you "
    "can break the work into independent sub-problems. Each nested call has "
    "fresh context and full thinking budget, so use them liberally to plan, "
    "explore, parallelize, verify, and double-check. Each nested sub-call "
    "MUST run in its own docker-in-docker sandbox so it cannot contaminate "
    "this task's filesystem. Invoke nested shellm with the dind flag and "
    "SHELLM_ALLOW_NESTED_DOCKER=1 like this:\n"
    "    SHELLM_ALLOW_NESTED_DOCKER=1 shellm \\\n"
    "        --effort max --max-iterations 1000 --max-depth 1000 \\\n"
    "        --docker-access dind \\\n"
    "        \"<sub-task description>\"\n"
    "Use sub-shellms for research, parsing, code synthesis, exploring "
    "alternatives, etc. Pass concrete files / context with `-f FILE` or via "
    "stdin. Sub-shellms run in a fresh ubuntu container with their own "
    "writable filesystem; reach back into this task with --var or by "
    "copying file contents through stdin/-f.\n\n"
    "## Mindset\n"
    "- Think as hard as you possibly can before each action.\n"
    "- DO NOT GIVE UP. If something fails, try a different approach.\n"
    "- Iterate until the task is solved completely. Verify your work.\n"
    "- Time is on your side: you have 1000 iterations and 1000 depth.\n\n"
    "=== TASK ===\n"
)


class ShellmAgent(BaseAgent):
    """
    Shellm harness for Harbor.

    The local `shellm` script is uploaded into the task container as
    /usr/local/bin/shellm, the docker.sock is mounted in via --mounts-json,
    and shellm is invoked with the supplied effort/iterations/depth.
    """

    SUPPORTS_ATIF: bool = False
    SUPPORTS_WINDOWS: bool = False

    def __init__(
        self,
        logs_dir: Path,
        model_name: str | None = None,
        effort: str = "max",
        max_iterations: int = 1000,
        max_depth: int = 1000,
        docker_access: str = "none",
        inactivity_timeout: int = 300,
        shellm_path: str = "/usr/local/bin/shellm",
        **kwargs,
    ):
        super().__init__(logs_dir=logs_dir, model_name=model_name, **kwargs)
        self.effort = effort
        self.max_iterations = int(max_iterations)
        self.max_depth = int(max_depth)
        self.docker_access = docker_access
        self.inactivity_timeout = int(inactivity_timeout)
        # Find shellm on the harness side (the harbor host).
        self.host_shellm_path = self._find_shellm(shellm_path)

    @staticmethod
    def name() -> str:
        return "shellm"

    def version(self) -> str:
        return "0.1.0"

    @staticmethod
    def _find_shellm(preferred: str) -> Path:
        for candidate in [preferred, "/usr/local/bin/shellm", "/usr/bin/shellm"]:
            p = Path(candidate)
            if p.is_file():
                return p
        # last resort: PATH search
        from shutil import which
        path = which("shellm")
        if path:
            return Path(path)
        raise FileNotFoundError(
            "shellm executable not found. Pass shellm_path via --ak."
        )

    async def setup(self, environment: BaseEnvironment) -> None:
        """Install dependencies and the shellm script in the task container."""
        # 1) install base packages and a modern docker CLI in the task container.
        # We avoid the distro's old docker.io because the host daemon is newer
        # than 1.44 API; the static docker CLI from docker.com matches our daemon.
        install_cmd = r"""
set -e
export DEBIAN_FRONTEND=noninteractive
need_install=()
for tool in bash curl jq python3 tmux ps; do
  command -v "$tool" >/dev/null 2>&1 || need_install+=("$tool")
done
# Install missing core tools.
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq >/dev/null 2>&1 || true
  apt-get install -y -qq --no-install-recommends bash curl jq python3 \
      ca-certificates tmux procps >/dev/null 2>&1 || \
    apt-get install -y --no-install-recommends bash curl jq python3 \
      ca-certificates tmux procps
elif command -v apk >/dev/null 2>&1; then
  apk add --no-cache bash curl jq python3 ca-certificates tmux procps coreutils
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y bash curl jq python3 ca-certificates tmux procps-ng
elif command -v yum >/dev/null 2>&1; then
  yum install -y bash curl jq python3 ca-certificates tmux procps-ng
fi

# Install docker CLI binary if missing or too old.
need_docker_cli=1
if command -v docker >/dev/null 2>&1; then
  client_ver=$(docker version --format '{{.Client.Version}}' 2>/dev/null || echo 0)
  major=$(echo "$client_ver" | cut -d. -f1)
  if [ "${major:-0}" -ge 24 ]; then
    need_docker_cli=0
  fi
fi
if [ "$need_docker_cli" -eq 1 ]; then
  arch=$(uname -m)
  case "$arch" in
    x86_64) DARCH=x86_64 ;;
    aarch64|arm64) DARCH=aarch64 ;;
    *) DARCH="$arch" ;;
  esac
  curl -fsSL "https://download.docker.com/linux/static/stable/$DARCH/docker-29.1.3.tgz" \
    -o /tmp/docker.tgz
  tar xzf /tmp/docker.tgz -C /tmp
  install /tmp/docker/docker /usr/local/bin/docker
  rm -rf /tmp/docker /tmp/docker.tgz
fi
docker version --format '{{.Client.Version}}' >/dev/null
"""
        await environment.exec(
            command=install_cmd,
            user="root",
            timeout_sec=600,
        )

        # 2) Upload shellm + sibling scripts (llm, shellm-docker,
        #    shellm-docker-broker, shellm-explore) to /usr/local/bin/.
        host_dir = self.host_shellm_path.parent
        for tool in (
            "shellm",
            "llm",
            "shellm-docker",
            "shellm-docker-broker",
            "shellm-explore",
        ):
            src = host_dir / tool
            if not src.is_file():
                self.logger.warning(f"shellm sibling tool {tool} not found at {src}")
                continue
            await environment.upload_file(
                source_path=src,
                target_path=f"/usr/local/bin/{tool}",
            )
        await environment.exec(
            command=(
                "chmod +x /usr/local/bin/shellm /usr/local/bin/llm "
                "/usr/local/bin/shellm-docker /usr/local/bin/shellm-docker-broker "
                "/usr/local/bin/shellm-explore 2>/dev/null; "
                "true"
            ),
            user="root",
        )

        # 3) Quick sanity check
        await environment.exec(
            command=(
                "set -e; "
                "shellm --help >/dev/null 2>&1 || "
                "  { echo 'shellm not runnable'; exit 1; }; "
                "command -v docker >/dev/null 2>&1 || "
                "  { echo 'docker CLI missing'; exit 1; }; "
                "docker info >/dev/null 2>&1 || "
                "  { echo 'docker daemon NOT reachable; check socket mount'; exit 1; }; "
                "echo OK"
            ),
            user="root",
        )

    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        prompt = PROMPT_PREAMBLE + instruction
        escaped_prompt = shlex.quote(prompt)

        env = {
            "ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY", ""),
            "SHELLM_EFFORT": self.effort,
            "SHELLM_MAX_ITERATIONS": str(self.max_iterations),
            "SHELLM_MAX_DEPTH": str(self.max_depth),
            "SHELLM_DOCKER_ACCESS": self.docker_access,
            "SHELLM_INACTIVITY_TIMEOUT": str(self.inactivity_timeout),
            # NOTE: Don't set SHELLM_ALLOW_NESTED_DOCKER=1 at top level so the
            # top-level shellm uses local execution INSIDE the task container
            # rather than spinning up its own sibling sandbox. Sub-shellm calls
            # that want dind must set SHELLM_ALLOW_NESTED_DOCKER=1 explicitly
            # (we tell the model how to do that in the prompt preamble).
            "SHELLM_TEMP_DOCKER": "1",  # tear down child containers when done
            "SHELLM_NO_BANNER": "1",
        }
        # forward optional model. shellm expects bare claude-* names.
        if self.model_name:
            mn = self.model_name
            for prefix in ("anthropic/", "openai/", "google/", "gemini/"):
                if mn.startswith(prefix):
                    mn = mn[len(prefix):]
                    break
            env["SHELLM_MODEL"] = mn

        cmd = (
            "set -o pipefail; "
            "mkdir -p /logs/agent; "
            "cd /app 2>/dev/null || cd / ; "
            f"shellm "
            f"--effort {shlex.quote(self.effort)} "
            f"--max-iterations {self.max_iterations} "
            f"--max-depth {self.max_depth} "
            f"--docker-access {shlex.quote(self.docker_access)} "
            f"{escaped_prompt} "
            "2>&1 | tee /logs/agent/shellm.log"
        )

        result = await environment.exec(
            command=cmd,
            user="root",
            env=env,
            timeout_sec=None,
        )

        # Persist stdout/stderr & exit info on the host side
        try:
            (self.logs_dir / "shellm.stdout.txt").write_text(result.stdout or "")
            (self.logs_dir / "shellm.stderr.txt").write_text(result.stderr or "")
            (self.logs_dir / "shellm.return_code.txt").write_text(
                str(result.return_code)
            )
        except Exception as e:
            self.logger.warning(f"failed to persist shellm logs: {e}")
