"""
Custom Harbor docker environment that disables the deploy.resources.limits block.

In a Docker-in-Docker setup running on cgroup v2 in "domain threaded" mode,
trying to apply CPU/memory limits via `deploy.resources.limits` triggers:

    cannot enter cgroupv2 "/sys/fs/cgroup/docker" with domain controllers
    -- it is in threaded mode

This subclass writes a small compose override file that resets the limits to
empty so docker compose accepts the configuration without trying to set
unsupported cgroup controllers.
"""

import json
from pathlib import Path

from harbor.environments.docker.docker import DockerEnvironment


class ShellmDockerEnvironment(DockerEnvironment):
    """DockerEnvironment that drops resource limits to support DinD setups."""

    def _write_mounts_compose_file(self) -> Path:  # type: ignore[override]
        """Write a compose override that adds mounts and clears resource limits.

        We deliberately re-use the base file path/name so the parent class still
        finds and includes it via _docker_compose_paths.
        """
        services_main: dict = {}
        if self._mounts_json:
            services_main["volumes"] = self._mounts_json
        # Reset the deploy.resources.limits set by docker-compose-base.yaml
        # because in DinD-on-cgroup-v2 these break container creation.
        services_main["deploy"] = {
            "resources": {
                "limits": {"__reset__": True},
            }
        }

        compose = {"services": {"main": services_main}}
        # Use docker-compose extension `!reset` for limits via the JSON-friendly
        # `!override` mechanism. Since !reset isn't expressible in JSON, we
        # emit YAML directly.
        path = self.trial_paths.trial_dir / "docker-compose-mounts.yaml"
        path.parent.mkdir(parents=True, exist_ok=True)

        # Build YAML manually so we can include the !reset tag.
        yaml_lines = [
            "services:",
            "  main:",
            "    deploy:",
            "      resources:",
            "        limits: !reset {}",
        ]
        if self._mounts_json:
            yaml_lines.append("    volumes:")
            for vol in self._mounts_json:
                yaml_lines.append("      - type: " + vol["type"])
                yaml_lines.append("        source: " + vol["source"])
                yaml_lines.append("        target: " + vol["target"])
                if vol.get("read_only"):
                    yaml_lines.append("        read_only: true")
        path.write_text("\n".join(yaml_lines) + "\n")

        # Also write the JSON variant for any tooling that reads
        # docker-compose-mounts.json (parity with upstream behavior).
        json_path = self.trial_paths.trial_dir / "docker-compose-mounts.json"
        json_path.write_text(
            json.dumps({"services": {"main": services_main}}, indent=2)
        )
        return path
