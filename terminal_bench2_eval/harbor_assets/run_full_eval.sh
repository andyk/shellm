#!/usr/bin/env bash
# Full Terminal Bench 2.0 evaluation against shellm.
# Memory-aware: -n 2 is safe for an 8GB Docker allocation.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; . .env; set +a

JOBS_DIR="${JOBS_DIR:-$(pwd)/.harbor-jobs}"
mkdir -p "$JOBS_DIR"

uvx harbor run \
  --agent-import-path harbor_shellm_agent:ShellmAgent \
  --dataset terminal-bench@2.0 \
  --ak max_iterations=1000 \
  --ak max_depth=1000 \
  --ak effort=max \
  --ak prompt_template_path="$(pwd)/harbor_assets/shellm_prompt.j2" \
  --ae ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  --ae SHELLM_NO_BANNER=1 \
  -o "$JOBS_DIR" \
  -n 2 \
  --yes \
  "$@"
